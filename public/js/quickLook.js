// The quick look: [data-qlook-item] elements (with data-id, data-title, data-url, data-preview) open in
// the pop-up; accept / reject send that entry and go to the next; next skips; keys a, r, n, Esc.
(function () {
  const dlg = document.querySelector('[data-qlook]');
  if (!dlg) return;
  const $ = (s) => dlg.querySelector(s);
  let items = []; let at = -1;
  const show = (i) => {
    items = [...document.querySelectorAll('[data-qlook-item]')];
    if (i < 0 || i >= items.length) { dlg.close(); return; }
    at = i; const it = items[i].dataset;
    $('[data-qlook-title]').textContent = it.title || '';
    $('[data-qlook-open]').href = it.url || '#';
    $('[data-qlook-frame]').src = it.preview || 'about:blank';
    $('[data-qlook-reason]').value = '';
    if (!dlg.open) dlg.showModal();
  };
  const send = (decision) => {
    const el = items[at]; if (!el) return;
    const body = new URLSearchParams({ _csrf: dlg.dataset.csrf, decision, comment: $('[data-qlook-reason]').value });
    dlg.classList.add('is-busy');
    fetch(dlg.dataset.bulk + '?one=' + el.dataset.id, { method: 'POST', body, headers: { Accept: 'application/json' } })
      .then((r) => r.json()).then((d) => {
        dlg.classList.remove('is-busy');
        if (!d.ok) { if (d.message) alert(d.message); return; }
        const row = el.closest('[data-qlook-row]') || el;
        row.classList.add('is-done');
        el.removeAttribute('data-qlook-item');
        show(at);
      }).catch(() => dlg.classList.remove('is-busy'));
  };
  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-qlook-item]');
    if (open && !e.target.closest('a[href]:not([data-qlook-item]), input, [data-quick]')) { e.preventDefault(); show([...document.querySelectorAll('[data-qlook-item]')].indexOf(open)); return; }
    if (e.target.closest('[data-qlook-close]')) dlg.close();
    const d = e.target.closest('[data-qlook-do]'); if (d) send(d.dataset.qlookDo);
    if (e.target.closest('[data-qlook-next]')) show(at + 1);
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.target.matches('input')) { if (e.key === 'Enter') { e.preventDefault(); send('reject'); } return; }
    if (e.key === 'a') send('accept'); else if (e.key === 'r') send('reject'); else if (e.key === 'n') show(at + 1);
  });
  dlg.addEventListener('close', () => { $('[data-qlook-frame]').src = 'about:blank'; });
})();
