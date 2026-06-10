// Central mutable app state. Imported by modules that need to read/write
// shared values. Keep flat & boring.

export const state = {
  last: null,
  lastImg: null,
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
