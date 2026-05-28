import { state } from "./state.js";
import { els } from "./dom.js";

const MAX = 8;

export function addToHistory(url) {
  state.historyUrls = [url, ...state.historyUrls.filter((u) => u !== url)].slice(0, MAX);
  render();
}

function render() {
  const row = els.histRow;
  if (!row) return;
  row.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const u of state.historyUrls) {
    const el = document.createElement("div");
    el.className = "hist-thumb";
    el.addEventListener("click", () => selectFromHistory(u));
    const img = document.createElement("img");
    img.src = u;
    img.loading = "lazy";
    el.appendChild(img);
    frag.appendChild(el);
  }
  row.appendChild(frag);
  els.histWrap.style.display = state.historyUrls.length > 1 ? "block" : "none";
}

function selectFromHistory(url) {
  els.resultImg.src = url;
  state.last = url;
  state.lastImg = new Image();
  state.lastImg.crossOrigin = "anonymous";
  state.lastImg.src = url;
}
