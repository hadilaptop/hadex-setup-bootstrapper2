const { app, BrowserWindow, WebContentsView, ipcMain, shell, nativeTheme, session } = require("electron");
const path = require("node:path");

// Keep the Chromium profile and signed-in sessions in a stable per-user location.
// This is deliberately outside the installation folder so app updates do not erase logins.
const APP_USER_DATA = path.join(app.getPath("appData"), "Hadex Browser");
app.setPath("userData", APP_USER_DATA);

app.disableHardwareAcceleration();

let mainWindow;
let tabs = [];
let activeTabId = null;
let nextTabId = 1;
let stageBounds = null;
let currentTheme = "dark";
let currentViewMode = "installer";

let modalWindow = null;
let modalResolve = null;

const START_URL = "https://chatgpt.com/";

const DEFAULT_TABS = [
  { icon: "C", title: "ChatGPT", url: "https://chatgpt.com/" },
  { icon: "O", title: "OpenAI Platform", url: "https://platform.openai.com/" }
];

// Use Electron Chromium's default user-agent and visibility behavior.

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function activeTab() {
  return tabs.find((tab) => tab.id === activeTabId) || null;
}

function findTabByInitialUrl(substr) {
  return tabs.find((t) => (t.initialUrl || "").includes(substr));
}

// دسترسی به تب‌های داخلی برای انجام عملیات پس‌زمینه (بدون نمایش).
// هر دو تب ChatGPT و OpenAI Platform حتی در حالت installer/success
// با ابعاد 0x0 و backgroundThrottling:false کاملاً زنده‌اند و می‌توان
// از webContents آن‌ها برای اجرای JS، fetch، کلیک، پر کردن فرم و ...
// استفاده کرد — بدون این‌که کاربر چیزی ببیند.
function getChatGPTTab() { return findTabByInitialUrl("chatgpt.com"); }
function getOpenAITab() { return findTabByInitialUrl("platform.openai.com"); }

function publishTabs() {
  send("browser:tabs", {
    activeTabId,
    tabs: tabs.map(({ id, title, url, isFixed, icon }) => ({ id, title, url, isFixed, icon }))
  });
}

function applyBounds(tab) {
  if (!mainWindow || !tab) return;
  const isActive = tab.id === activeTabId;
  const target = isActive ? (stageBounds || tab.bounds) : null;

  if (currentViewMode !== "browser") {
    // مخفی کردن بصری — ولی webContents زنده و فعال است.
    tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return;
  }

  tab.view.setBounds(target
    ? { x: target.x, y: target.y, width: target.width, height: target.height }
    : { x: 0, y: 0, width: 0, height: 0 });
}

// Only force a style recolor. Do NOT dispatch a synthetic resize event here:
// on some SPAs (e.g. platform.openai.com) receiving a resize while the view
// is still at 0x0 makes the page snap its scroll position to the bottom.
function injectThemeInto(webContents) {
  webContents.executeJavaScript(`
    (() => {
      if (!document.documentElement) return;
      document.documentElement.style.colorScheme = '${currentTheme}';
      if (document.body) document.body.style.colorScheme = '${currentTheme}';
    })();
  `).catch(() => {});
}

// Aggressively scroll every scrollable container to the top for a short window
// after load. This is needed because some SPAs (platform.openai.com in
// particular) call their own scroll/layout routines shortly after paint
// and snap the viewport to the bottom. We keep forcing top for ~1.5s, then
// do one final catch-all reset after another 1s.
function resetScrollToTop(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.executeJavaScript(`
    (() => {
      const scrollAll = () => {
        try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }
        catch (e) { try { window.scrollTo(0, 0); } catch (_) {} }
        try { if (document.scrollingElement) document.scrollingElement.scrollTop = 0; } catch (e) {}
        try { if (document.documentElement) document.documentElement.scrollTop = 0; } catch (e) {}
        try { if (document.body) document.body.scrollTop = 0; } catch (e) {}
        try {
          const nodes = document.querySelectorAll('*');
          for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            if (el && el.scrollTop > 0) el.scrollTop = 0;
          }
        } catch (e) {}
      };

      let count = 0;
      const tick = () => {
        scrollAll();
        count++;
        if (count < 16) setTimeout(tick, 100);
        else setTimeout(scrollAll, 1000);
      };
      tick();
    })();
  `).catch(() => {});
}

