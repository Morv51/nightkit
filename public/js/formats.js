import { state } from "./state.js";
import { $, els } from "./dom.js";
import { postReframe, postFormatV4, friendlyMessage } from "./api.js";
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
];

const MAX_UPLOAD = 9.5 * 1024 * 1024; // Ideogram-Limit: 10MB

// ── Rand-Nachbearbeitung (Shadow-Falloff) ────────────────────────
// Die per Reframe erweiterten Flächen außerhalb des Master-Rechtecks werden
// nach dem Call beruhigt, damit sie wie ein gewolltes dunkles Gestaltungsmittel
// wirken statt wie KI-Füllung: weicher Blur + leichte Entsättigung gegen
// Muster, dazu ein dunkler Verlauf von der Flyer-Kante (transparent) nach
// außen, der Reststrukturen schluckt. Der Übergang ist über `feather` px
// gefedert; das Master-Rechteck selbst bleibt zu 100% scharf und unbearbeitet.
// Justierbare Werte pro Format:
const EDGE_TREAT = {
  feed:   { blur: 8,  desat: 40, darkMax: 0.7, feather: 80 }, // 4:5 — schmale Randstreifen (Blur-Spielraum 6–10px)
  square: { blur: 15, desat: 40, darkMax: 0.7, feather: 90 }, // 1:1 — breite Randstreifen (Blur-Spielraum 12–18px)
};

const loading = new Set();

// V4-Beta pro Kachel (Feed + Quadrat): bei aktivem Toggle wird das Format
// nicht per Reframe outgepainted, sondern per /api/format-v4 (Ideogram 4.0,
// fertiger Flyer als Vorlage) vollflächig neu layoutet. Beide Varianten
// werden separat gecacht ('feed'/'square' = Reframe, 'feed-v4'/'square-v4'
// = V4) und kosten je einen Call.
const v4Mode = { feed: false, square: false };

const variantOf = (tileId) => (v4Mode[tileId] ? tileId + "-v4" : tileId);

const VIA_LABELS = { "square-v4": "1:1 via V4", "feed-v4": "4:5 via V4" };

function updateViaTag() {
  const tag = $("fmtViaTag");
  if (!tag) return;
  const label = VIA_LABELS[state.currentFormat];
  tag.textContent = label || "";
  tag.style.display = label ? "block" : "none";
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
    img.src = src;
  });
}

