// Small behaviours that would otherwise need inline handlers (blocked by the CSP).
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) window.print();
});
document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-autosubmit]')) return;
  const form = e.target.form;
  const card = form.closest('[data-live]');
  if (!card || !window.fetch) { form.submit(); return; }
  // Filters in a live card: fetch the new list and swap it in, no page reload.
  const url = location.pathname + '?' + new URLSearchParams([...new FormData(form)].filter(([, v]) => v !== '')).toString();
  card.style.opacity = '.6';
  fetch(url, { headers: { Accept: 'text/html' } }).then((r) => r.text()).then((html) => {
    const next = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-live]');
    if (!next) { location.href = url; return; }
    card.replaceWith(next);
    history.replaceState(null, '', url);
  }).catch(() => form.submit());
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
  let bar = document.querySelector(`[data-live] [data-bulk-bar="${group}"]`) || document.querySelector(`[data-bulk-bar="${group}"]`);
  // On an event page the selection's buttons sit in the event header, not in a bar over the list.
  const head = document.querySelector('[data-live] .z-bulk-slot') || document.querySelector('.z-bulk-slot');
  if (bar && head && !head.contains(bar)) {
    document.querySelectorAll('.z-bulk-slot [data-bulk-bar]').forEach((old) => old.remove());
    bar.classList.add('z-bulk-in-head');
    head.append(bar);
  }
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

// Messages after an action float in a corner; good news fades by itself.
(function () {
  const toast = document.querySelector('.z-toast');
  if (!toast) return;
  const hide = () => { toast.classList.add('is-hiding'); setTimeout(() => toast.remove(), 300); };
  toast.querySelector('[data-toast-close]').addEventListener('click', hide);
  if (toast.hasAttribute('data-autohide')) setTimeout(hide, 5000);
})();

// Messages after an action float in a corner; good news fades by itself.
(function () {
  const toast = document.querySelector('.z-toast');
  if (!toast) return;
  const hide = () => { toast.classList.add('is-hiding'); setTimeout(() => toast.remove(), 300); };
  toast.querySelector('[data-toast-close]').addEventListener('click', hide);
  if (toast.hasAttribute('data-autohide')) setTimeout(hide, 5000);
})();

// Import from Fountain: the event type only matters for a new event.
(function () {
  const target = document.querySelector('[data-import-target]');
  const only = document.querySelector('[data-new-only]');
  if (target && only) target.addEventListener('change', () => { only.hidden = Boolean(target.value); });
})();

// Links marked data-swap="<id>" (the calendar's arrows) load the next view of that part
// only: no page reload, and the address follows so Back works.
(function () {
  async function swap(url, id, push) {
    const target = document.getElementById(id);
    if (!target) return (window.location.href = url);
    target.style.opacity = '0.55';
    try {
      const res = await fetch(url, { headers: { 'X-Requested-With': 'zury' } });
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const fresh = doc.getElementById(id);
      if (!fresh) throw new Error('missing');
      target.replaceWith(fresh);
      if (push) history.pushState({ swap: id }, '', url);
    } catch {
      window.location.href = url;
    }
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-swap]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    swap(a.href, a.dataset.swap, true);
  });
  window.addEventListener('popstate', (e) => { if (e.state && e.state.swap) swap(location.href, e.state.swap, false); });
})();

// In-place editing: [data-inline] forms show their value with a pencil; the pencil turns
// them into fields, Cancel puts the value back. One pattern for every such field.
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-inline-open]');
  const cancel = e.target.closest('[data-inline-cancel]');
  const form = (open || cancel)?.closest('[data-inline]');
  if (!form) return;
  if (open) {
    form.classList.add('is-editing');
    form.querySelector('.z-inline-edit input, .z-inline-edit textarea, .z-inline-edit select')?.focus();
  } else {
    form.reset();
    form.classList.remove('is-editing');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const form = e.target.closest && e.target.closest('[data-inline].is-editing');
  if (form) { form.reset(); form.classList.remove('is-editing'); }
});

