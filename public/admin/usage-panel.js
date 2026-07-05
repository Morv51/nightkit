// Nutzungs-Dashboard als Studio-Tab. Zeigt die EIGENEN Anbieter-Aufrufe von NightKit
// und eine selbst berechnete Kostenschätzung (Anzahl × editierbarer Richtpreis). NUR
// Anzeige, keine Kernfunktion. Nutzt das geteilte Admin-Token (studioApi). Erscheint
// nur bei ADMIN_TOOLS=1 (Endpunkt 404 -> Tab verborgen).

import { getToken, clearToken, post } from "./studioApi.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const panel = () => document.getElementById("panel-usage");
const q = (sel) => panel().querySelector(sel);
const money = (n) => "$" + (Number(n) || 0).toFixed(2);

let data = null;

const PROVIDER_LINKS = [
  { name: "OpenAI", url: "https://platform.openai.com/account/usage" },
  { name: "Anthropic", url: "https://console.anthropic.com" },
  { name: "Ideogram", url: "https://ideogram.ai/manage-api" },
  { name: "fal", url: "https://fal.ai/dashboard" },
  { name: "Replicate", url: "https://replicate.com/account/billing" },
];

async function fetchData() {
  const res = await fetch("/admin/usage/data", { headers: { "X-Admin-Token": getToken() } });
  if (res.status === 401) { clearToken(); location.reload(); throw Object.assign(new Error("401"), { status: 401 }); }
  if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { status: res.status });
  return res.json();
}

export async function initUsage() {
  const tabBtn = document.querySelector('.studio-tab[data-tab="usage"]');
  const p = panel(); if (!p) return;
  try { data = await fetchData(); }
  catch (e) {
    if (e.status === 404) return; // Tool aus -> Tab verborgen lassen
    if (tabBtn) tabBtn.hidden = false;
    p.innerHTML = '<p class="us-empty">Nutzungsdaten konnten nicht geladen werden: ' + esc(e.message) + "</p>";
    return;
  }
  if (tabBtn) tabBtn.hidden = false;
  renderShell(p);
  render();
}

function renderShell(p) {
  p.innerHTML = [
    '<div class="us-note">Zählt die EIGENEN Anbieter-Aufrufe von NightKit und schätzt daraus die Kosten. Das ist eine <b>Schätzung</b> (Anzahl der Aufrufe × selbst gepflegter Richtpreis), keine echte Abrechnung. Die Zählung beginnt ab Einbau, <b>nicht rückwirkend</b>. Verbindlich sind allein die Anbieter-Dashboards (unten verlinkt).</div>',
    '<div class="us-cards">',
    '  <div class="us-card"><div class="us-k">Aktionen gesamt</div><div class="us-v" id="usTotalCount">-</div></div>',
    '  <div class="us-card"><div class="us-k">Geschätzte Kosten</div><div class="us-v" id="usTotalCost">-</div><div class="us-sub">Schätzung, keine Abrechnung</div></div>',
    '  <div class="us-card"><div class="us-k">Zählung seit</div><div class="us-v us-since" id="usSince">-</div></div>',
    '</div>',
    '<div class="us-tablewrap"><table class="us-table"><thead><tr><th>Aktion</th><th>Anbieter</th><th class="r">Aufrufe</th><th class="r">Richtpreis/Aufruf</th><th class="r">Geschätzte Kosten</th></tr></thead><tbody id="usRows"></tbody></table></div>',
    '<div class="us-links"><b>Verbindliche Abrechnung:</b> ' + PROVIDER_LINKS.map((l) => '<a href="' + l.url + '" target="_blank" rel="noopener">' + esc(l.name) + "</a>").join(" · ") + "</div>",
    '<div class="us-actions"><button class="rbtn rbtn-ghost" id="usReload" type="button">Aktualisieren</button><button class="rbtn rbtn-danger" id="usReset" type="button">Zähler zurücksetzen</button><span class="us-hint">Richtpreis direkt in der Tabelle ändern (in deiner Einheit, z. B. USD).</span></div>',
    '<div class="mng-toast" id="usToast"></div>',
  ].join("");
  q("#usReload").addEventListener("click", reload);
  q("#usReset").addEventListener("click", doReset);
  p.addEventListener("change", onPriceChange);
}

function render() {
  if (!data) return;
  q("#usTotalCount").textContent = String(data.totalCount || 0);
  q("#usTotalCost").textContent = "≈ " + money(data.totalCost);
  q("#usSince").textContent = data.startedAt ? fmtDate(data.startedAt) : "-";
  q("#usRows").innerHTML = (data.rows || []).map((r) =>
    "<tr><td>" + esc(r.label) + '</td><td class="us-prov">' + esc(r.provider) + "</td>" +
    '<td class="r us-count">' + (r.count || 0) + "</td>" +
    '<td class="r"><span class="us-cur">$</span><input class="us-price" type="number" min="0" step="0.001" value="' + (Number(r.price) || 0) + '" data-key="' + esc(r.key) + '"></td>' +
    '<td class="r us-cost">' + money(r.cost) + "</td></tr>"
  ).join("");
}

function fmtDate(iso) { try { return new Date(iso).toLocaleString("de-DE"); } catch (_) { return String(iso); } }

function toast(msg, kind) {
  const t = q("#usToast"); if (!t) return;
  t.textContent = msg; t.className = "mng-toast show" + (kind ? " " + kind : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = "mng-toast"; }, 2600);
}

async function reload() {
  try { data = await fetchData(); render(); }
  catch (e) { if (e.status !== 401) toast(e.message, "err"); }
}

async function onPriceChange(e) {
  const inp = e.target.closest(".us-price"); if (!inp) return;
  try {
    data = await post("/admin/usage/price", { key: inp.dataset.key, price: Number(inp.value) });
    render();
    toast("Richtpreis gespeichert, Schätzung aktualisiert", "good");
  } catch (err) { if (err.message !== "401") toast(err.message, "err"); }
}

async function doReset() {
  if (!confirm("Alle Nutzungs-Zähler auf 0 zurücksetzen?\nDie bisherige Zählung geht verloren, der Startzeitpunkt wird neu gesetzt.")) return;
  try { data = await post("/admin/usage/reset", {}); render(); toast("Zähler zurückgesetzt", "good"); }
  catch (e) { if (e.message !== "401") toast(e.message, "err"); }
}
