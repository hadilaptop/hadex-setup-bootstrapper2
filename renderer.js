const api = window.hadexBrowser;
const sidebarTabs = document.getElementById("sidebarTabs");
const browserStage = document.querySelector(".browser-stage");
const placeholder = document.getElementById("browserPlaceholder");
const themeCheckbox = document.getElementById("themeCheckbox");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const googleRefreshBtn = document.getElementById("googleRefreshBtn");
const googleLogoutBtn = document.getElementById("googleLogoutBtn");

const installerView = document.getElementById("installer-view");
const browserView = document.getElementById("browser-view");
const successView = document.getElementById("success-view");
const btnInstall = document.getElementById("btnInstall");
const btnNext = document.getElementById("btnNext");
const confirmLoginBtn = document.getElementById("confirmLoginBtn");

const btnLogoutInstaller = document.getElementById("btnLogoutInstaller");
const btnLogoutSuccess = document.getElementById("btnLogoutSuccess");

let checkInterval = null;
let hasAutoAdvanced = false;
let nextStepRunning = false;
let advanceTimer = null;

const CONFIRMS_UP = 1;
const CONFIRMS_DOWN = 4;

// پس از تشخیص هر سه لاگین، این مدت صبر می‌کنیم تا تیک‌ها در UI
// رندر و دیده شوند، بعد به‌طور خودکار به مرحله بعد می‌رویم.
const AUTO_ADVANCE_DELAY = 3000;

const loginState = { google: false, chatgpt: false, openai: false };
const pendingCount = { google: 0, chatgpt: 0, openai: 0 };
let checkInFlight = false;

// Themed dialogs (replacing native alert / confirm)
function showAlert(message, options = {}) {
  if (!api || typeof api.showAlert !== "function") {
    window.alert(message);
    return Promise.resolve(true);
  }
  return api.showAlert({
    title: options.title || "پیام",
    message: message || "",
    details: options.details || "",
    type: options.type || "info"
  });
}

function showConfirm(message, options = {}) {
  if (!api || typeof api.showConfirm !== "function") {
    return Promise.resolve(window.confirm(message));
  }
  return api.showConfirm({
    title: options.title || "تایید",
    message: message || "",
    details: options.details || "",
    type: options.type || "confirm"
  });
}

function applyHysteresis(key, fresh) {
  const current = loginState[key];
  if (fresh === current) { pendingCount[key] = 0; return; }
  pendingCount[key]++;
  if (fresh && !current) {
    if (pendingCount[key] >= CONFIRMS_UP) { loginState[key] = true; pendingCount[key] = 0; }
  } else if (!fresh && current) {
    if (pendingCount[key] >= CONFIRMS_DOWN) { loginState[key] = false; pendingCount[key] = 0; }
  }
}

function scheduleAutoAdvance() {
  if (advanceTimer) return;
  advanceTimer = setTimeout(async () => {
    advanceTimer = null;
    // یک بار دیگر وضعیت را چک می‌کنیم؛ اگر در این فاصله لاگینی از دست رفت،
    // به‌روزرسانی متوقف می‌شود و منتظر تشخیص مجدد می‌مانیم.
    if (!isAllDone()) {
      hasAutoAdvanced = false;
      return;
    }
    await goToSuccessView();
  }, AUTO_ADVANCE_DELAY);
}

async function checkLoginStatus() {
  if (checkInFlight) return;
  checkInFlight = true;
  try {
    const status = await api.checkLogins();
    applyHysteresis("google", !!status.google);
    applyHysteresis("chatgpt", !!status.chatgpt);
    applyHysteresis("openai", !!status.openai);
    renderLoginUI();

    // وقتی هر سه لاگین تشخیص داده شد، بلافاصله نمی‌رویم؛ ۳ ثانیه صبر می‌کنیم
    // تا تیک‌ها در UI نمایش داده شوند و کاربر ببیند، بعد خودکار جلو می‌رویم.
    // تب‌های ChatGPT و OpenAI Platform بسته نمی‌شوند؛ فقط view آن‌ها به
    // ابعاد 0x0 می‌رود و چون backgroundThrottling غیرفعال است در پس‌زمینه
    // کاملاً زنده می‌مانند تا عملیات بعدی رویشان اجرا شود.
    if (isAllDone() && !hasAutoAdvanced) {
      hasAutoAdvanced = true;
      scheduleAutoAdvance();
    }
  } catch (err) {
    console.error("Login check error:", err);
  } finally {
    checkInFlight = false;
  }
}