function applyThemeToAll() {
  const bg = currentTheme === "dark" ? "#1a1a1a" : "#ffffff";
  nativeTheme.themeSource = currentTheme;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(currentTheme === "dark" ? "#10141d" : "#f3f4f6");
  }

  for (const tab of tabs) {
    tab.view.setBackgroundColor(bg);
    injectThemeInto(tab.view.webContents);
  }
}

// ---------------------------------------------------------------------------
// Themed modal dialog system
// ---------------------------------------------------------------------------

function splitError(err) {
  const raw = err && err.stack ? String(err.stack) : String(err || "خطای نامشخص");
  const lines = raw.split("\n");
  const first = (lines.shift() || "").trim() || "خطای نامشخص";
  const rest = lines.join("\n").trim();
  return { message: first, details: rest };
}

function centerModalOverParent() {
  if (!modalWindow || modalWindow.isDestroyed()) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const pb = mainWindow.getBounds();
  const nb = modalWindow.getBounds();
  modalWindow.setPosition(
    Math.round(pb.x + (pb.width - nb.width) / 2),
    Math.round(pb.y + (pb.height - nb.height) / 2)
  );
}

function closeModalWindow(result) {
  if (modalResolve) {
    const resolve = modalResolve;
    modalResolve = null;
    resolve(!!result);
  }
  if (modalWindow && !modalWindow.isDestroyed()) modalWindow.close();
}