async function treatEdges(dataUrl, formatId) {
  const t = EDGE_TREAT[formatId];
  if (!t) return dataUrl;
  const [img, master] = await Promise.all([loadImage(dataUrl), loadImage(state.master)]);
  const W = img.naturalWidth, H = img.naturalHeight;

  // Das Master sitzt "contain"-zentriert im Reframe-Ergebnis.
  const s = Math.min(W / master.naturalWidth, H / master.naturalHeight);
  const mw = Math.round(master.naturalWidth * s);
  const mh = Math.round(master.naturalHeight * s);
  const x0 = Math.round((W - mw) / 2);
  const y0 = Math.round((H - mh) / 2);
  if (x0 < 3 && y0 < 3) return dataUrl; // keine nennenswerte Erweiterung

  // 1) Beruhigte Basis: Blur + Entsättigung über schwarzem Grund (der
  //    Blur-Alphasaum am Canvas-Rand fällt damit ins Dunkle statt transparent).
  const base = document.createElement("canvas");
  base.width = W; base.height = H;
  const bx = base.getContext("2d");
  bx.fillStyle = "#000";
  bx.fillRect(0, 0, W, H);
  bx.filter = `blur(${t.blur}px) grayscale(${t.desat}%)`;
  bx.drawImage(img, 0, 0);
  bx.filter = "none";

  // 2) Dunkler Verlauf auf den Erweiterungsflächen: an der Flyer-Kante
  //    transparent, außen bis rgba(0,0,0,darkMax).
  function darken(x, y, w, h, gx0, gy0, gx1, gy1) {
    const g = bx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${t.darkMax})`);
    bx.fillStyle = g;
    bx.fillRect(x, y, w, h);
  }
  if (x0 > 2) {
    darken(0, 0, x0, H, x0, 0, 0, 0);                     // links
    darken(x0 + mw, 0, W - x0 - mw, H, x0 + mw, 0, W, 0); // rechts
  }
  if (y0 > 2) {
    darken(0, 0, W, y0, 0, y0, 0, 0);                     // oben
    darken(0, y0 + mh, W, H - y0 - mh, 0, y0 + mh, 0, H); // unten
  }

  // 3) Gefederte Maske: deckend im Flyer-Rechteck, Fade über `feather` px in
  //    die Erweiterung hinein. Eigene Canvas + EIN destination-in-Draw —
  //    mehrere destination-in-Fills würden den Rest der Fläche löschen.
  const mask = document.createElement("canvas");
  mask.width = W; mask.height = H;
  const mx = mask.getContext("2d");
  mx.fillStyle = "#fff";
  mx.fillRect(x0, y0, mw, mh);
  function fade(x, y, w, h, gx0, gy0, gx1, gy1) {
    const g = mx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    mx.fillStyle = g;
    mx.fillRect(x, y, w, h);
  }
  if (x0 > 2) {
    const f = Math.min(t.feather, x0);
    fade(x0 - f, y0, f, mh, x0, 0, x0 - f, 0);
    fade(x0 + mw, y0, f, mh, x0 + mw, 0, x0 + mw + f, 0);
  }
  if (y0 > 2) {
    const f = Math.min(t.feather, y0);
    fade(x0, y0 - f, mw, f, 0, y0, 0, y0 - f);
    fade(x0, y0 + mh, mw, f, 0, y0 + mh, 0, y0 + mh + f);
  }

  // 4) Scharfes Original mit der Maske über die beruhigte Basis legen.
  const sharp = document.createElement("canvas");
  sharp.width = W; sharp.height = H;
  const sx = sharp.getContext("2d");
  sx.drawImage(img, 0, 0);
  sx.globalCompositeOperation = "destination-in";
  sx.drawImage(mask, 0, 0);

  bx.drawImage(sharp, 0, 0);
  return base.toDataURL("image/png");
}

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
  updateViaTag();
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
  updateViaTag();
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
    let image;
    if (id.endsWith("-v4")) {
      // V4-Adaption: vollflächiges Re-Layout aus der Vorlage — es gibt keine
      // erweiterten Randflächen, daher auch keine Rand-Nachbearbeitung.
      image = await postFormatV4({ masterImage: await masterDataUrl(), targetFormat: id.slice(0, -3) });
    } else {
      image = await postReframe({ image: await masterDataUrl(), targetFormat: id });
      // Shadow-Falloff auf den erweiterten Flächen; bei Fehlern lieber das
      // unbehandelte Reframe-Ergebnis zeigen als gar keins.
      try {
        image = await treatEdges(image, id);
      } catch (e) {
        console.error("Rand-Nachbearbeitung fehlgeschlagen:", e);
      }
    }
    loading.delete(id);
    if (state.master !== masterAtStart) { renderTiles(); return; }
    state.formats[id] = image;
    selectFormat(id);
  } catch (e) {
    loading.delete(id);
    renderTiles();
    if (state.master !== masterAtStart) return; // veraltet → kein Retry-Toast
    toast(friendlyMessage(e), {
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
    // Feed- und Quadrat-Kachel haben zwei Varianten (Reframe vs. V4-Beta) —
    // Status, Häkchen und Klick beziehen sich immer auf die aktive Variante.
    const vid = variantOf(f.id);
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "fmt-tile"
      + (state.currentFormat === vid ? " active" : "")
      + (state.formats[vid] ? " done" : "")
      + (loading.has(vid) ? " loading" : "");
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
    if (loading.has(vid)) status.innerHTML = '<span class="fmt-spin"></span>';
    else if (state.formats[vid]) status.textContent = "✓";
    tile.appendChild(status);

    // V4-Beta-Toggle an Feed- und Quadrat-Kachel (span statt button —
    // verschachtelte Buttons sind ungültiges HTML). Klick toggelt nur den
    // Modus, generiert nichts; der Kachel-Klick nutzt dann V4 bzw. Reframe.
    if (f.id in v4Mode) {
      const chip = document.createElement("span");
      chip.className = "fmt-v4-chip" + (v4Mode[f.id] ? " active" : "");
      chip.setAttribute("role", "button");
      chip.tabIndex = 0;
      chip.textContent = "V4 (Beta)";
      chip.title = f.name + " per Ideogram V4 aus dem fertigen Flyer vollflächig neu layouten (Beta), statt per Reframe zu erweitern";
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        v4Mode[f.id] = !v4Mode[f.id];
        // Ist die andere Variante schon gecacht und gerade eine Ansicht
        // dieser Kachel aktiv, direkt umschalten — sonst nur neu rendern.
        const v = variantOf(f.id);
        if ((state.currentFormat === f.id || state.currentFormat === f.id + "-v4") && state.formats[v]) {
          selectFormat(v);
        } else {
          renderTiles();
        }
      });
      tile.appendChild(chip);
    }

    tile.addEventListener("click", () => ensureFormat(variantOf(f.id)));
    row.appendChild(tile);
  }
}

export function initFormats() {
  renderTiles();
}
