"use strict";

// Maps the event form fields onto the text zones of the "Birthday Pink"
// template and produces an Ideogram edit prompt describing each zone.
//
//   form field         -> template zone
//   dj (Acts/Host)     -> top centre club / host name (up to 2 lines)
//   day + date         -> large date block: weekday / day / month (3 lines)
//   prefix (Subline)   -> cursive script subline above the headline
//   name (Headline)    -> main headline (largest, ALL CAPS, white w/ shadow)
//   date -> month      -> pink/purple banner (month / season); time folded in
//   contact (Website)  -> website at the bottom

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function clean(s) {
  return typeof s === "string" ? s.trim() : "";
}

// Parses the app's DD.MM.YYYY date (tolerant of . - / separators).
function parseDate(dateStr) {
  const m = clean(dateStr).match(/^(\d{1,2})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{2,4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthIdx = parseInt(m[2], 10) - 1;
  if (monthIdx < 0 || monthIdx > 11) return null;
  return { day, month: MONTHS_DE[monthIdx] };
}

function buildPrompt(rawEvent) {
  const ev = rawEvent || {};
  const hosts    = clean(ev.dj).split(",").map((d) => d.trim().toUpperCase()).filter(Boolean);
  const weekday  = clean(ev.day).toUpperCase();
  const subline  = clean(ev.prefix);
  const headline = clean(ev.name).toUpperCase();
  const website  = clean(ev.contact).toUpperCase();
  const time     = clean(ev.time);
  const dateRaw  = clean(ev.date);

  const parsed = parseDate(dateRaw);
  const dayNum = parsed ? String(parsed.day) : "";
  const month  = parsed ? parsed.month.toUpperCase() : "";

  const lines = [
    "Edit this pink birthday-party event flyer. ",
    "Keep ALL visual elements completely identical — background, the pink and purple colors, gradients, textures, decorations, lighting and overall composition. ",
    "Only replace the TEXT content. CRITICAL: every text element must keep EXACTLY the same font, font style, capitalization, color and position as in the original template — do not change the typography or letter case, only swap the words.\n\n",
    "Replace each text zone with exactly the following:\n",
  ];

  if (hosts.length > 1) {
    lines.push(`1. Top centre, large host / act names — render each name on its OWN line, do NOT use commas or any separator between them: ${hosts.map((h) => `"${h}"`).join(", ")}\n`);
  } else if (hosts.length === 1) {
    lines.push(`1. Top centre, large host / act name (may wrap onto two lines): "${hosts[0]}"\n`);
  } else {
    lines.push("1. Top centre host / act name: REMOVE IT COMPLETELY\n");
  }

  const dateBlock = [weekday, dayNum, month].filter(Boolean);
  if (dateBlock.length === 3) {
    lines.push(`2. Large date block, three stacked lines — weekday, day, month: "${weekday}" / "${dayNum}" / "${month}"\n`);
  } else if (weekday || dateRaw) {
    lines.push(`2. Large date block: "${[weekday, dateRaw.toUpperCase()].filter(Boolean).join(" ")}"\n`);
  }

  lines.push(
    subline
      ? `3. Cursive handwritten script subline directly above the headline (keep the script font and its mixed-case styling): "${subline}"\n`
      : "3. Cursive script subline above the headline: REMOVE IT COMPLETELY\n"
  );

  if (headline) {
    lines.push(`4. Main HEADLINE — the largest text, ALL CAPS, white with a drop shadow: "${headline}"\n`);
  }

  const banner = [];
  if (month) banner.push(month);
  if (time)  banner.push(`EINLASS ${time} UHR`);
  lines.push(
    banner.length
      ? `5. Pink / purple banner strip (keep the pink banner background): "${banner.join("  •  ")}"\n`
      : "5. Pink / purple banner strip: REMOVE THE TEXT\n"
  );

  if (website) {
    lines.push(`6. Website at the very bottom (ALL CAPS): "${website}"\n`);
  }

  if (ev.hasLogo) {
    lines.push("7. Keep the bottom-right corner clean and free of any text or graphics — a logo will be placed there afterwards.\n");
  }

  lines.push(
    "\nDo not add any text that is not listed above. Remove any original template text that has no replacement here. ",
    "The capitalization shown above is final — render every letter exactly as written."
  );

  return lines.join("");
}

module.exports = { buildPrompt };
