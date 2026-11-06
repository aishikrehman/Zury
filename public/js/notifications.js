// The bell's menu: the latest notifications, fetched when it opens; "Mark all as read".
(function () {
  const box = document.querySelector('[data-notifications]');
  if (!box) return;
  const list = box.querySelector('[data-bell-list]');
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || document.querySelector('input[name="_csrf"]')?.value || '';
  const setCount = (n) => {
    let badge = box.querySelector('[data-bell-count]');
    box.querySelector('[data-bell-read-all]').hidden = !n;
    if (!n) return badge && badge.remove();
    if (!badge) {
      badge = Object.assign(document.createElement('span'), { className: 'z-bell-count' });
      badge.dataset.bellCount = '';
      box.querySelector('.z-bell-btn').append(badge);
    }
    badge.textContent = n > 99 ? '99+' : String(n);
  };
  function render(items) {
    if (!items.length) {
      list.replaceChildren(Object.assign(document.createElement('div'), { className: 'z-bell-empty', textContent: zt('No notifications yet') }));
      return;
    }
    list.replaceChildren(...items.map((n) => {
      const a = Object.assign(document.createElement('a'), { className: 'dropdown-item z-bell-item' + (n.unread ? ' z-unread' : ''), href: n.href });
      const dot = Object.assign(document.createElement('span'), { className: 'z-dot' + (n.unread ? '' : ' invisible') });
      const body = document.createElement('div');
      body.className = 'min-w-0';
      body.append(Object.assign(document.createElement('div'), { className: 'z-bell-text', textContent: n.text }), Object.assign(document.createElement('div'), { className: 'text-secondary small', textContent: n.when }));
      a.append(dot, body);
      return a;
    }));
  }
  const load = () => fetch('/notifications.json', { headers: { Accept: 'application/json' } }).then((r) => r.json()).then((d) => { render(d.items); setCount(d.unread); }).catch(() => {});
  box.addEventListener('show.bs.dropdown', load);
  box.querySelector('[data-bell-read-all]').addEventListener('click', () => {
    fetch('/notifications/read-all', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf }) })
      .then(() => { setCount(0); list.querySelectorAll('.z-unread').forEach((el) => el.classList.remove('z-unread')); list.querySelectorAll('.z-dot').forEach((el) => el.classList.add('invisible')); })
      .catch(() => {});
  });
})();
