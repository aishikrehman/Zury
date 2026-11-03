// Tabler page layouts. Every layout uses the same markup (sidebar, header,
// optional menu bar, page wrapper); Tabler's CSS picks what to show from
// these <html> attributes and classes, exactly as in its layout-*.html demos.

const V = { 'data-bs-navbar-position': 'vertical' };

const LAYOUTS = {
  vertical: { label: 'Vertical', html: { ...V } },
  'vertical-right': { label: 'Right vertical', html: { ...V }, asideClass: 'navbar-end' },
  'vertical-floating': { label: 'Vertical floating', html: { ...V, 'data-bs-navbar-style': 'floating' } },
  'vertical-transparent': { label: 'Vertical transparent', html: { ...V }, asideClass: 'navbar-transparent' },
  'fluid-vertical': { label: 'Fluid vertical', html: { ...V, 'data-bs-layout': 'fluid' } },
  folded: { label: 'Folded sidebar', html: { ...V, 'data-bs-sidebar': 'folded' } },
  'folded-hover': { label: 'Folded hover', html: { ...V, 'data-bs-sidebar': 'folded-hover' } },
  horizontal: { label: 'Horizontal', html: {} },
  condensed: { label: 'Condensed', html: {}, menuInHeader: true },
  'navbar-floating': { label: 'Navbar floating', html: { 'data-bs-navbar-style': 'floating' }, menuInHeader: true },
  'navbar-sticky': { label: 'Navbar sticky', html: { 'data-bs-navbar': 'sticky' } },
  'navbar-dark': { label: 'Navbar dark', html: { 'data-bs-navbar-theme': 'dark' } },
  fluid: { label: 'Fluid', html: { 'data-bs-layout': 'fluid' } },
  rtl: { label: 'RTL mode', html: { dir: 'rtl' }, rtl: true },
};

const DEFAULT_LAYOUT = 'vertical-floating';
const PUBLIC_LAYOUT = 'navbar-floating';
const COOKIE = 'zury_layout';

function readLayoutCookie(header = '') {
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  const value = match && decodeURIComponent(match.slice(COOKIE.length + 1));
  return LAYOUTS[value] ? value : null;
}

function htmlAttributes(def) {
  return Object.entries(def.html)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
}

module.exports = { LAYOUTS, DEFAULT_LAYOUT, PUBLIC_LAYOUT, COOKIE, readLayoutCookie, htmlAttributes };
