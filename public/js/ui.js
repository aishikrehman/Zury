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
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  const search = document.querySelector('[data-hotkey="/"]');
  if (search) {
    e.preventDefault();
    search.focus();
  }
});

// Sidebar collapse: switch at once and save the choice on the account in the background.
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-sidebar-toggle]');
  if (!toggle) return;
  e.preventDefault();
  const collapsed = document.documentElement.classList.toggle('z-collapsed');
  fetch(`/preferences/display?sidebar=${collapsed ? 1 : 0}&quiet=1`, { credentials: 'same-origin' }).catch(() => {});
});