function isAllDone() {
  return loginState.google && loginState.chatgpt && loginState.openai;
}

function renderLoginUI() {
  if (loginState.google) {
    googleLoginBtn.innerHTML = '<span class="side-icon" style="color: #52c99a;">✓</span> <span class="tab-title-text">حساب گوگل متصل است</span>';
  } else {
    googleLoginBtn.innerHTML = '<span class="side-icon" style="color: #ea4335;">G</span> <span class="tab-title-text">ورود به حساب گوگل</span>';
  }

  const tabButtons = sidebarTabs.querySelectorAll(".side-item");
  tabButtons.forEach(btn => {
    const url = btn.title || "";
    const icon = btn.querySelector(".side-icon");
    if (!icon) return;
    if (url.includes("chatgpt.com")) {
      if (loginState.chatgpt) { icon.textContent = "✓"; icon.style.color = "#52c99a"; }
      else { icon.textContent = "C"; icon.style.color = ""; }
    } else if (url.includes("platform.openai.com")) {
      if (loginState.openai) { icon.textContent = "✓"; icon.style.color = "#52c99a"; }
      else { icon.textContent = "O"; icon.style.color = ""; }
    }
  });

  if (isAllDone()) {
    confirmLoginBtn.style.background = "#52c99a";
    confirmLoginBtn.style.color = "#fff";
    confirmLoginBtn.style.border = "none";
    confirmLoginBtn.innerHTML = '<span class="side-icon" style="color: #fff;">✓</span> <span class="tab-title-text">همه لاگین‌ها موفق — ادامه خودکار…</span>';
  } else {
    confirmLoginBtn.style.background = "transparent";
    confirmLoginBtn.style.color = "var(--text-item)";
    confirmLoginBtn.style.border = "1px solid var(--border-color)";
    confirmLoginBtn.innerHTML = '<span class="side-icon">✓</span> <span class="tab-title-text">تایید  لاگین‌ها</span>';
  }
}

async function goToSuccessView() {
  if (!isAllDone()) return;
  if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
  if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
  browserView.style.display = "none";
  successView.style.display = "flex";
  await api.setViewMode("success");

  // مرحله بعد به‌صورت خودکار و بی‌صدا اجرا می‌شود.
  // تب‌های ChatGPT و OpenAI Platform در پس‌زمینه باز و فعال هستند
  // (فقط ابعادشان 0x0 شده) و عملیات بعدی روی همان webContentsها انجام می‌شود.
  setTimeout(() => { runNextStep(true); }, 900);
}

async function runNextStep(silent) {
  if (nextStepRunning) return;
  nextStepRunning = true;

  btnNext.innerHTML = "در حال اجرای مرحله بعد...";
  btnNext.disabled = true;
  let result;
  try {
    result = await api.executeNextStep();
  } catch (err) {
    result = { success: false, error: err && err.message ? err.message : String(err) };
  }
  btnNext.innerHTML = "ادامه نصب (Next Step)";
  btnNext.disabled = false;
  nextStepRunning = false;

  if (!result.success) {
    await showAlert("خطا در مرحله بعد: " + (result.error || "نامشخص"), {
      title: "خطا",
      type: "error"
    });
  } else if (!silent) {
    await showAlert("پیش‌نیازها با موفقیت نصب شدند. مرحله بعدی در آینده اضافه خواهد شد.", {
      title: "مرحله بعد",
      type: "success"
    });
  }
}

btnInstall.addEventListener("click", async () => {
  installerView.style.display = "none";
  browserView.style.display = "flex";
  await api.setViewMode("browser");
  setTimeout(updateBrowserBounds, 100);

  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(checkLoginStatus, 3000);
  checkLoginStatus();
});

