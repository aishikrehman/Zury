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
      a.classList.add('z-note-' + (n.level || 'normal'));
      const dot = Object.assign(document.createElement('span'), { className: 'z-note-icon ti ti-' + ({ good: 'circle-check', urgent: 'alert-triangle' }[n.level] || 'bell') });
      const body = document.createElement('div');
      body.className = 'min-w-0';
      body.append(Object.assign(document.createElement('div'), { className: 'z-bell-text', textContent: n.text }), Object.assign(document.createElement('div'), { className: 'text-secondary small', textContent: n.when }));
      a.append(dot, body);
      return a;
    }));
  }
  const load = () => fetch('/notifications.json', { headers: { Accept: 'application/json' } }).then((r) => r.json()).then((d) => { render(d.items); setCount(d.unread); }).catch(() => {});
  box.addEventListener('show.bs.dropdown', load);

  // A quiet check every minute while the page is in front; a soft chime when something new arrives.
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } } };
  const soundBtn = box.querySelector('[data-bell-sound]');
  const soundOn = () => store.get('zury.sound') !== 'off';
  const showSound = () => { if (!soundBtn) return; soundBtn.setAttribute('aria-pressed', String(soundOn())); soundBtn.querySelector('i').className = 'ti ti-' + (soundOn() ? 'volume' : 'volume-off'); };
  showSound();
  if (soundBtn) soundBtn.addEventListener('click', (e) => { e.stopPropagation(); store.set('zury.sound', soundOn() ? 'off' : 'on'); showSound(); if (soundOn()) chime(); });
  let ctx = null;
  function chime() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ctx.currentTime;
      [[880, 0], [1320, 0.12]].forEach(([f, d]) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.12, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.35);
        o.connect(g).connect(ctx.destination); o.start(t0 + d); o.stop(t0 + d + 0.4);
      });
    } catch (e) { /* no audio here */ }
  }
  let known = Number(box.dataset.bellKnown) || 0;
  const check = () => {
    if (document.hidden) return;
    fetch('/notifications/count.json', { headers: { Accept: 'application/json' } }).then((r) => r.json()).then((d) => {
      const n = Number(d.unread) || 0;
      if (n > known) {
        // Several tabs open: only one chimes.
        const last = Number(store.get('zury.chimeAt')) || 0;
        if (soundOn() && Date.now() - last > 20000) { store.set('zury.chimeAt', String(Date.now())); chime(); }
      }
      if (n !== known) setCount(n);
      known = n;
    }).catch(() => {});
  };
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  box.querySelector('[data-bell-read-all]').addEventListener('click', () => {
    fetch('/notifications/read-all', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf }) })
      .then(() => { setCount(0); list.querySelectorAll('.z-unread').forEach((el) => el.classList.remove('z-unread')); list.querySelectorAll('.z-dot').forEach((el) => el.classList.add('invisible')); })
      .catch(() => {});
  });
})();
