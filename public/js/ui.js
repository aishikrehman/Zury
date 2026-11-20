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
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    // The step bar: title done, checking now.
    const steps = document.querySelector('[data-steps]');
    if (steps) { steps.children[0].className = 'is-done'; steps.children[1].className = 'is-now'; steps.children[2].className = ''; }
    const rules = [...document.querySelectorAll('[data-check-rules] [data-rule], [data-check-rules] .z-rule-where')].map((x) => x.textContent.trim()).filter(Boolean);
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
    // Checked in the background: the page stays, only the steps, the form's top line and the result change.
    const started = Date.now();
    const minWait = 450 * (rules.length + 1);
    fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), headers: { Accept: 'text/html' } })
      .then((r) => r.text())
      .then((html) => new Promise((ok) => setTimeout(() => ok(html), Math.max(0, minWait - (Date.now() - started)))))
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const newForm = doc.querySelector('form[data-check-anim]');
        if (!newForm) throw new Error('no form');
        const newSteps = doc.querySelector('[data-steps]');
        if (steps && newSteps) steps.replaceWith(newSteps);
        form.className = newForm.className;
        form.querySelector('.z-folded-line')?.remove();
        const line = newForm.querySelector('.z-folded-line');
        if (line) form.prepend(line);
        form.querySelectorAll('.card-body > .alert').forEach((x) => x.remove());
        const body = form.querySelector('.card-body');
        [...newForm.querySelectorAll('.card-body > .alert')].reverse().forEach((x) => body.prepend(x));
        // Everything after the form in the column comes from the answer.
        const col = form.parentElement;
        while (form.nextElementSibling) form.nextElementSibling.remove();
        let n = newForm.nextElementSibling;
        while (n) { const next = n.nextElementSibling; col.append(n); n = next; }
        (col.querySelector('.z-result-wrap, .z-result, [data-check-slot] ~ .card') || form).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      })
      .catch(() => { form.removeAttribute('data-check-anim'); HTMLFormElement.prototype.submit.call(form); });
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
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-unfold]'); if (!b) return; const f = document.querySelector('form[data-check-anim]'); if (!f) return; f.classList.remove('z-form-folded'); f.scrollIntoView({ block: 'center', behavior: 'smooth' }); f.querySelector('#entries')?.focus(); });

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

// A reviewer's note: a click on its icon shows it under the icon, where it stays as the page
// scrolls (it is placed on the page, so a scrolling table can't clip it). A click anywhere else,
// or on the icon again, closes it.
(() => {
  let open = null;
  const close = () => { if (open) { open.float.remove(); open.btn.classList.remove('is-open'); open = null; } };
  const place = () => {
    if (!open) return;
    const r = open.btn.getBoundingClientRect();
    const w = Math.min(352, document.documentElement.clientWidth - 24);
    open.float.style.width = `${w}px`;
    open.float.style.left = `${Math.max(12, Math.min(r.left - 8, document.documentElement.clientWidth - w - 12)) + window.scrollX}px`;
    open.float.style.top = `${r.bottom + 6 + window.scrollY}px`;
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-toggle-open]');
    if (open && open.float.contains(e.target)) return;
    if (btn && open && open.btn === btn) return close();
    close();
    if (!btn) return;
    const pop = btn.querySelector('.z-note-pop');
    if (!pop) return;
    const float = document.createElement('div');
    float.className = 'z-note-float small';
    float.textContent = pop.textContent;
    document.body.append(float);
    btn.classList.add('is-open');
    open = { btn, float };
    place();
  });
  window.addEventListener('resize', place);
  // Sliding a table sideways moves the icon: the note follows it.
  document.addEventListener('scroll', (e) => { if (open && e.target !== document && e.target.contains && e.target.contains(open.btn)) place(); }, { capture: true, passive: true });
})();

// By participant: a click on a heading sorts the people (each keeps their entries under them).
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('.z-psort');
  if (!btn) return;
  const head = btn.closest('tr');
  const body = head.parentNode;
  const i = Number(btn.dataset.psort);
  const desc = btn.dataset.kind === 'num' && i !== 1 ? btn.getAttribute('aria-sort') !== 'descending' : btn.getAttribute('aria-sort') === 'ascending';
  head.querySelectorAll('.z-psort').forEach((b) => b.removeAttribute('aria-sort'));
  btn.setAttribute('aria-sort', desc ? 'descending' : 'ascending');
  const groups = [...body.querySelectorAll('tr.z-group-row')].map((row) => ({ row, rows: [...body.querySelectorAll(`tr[data-group="${row.dataset.groupToggle}"]`)] }));
  const key = btn.dataset.key;
  const val = (g) => { const cell = [...g.row.querySelector('.z-pgrid').children].filter((c) => !c.classList.contains('z-pbar'))[i]; if (btn.dataset.kind !== 'num') return cell.textContent.trim().toLowerCase(); return Number((key ? cell.dataset[key] : cell.dataset.v) || 0); };
  groups.sort((a, b) => { const x = val(a), y = val(b); const c = typeof x === 'number' ? x - y : x.localeCompare(y); return desc ? -c : c; });
  groups.forEach((g) => { body.appendChild(g.row); g.rows.forEach((r) => body.appendChild(r)); });
});


