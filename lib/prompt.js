"use strict";

const UPPER_FIELDS = ["name", "prefix", "genre", "day", "contact"];

function normalize(ev) {
  const out = {};
  for (const k of Object.keys(ev || {})) {
    const v = typeof ev[k] === "string" ? ev[k].trim() : "";
    out[k] = UPPER_FIELDS.includes(k) ? v.toUpperCase() : v;
  }
  return out;
}

function splitDjs(dj) {
  if (!dj) return [];
  return dj
    .split(",")
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean);
}

function buildPrompt(rawEvent) {
  const ev = normalize(rawEvent);
  const djList = splitDjs(ev.dj);

  const lines = [
    "Edit this nightclub event flyer. ",
    "Keep ALL visual elements completely identical — people, background, colors, textures, effects, decorations, layout, composition. ",
    "Only replace the text content. CRITICAL: Every text element must use EXACTLY the same font, capitalization style, color and position as the original template — do not change the typography or letter case, only swap the words.\n\n",
    "Replace each text element with these exact strings (use ALL CAPS exactly as written here):\n",
  ];

  lines.push(
    ev.prefix
      ? `1. Small decorative text above main title: "${ev.prefix}"\n`
      : "1. Small decorative text above main title: REMOVE IT COMPLETELY\n"
  );

  if (ev.name) lines.push(`2. Main event title (largest text, ALL CAPS): "${ev.name}"\n`);
  if (ev.genre) lines.push(`3. Secondary banner text (ALL CAPS): "${ev.genre}"\n`);

  if (ev.day || ev.date) {
    const dateStr = [ev.day, ev.date].filter(Boolean).join(" ");
    lines.push(`4. Date section (ALL CAPS): "${dateStr}"\n`);
  }

  lines.push(
    djList.length
      ? `5. DJ/artist names (ALL CAPS, one per line): ${djList.map((d) => `"${d}"`).join(", ")}\n`
      : "5. DJ/artist names section: REMOVE ALL NAMES\n"
  );

  if (ev.time || ev.entry) {
    const parts = [];
    if (ev.time) parts.push(`EINLASS: ${ev.time} UHR`);
    if (ev.entry) parts.push(`EINTRITT: ${ev.entry}`);
    lines.push(`6. Event details: "${parts.join(" | ")}"\n`);
  }

  if (ev.contact) lines.push(`7. Website at bottom (ALL CAPS): "${ev.contact}"\n`);

  lines.push(
    "\nDo not add any text not listed above. Remove any original text that has no replacement in this list. ",
    "The capitalization shown above is final — render every letter exactly as written."
  );

  return lines.join("");
}

module.exports = { buildPrompt };