function openModalWindow(options = {}) {
  const { title = "پیام", message = "", details = "", type = "info", confirm = false } = options;

  if (modalWindow && !modalWindow.isDestroyed()) {
    closeModalWindow(false);
  }

  return new Promise((resolve) => {
    modalResolve = resolve;

    const bg = currentTheme === "dark" ? "#151b27" : "#ffffff";

    modalWindow = new BrowserWindow({
      width: 520,
      height: 250,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      modal: true,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      backgroundColor: bg,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "modal-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    modalWindow.setMenuBarVisibility(false);

    modalWindow.on("closed", () => {
      modalWindow = null;
      if (modalResolve) {
        const r = modalResolve;
        modalResolve = null;
        r(false);
      }
    });

    modalWindow.webContents.once("did-finish-load", () => {
      if (!modalWindow || modalWindow.isDestroyed()) return;
      modalWindow.webContents.send("modal:init", {
        title,
        message,
        details,
        type,
        confirm,
        theme: currentTheme
      });
    });

    modalWindow.once("ready-to-show", () => {
      if (!modalWindow || modalWindow.isDestroyed()) return;
      centerModalOverParent();
      modalWindow.show();
      modalWindow.focus();
    });

    modalWindow.loadFile(path.join(__dirname, "modal.html")).catch(() => {});
  });
}

function reportAppError(err, title) {
  const { message, details } = splitError(err);
  const label = title || "خطای برنامه";
  console.error(`[${label}]`, err);
  if (modalWindow && !modalWindow.isDestroyed()) return true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    openModalWindow({ title: label, message, details, type: "error", confirm: false });
    return true;
  }
  return false;
}

// Suppress Electron's native (unstyled) error dialogs and route errors
// through the themed modal window instead.
process.on("uncaughtException", (error) => {
  reportAppError(error, "خطای برنامه");
});

process.on("unhandledRejection", (reason) => {
  reportAppError(reason, "خطای برنامه");
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function createTab(url = START_URL, options = {}) {
  const id = nextTabId++;
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,

      // مهم: جلوگیری از throttle شدن تب‌های غیرفعال.
      // این‌طوری ChatGPT و OpenAI Platform حتی وقتی تب فعال نیستند
      // (یا صفحه ی نصب/موفقیت بازه) در پس‌زمینه زنده و در حال اجرا می‌مونن:
      // تایمرها، WebSocket، پولینگ، fetch و executeJavaScript همه کار می‌کنن.
      backgroundThrottling: false
    }
  });

  view.setBackgroundColor(currentTheme === "dark" ? "#1a1a1a" : "#ffffff");

  const tab = {
    id,
    view,
    title: options.title || "تب جدید",
    icon: options.icon || "◫",
    url,
    initialUrl: url,
    isFixed: !!options.isFixed,
    loadScrollFixed: false,
    resizeScrollFixed: false,
    bounds: stageBounds
      ? { ...stageBounds }
      : { x: 0, y: 0, width: 0, height: 0 }
  };

  tabs.push(tab);
  mainWindow.contentView.addChildView(view);

  view.webContents.setWindowOpenHandler(() => {
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 600,
        height: 750,
        autoHideMenuBar: true,
        backgroundColor: currentTheme === "dark" ? "#10141d" : "#f3f4f6",
        webPreferences: {
          preload: path.join(__dirname, "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,

        }
      }
    };
  });

  view.webContents.on("page-title-updated", (_event, title) => {
    if (!tab.isFixed) tab.title = title || "بدون عنوان";
    publishTabs();
  });

  view.webContents.on("did-navigate", (_event, navigatedUrl) => {
    tab.url = navigatedUrl;
    if (tab.id === activeTabId) send("browser:url", navigatedUrl);
    publishTabs();
  });

  view.webContents.on("did-navigate-in-page", (_event, navigatedUrl) => {
    tab.url = navigatedUrl;
    if (tab.id === activeTabId) send("browser:url", navigatedUrl);
    publishTabs();
  });

  view.webContents.on("did-finish-load", () => {
    injectThemeInto(view.webContents);
    // On the very first page load of each tab, force scroll-to-top.
    // Some SPAs (platform.openai.com) fire their own scroll/layout routines
    // right after paint, so we run this a few times over ~2.5s.
    if (!tab.loadScrollFixed) {
      tab.loadScrollFixed = true;
      setTimeout(() => resetScrollToTop(view.webContents), 80);
    }
  });

  view.webContents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      send("browser:error", { code, description, url: validatedURL });
    }
  });

  view.webContents.on("will-navigate", (event, targetUrl) => {
    if (!/^https?:\/\//i.test(targetUrl)) event.preventDefault();
  });

  switchTab(id);
  view.webContents.loadURL(url).catch(() => {});
  publishTabs();
  return tab;
}

function openDefaultTabs() {
  const created = DEFAULT_TABS.map(({ url, title, icon }) =>
    createTab(url, { title, icon, isFixed: true })
  );
  if (created.length > 0) switchTab(created[0].id);
}

function switchTab(id) {
  const target = tabs.find((tab) => tab.id === id);
  if (!target) return;

  activeTabId = id;
  for (const tab of tabs) applyBounds(tab);
  send("browser:url", target.url);
  send("browser:history", {
    canGoBack: target.view.webContents.navigationHistory.canGoBack(),
    canGoForward: target.view.webContents.navigationHistory.canGoForward()
  });
  publishTabs();
}

function closeTab(id) {
  const index = tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return;
  if (tabs[index].isFixed) return;

  const [tab] = tabs.splice(index, 1);
  mainWindow.contentView.removeChildView(tab.view);
  tab.view.webContents.close();

  if (tabs.length === 0) {
    createTab(START_URL);
    return;
  }
  if (activeTabId === id) {
    const replacement = tabs[Math.min(index, tabs.length - 1)];
    switchTab(replacement.id);
  } else {
    publishTabs();
  }
}

