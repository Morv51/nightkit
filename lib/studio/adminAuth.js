"use strict";

// Admin-Zugang fürs Template Studio (für ein kleines Team, kein IP-Schutz).
// Codes kommen AUSSCHLIESSLICH aus der Env — kein Hardcode, kein Default-
// Fallback im Repo. Ist nichts gesetzt, wird der Zugang verweigert.
// BEWUSST getrennt von lib/auth.js (Supabase).
//
// Env ADMIN_CODES: kommaseparierte Liste, je Eintrag "code" oder "label:code".
//   Beispiel:  ADMIN_CODES="marvin:99,partner:1234"   oder   "99,1234"
// Env ADMIN_SECRET (optional): Signaturgeheimnis fürs Token. Ohne wird ein
//   Geheimnis stabil aus den Codes abgeleitet (kein statischer Default im Repo).

const crypto = require("crypto");

const TTL_MS = 12 * 60 * 60 * 1000; // 12 h

// Codes aus der Env parsen → [{ label, code }]. Leere/whitespace-Einträge raus.
function parseCodes() {
  return (process.env.ADMIN_CODES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const i = item.indexOf(":");
      if (i > 0) return { label: item.slice(0, i).trim(), code: item.slice(i + 1).trim() };
      return { label: null, code: item };
    })
    .filter((e) => e.code);
}

function isConfigured() {
  return parseCodes().length > 0;
}

// Signaturgeheimnis: ADMIN_SECRET, sonst stabil aus den Codes abgeleitet.
// Kein statischer Repo-Default. Da Codes Pflicht sind, gibt es immer eine Basis.
function secret() {
  if (process.env.ADMIN_SECRET) return process.env.ADMIN_SECRET;
  const codes = parseCodes().map((e) => e.code).join("|");
  return crypto.createHash("sha256").update("nk-studio-secret|" + codes).digest("hex");
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Liefert das Label (oder "admin") bei Treffer, sonst null. Verweigert + loggt,
// wenn keine Codes konfiguriert sind.
function matchCode(code) {
  const entries = parseCodes();
  if (!entries.length) {
    console.error("[studio-auth] ADMIN_CODES nicht gesetzt — Zugang verweigert");
    return null;
  }
  if (!code) return null;
  for (const e of entries) {
    if (safeEqual(code, e.code)) return e.label || "admin";
  }
  return null;
}

function sign(payloadB64) {
  return crypto.createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

// Signiertes, selbsttragendes Token "<payload>.<hmac>". Kein Serverstate nötig.
function issueToken() {
  const payload = b64url(JSON.stringify({ exp: Date.now() + TTL_MS }));
  return payload + "." + sign(payload);
}

function verifyToken(token) {
  if (!isConfigured()) return false; // fail-closed: ohne Codes kein Zugang
  if (typeof token !== "string" || token.indexOf(".") < 0) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  if (!safeEqual(sig, sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

// Guard für Admin-Endpoints: liest den Token-Header und prüft ihn.
function requireAdmin(req) {
  const h = req.headers || {};
  return verifyToken(h["x-admin-token"] || h["X-Admin-Token"] || "");
}

module.exports = { isConfigured, matchCode, issueToken, verifyToken, requireAdmin };