confirmLoginBtn.addEventListener("click", async () => {
  if (isAllDone()) {
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    hasAutoAdvanced = true;
    await goToSuccessView();
  } else {
    await checkLoginStatus();
  }
});

btnNext.addEventListener("click", () => runNextStep(false));

async function handleTotalReset() {
  const ok = await showConfirm("آیا مطمئن هستید که می‌خواهید از همه حساب‌ها خارج شوید و برنامه را ریست کنید؟", {
    title: "خروج از حساب‌ها",
    type: "confirm"
  });
  if (!ok) return;

  hasAutoAdvanced = false;
  nextStepRunning = false;
  if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
  if (checkInterval) { clearInterval(checkInterval); checkInterval = null; }
  await api.logoutGoogle();
  successView.style.display = "none";
  browserView.style.display = "none";
  installerView.style.display = "flex";
  await api.setViewMode("installer");
  window.location.reload();
}

btnLogoutInstaller.addEventListener("click", handleTotalReset);
btnLogoutSuccess.addEventListener("click", handleTotalReset);

async function handleGoogleLogin() {
  const originalText = googleLoginBtn.innerHTML;
  googleLoginBtn.innerHTML = '<span class="side-icon">⏳</span> <span class="tab-title-text">در حال باز کردن...</span>';
  googleLoginBtn.disabled = true;
  const result = await api.loginGoogle();
  googleLoginBtn.innerHTML = originalText;
  googleLoginBtn.disabled = false;
  if (!result.success && result.error) {
    await showAlert("خطا در ورود: " + result.error, { title: "خطا در ورود", type: "error" });
  } else {
    checkLoginStatus();
  }
}

googleLoginBtn.addEventListener("click", handleGoogleLogin);
googleRefreshBtn.addEventListener("click", (e) => { e.stopPropagation(); handleGoogleLogin(); });
googleLogoutBtn.addEventListener("click", handleTotalReset);

let currentTheme = localStorage.getItem("hadex-theme") || "dark";
document.body.dataset.theme = currentTheme;
api.setTheme(currentTheme);
themeCheckbox.checked = (currentTheme === "light");
themeCheckbox.addEventListener("change", () => {
  currentTheme = themeCheckbox.checked ? "light" : "dark";
  document.body.dataset.theme = currentTheme;
  localStorage.setItem("hadex-theme", currentTheme);
  api.setTheme(currentTheme);
});

function updateBrowserBounds() {
  const rect = browserStage.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    api.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  }
}

const resizeObserver = new ResizeObserver(updateBrowserBounds);
resizeObserver.observe(browserStage);
window.addEventListener("resize", updateBrowserBounds);

let boundsSynced = false;
function syncBoundsOnce() {
  if (boundsSynced) return;
  boundsSynced = true;
  requestAnimationFrame(updateBrowserBounds);
}

api.onTabs(({ tabs, activeTabId }) => {
  syncBoundsOnce();
  sidebarTabs.replaceChildren();

  for (const tab of tabs) {
    const container = document.createElement("div");
    container.className = "tab-container";

    const button = document.createElement("button");
    button.className = "side-item" + (tab.id === activeTabId ? " active" : "");
    button.title = tab.url || "";

    const icon = document.createElement("span");
    icon.className = "side-icon";
    icon.textContent = tab.icon || "◫";

    const title = document.createElement("span");
    title.className = "tab-title-text";
    title.textContent = tab.title || "تب جدید";

    button.append(icon, title);
    button.addEventListener("click", () => api.switchTab(tab.id));

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "btn-action";
    refreshBtn.innerHTML = "↻";
    refreshBtn.title = "بازگشت به آدرس اولیه";
    refreshBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      api.resetTab(tab.id);
      api.switchTab(tab.id);
    });

    container.append(button, refreshBtn);

    if (!tab.isFixed) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "btn-action btn-close";
      closeBtn.innerHTML = "×";
      closeBtn.title = "بستن تب";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        api.closeTab(tab.id);
      });
      container.append(closeBtn);
    }

    sidebarTabs.append(container);
  }

  renderLoginUI();
});

api.onUrl(() => {
  placeholder.style.display = "none";
});
