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
  if (form instanceof HTMLFormElement && form.dataset.confirm && !window.confirm(form.dataset.confirm)) e.preventDefault();
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
