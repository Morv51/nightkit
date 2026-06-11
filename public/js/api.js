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
  if (res.status === 401) throw new Error("Sitzung abgelaufen. Bitte neu anmelden.");
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  if (!data.jobId) throw new Error("Kein Job zurück.");
  return data.jobId;
}

// Inpainting correction: image + mask as base64 data URLs, instruction
// optional. Returns the corrected image as a base64 data URL.
export async function postCorrect(payload) {
  const res = await fetch("/api/correct", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) throw new Error("Sitzung abgelaufen. Bitte neu anmelden.");
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  if (!data.image) throw new Error("Kein korrigiertes Bild erhalten.");
  return data.image;
}

// Multi-format export: master image as base64 data URL + target format id
// ('feed' | 'square' | 'banner'). Returns the reframed image as a data URL.
export async function postReframe(payload) {
  const res = await fetch("/api/reframe", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) throw new Error("Sitzung abgelaufen. Bitte neu anmelden.");
  if (!res.ok) throw new Error(await parseError(res));
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
  if (res.status === 401) throw new Error("Sitzung abgelaufen. Bitte neu anmelden.");
  if (!res.ok) throw new Error(await parseError(res));
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
