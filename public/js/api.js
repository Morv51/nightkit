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

export async function postGenerate(event) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = await res.json();
  if (!data.jobId) throw new Error("Kein Job zurück.");
  return data.jobId;
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
  return data.templates || [];
}

export function proxyUrl(externalUrl) {
  return "/api/proxy?url=" + encodeURIComponent(externalUrl);
}
