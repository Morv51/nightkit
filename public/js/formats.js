import { state } from "./state.js";
import { $, els } from "./dom.js";
import { postReframe } from "./api.js";
import { toast } from "./toast.js";

// Multi-Format-Export: das 9:16-Master bleibt wie bisher, weitere
// Instagram-Formate werden per Ideogram V3 Reframe abgeleitet (KI erweitert
// das Bild passend — keine schwarzen Ränder, kein hartes Cropping).
// Bereits erzeugte Formate werden im Frontend-State gecacht; die große
// Vorschau und die PNG/JPG-Downloads folgen immer dem aktiven Format.
//
// Kosten: Jeder Reframe-Aufruf ist ein zusätzlicher Ideogram-Call (~0,20 USD).
// Es wird daher nur auf expliziten Klick reframed und nie doppelt (Cache).

const FORMATS = [
  { id: "story",  name: "Story",   ratio: "9:16", shapeW: 14, shapeH: 24 },
  { id: "feed",   name: "Feed",    ratio: "4:5",  shapeW: 19, shapeH: 24 },
  { id: "square", name: "Quadrat", ratio: "1:1",  shapeW: 22, shapeH: 22 },
  { id: "banner", name: "Banner",  ratio: "16:9", shapeW: 24, shapeH: 14 },
];

const MAX_UPLOAD = 9.5 * 1024 * 1024; // Ideogram-Limit: 10MB

const loading = new Set();

function makeImg(url) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  return img;
}

// Neues Master setzen (nach Generierung, Korrektur oder Verlaufs-Auswahl):
// abgeleitete Formate verfallen, Anzeige springt auf das Master zurück.
export function setMaster(url) {
  state.master = url;
  state.masterImg = makeImg(url);
  state.last = url;
  state.lastImg = state.masterImg;
  state.formats = { story: url };
  state.currentFormat = "story";
  if (els.resultImg) els.resultImg.src = url;
  renderTiles();
}

// Anzeige (große Vorschau + Downloads) auf ein bereits erzeugtes Format
// umschalten.
export function selectFormat(id) {
  const url = state.formats[id];
  if (!url) return;
  state.currentFormat = id;
  state.last = url;
  state.lastImg = id === "story" ? state.masterImg : makeImg(url);
  if (els.resultImg) els.resultImg.src = url;
  renderTiles();
}

async function masterDataUrl() {
  const blob = await (await fetch(state.master)).blob();
  if (blob.size > MAX_UPLOAD) throw new Error("Das Master-Bild ist zu groß (max. 10 MB).");
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
    r.readAsDataURL(blob);
  });
}

// Kachel-Klick: gecachte Formate schalten nur um, neue werden erst per
// Reframe erzeugt (Spinner in der Kachel, danach Häkchen).
async function ensureFormat(id) {
  if (loading.has(id)) return;
  if (state.formats[id]) { selectFormat(id); return; }
  if (!state.master) return;

  // Während des Calls kann sich das Master ändern (neue Generierung oder
  // Korrektur) — das Ergebnis wäre dann veraltet und wird verworfen.
  const masterAtStart = state.master;
  loading.add(id);
  renderTiles();
  try {
    const image = await postReframe({ image: await masterDataUrl(), targetFormat: id });
    loading.delete(id);
    if (state.master !== masterAtStart) { renderTiles(); return; }
    state.formats[id] = image;
    selectFormat(id);
  } catch (e) {
    loading.delete(id);
    renderTiles();
    if (state.master !== masterAtStart) return; // veraltet → kein Retry-Toast
    toast(e.message || "Format konnte nicht erstellt werden.", {
      type: "error",
      action: { label: "Erneut versuchen", onClick: () => ensureFormat(id) },
    });
  }
}

export function renderTiles() {
  const row = $("formatsRow");
  if (!row) return;
  row.innerHTML = "";
  for (const f of FORMATS) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "fmt-tile"
      + (state.currentFormat === f.id ? " active" : "")
      + (state.formats[f.id] ? " done" : "");
    tile.dataset.fmt = f.id;
    tile.title = f.name + " " + f.ratio;

    const shape = document.createElement("span");
    shape.className = "fmt-shape";
    shape.style.width = f.shapeW + "px";
    shape.style.height = f.shapeH + "px";
    tile.appendChild(shape);

    const name = document.createElement("span");
    name.className = "fmt-name";
    name.textContent = f.name;
    tile.appendChild(name);

    const ratio = document.createElement("span");
    ratio.className = "fmt-ratio";
    ratio.textContent = f.ratio;
    tile.appendChild(ratio);

    const status = document.createElement("span");
    status.className = "fmt-status";
    if (loading.has(f.id)) status.innerHTML = '<span class="fmt-spin"></span>';
    else if (state.formats[f.id]) status.textContent = "✓";
    tile.appendChild(status);

    tile.addEventListener("click", () => ensureFormat(f.id));
    row.appendChild(tile);
  }
}

export function initFormats() {
  renderTiles();
}