// A dropdown marked data-submit-on-change sends its form as soon as it changes.
document.addEventListener('change', (e) => { if (e.target.matches && e.target.matches('select[data-submit-on-change]')) e.target.form.submit(); });

// By participant: words or articles — the column headings sort by the chosen measure.
document.addEventListener('change', (e) => {
  const sel = e.target.closest && e.target.closest('[data-measure]');
  if (!sel) return;
  const table = sel.closest('table');
  let active = null;
  table.querySelectorAll('.z-psort[data-key]').forEach((b) => { b.dataset.key = sel.value; if (b.hasAttribute('aria-sort')) active = b; });
  if (active) { const dir = active.getAttribute('aria-sort'); active.setAttribute('aria-sort', dir === 'descending' ? 'ascending' : 'descending'); active.click(); }
});

// By participant on phones: the order picker sorts like a click on that column's heading (largest first).
document.addEventListener('change', (e) => {
  const sel = e.target.closest && e.target.closest('[data-psort-pick]');
  if (!sel || sel.value === '') return;
  const btn = sel.closest('table').querySelector(`.z-group-head .z-psort[data-psort="${sel.value}"]`);
  if (!btn) return;
  btn.removeAttribute('aria-sort');
  btn.closest('tr').querySelectorAll('.z-psort').forEach((b) => b.removeAttribute('aria-sort'));
  if (sel.value === '0' || sel.value === '1') btn.setAttribute('aria-sort', 'descending');
  btn.click();
});

// Big figures count up once when they come into view (skipped for people who prefer less motion).
(() => {
  const els = document.querySelectorAll('[data-count]');
  if (!els.length || !('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const fmt = (n, el) => { const shown = el.textContent; const bn = /[০-৯]/.test(shown); const s = Math.round(n).toLocaleString(bn ? 'bn-BD' : 'en-US'); return s; };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const el = e.target; const end = Number(el.dataset.count) || 0; const final = el.textContent;
      if (end < 10) return;
      const t0 = performance.now();
      const step = (now) => { const p = Math.min(1, (now - t0) / 900); el.textContent = fmt(end * (1 - Math.pow(1 - p, 3)), el); if (p < 1) requestAnimationFrame(step); else el.textContent = final; };
      el.textContent = fmt(0, el);
      requestAnimationFrame(step);
    });
  }, { threshold: 0.4 });
  els.forEach((el) => io.observe(el));
})();

// Home carousel: cross-fades every 6 seconds (paused on hover, on focus and when the tab is hidden;
// still for people who prefer less motion). The later pictures load once the page has finished.
(() => {
  const box = document.querySelector('[data-carousel]');
  if (!box) return;
  const slides = [...box.querySelectorAll('.z-slide')];
  const dots = [...box.querySelectorAll('[data-slide]')];
  let at = 0; let timer = null;
  const load = () => slides.forEach((s) => { const img = s.querySelector('img[data-src]'); if (img) { img.srcset = img.dataset.srcset; img.src = img.dataset.src; img.removeAttribute('data-src'); } });
  if (document.readyState === 'complete') setTimeout(load, 300); else window.addEventListener('load', () => setTimeout(load, 300));
  const show = (i) => {
    at = (i + slides.length) % slides.length;
    slides.forEach((s, k) => { s.classList.toggle('is-on', k === at); s.setAttribute('aria-hidden', k === at ? 'false' : 'true'); });
    dots.forEach((d, k) => d.classList.toggle('is-on', k === at));
    const cap = box.querySelector('.z-hero2-cap');
    if (cap) { cap.classList.remove('is-in'); void cap.offsetWidth; cap.querySelector('i').className = 'ti ti-' + slides[at].dataset.icon; cap.querySelector('span').textContent = slides[at].dataset.caption; cap.classList.add('is-in'); }
    const cr = box.querySelector('.z-hero2-credit');
    if (cr) { cr.href = slides[at].dataset.creditHref; cr.querySelector('span').textContent = slides[at].dataset.credit; }
  };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = () => { if (!still && !timer) timer = setInterval(() => { load(); show(at + 1); }, 6000); };
  const stop = () => { clearInterval(timer); timer = null; };
  dots.forEach((d) => d.addEventListener('click', () => { load(); show(Number(d.dataset.slide)); stop(); start(); }));
  box.addEventListener('mouseenter', stop); box.addEventListener('mouseleave', start);
  box.addEventListener('focusin', stop); box.addEventListener('focusout', start);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  let x0 = null;
  box.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) { load(); show(at + (dx < 0 ? 1 : -1)); stop(); start(); } x0 = null; });
  start();
})();
// Sections rise in as they come into view.
(() => {
  const els = document.querySelectorAll('.z-reveal');
  if (!els.length) return;
  if (!('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { threshold: 0.12 });
  els.forEach((el) => io.observe(el));
})();

// Home: all time / this month.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-stat-tab]');
  if (!b) return;
  const box = b.closest('section');
  box.querySelectorAll('[data-stat-tab]').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
  box.querySelectorAll('[data-stat-pane]').forEach((p) => { p.hidden = p.dataset.statPane !== b.dataset.statTab; });
});
// First visit: the site's language from where the visitor is (their time zone), unless they chose one.
(() => {
  try {
    if (document.cookie.includes('zury_tz=')) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    document.cookie = 'zury_tz=' + encodeURIComponent(tz) + '; path=/; max-age=31536000; samesite=lax';
    const want = tz === 'Asia/Dhaka' ? 'bn' : null;
    if (want && document.documentElement.lang !== want && !document.documentElement.dataset.langChosen) location.reload();
  } catch (e) { /* stays as it is */ }
})();