async function injectCookiesToElectron(state) {
  const ses = session.defaultSession;
  for (const cookie of state.cookies) {
    const url = `https://${cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`;
    await ses.cookies.set({
      url,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expires > 0 ? cookie.expires : undefined,
      sameSite: cookie.sameSite === "Lax" ? "lax" : cookie.sameSite === "Strict" ? "strict" : "no_restriction"
    }).catch(() => {});
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: currentTheme === "dark" ? "#10141d" : "#f3f4f6",
    title: "HADEX GPT Setup",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // پنجره‌ی اصلی هم از همان ابتدا Maximize باز شود (مثل زدن دکمه‌ی مربع).
  mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, "index.html")).catch(() => {});

  mainWindow.on("resize", () => {
    const tab = activeTab();
    if (tab && tab.bounds) applyBounds(tab);
  });

  mainWindow.on("closed", () => {
    if (modalWindow && !modalWindow.isDestroyed()) modalWindow.close();
    modalWindow = null;
    modalResolve = null;
    mainWindow = null;
    tabs = [];
    activeTabId = null;
    stageBounds = null;
  });

  mainWindow.webContents.on("did-finish-load", async () => {
    if (tabs.length === 0) {
      // Electron persists the default session under APP_USER_DATA.
      // Existing sign-ins remain available across restarts and app updates.
      openDefaultTabs();
      currentViewMode = "installer";
      for (const tab of tabs) applyBounds(tab);
    } else {
      for (const tab of tabs) applyBounds(tab);
      publishTabs();
      const tab = activeTab();
      if (tab) send("browser:url", tab.url);
    }
  });
}

ipcMain.handle("app:set-view-mode", (_event, mode) => {
  currentViewMode = mode;
  // وقتی به installer یا success می‌رویم، تب‌ها با ابعاد 0x0 کاملاً
  // پنهان می‌شوند ولی به‌خاطر backgroundThrottling:false همچنان فعال‌اند.
  // این همان «باز بودن پشت صحنه» است: هیچ پنجره/نمای اضافه‌ای دیده نمی‌شود،
  // ولی عملیات می‌تواند روی webContents آن‌ها انجام شود.
  for (const tab of tabs) applyBounds(tab);
});

ipcMain.handle("app:show-alert", async (_event, options) => {
  await openModalWindow({ ...(options || {}), confirm: false });
  return true;
});

ipcMain.handle("app:show-confirm", async (_event, options) => {
  const result = await openModalWindow({ ...(options || {}), confirm: true });
  return !!result;
});

ipcMain.on("modal:response", (_event, result) => {
  closeModalWindow(!!result);
});

ipcMain.on("modal:resize", (_event, size) => {
  if (!modalWindow || modalWindow.isDestroyed() || !size) return;
  const width = Math.max(360, Math.min(760, Math.round(Number(size.width) || 520)));
  const height = Math.max(150, Math.min(700, Math.round(Number(size.height) || 250)));
  modalWindow.setContentSize(width, height);
  centerModalOverParent();
});

// ---------------------------------------------------------------------------
// Login detection
// ---------------------------------------------------------------------------

async function fetchJsonWithSession(url) {
  try {
    const res = await session.defaultSession.fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { "accept": "application/json" }
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  }
}

async function fetchJsonInsideTab(tab, url) {
  if (!tab || !tab.view || tab.view.webContents.isDestroyed()) {
    return { ok: false, status: 0, data: null, href: "" };
  }
  try {
    const raw = await tab.view.webContents.executeJavaScript(`
      (async () => {
        try {
          const r = await fetch(${JSON.stringify(url)}, {
            credentials: "include",
            cache: "no-store",
            headers: { "accept": "application/json" }
          });
          const text = await r.text();
          let data = null;
          try { data = JSON.parse(text); } catch {}
          return { ok: r.ok, status: r.status, data, href: location.href };
        } catch (e) {
          return { ok: false, status: 0, data: null, href: location.href };
        }
      })()
    `, true);
    return raw || { ok: false, status: 0, data: null, href: "" };
  } catch (e) {
    return { ok: false, status: 0, data: null, href: "" };
  }
}

