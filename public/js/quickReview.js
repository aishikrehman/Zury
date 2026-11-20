// Quick review: j/k (or arrows) move between lines, a accepts, r rejects (with the chosen reason);
// a line's own buttons send just that entry in the background and the line leaves the list.
(function () {
  const form = document.querySelector('[data-quick-review]');
  if (!form) return;
  const rows = () => [...form.querySelectorAll('.z-quick-row')];
  const focus = (row) => { rows().forEach((r) => r.classList.toggle('is-focus', r === row)); if (row) row.scrollIntoView({ block: 'nearest' }); };
  const current = () => form.querySelector('.z-quick-row.is-focus') || rows()[0];
  const decide = (row, decision) => {
    if (!row) return;
    const body = new URLSearchParams();
    body.set('_csrf', form.querySelector('[name=_csrf]').value);
    body.set('decision', decision);
    body.set('comment', '');
    row.classList.add('is-busy');
    fetch(form.action + '?one=' + row.dataset.id, { method: 'POST', body, headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) { row.classList.remove('is-busy'); if (d.message) alert(d.message); return; }
        const next = row.nextElementSibling || row.previousElementSibling;
        row.remove();
        focus(next);
        if (!rows().length) location.reload();
      })
      .catch(() => row.classList.remove('is-busy'));
  };
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-quick]');
    if (b) { e.preventDefault(); decide(b.closest('.z-quick-row'), b.dataset.quick); return; }
    const row = e.target.closest('.z-quick-row');
    if (row && !e.target.closest('a, input')) focus(row);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const row = current();
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); focus(row && row.nextElementSibling ? row.nextElementSibling : row); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); focus(row && row.previousElementSibling ? row.previousElementSibling : row); }
    else if (e.key === 'a') decide(row, 'accept');
    else if (e.key === 'r') decide(row, 'reject');
  });
})();