// Configuration checklist: a link opens that section's tab.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('[data-open-step]');
  if (!a) return;
  const link = document.querySelector('[data-step-link][href="#step-' + a.dataset.openStep + '"]');
  if (link) { e.preventDefault(); link.click(); }
});

// Busy states: a thin bar at the top while the next page loads, and a sent form's buttons are
// switched off (with a spinner on the pressed one) so nothing is sent twice.
(() => {
  const bar = document.createElement('div');
  bar.className = 'z-busy-bar';
  document.body.appendChild(bar);
  let timer = null;
  const busy = () => { clearTimeout(timer); timer = setTimeout(() => bar.classList.add('is-on'), 120); };
  const idle = () => {
    clearTimeout(timer);
    bar.classList.remove('is-on');
    document.querySelectorAll('.z-was-busy').forEach((b) => { b.disabled = false; b.classList.remove('btn-loading', 'z-was-busy'); });
  };
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (e.defaultPrevented || !(form instanceof HTMLFormElement) || form.target === '_blank' || form.hasAttribute('data-no-busy')) return;
    busy();
    // after the browser has taken the pressed button's value
    setTimeout(() => form.querySelectorAll('button, input[type=submit]').forEach((b) => {
      if (b.disabled) return;
      b.disabled = true;
      b.classList.add('z-was-busy');
      if (b === e.submitter && b.classList.contains('btn')) b.classList.add('btn-loading');
    }), 0);
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download') || a.origin !== location.origin || a.getAttribute('href').startsWith('#')) return;
    if (a.pathname === location.pathname && a.search === location.search && a.hash) return;
    busy();
  });
  // back/forward from the cache: nothing is loading any more
  window.addEventListener('pageshow', idle);
})();

// A frame (the article in review) shows a spinner until it has loaded.
document.querySelectorAll('iframe[data-loading]').forEach((f) => {
  const box = f.parentElement;
  box.classList.add('z-frame-loading');
  f.addEventListener('load', () => box.classList.remove('z-frame-loading'), { once: true });
});

// A select whose options are addresses: choosing one goes there.
document.addEventListener('change', (e) => {
  const s = e.target;
  if (s instanceof HTMLSelectElement && s.hasAttribute('data-nav-select') && s.value) location.href = s.value;
});
// "Show more" on a list with hidden rows.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-show-more]');
  if (!b) return;
  const box = b.parentElement;
  box.classList.add('is-open');
  b.remove();
});

// Links that leave Zury get a small ↗ after their text (not buttons, images or icon-only links).
(() => {
  const mark = (root) => root.querySelectorAll('a[href]').forEach((a) => {
    if (a.classList.contains('z-ext') || a.classList.contains('btn') || a.closest('.btn-group, .dropdown-menu, .z-ext-off')) return;
    let u; try { u = new URL(a.href, location.href); } catch (e) { return; }
    if (!/^https?:$/.test(u.protocol) || u.hostname === location.hostname) return;
    if (a.querySelector('img') || !a.textContent.trim()) return;
    if (a.querySelector('.ti-external-link')) return;
    a.classList.add('z-ext');
    if (!a.title) a.title = u.hostname;
  });
  mark(document);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) mark(n); }))).observe(document.body, { childList: true, subtree: true });
})();

// Import page: Fountain or CampWiz shows its own fields.
document.addEventListener('change', (e) => {
  const r = e.target;
  if (!(r instanceof HTMLInputElement) || r.name !== 'source' || !r.closest('[data-import-form]')) return;
  const form = r.closest('form');
  form.querySelectorAll('[data-only]').forEach((el) => { el.hidden = el.dataset.only !== r.value; });
  form.querySelectorAll('.z-seg label').forEach((l) => l.classList.toggle('active', l.contains(r)));
});