// New series: is the name free? Checked a moment after typing stops.
(function () {
  const status = document.querySelector('[data-series-address-status]');
  const input = status && document.getElementById('slug');
  if (!input) return;
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!input.value.trim()) { status.textContent = ''; return; }
      try {
        const r = await (await fetch('/api/address?kind=series&slug=' + encodeURIComponent(input.value.trim()))).json();
        status.className = 'small mt-1 ' + (r.free ? 'text-success' : 'text-danger');
        status.textContent = r.free ? zt('Free: {path}', { path: r.path }) : r.reason === 'form' ? zt('Use lowercase letters, numbers and hyphens.') : zt('Taken.');
      } catch { status.textContent = ''; }
    }, 350);
  });
})();

// A select that opens another page when changed (data-nav: the address, the value appended).
document.querySelectorAll('select[data-nav]').forEach((sel) => sel.addEventListener('change', () => { location.search = sel.dataset.nav + encodeURIComponent(sel.value); }));
// Boxes that only make sense with another one ticked (data-needs-event needs [data-needed-by]).
document.querySelectorAll('[data-needed-by]').forEach((main) => {
  const sync = () => document.querySelectorAll('[data-needs-event]').forEach((b) => { b.disabled = !main.checked; if (!main.checked) b.checked = false; });
  main.addEventListener('change', sync);
});

// Fountain imports: while the import runs, how many of its articles are in.
document.querySelectorAll('form').forEach((form) => {
  const code = form.querySelector('input[name="code"]');
  if (!code || !/fountain/.test(form.action)) return;
  form.addEventListener('submit', () => {
    const btn = form.querySelector('button[type="submit"]');
    const out = document.createElement('div');
    out.className = 'small text-secondary mt-2';
    out.setAttribute('aria-live', 'polite');
    form.appendChild(out);
    if (btn) btn.disabled = true;
    const raw = code.value.trim();
    const key = (raw.match(/editathons\/([^/?#]+)/) || [null, raw])[1];
    const tick = async () => {
      try {
        const p = await (await fetch('/api/fountain-progress?code=' + encodeURIComponent(key))).json();
        out.textContent = p && p.total ? `${p.done} / ${p.total}` : '…';
      } catch { /* next time */ }
    };
    tick();
    setInterval(tick, 1000);
  });
});

(() => {
  const live = document.querySelector('[data-live]');
  if (!live) return;
  let busy = false;
  async function load(url, push) {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch(url, { headers: { 'X-Requested-With': 'fetch' } });
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const fresh = doc.querySelector('[data-live]');
      if (fresh) {
        live.innerHTML = fresh.innerHTML;
        if (push) history.pushState(null, '', String(url).replace(/\?$/, ''));
        live.dispatchEvent(new CustomEvent('zury:refreshed', { bubbles: true }));
      }
    } catch { /* keep the list as it is */ }
    busy = false;
  }
  const sameList = (href) => { try { const u = new URL(href, location.href); return u.pathname === location.pathname; } catch { return false; } };
  live.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a && !a.target && sameList(a.href) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); load(a.href, true); }
  });
  live.addEventListener('submit', (e) => {
    const form = e.target;
    if (form.method.toLowerCase() === 'get') { e.preventDefault(); load(`${location.pathname}?${new URLSearchParams(new FormData(form))}`, true); return; }
    // Other forms (withdraw, remove, review) go the normal way: their confirmation and message show.
  }, true);
  window.addEventListener('popstate', () => load(location.href, false));
  setInterval(() => {
    if (document.hidden || live.querySelector('input[type=checkbox]:checked') || live.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    load(location.href, false);
  }, 20000);

})();

// Inside the quick-look popup: only the page itself, without the site's header and footer.
if (window.self !== window.top) document.documentElement.classList.add('z-embed');

