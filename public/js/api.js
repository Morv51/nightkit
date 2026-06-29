// Thin wrapper over fetch — every API call goes through here so error
// shapes stay consistent and future cross-cutting concerns (auth, retries,
// timeouts) have one place to land.

async function parseError(res) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    if (j.error) return j.error;
  } catch {}
  return `Fehler ${res.status}: ${text.slice(0, 200)}`;
}

// Limit messages by plan (429). The server may send { plan: 'free' | 'premium' }.
const LIMIT_MSG = {
  free:    "Du hast dein Limit im kostenlosen Plan erreicht. Mit einem Upgrade kannst du weiter Grafiken erstellen.",
  premium: "Du hast das faire Nutzungslimit erreicht. Bitte versuche es in Kürze noch einmal.",
  default: "Du hast dein Limit erreicht. Bitte versuche es später noch einmal.",
};

// Central response gate so every endpoint handles auth (401), rate limits
// (429) and other errors the same way. Throws a tagged Error (e.code) on
// failure; returns nothing on success.
async function ensureOk(res) {
  if (res.status === 401) {
    const e = new Error("Sitzung abgelaufen. Bitte neu anmelden.");
    e.code = "auth";
    throw e;
  }
  if (res.status === 429) {
    let plan = "default";
    try { plan = (await res.clone().json()).plan || "default"; } catch {}
    const e = new Error(LIMIT_MSG[plan] || LIMIT_MSG.default);
    e.code = "limit";
    throw e;
  }
  if (!res.ok) {
    const e = new Error(await parseError(res));
    e.code = "http";
    throw e;
  }
}

// Friendly, user-facing message for a caught API error. Limit and auth
// messages are already friendly and specific, so they pass through; raw
// server/network errors collapse to one calm line.
export function friendlyMessage(e) {
  if (e && (e.code === "limit" || e.code === "auth")) return e.message;
  return "Das hat gerade nicht geklappt. Bitte versuche es nochmal.";
}

// Attach the Supabase JWT (set up in app.html as window.sb) so the server can
// verify the user. No-op if auth isn't loaded.
async function authHeaders() {
  try {
    const sb = window.sb;
    if (sb && sb.auth) {
      const { data } = await sb.auth.getSession();
      const token = data && data.session && data.session.access_token;
      if (token) return { Authorization: "Bearer " + token };
    }
  } catch {}
  return {};
}

export async function postGenerate(event) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(event),
  });
  await ensureOk(res);
  const data = await res.json();
  if (!data.jobId) throw new Error("Kein Job zurück.");
  return data.jobId;
}

// Sauberes Entfernen (LaMa via Replicate): image + mask als base64 data URLs.
// Maskenkonvention: WEISS = entfernen, SCHWARZ = behalten. Liefert das
// bereinigte Bild als base64 data URL zurück.
export async function postRemove(payload) {
  const res = await fetch("/api/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  await ensureOk(res);
  const data = await res.json();
  if (!data.image) throw new Error("Kein bereinigtes Bild erhalten.");
  return data.image;
}

// Text anpassen: fertiger Flyer ({ image }) + korrigierter Text + markierte Zone
// ({ text, area }). Nutzt serverseitig den bestehenden edit()-Flow und liefert
// den neu gerenderten (ganzen) Flyer als base64 data URL zurück; das Frontend
// kopiert davon nur die markierte Zone ins Original.
export async function postAdjust(payload) {
  const res = await fetch("/api/adjust-text", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  await ensureOk(res);
  const data = await res.json();
  if (!data.image) throw new Error("Kein angepasstes Bild erhalten.");
  return data.image;
}

// Multi-format export: master image as base64 data URL + target format id
// ('feed' | 'square'). Returns the reframed image as a data URL.
export async function postReframe(payload) {
  const res = await fetch("/api/reframe", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  await ensureOk(res);
  const data = await res.json();
  if (!data.image) throw new Error("Kein Bild erhalten.");
  return data.image;
}

// V4-Format-Adaption: der fertige Flyer als Vorlage ({ masterImage, targetFormat }),
// V4 baut das Design ins Zielformat um. Antwort: Bild als Base64-Data-URL.
export async function postFormatV4(payload) {
  const res = await fetch("/api/format-v4", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  await ensureOk(res);
  const data = await res.json();
  if (!data.image) throw new Error("Kein Bild erhalten.");
  return data.image;
}

export async function postCaption(payload) {
  const res = await fetch("/api/caption", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  await ensureOk(res);
  const data = await res.json();
  if (!data.caption) throw new Error("Keine Caption erhalten.");
  return data.caption;
}

export async function getJobStatus(jobId) {
  const res = await fetch("/api/status/" + encodeURIComponent(jobId));
  if (!res.ok) throw new Error("Job nicht mehr vorhanden.");
  return res.json();
}

export async function getTemplates() {
  const res = await fetch("/api/templates");
  if (!res.ok) throw new Error("Templates konnten nicht geladen werden.");
  const data = await res.json();
  return { templates: data.templates || [], categories: data.categories || [] };
}

export function proxyUrl(externalUrl) {
  return "/api/proxy?url=" + encodeURIComponent(externalUrl);
}
