// Toasts for signed-in people: new notifications and new messages in their chats. A light check
// every 45 seconds while the page is in view (no open connection, so many tabs stay quick).
// A message for the chat open on screen makes no toast.
(function () {
  let stack = null;
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const toast = (icon, title, text, link) => {
    if (!stack) { stack = document.createElement('div'); stack.className = 'z-toasts'; stack.setAttribute('aria-live', 'polite'); document.body.appendChild(stack); }
    const el = document.createElement('a');
    el.className = 'z-live-toast';
    el.href = link || '/notifications';
    el.innerHTML = '<i class="ti ti-' + icon + '"></i><span><b>' + esc(title) + '</b><span>' + esc(text) + '</span></span>';
    stack.appendChild(el);
    setTimeout(() => el.classList.add('is-out'), 6000);
    setTimeout(() => el.remove(), 6600);
  };
  let since = Date.now();
  let stopped = false;
  const check = () => {
    if (document.hidden || stopped) return;
    fetch('/inbox/news.json?since=' + since, { headers: { Accept: 'application/json' } }).then((r) => { if (r.status === 401) stopped = true; return r.ok ? r.json() : null; }).then((d) => {
      if (!d) return;
      since = d.now;
      document.dispatchEvent(new CustomEvent('zury:unread', { detail: d.unreadNotes }));
      d.notes.forEach((n) => toast('bell', window.zt ? window.zt('Notification') : 'Notification', n.text, n.link));
      d.chats.forEach((m) => { if (!document.querySelector('[data-chat] input[name="c"][value="' + m.channel + '"]')) toast('messages', m.who + ' · ' + m.title, m.text, m.link); });
      const dot = document.querySelector('[data-chat-dot]');
      if (dot && d.liveChat) dot.hidden = !d.unreadRooms;
    }).catch(() => {});
  };
  setInterval(check, (Number(document.body.dataset.live) || 45) * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
})();