// Copy buttons.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-copy]');
  if (!b) return;
  navigator.clipboard.writeText(b.dataset.copy).then(() => { const i = b.querySelector('i'); if (i) { i.className = 'ti ti-check me-1'; setTimeout(() => { i.className = 'ti ti-copy me-1'; }, 1500); } });
});

// Title suggestions while typing (from the event's wikis), in our own list.
(() => {
  const input = document.querySelector('input[data-suggest]');
  if (!input || !input.dataset.suggest) return;
  const hosts = input.dataset.suggest.split(','); const ns = input.dataset.suggestNs || '0';
  const list = input.parentElement.querySelector('.z-suggest-list');
  let timer; let n = 0; let active = -1;
  const hide = () => { list.hidden = true; active = -1; };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q || /^https?:/i.test(q)) return hide();
    timer = setTimeout(async () => {
      const my = ++n;
      const all = await Promise.all(hosts.map((h) => fetch(`https://${h}/w/api.php?action=query&list=prefixsearch&pssearch=${encodeURIComponent(q)}&psnamespace=${ns}&pslimit=8&format=json&origin=*`).then((r) => r.json()).then((j) => (j.query?.prefixsearch || []).map((p) => ({ title: p.title, host: h }))).catch(() => [])));
      if (my !== n) return;
      const items = all.flat().slice(0, 8);
      list.innerHTML = '';
      items.forEach((it) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'list-group-item list-group-item-action';
        b.textContent = it.title;
        if (hosts.length > 1) { const s = document.createElement('small'); s.className = 'text-secondary ms-2'; s.textContent = it.host; b.append(s); }
        b.addEventListener('mousedown', (e) => { e.preventDefault(); input.value = hosts.length > 1 ? `https://${it.host}/wiki/${encodeURIComponent(it.title.replace(/ /g, '_'))}` : it.title; hide(); });
        list.append(b);
      });
      list.hidden = !items.length; active = -1;
    }, 200);
  });
  input.addEventListener('keydown', (e) => {
    const els = [...list.children]; if (list.hidden || !els.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length; els.forEach((x, i) => x.classList.toggle('active', i === active)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); els[active].dispatchEvent(new MouseEvent('mousedown')); }
    else if (e.key === 'Escape') hide();
  });
  input.addEventListener('blur', () => setTimeout(hide, 100));
})();

