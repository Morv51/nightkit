// Central mutable app state. Imported by modules that need to read/write
// shared values. Keep flat & boring.

export const state = {
  last: null,      // currently DISPLAYED image (downloads/copy follow this)
  lastImg: null,
  master: null,    // the 9:16 master (video + correction always use this)
  masterImg: null,

  // multi-format export: cached reframe results per format id
  formats: {},          // { story|feed|square|banner: url }
  currentFormat: "story",
  currentVideoStyle: "glitch",
  animFrameId: null,
  historyUrls: [],
  videoPanelOpen: true,

  // templates
  templates: [],
  categories: [],
  currentTemplateFile: null,

  // logo
  logoUrl: null,
  logoBox: { cx: 0.5, cy: 0.15, w: 0.3 }, // centre + width as fractions of the flyer

  // correction mode: one step back to the version before the last inpainting
  correctPrev: null,
  correctPrevImg: null,
};
