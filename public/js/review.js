// Review window: buttons set the decision; keys A (accept), R (reject),
// S (skip), 1–9 (values of the first mark) and Ctrl+Enter (save).
(function () {
  const form = document.querySelector('[data-review-form]');
  if (!form) return;
  const decision = form.querySelector('[data-decision]');

  form.querySelectorAll('[data-decide]').forEach((button) =>
    button.addEventListener('click', () => {
      decision.value = button.dataset.decide;
    }),
  );

  document.addEventListener('keydown', (e) => {
    const inField = e.target instanceof Element && e.target.closest('input[type="text"], textarea, select, [contenteditable]');
    if (inField) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && decision.value) form.requestSubmit();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'a' || key === 'r') {
      e.preventDefault();
      form.querySelector(`[data-decide="${key === 'a' ? 'accept' : 'reject'}"]`).click();
    } else if (key === 's') {
      const skip = document.querySelector('[data-review-skip]');
      if (skip) location.href = skip.href;
    } else if (/^[1-9]$/.test(key)) {
      const options = form.querySelectorAll('[data-mark-group="0"] input');
      const option = options[Number(key) - 1];
      if (option) option.checked = true;
    }
  });
})();

// The entry picker on the review page: the queue in order, searchable, a page at a time.
(function () {
  const el = document.querySelector('[data-review-picker]');
  if (!el || !window.TomSelect) return;
  const go = el.dataset.go;
  const url = (q, page) => `${el.dataset.url}&search=${encodeURIComponent(q)}&page=${page}`.replace('?&', '?');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Pages per search: the next page loads when the list is scrolled near its end.
  const state = { query: '', next: null, busy: false, loaded: false };
  const ts = new window.TomSelect(el, {
    dropdownParent: 'body',
    valueField: 'value',
    labelField: 'text',
    // The server searches; show what it sends, in the queue's order.
    searchField: [],
    score: () => () => 1,
    sortField: [{ field: 'position' }],
    maxOptions: null,
    loadThrottle: 250,
    // Load with an empty search too: the list is the whole queue.
    shouldLoad: () => true,
    load(query, callback) {
      state.query = query;
      state.busy = true;
      fetch(url(query, 1), { headers: { Accept: 'application/json' } })
        .then((r) => r.json())
        .then((json) => {
          state.next = json.next;
          // A new search replaces the list (the chosen entry stays).
          this.clearOptions((o) => this.items.includes(o.value));
          callback(json.items);
        })
        .catch(() => callback())
        .finally(() => {
          state.busy = false;
        });
    },
    onDropdownOpen() {
      if (!state.loaded) {
        state.loaded = true;
        this.load('');
      }
    },
    render: {
      option: (it) => `<div class="d-flex gap-2"><span class="text-secondary small" style="min-width:2.5rem">${it.position ? esc(it.position) : ''}</span><span class="flex-fill min-w-0"><span class="d-block text-truncate">${esc(it.text)}</span><span class="d-block small text-secondary text-truncate">${esc(it.participant || '')}${it.words != null ? ' · ' + esc(it.words) : ''}</span></span></div>`,
      item: (it) => `<div class="text-truncate">${esc(it.text)}</div>`,
      loading_more: () => `<div class="loading-more-results py-2 d-flex align-items-center"><div class="spinner-border spinner-border-sm me-2"></div>${esc(zt('Loading…'))}</div>`,
      no_more_results: () => '',
      no_results: () => `<div class="no-results">${esc(zt('No matches'))}</div>`,
    },
    onChange(value) {
      if (value) location.href = `${go}&entry=${encodeURIComponent(value)}`.replace('?&', '?');
    },
  });
  ts.on('focus', () => ts.setTextboxValue(''));
  ts.dropdown_content.addEventListener('scroll', () => {
    const d = ts.dropdown_content;
    if (state.busy || !state.next || d.scrollTop + d.clientHeight < d.scrollHeight - 80) return;
    const query = state.query;
    state.busy = true;
    fetch(url(query, state.next), { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((json) => {
        if (query !== state.query) return;
        ts.addOptions(json.items);
        state.next = json.next;
        ts.refreshOptions(false);
      })
      .catch(() => {})
      .finally(() => {
        state.busy = false;
      });
  });
})();

// Full screen: the review frame fills the window; the button again, or Esc, brings the page back.
// Remembered on this device for the next entries.
(function () {
  const btn = document.querySelector('[data-review-full]');
  if (!btn) return;
  const root = document.documentElement;
  const KEY = 'zury.reviewFull';
  const set = (on) => {
    root.classList.toggle('z-review-full', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = btn.ariaLabel = zt(on ? 'Leave full screen' : 'Full screen');
    btn.querySelector('i').className = 'ti ' + (on ? 'ti-minimize' : 'ti-maximize');
    try { localStorage.setItem(KEY, on ? '1' : ''); } catch { /* not remembered */ }
  };
  let start = false;
  try { start = localStorage.getItem(KEY) === '1'; } catch { /* default: in the page */ }
  if (start) set(true);
  btn.addEventListener('click', () => set(!root.classList.contains('z-review-full')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('z-review-full') && !(e.target.closest && e.target.closest('input, textarea, select, .ts-wrapper'))) set(false);
  });
})();
