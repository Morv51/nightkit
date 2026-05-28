// Central mutable app state. Imported by modules that need to read/write
// shared values. Keep flat & boring — anything stored here is implicitly
// part of the public surface.

export const state = {
  last: null,
  lastImg: null,
  currentVideoStyle: "horror",
  animFrameId: null,
  historyUrls: [],
  liveUpdateTimer: null,
  videoPanelOpen: true,
  currentTemplateId: "default",
  currentCategory: "alle",
  templates: [],
};
