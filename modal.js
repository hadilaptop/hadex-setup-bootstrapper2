const api = window.hadexModal;

const card = document.getElementById("modalCard");
const titleEl = document.getElementById("modalTitle");
const messageEl = document.getElementById("modalMessage");
const iconEl = document.getElementById("modalIcon");
const closeBtn = document.getElementById("modalClose");
const btnOk = document.getElementById("btnOk");
const btnCancel = document.getElementById("btnCancel");
const detailsWrap = document.getElementById("modalDetailsWrap");
const detailsToggle = document.getElementById("detailsToggle");
const detailsEl = document.getElementById("modalDetails");

let isConfirm = false;
let lastSize = { width: 0, height: 0 };

const ICONS = {
  info: "i",
  error: "!",
  warning: "!",
  success: "✓",
  confirm: "?"
};

function applyTheme(theme) {
  document.body.dataset.theme = theme === "light" ? "light" : "dark";
}

function reportSize() {
  if (!api || typeof api.resize !== "function") return;
  requestAnimationFrame(() => {
    const rect = card.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(document.documentElement.scrollHeight || rect.height);
    if (width === lastSize.width && height === lastSize.height) return;
    lastSize = { width, height };
    api.resize({ width, height: Math.max(height, 150) });
  });
}

function respond(result) {
  if (api && typeof api.respond === "function") api.respond(!!result);
}

function close(result) {
  respond(!!result);
}

function init(data) {
  const {
    title = "پیام",
    message = "",
    details = "",
    type = "info",
    confirm = false,
    theme = "dark"
  } = data || {};

  isConfirm = !!confirm;
  applyTheme(theme);

  document.title = title;
  titleEl.textContent = title;
  card.dataset.type = type;
  iconEl.textContent = ICONS[type] || ICONS.info;
  messageEl.textContent = message || "خطای نامشخص";

  if (details && details.trim()) {
    detailsEl.textContent = details;
    detailsWrap.style.display = "block";
  } else {
    detailsWrap.style.display = "none";
    detailsEl.textContent = "";
    detailsEl.classList.remove("open");
    detailsToggle.classList.remove("open");
  }

  if (isConfirm) {
    btnCancel.style.display = "inline-block";
    btnOk.textContent = "تایید";
  } else {
    btnCancel.style.display = "none";
    btnOk.textContent = "باشه";
  }

  btnOk.focus();
  reportSize();
}

closeBtn.addEventListener("click", () => close(isConfirm ? false : true));
btnOk.addEventListener("click", () => close(true));
btnCancel.addEventListener("click", () => close(false));

detailsToggle.addEventListener("click", () => {
  const open = detailsEl.classList.toggle("open");
  detailsToggle.classList.toggle("open", open);
  reportSize();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    close(false);
  } else if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    close(true);
  }
});

window.addEventListener("resize", reportSize);

if (api && typeof api.onInit === "function") api.onInit(init);
if (api && typeof api.onTheme === "function") api.onTheme(applyTheme);