// Forms that ask one thing first (an appeal's reason).
document.addEventListener('submit', (e) => {
  const f = e.target;
  const src = e.submitter && e.submitter.dataset.ask ? e.submitter : f;
  if (!src.dataset || !src.dataset.ask) return;
  const field = f.querySelector(`[name="${src.dataset.ask}"]`);
  if (field && !field.value) {
    const v = prompt(src.dataset.askText || '');
    if (!v || v.trim().length < (src.dataset.ask === 'reason' ? 10 : 1)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    field.value = v.trim();
  }
}, true);

// Submitting: each requirement is checked off on screen, one after another, while the entries are checked.
(() => {
  const form = document.querySelector('form[data-check-anim]');
  const holder = document.querySelector('[data-check-steps]');
  if (!form || !holder) return;
  form.addEventListener('submit', () => {
    // The step bar: title done, checking now.
    const steps = document.querySelector('[data-steps]');
    if (steps) { steps.children[0].className = 'is-done'; steps.children[1].className = 'is-now'; steps.children[2].className = ''; }
    const rules = [...holder.parentElement.querySelectorAll('.list-group-item')].map((x) => x.textContent.trim()).filter(Boolean);
    const box = document.createElement('div');
    box.className = 'z-checking';
    box.innerHTML = '<div class="z-checking-card"><div class="fw-bold mb-3"></div><ul class="list-unstyled m-0"></ul></div>';
    box.querySelector('.fw-bold').textContent = holder.dataset.title;
    const ul = box.querySelector('ul');
    rules.forEach((r) => { const li = document.createElement('li'); li.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span><span></span>'; li.lastChild.textContent = r; ul.append(li); });
    // In the page under the form (old results make way), not as a pop-up.
    const slot = document.querySelector('[data-check-slot]');
    if (slot) { box.classList.add('is-inline'); slot.replaceChildren(box); document.querySelectorAll('.z-result-wrap, [data-check-slot] ~ .card').forEach((el) => el.remove()); box.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else document.body.append(box);
    [...ul.children].forEach((li, i) => setTimeout(() => { li.classList.add('is-done'); li.firstChild.className = 'ti ti-circle-check text-green me-2'; }, 450 * (i + 1)));
  });
})();

// By participant: a click on a person's row folds or unfolds their entries.
document.addEventListener('click', (e) => {
  const head = e.target.closest && e.target.closest('[data-group-toggle]');
  if (!head) return;
  const id = head.dataset.groupToggle;
  const open = !head.classList.toggle('is-folded');
  document.querySelectorAll(`tr[data-group="${id}"]`).forEach((r) => { r.hidden = !open; });
});

// Quick action "Review": the first selected entry opens in the review window (popup); the rest follow with Skip/next.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-review-selected]');
  if (!b) return;
  const ids = [...document.querySelectorAll('[data-check="bulk-ids"]:checked')].map((c) => c.value).filter(Boolean);
  if (!ids.length) return;
  location.href = `${b.dataset.reviewSelected}?entry=${ids[0]}`;
});

// Forms marked data-once: the first submit goes, repeated clicks don't send it again.
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-once') || e.defaultPrevented) return;
  if (form.dataset.sent) { e.preventDefault(); return; }
  // After the other handlers (a confirm may cancel it): only a submit that goes locks the form.
  setTimeout(() => { if (e.defaultPrevented) return; form.dataset.sent = '1'; form.querySelectorAll('button[type=submit]').forEach((b) => { b.disabled = true; }); });
});

// Phones: the review filters sheet closes with its × or Escape (not a stray tap).
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('.z-review-filters.show')?.classList.remove('show'); });

// Submit page: after a check the form folds to one line; Change opens it again.
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-unfold]'); if (!b) return; const f = b.closest('form'); f.classList.remove('z-form-folded'); f.querySelector('#entries')?.focus(); });

// Sortable tables (table[data-sortable]): a click on a heading sorts by that column; again reverses.
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-sort-col]');
  if (!btn) return;
  const th = btn.closest('th');
  const table = th.closest('table[data-sortable]');
  if (!table) return;
  const col = [...th.parentElement.children].indexOf(th);
  const dir = th.getAttribute('aria-sort') === 'descending' ? 'ascending' : 'descending';
  table.querySelectorAll('thead th').forEach((x) => x.setAttribute('aria-sort', 'none'));
  th.setAttribute('aria-sort', dir);
  const body = table.tBodies[0];
  const val = (tr) => { const c = tr.children[col]; return c ? (c.dataset.v ?? c.textContent.trim()) : ''; };
  const rows = [...body.rows];
  rows.sort((x, y) => {
    const a = val(x); const b = val(y);
    const na = Number(a); const nb = Number(b);
    const cmp = a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb) ? na - nb : String(a).localeCompare(String(b));
    return dir === 'ascending' ? cmp : -cmp;
  });
  body.append(...rows);
});

// Import page: the source tabs, and a file loaded into the text box.
document.addEventListener('change', (e) => {
  if (e.target.matches && e.target.matches('[data-imp-tab]')) {
    e.target.closest('.z-imp-tabs').querySelectorAll('.nav-link').forEach((l) => l.classList.toggle('active', l.contains(e.target)));
  }
  if (e.target.matches && e.target.matches('[data-imp-file]') && e.target.files[0]) {
    const box = document.getElementById('imp-text');
    e.target.files[0].text().then((txt) => { box.value = txt; box.focus(); });
  }
});

// Long notes show one line; a click opens the rest.
document.addEventListener('click', (e) => {
  const n = e.target.closest('[data-toggle-open]');
  if (n) n.classList.toggle('is-open');
});
