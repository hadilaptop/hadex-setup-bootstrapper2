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

// دکمه‌های خروج تست
const btnLogoutInstaller = document.getElementById("btnLogoutInstaller");
const btnLogoutSuccess = document.getElementById("btnLogoutSuccess");

let checkInterval = null;

// ۱. شروع نصب و ورود به صفحه مرورگر
btnInstall.addEventListener("click", async () => {
  installerView.style.display = "none";
  browserView.style.display = "flex";
  
  await api.setViewMode("browser");
  setTimeout(updateBrowserBounds, 100);

  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(checkLoginStatus, 3000);
});

// ۲. بررسی وضعیت لاگین‌ها
async function checkLoginStatus() {
  try {
    const status = await api.checkLogins();
    
    // آپدیت دکمه گوگل
    if (status.google) {
      googleLoginBtn.innerHTML = `<span class="side-icon" style="color: #52c99a;">✓</span> <span class="tab-title-text">حساب گوگل متصل است</span>`;
    } else {
      googleLoginBtn.innerHTML = `<span class="side-icon" style="color: #ea4335;">G</span> <span class="tab-title-text">ورود به حساب گوگل</span>`;
    }

    // آپدیت تب‌های ChatGPT و OpenAI
    const tabButtons = sidebarTabs.querySelectorAll(".side-item");
    tabButtons.forEach(btn => {
      const url = btn.title || "";
      const icon = btn.querySelector(".side-icon");
      
      if (url.includes("chatgpt.com")) {
        if (status.chatgpt) {
          icon.textContent = "✓";
          icon.style.color = "#52c99a";
        } else {
          icon.textContent = "C";
          icon.style.color = "";
        }
      } else if (url.includes("platform.openai.com")) {
        if (status.openai) {
          icon.textContent = "✓";
          icon.style.color = "#52c99a";
        } else {
          icon.textContent = "O";
          icon.style.color = "";
        }
      }
    });

    const allDone = status.google && status.chatgpt && status.openai;

    // آپدیت ظاهر دکمه تایید
    if (allDone) {
      confirmLoginBtn.style.background = "#52c99a";
      confirmLoginBtn.style.color = "#fff";
      confirmLoginBtn.style.border = "none";
      confirmLoginBtn.innerHTML = `<span class="side-icon" style="color: #fff;">✓</span> <span class="tab-title-text">همه لاگین‌ها موفق</span>`;
    } else {
      confirmLoginBtn.style.background = "transparent";
      confirmLoginBtn.style.color = "var(--text-item)";
      confirmLoginBtn.style.border = "1px solid var(--border-color)";
      confirmLoginBtn.innerHTML = `<span class="side-icon">✓</span> <span class="tab-title-text">تایید دستی لاگین‌ها</span>`;
    }

    // انتقال به صفحه موفقیت
    if (allDone) {
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
      
      browserView.style.display = "none";
      successView.style.display = "flex";
      await api.setViewMode("success");
    }
  } catch (err) {
    console.error("Login check error:", err);
  }
}

// تایید دستی لاگین‌ها
confirmLoginBtn.addEventListener("click", async () => {
  const originalText = confirmLoginBtn.innerHTML;
  confirmLoginBtn.innerHTML = `<span class="side-icon">⏳</span> <span class="tab-title-text">در حال بررسی...</span>`;
  await checkLoginStatus();
  if (checkInterval) {
    confirmLoginBtn.innerHTML = originalText;
  }
});

// ۳. رفتن به مرحله بعدی نصب
btnNext.addEventListener("click", async () => {
  btnNext.innerHTML = "در حال اجرای مرحله بعد...";
  btnNext.disabled = true;
  
  const result = await api.executeNextStep();
  
  btnNext.innerHTML = "ادامه نصب (Next Step)";
  btnNext.disabled = false;

  if (result.success) {
    alert("پیش‌نیازها با موفقیت نصب شدند. مرحله بعدی در آینده اضافه خواهد شد.");
  } else {
    alert("خطا در مرحله بعد: " + (result.error || "نامشخص"));
  }
});

// ۴. خروج کامل و ریست برای تست
async function handleTotalReset() {
  if (!confirm("آیا مطمئن هستید که می‌خواهید از همه حساب‌ها خارج شوید و برنامه را ریست کنید؟")) return;
  
  await api.logoutGoogle();
  
  // برگشت به صفحه نصب
  successView.style.display = "none";
  browserView.style.display = "none";
  installerView.style.display = "flex";
  await api.setViewMode("installer");
  
  // رفرش کامل صفحه برای پاک شدن حافظه
  window.location.reload();
}

btnLogoutInstaller.addEventListener("click", handleTotalReset);
btnLogoutSuccess.addEventListener("click", handleTotalReset);

// منطق ورود گوگل
async function handleGoogleLogin() {
  const originalText = googleLoginBtn.innerHTML;
  googleLoginBtn.innerHTML = `<span class="side-icon">⏳</span> <span class="tab-title-text">در حال باز کردن...</span>`;
  googleLoginBtn.disabled = true;

  const result = await api.loginGoogle();

  googleLoginBtn.innerHTML = originalText;
  googleLoginBtn.disabled = false;

  if (!result.success && result.error) {
    alert("خطا در ورود: " + result.error);
  } else {
    checkLoginStatus();
  }
}

googleLoginBtn.addEventListener("click", handleGoogleLogin);
googleRefreshBtn.addEventListener("click", (e) => { e.stopPropagation(); handleGoogleLogin(); });

googleLogoutBtn.addEventListener("click", handleTotalReset);

// تم و ابعاد
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
});

api.onUrl(() => {
  placeholder.style.display = "none";
});
