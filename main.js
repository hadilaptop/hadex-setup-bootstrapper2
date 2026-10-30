const { app, BrowserWindow, WebContentsView, ipcMain, shell, nativeTheme, session } = require("electron");
const path = require("node:path");
const fs = require("fs");

app.disableHardwareAcceleration();

let mainWindow;
let tabs = [];
let activeTabId = null;
let nextTabId = 1;
let stageBounds = null;
let currentTheme = "dark";
let currentViewMode = "installer";

const START_URL = "https://chatgpt.com/";
const AUTH_FILE = path.join(__dirname, "auth.json");

const DEFAULT_TABS = [
  { icon: "C", title: "ChatGPT", url: "https://chatgpt.com/" },
  { icon: "O", title: "OpenAI Platform", url: "https://platform.openai.com/login" }
];

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const CH_UA = '"Not_A Brand";v="99", "Chromium";v="122", "Google Chrome";v="122"';

app.userAgentFallback = CHROME_UA;
app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function activeTab() {
  return tabs.find((tab) => tab.id === activeTabId) || null;
}

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
    tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return;
  }

  tab.view.setBounds(target
    ? { x: target.x, y: target.y, width: target.width, height: target.height }
    : { x: 0, y: 0, width: 0, height: 0 });
}

function injectThemeInto(webContents) {
  webContents.executeJavaScript(`
    (() => {
      if (!document.documentElement) return;
      document.documentElement.style.colorScheme = '${currentTheme}';
      if (document.body) document.body.style.colorScheme = '${currentTheme}';
      window.dispatchEvent(new Event('resize'));
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

function createTab(url = START_URL, options = {}) {
  const id = nextTabId++;
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      userAgent: CHROME_UA
    }
  });

  view.webContents.setUserAgent(CHROME_UA);
  view.setBackgroundColor(currentTheme === "dark" ? "#1a1a1a" : "#ffffff");

  const tab = {
    id,
    view,
    title: options.title || "تب جدید",
    icon: options.icon || "◫",
    url,
    initialUrl: url,
    isFixed: !!options.isFixed,
    bounds: stageBounds
      ? { ...stageBounds }
      : { x: 0, y: 0, width: 0, height: 0 }
  };

  tabs.push(tab);
  mainWindow.contentView.addChildView(view);

  view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 600,
        height: 750,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          userAgent: CHROME_UA
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

  view.webContents.on("dom-ready", () => {
    view.webContents.executeJavaScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    `).catch(() => {});
  });

  view.webContents.on("did-finish-load", () => {
    injectThemeInto(view.webContents);
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
  view.webContents.loadURL(url);
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

function setupRequestHeaders() {
  const ses = session.defaultSession;
  ses.setUserAgent(CHROME_UA);

  ses.webRequest.onBeforeSendHeaders({ urls: ["*://*/*"] }, (details, callback) => {
    const headers = details.requestHeaders;
    headers["User-Agent"] = CHROME_UA;
    headers["sec-ch-ua"] = CH_UA;
    headers["sec-ch-ua-mobile"] = "?0";
    headers["sec-ch-ua-platform"] = '"Windows"';
    callback({ requestHeaders: headers });
  });
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

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("resize", () => {
    const tab = activeTab();
    if (tab && tab.bounds) applyBounds(tab);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    tabs = [];
    activeTabId = null;
    stageBounds = null;
  });

  mainWindow.webContents.on("did-finish-load", async () => {
    if (tabs.length === 0) {
      if (fs.existsSync(AUTH_FILE)) {
        try {
          const state = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
          await injectCookiesToElectron(state);
        } catch (e) {}
      }
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
  for (const tab of tabs) applyBounds(tab);
});

ipcMain.handle("app:check-logins", async () => {
  const cookies = await session.defaultSession.cookies.get({});
  const hasGoogle = cookies.some(c => c.domain.includes("google.com") && ["SID", "SSID", "HSID"].includes(c.name));
  
  // بررسی دقیق بر اساس URL تب‌ها به جای کوکی‌های مشترک
  const chatgptTab = tabs.find(t => t.url.includes("chatgpt.com"));
  const openaiTab = tabs.find(t => t.url.includes("platform.openai.com"));

  const hasChatGPT = !!(chatgptTab && !chatgptTab.url.includes("auth/") && !chatgptTab.url.includes("login"));
  const hasOpenAI = !!(openaiTab && !openaiTab.url.includes("login") && !openaiTab.url.includes("auth"));

  return { google: hasGoogle, chatgpt: hasChatGPT, openai: hasOpenAI };
});

ipcMain.handle("app:execute-next-step", async () => {
  console.log("Next setup step triggered!");
  return { success: true };
});

ipcMain.handle("app:login-google", async () => {
  try {
    const { chromium } = require("playwright");
    let browser;

    const launchOptions = {
      headless: false,
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=WebAuthentication,WebAuthenticationPasskey,WebAuthenticationConditionalUI",
        "--start-maximized",
        "--window-position=0,0",
        "--disable-infobars"
      ]
    };

    try {
      browser = await chromium.launch({ ...launchOptions, channel: "msedge" });
    } catch (e) {
      try {
        browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
      } catch (e2) {
        return { success: false, error: "مرورگر کروم یا اج روی سیستم شما یافت نشد." };
      }
    }

    let contextOptions = {
      userAgent: CHROME_UA,
      viewport: null
    };
    if (fs.existsSync(AUTH_FILE)) {
      try {
        contextOptions.storageState = AUTH_FILE;
      } catch (e) {}
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    const client = await context.newCDPSession(page);
    await client.send("WebAuthn.enable", { enableUI: false });

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    await page.goto("https://accounts.google.com/");

    await page.waitForURL(url => {
      const u = url.toString();
      return !u.includes("accounts.google.com") || u.includes("myaccount.google.com");
    }, { timeout: 0 }).catch(() => {});

    const state = await context.storageState();
    await browser.close();

    fs.writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2));
    await injectCookiesToElectron(state);

    for (const tab of tabs) {
      tab.view.webContents.reload();
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("app:logout-google", async () => {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
    }
    const ses = session.defaultSession;
    await ses.clearStorageData({ storages: ["cookies", "localstorage", "sessionstorage"] });
    
    // برگرداندن تب‌ها به آدرس اولیه خود
    for (const tab of tabs) {
      if (tab.initialUrl) tab.view.webContents.loadURL(tab.initialUrl);
    }
    
    // برگشت به حالت اولیه نصب
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
  tab.bounds = { ...stageBounds };
  applyBounds(tab);
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
  tab.view.webContents.loadURL(target);
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
    tab.view.webContents.loadURL(tab.initialUrl);
  }
});

ipcMain.handle("browser:new-tab", (_event, url) => createTab(typeof url === "string" ? url : START_URL));
ipcMain.handle("browser:switch-tab", (_event, id) => switchTab(id));
ipcMain.handle("browser:close-tab", (_event, id) => closeTab(id));

app.whenReady().then(() => {
  setupRequestHeaders();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