function stripXssiPrefix(text) {
  return String(text || "").replace(/^\s*\)\]\}'\s*/, "").trim();
}

function isRealSession(d) {
  if (!d) return false;
  if (typeof d !== "object") return false;
  if (Array.isArray(d)) return d.length > 0;
  const keys = Object.keys(d);
  if (keys.length === 0) return false;
  if (d.accessToken || d.access_token || d.token) return true;
  if (d.user) {
    const u = d.user;
    if (typeof u === "object" && Object.keys(u).length > 0) return true;
  }
  if (d.expires || d.expiresAt) return true;
  if (d.email) return true;
  return false;
}

const SESSION_COOKIE_NAMES = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "authjs.session-token",
  "__Secure-authjs.session-token"
];

function hasFreshSessionCookie(cookies, domainSuffix) {
  const now = Math.floor(Date.now() / 1000);
  return cookies.some((c) => {
    if (!c.domain || !c.domain.endsWith(domainSuffix)) return false;
    if (!c.name || !SESSION_COOKIE_NAMES.includes(c.name)) return false;
    if (c.expired) return false;
    if (c.expirationDate && c.expirationDate <= now) return false;
    if (!c.value || c.value.length < 10) return false;
    return true;
  });
}

async function checkGoogle() {
  try {
    const res = await session.defaultSession.fetch(
      "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard",
      { credentials: "include" }
    );
    const text = await res.text();
    const clean = stripXssiPrefix(text);
    if (clean) {
      let data = null;
      try { data = JSON.parse(clean); } catch {}
      let accounts = [];
      if (Array.isArray(data)) accounts = data;
      else if (data && Array.isArray(data.email)) accounts = data.email;
      else if (data && Array.isArray(data.accounts)) accounts = data.accounts;
      const real = accounts.find((a) => a && (a.email || a.accountId || a.displayEmail));
      if (real) return true;
    }
  } catch (e) {}

  try {
    const now = Math.floor(Date.now() / 1000);
    const all = await session.defaultSession.cookies.get({});
    const isGoogle = (c) => c.domain && (c.domain === "google.com" || c.domain.endsWith(".google.com"));
    const fresh = (c) => !c.expired && (!c.expirationDate || c.expirationDate > now);
    const cookies = all.filter(isGoogle);
    const strong = cookies.some((c) =>
      (c.name === "__Secure-1PSID" || c.name === "__Secure-3PSID") && fresh(c)
    );
    const basics = cookies.filter((c) =>
      ["SID", "HSID", "SSID", "SAPISID", "APISID"].includes(c.name) && fresh(c)
    );
    if (strong || basics.length >= 2) return true;
  } catch (e) {}

  return false;
}

async function checkChatGPT() {
  const tab = getChatGPTTab();

  const inPage = await fetchJsonInsideTab(tab, "https://chatgpt.com/api/auth/session");
  if (inPage.ok && isRealSession(inPage.data)) return true;

  const r = await fetchJsonWithSession("https://chatgpt.com/api/auth/session");
  if (r.ok && isRealSession(r.data)) return true;

  let chatgptCookies = [];
  try {
    const all = await session.defaultSession.cookies.get({});
    chatgptCookies = all.filter((c) => c.domain && c.domain.endsWith("chatgpt.com"));
  } catch (e) {}
  if (hasFreshSessionCookie(chatgptCookies, "chatgpt.com")) return true;

  return false;
}

