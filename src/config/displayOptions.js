// Display and accessibility options. Each is a class on <html> when on; "theme" picks
// light, dark or the system's choice. Saved on the account, or in the session for visitors.
const SWITCHES = {
  wide: { cls: 'zury-wide', label: 'Wide pages', icon: 'arrows-horizontal' },
  textLarge: { cls: 'zury-text-lg', label: 'Larger text', icon: 'text-size' },
  textXl: { cls: 'zury-text-xl', label: 'Even larger text', icon: 'text-increase' },
  contrast: { cls: 'zury-contrast', label: 'High contrast', icon: 'contrast' },
  underline: { cls: 'zury-underline', label: 'Underline links', icon: 'underline' },
  spacing: { cls: 'zury-spacing', label: 'Easier reading (more spacing)', icon: 'line-height' },
  targets: { cls: 'zury-targets', label: 'Bigger buttons and links', icon: 'hand-click' },
  motion: { cls: 'zury-still', label: 'Reduce motion', icon: 'player-pause' },
};
const THEMES = ['auto', 'light', 'dark'];

function read(source = {}) {
  const ui = { theme: THEMES.includes(source.theme) ? source.theme : 'auto' };
  for (const key of Object.keys(SWITCHES)) ui[key] = Boolean(source[key]);
  return ui;
}

const classes = (ui) => [...Object.entries(SWITCHES).filter(([k]) => ui[k]).map(([, o]) => o.cls), ui.theme !== 'auto' && `z-theme-${ui.theme}`].filter(Boolean).join(' ');

module.exports = { SWITCHES, THEMES, read, classes };
