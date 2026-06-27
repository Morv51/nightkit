"use strict";

// Eigenständiger Admin-Zugang für das Template Studio (single-user, Passwort
// "99"). BEWUSST getrennt von lib/auth.js (Supabase) — fasst dort nichts an.
// Ablauf: POST /admin/auth prüft den Code serverseitig und stellt ein
// signiertes Token aus; jeder kostenpflichtige Admin-Endpoint verlangt dieses
// Token im Header "X-Admin-Token". Frontend-Prüfung allein genügt nicht.

const crypto = require("crypto");

const ADMIN_CODE = process.env.ADMIN_CODE || "99";
// Signaturgeheimnis: in Produktion idealerweise ADMIN_SECRET setzen. Fallback
// auf den Code, damit es ohne Extra-Config läuft (Tool ist admin-only).
const SECRET = process.env.ADMIN_SECRET || process.env.ADMIN_CODE || "99";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 h

const b64url = (buf) => Buffer.from(buf).toString("base64url");

// Konstantzeit-Vergleich zweier Strings beliebiger Länge (über SHA-256-Digests,
// damit timingSafeEqual gleich lange Buffer bekommt und die Länge nichts verrät).
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function validateCode(code) {
  return safeEqual(code, ADMIN_CODE);
}

function sign(payloadB64) {
  return crypto.createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
}

// Signiertes, selbsttragendes Token: "<payload>.<hmac>". Kein Serverstate nötig.
function issueToken() {
  const payload = b64url(JSON.stringify({ exp: Date.now() + TTL_MS }));
  return payload + "." + sign(payload);
}

function verifyToken(token) {
  if (typeof token !== "string" || token.indexOf(".") < 0) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  // Signatur prüfen (konstantzeit), dann Ablauf.
  if (!safeEqual(sig, sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

// Guard für Admin-Endpoints: liest den Token-Header und prüft ihn. Liefert
// true/false; der Aufrufer antwortet bei false mit 401.
function requireAdmin(req) {
  const h = req.headers || {};
  const token = h["x-admin-token"] || h["X-Admin-Token"] || "";
  return verifyToken(token);
}

module.exports = { validateCode, issueToken, verifyToken, requireAdmin, ADMIN_CODE };