async function checkOpenAI() {
  const tab = getOpenAITab();

  // ۱) چک کردن DOM (مطمئن‌ترین راه برای SPA و دور زدن Cloudflare)
  if (tab && tab.view && !tab.view.webContents.isDestroyed()) {
    try {
      const domOk = await tab.view.webContents.executeJavaScript(`
        (() => {
          const href = location.href;
          if (!href.includes('platform.openai.com')) return false;
          if (href.includes('/login') || href.includes('/auth')) return false;

          const text = (document.body ? document.body.innerText : "").toLowerCase();
          if (text.includes('api keys') || text.includes('usage') || text.includes('billing') || text.includes('personal') || text.includes('playground')) {
            return true;
          }
          return false;
        })()
      `, true);
      if (domOk) return true;
    } catch (e) {}
  }

  // ۲) fetch داخل خود تب
  const inPage = await fetchJsonInsideTab(tab, "https://platform.openai.com/api/auth/session");
  if (inPage.ok && isRealSession(inPage.data)) return true;

  // ۳) fetch از session اصلی main
  const r = await fetchJsonWithSession("https://platform.openai.com/api/auth/session");
  if (r.ok && isRealSession(r.data)) return true;

  // ۴) فقط کوکی‌های شناخته‌شده‌ی سشن روی openai.com
  let openaiCookies = [];
  try {
    const all = await session.defaultSession.cookies.get({});
    openaiCookies = all.filter((c) => c.domain && c.domain.endsWith("openai.com"));
  } catch (e) {}
  if (hasFreshSessionCookie(openaiCookies, "openai.com")) return true;

  return false;
}

ipcMain.handle("app:check-logins", async () => {
  const [google, chatgpt, openai] = await Promise.all([
    checkGoogle(),
    checkChatGPT(),
    checkOpenAI()
  ]);
  return { google, chatgpt, openai };
});

// ---------------------------------------------------------------------------
// Next step (اجرای خودکار پس‌زمینه روی ChatGPT و OpenAI Platform)
// ---------------------------------------------------------------------------
//
// این تابع هسته‌ی «عملیات نامرئی» است. در این‌جا تب‌های داخلی ChatGPT و
// OpenAI Platform با ابعاد 0x0 (پنهان) ولی زنده در دسترس‌اند. هر عملیاتی
// که لازم است (کلیک، پر کردن فرم، navigate، fetch، ...) را می‌توان روی
// tab.view.webContents آن‌ها اجرا کرد. کاربر فقط صفحه‌ی «موفقیت/مرحله بعد»
// را می‌بیند، در حالی که عملیات واقعی روی همین دو تب ادامه دارد.
//
// نکته: از Playwright استفاده نمی‌کنیم — همان webContents کافی است. این‌طوری
// هیچ پنجره‌ی مرورگر خارجی باز نمی‌شود و عملیات کاملاً نامرئی است.
//
// مثال‌ها (برای استفاده در آینده):
//   const t = getChatGPTTab();
//   await t.view.webContents.executeJavaScript(`document.querySelector('...').click()`);
//   await t.view.webContents.executeJavaScript(`fetch('/backend-api/...', {method:'POST', ...})`);
//   const t2 = getOpenAITab();
//   await t2.view.webContents.loadURL('https://platform.openai.com/api-keys');
// ---------------------------------------------------------------------------

