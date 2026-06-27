// Fetch-Helfer für das Template Studio. Hängt das Admin-Token (aus dem
// Code-Gate) als X-Admin-Token an jeden Aufruf. Bei 401 → Token verwerfen und
// zurück zum Gate.

const TOKEN_KEY = "nk_admin_token";

export const getToken = () => sessionStorage.getItem(TOKEN_KEY) || "";
export const setToken = (t) => sessionStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

// Code-Gate: ohne Token, gibt bei Erfolg { token } zurück.
export async function postAuth(code) {
  const res = await fetch("/admin/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Falscher Code");
  return data;
}

// Geschützter POST mit Token. Bei 401 → Gate.
export async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": getToken() },
    body: JSON.stringify(body || {}),
  });
  if (res.status === 401) {
    clearToken();
    location.reload();
    throw new Error("Sitzung abgelaufen — bitte erneut entsperren.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
  return data;
}
