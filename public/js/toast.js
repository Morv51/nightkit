// Kleines Toast-System: Container unten rechts, dunkler Background,
// #CCFF00-Border für Erfolg, roter Border für Fehler, auto-dismiss nach 4s.
// Optionale Action (z.B. "Erneut versuchen") — Toasts mit Action bleiben
// doppelt so lange stehen, damit der Button klickbar bleibt.

let wrap = null;

function ensureWrap() {
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toasts";
    document.body.appendChild(wrap);
  }
  return wrap;
}

export function toast(message, { type = "success", action, duration = 4000 } = {}) {
  const el = document.createElement("div");
  el.className = "toast toast-" + (type === "error" ? "error" : "success");

  const msg = document.createElement("span");
  msg.className = "toast-msg";
  msg.textContent = message;
  el.appendChild(msg);

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    if (!el.parentNode) return;
    el.classList.add("out");
    setTimeout(() => el.remove(), 180);
  };

  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast-act";
    btn.textContent = action.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      dismiss();
      action.onClick();
    });
    el.appendChild(btn);
  }

  el.addEventListener("click", dismiss); // Klick auf den Toast schließt ihn
  ensureWrap().appendChild(el);
  timer = setTimeout(dismiss, action ? duration * 2 : duration);
  return dismiss;
}