ipcMain.handle("app:execute-next-step", async () => {
  try {
    const chatgpt = getChatGPTTab();
    const openai = getOpenAITab();

    // اطمینان از زنده بودن هر دو تب پشت صحنه
    if (!chatgpt || !openai) {
      return { success: false, error: "تب‌های ChatGPT یا OpenAI Platform در دسترس نیستند." };
    }
    if (chatgpt.view.webContents.isDestroyed() || openai.view.webContents.isDestroyed()) {
      return { success: false, error: "webContents یکی از تب‌ها بسته شده است." };
    }

    // --- نقطه‌ی توسعه: عملیات واقعی روی تب‌های پنهان این‌جا انجام می‌شود ---
    // مثال نمونه (کامنت‌شده تا رفتار فعلی حفظ شود):
    // await openai.view.webContents.executeJavaScript(`location.href = 'https://platform.openai.com/api-keys';`);
    // await chatgpt.view.webContents.executeJavaScript(`document.querySelector('textarea')?.focus();`);

    return { success: true };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle("app:login-google", async () => {
  try {
    // Use Electron's own Chromium session instead of launching a separate
    // Playwright-controlled Chrome/Edge process. The user completes sign-in
    // directly in the visible Hadex browser window.
    let googleTab = findTabByInitialUrl("accounts.google.com");

    if (!googleTab || googleTab.view.webContents.isDestroyed()) {
      googleTab = createTab("https://accounts.google.com/", {
        title: "Google",
        icon: "G",
        isFixed: false
      });
    }

    currentViewMode = "browser";
    switchTab(googleTab.id);

    return { success: true };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle("app:logout-google", async () => {
  try {
    const ses = session.defaultSession;
    await ses.clearStorageData({ storages: ["cookies", "localstorage", "sessionstorage"] });

    for (const tab of tabs) {
      if (tab.initialUrl) tab.view.webContents.loadURL(tab.initialUrl).catch(() => {});
    }

    currentViewMode = "installer";
    for (const tab of tabs) applyBounds(tab);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("app:set-theme", (_event, theme) => {
  currentTheme = theme === "light" ? "light" : "dark";
  applyThemeToAll();
  if (modalWindow && !modalWindow.isDestroyed()) {
    modalWindow.setBackgroundColor(currentTheme === "dark" ? "#151b27" : "#ffffff");
    modalWindow.webContents.send("modal:theme", currentTheme);
  }
});

ipcMain.handle("browser:set-bounds", (_event, bounds) => {
  if (!bounds) return;
  const values = ["x", "y", "width", "height"];
  if (!values.every((key) => Number.isFinite(bounds[key]))) return;

  stageBounds = {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height))
  };

  const tab = activeTab();
  if (!tab) return;

  const wasZero =
    !tab.bounds ||
    (tab.bounds.width === 0 || tab.bounds.height === 0);

  tab.bounds = { ...stageBounds };
  applyBounds(tab);

  // First time the view gets a real size, force scroll-to-top.
  // Some SPAs (platform.openai.com in particular) snap to the bottom when
  // they receive a resize from 0x0 to real bounds.
  if (
    wasZero &&
    stageBounds.width > 0 &&
    stageBounds.height > 0 &&
    !tab.resizeScrollFixed
  ) {
    tab.resizeScrollFixed = true;
    setTimeout(() => resetScrollToTop(tab.view.webContents), 80);
  }
});

ipcMain.handle("browser:navigate", (_event, input) => {
  const tab = activeTab();
  if (!tab || typeof input !== "string") return;
  const value = input.trim();
  if (!value) return;

  let target;
  try {
    target = new URL(value).href;
  } catch {
    target = /^\s*([a-z0-9-]+\.)+[a-z]{2}([/:?#]|$)/i.test(value)
      ? "https://" + value
      : "https://www.google.com/search?q=" + encodeURIComponent(value);
  }
  if (!/^https?:\/\//i.test(target)) return;
  tab.view.webContents.loadURL(target).catch(() => {});
});

ipcMain.handle("browser:back", () => {
  const tab = activeTab();
  if (tab?.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
});

ipcMain.handle("browser:forward", () => {
  const tab = activeTab();
  if (tab?.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
});

ipcMain.handle("browser:reload", () => activeTab()?.view.webContents.reload());

ipcMain.handle("browser:reset-tab", (_event, id) => {
  const tab = tabs.find(t => t.id === id);
  if (tab && tab.initialUrl) {
    tab.loadScrollFixed = false;
    tab.resizeScrollFixed = false;
    tab.view.webContents.loadURL(tab.initialUrl).catch(() => {});
  }
});

ipcMain.handle("browser:new-tab", (_event, url) => createTab(typeof url === "string" ? url : START_URL));
ipcMain.handle("browser:switch-tab", (_event, id) => switchTab(id));
ipcMain.handle("browser:close-tab", (_event, id) => closeTab(id));

app.whenReady().then(() => {

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
