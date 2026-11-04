// Small behaviours that would otherwise need inline handlers (blocked by the CSP).
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) window.print();
});
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-autosubmit]')) e.target.form.submit();
});

// "/" jumps to the search box, as on GitHub (not while typing in a field).
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const search = document.querySelector('[data-hotkey="/"]');
  if (search) {
    e.preventDefault();
    search.focus();
  }
});

// Forms that undo or remove something ask first: <form data-confirm="Remove this entry?">.
document.addEventListener('submit', (e) => {
  const form = e.target;
  // The button pressed may ask its own question (a Delete button inside an edit form).
  const ask = (e.submitter && e.submitter.dataset.confirm) || (form instanceof HTMLFormElement && form.dataset.confirm);
  if (ask && !window.confirm(ask)) e.preventDefault();
});

// A search box that hides table rows not matching it: <input data-filter-rows="#table">.
// Rows carry their text in data-filter-text; a detail row right after a row follows it.
document.addEventListener('input', (e) => {
  const box = e.target;
  if (!(box instanceof HTMLInputElement) || !box.dataset.filterRows) return;
  const q = box.value.trim().toLowerCase();
  document.querySelectorAll(`${box.dataset.filterRows} tbody tr[data-filter-text]`).forEach((row) => {
    const hide = q !== '' && !row.dataset.filterText.includes(q);
    row.hidden = hide;
    const next = row.nextElementSibling;
    if (next && !next.dataset.filterText && next.classList.contains('collapse')) next.hidden = hide;
  });
});


// Row checkboxes with a "select all" box and a bar that appears when something is picked.
document.addEventListener('change', (e) => {
  const box = e.target;
  if (!(box instanceof HTMLInputElement)) return;
  const group = box.dataset.checkAll || box.dataset.check;
  if (!group) return;
  const boxes = [...document.querySelectorAll(`[data-check="${group}"]`)];
  if (box.dataset.checkAll) boxes.forEach((b) => { b.checked = box.checked; });
  const n = boxes.filter((b) => b.checked).length;
  const bar = document.querySelector(`[data-bulk-bar="${group}"]`);
  if (bar) {
    bar.hidden = n === 0;
    const count = bar.querySelector('[data-bulk-count]');
    if (count) count.textContent = zt('{n} selected', { n });
  }
});


// Display options: switch at once (class on <html>), save in the background, keep the panel open.
document.addEventListener('click', (e) => {
  const sw = e.target instanceof Element && e.target.closest('[data-ui-switch], [data-ui-theme]');
  if (!sw) return;
  e.preventDefault();
  const html = document.documentElement;
  let query;
  if (sw.dataset.uiTheme) {
    html.classList.remove('z-theme-light', 'z-theme-dark');
    if (sw.dataset.uiTheme !== 'auto') html.classList.add(`z-theme-${sw.dataset.uiTheme}`);
    sw.parentElement.querySelectorAll('[data-ui-theme]').forEach((b) => { b.classList.toggle('active', b === sw); b.setAttribute('aria-pressed', String(b === sw)); });
    query = `theme=${sw.dataset.uiTheme}`;
  } else {
    const on = sw.getAttribute('aria-checked') !== 'true';
    html.classList.toggle(sw.dataset.uiClass, on);
    sw.setAttribute('aria-checked', String(on));
    const box = sw.querySelector('input');
    if (box) box.checked = on;
    query = `${sw.dataset.uiSwitch}=${on ? 1 : 0}`;
  }
  fetch(`/preferences/display?${query}`, { headers: { 'X-Requested-With': 'zury' }, credentials: 'same-origin' }).catch(() => {});
});
