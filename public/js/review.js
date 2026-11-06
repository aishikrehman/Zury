// Review window: buttons set the decision; keys A (accept), R (reject), S (skip), 1–9 (values of
// the first mark) and Ctrl+Enter (save). Saving and moving to another entry happen in place.
(function () {
  if (!document.querySelector('[data-review-form]')) return;
  const formNow = () => document.querySelector('[data-review-form]');

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-decide]');
    if (!btn) return;
    const form = btn.closest('form');
    if (btn.dataset.decide === 'reject') {
      const box = form && form.querySelector('#comment');
      if (box && !box.value.trim()) { e.preventDefault(); box.classList.add('is-invalid'); box.focus(); return; }
    }
    const field = form && form.querySelector('[data-decision]');
    if (field) field.value = btn.dataset.decide;
  }, true);

  document.addEventListener('click', (e) => {
    const r = e.target.closest && e.target.closest('[data-reason]');
    if (!r) return;
    const box = document.getElementById('comment');
    if (!box) return;
    box.value = box.value.trim() ? `${box.value.trim()}; ${r.dataset.reason}` : r.dataset.reason;
    box.classList.remove('is-invalid');
    box.focus();
  });

  // Swap in another entry (after saving, skipping or picking one) without a page change.
  async function swapTo(url, response) {
    const card = document.querySelector('.z-review-card');
    if (!card) { location.href = url; return; }
    card.classList.add('opacity-50');
    try {
      const res = response || (await fetch(url, { headers: { 'X-Requested-With': 'fetch' } }));
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const fresh = doc.querySelector('.z-review-card');
      if (!fresh) { location.href = res.url || url; return; }
      card.innerHTML = fresh.innerHTML;
      history.replaceState(null, '', res.url || url);
      document.dispatchEvent(new CustomEvent('zury:review-swapped'));
    } catch { location.href = url; }
    card.classList.remove('opacity-50');
  }
  window.zuryReviewSwap = swapTo;

  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.method.toLowerCase() === 'get' && form.closest('.z-review-card')) { e.preventDefault(); swapTo(location.pathname + '?' + new URLSearchParams(new FormData(form))); return; }
    if (!form.matches('[data-review-form]')) return;
    e.preventDefault();
    const body = new URLSearchParams(new FormData(form));
    if (e.submitter && e.submitter.name) body.set(e.submitter.name, e.submitter.value);
    const res = await fetch(form.action, { method: 'POST', body, headers: { 'X-Requested-With': 'fetch' } }).catch(() => null);
    if (!res) { form.submit(); return; }
    swapTo(res.url, res);
  });

  // Links to other entries inside the review card (skip, previous, next): in place.
  document.addEventListener('click', (e) => {
    const link = e.target.closest && e.target.closest('.z-review-card a[href]');
    if (!link || link.target || e.ctrlKey || e.metaKey) return;
    const u = new URL(link.href, location.href);
    if (u.pathname !== location.pathname) return;
    e.preventDefault();
    swapTo(u.href);
  });

  document.addEventListener('keydown', (e) => {
    const form = formNow();
    if (!form) return;
    const decision = form.querySelector('[data-decision]');
    const inField = e.target instanceof Element && e.target.closest('input[type="text"], textarea, select, [contenteditable]');
    if (inField) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && decision && decision.value) form.requestSubmit();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'a' || key === 'r') {
      e.preventDefault();
      const btn = form.querySelector(`[data-decide="${key === 'a' ? 'accept' : 'reject'}"]`);
      if (btn) btn.click();
    } else if (key === 's') {
      const skip = document.querySelector('[data-review-skip]');
      if (skip) swapTo(skip.href);
    } else if (/^[1-9]$/.test(key)) {
      const option = form.querySelectorAll('[data-mark-group="0"] input')[Number(key) - 1];
      if (option) option.checked = true;
    }
  });
})();

// The entry picker on the review page: the queue in order, searchable, a page at a time.
function initReviewPicker() {
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
      if (value) { const to = `${go}&entry=${encodeURIComponent(value)}`.replace('?&', '?'); if (window.zuryReviewSwap) window.zuryReviewSwap(to); else location.href = to; }
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
}
initReviewPicker();
document.addEventListener('zury:review-swapped', initReviewPicker);

// Full screen: the review frame fills the window; the button again, or Esc, brings the page back.
// Remembered on this device for the next entries.
(function () {
  const btn = document.querySelector('[data-review-full]');
  if (!btn) return;
  const root = document.documentElement;
  const KEY = 'zury.reviewFull';
  const set = (on) => {
    root.classList.toggle('z-review-full', on);
    const b2 = document.querySelector('[data-review-full]');
    if (b2) { b2.setAttribute('aria-pressed', String(on)); b2.title = b2.ariaLabel = zt(on ? 'Leave full screen' : 'Full screen'); b2.querySelector('i').className = 'ti ' + (on ? 'ti-minimize' : 'ti-maximize'); }
    try { localStorage.setItem(KEY, on ? '1' : ''); } catch { /* not remembered */ }
  };
  let start = false;
  try { start = localStorage.getItem(KEY) === '1'; } catch { /* default: in the page */ }
  if (start) set(true);
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-review-full]')) set(!root.classList.contains('z-review-full')); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('z-review-full') && !(e.target.closest && e.target.closest('input, textarea, select, .ts-wrapper'))) set(false);
  });
})();

