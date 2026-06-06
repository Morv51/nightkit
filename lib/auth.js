"use strict";

// Server-side Supabase helpers. Uses the SERVICE ROLE key (admin) which must
// never reach the browser — it bypasses Row Level Security. Configure via env:
//   SUPABASE_URL          e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  the service_role secret
//
// When either is missing (local dev) the admin client is null: /api/generate
// is then NOT enforced and a loud warning is printed at startup. Production
// MUST set both.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || "";

let admin = null;
if (SUPABASE_URL && SERVICE_KEY) {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
} else {
  console.warn(
    "⚠️  SUPABASE_URL / SUPABASE_SERVICE_KEY not set — /api/generate is " +
    "NOT protected (dev mode). Set both env vars in production."
  );
}

function isConfigured() {
  return !!admin;
}

// Extract the bearer token from the Authorization header.
function bearer(req) {
  const h = req.headers["authorization"] || req.headers["Authorization"] || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

// Verify a Supabase access token. Resolves to the user object or null.
async function verifyToken(token) {
  if (!admin || !token) return null;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

// Increment profiles.generations_count for a user via the SQL `increment`
// RPC. Best-effort: failures are logged, never block the response.
async function incrementGenerations(userId) {
  if (!admin || !userId) return;
  try {
    const { error } = await admin.rpc("increment", { row_id: userId });
    if (error) console.error("increment RPC failed:", error.message);
  } catch (e) {
    console.error("increment RPC threw:", e.message);
  }
}

module.exports = { isConfigured, bearer, verifyToken, incrementGenerations };
