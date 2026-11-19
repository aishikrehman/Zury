// Live chat: new messages arrive over a server-sent event stream (made into HTML on the server);
// sending posts the form in the background. Enter sends, Shift+Enter starts a new line.
function initChat(box) {
  if (box.dataset.ready) return;
  box.dataset.ready = '1';
  const list = box.querySelector('[data-chat-list]');
  const form = box.querySelector('[data-chat-form]');
  const bottom = () => { list.scrollTop = list.scrollHeight; };
  bottom();
  const streamUrl = () => box.dataset.stream + (box.dataset.stream.includes('?') ? '&' : '?') + 'after=' + (box.dataset.last || 0);
  const onMessage = (e) => {
    if (Number(e.lastEventId) > Number(box.dataset.last || 0)) box.dataset.last = e.lastEventId;
    if (list.querySelector('[data-id="' + e.lastEventId + '"]')) return;
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const empty = list.querySelector('[data-chat-empty]');
    if (empty) empty.remove();
    const last = [...list.querySelectorAll('.z-chat-msg')].pop();
    list.insertAdjacentHTML('beforeend', JSON.parse(e.data));
    const added = list.lastElementChild;
    if (last && added && last.dataset.user === added.dataset.user && added.dataset.at - last.dataset.at < 300000) added.classList.add('is-cont');
    if (near) bottom();
  };
  const listen = (es) => {
    es.onmessage = onMessage;
    es.addEventListener('clear', () => { list.querySelectorAll('.z-chat-msg').forEach((el) => el.remove()); });
    es.addEventListener('hide', (e) => { const el = list.querySelector('[data-id="' + e.data + '"]'); if (el) el.remove(); });
    return es;
  };
  // Live: one line stays open. Not live: new messages are fetched only when asked (refresh, or after sending).
  const live = box.dataset.live !== '0';
  const pull = () => { const es = listen(new EventSource(streamUrl())); setTimeout(() => es.close(), 1500); };
  if (live) box._es = listen(new EventSource(streamUrl()));
  const refresh = box.querySelector('[data-chat-refresh]');
  if (refresh) refresh.addEventListener('click', pull);
  list.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-chat-hide]');
    if (!f) return;
    e.preventDefault();
    fetch(f.action, { method: 'POST', body: new URLSearchParams(new FormData(f)), headers: { Accept: 'application/json' } })
      .then(() => { const el = f.closest('.z-chat-msg'); if (el) el.remove(); });
  });
  if (!form) return;
  const text = form.querySelector('textarea');
  const grow = () => { text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 160) + 'px'; };
  text.addEventListener('input', grow);
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!text.value.trim()) return;
    const body = new URLSearchParams(new FormData(form));
    text.value = ''; grow();
    fetch(form.action, { method: 'POST', body, headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((r) => { if (r.error) { text.value = body.get('body'); alert(r.error); } else if (!live) pull(); })
      .catch(() => { text.value = body.get('body'); });
  });
}
window.zuryChat = { init: initChat };
document.querySelectorAll('[data-chat]').forEach(initChat);

// The corner chat button: the chat's contents are fetched (made on the server) when it is first opened.
document.querySelectorAll('[data-chat-launch]').forEach((btn) => {
  const side = document.getElementById('z-chat-side');
  const slot = side && side.querySelector('[data-chat-slot]');
  if (!slot) return;
  const load = (url) => fetch(url, { headers: { Accept: 'text/html' } }).then((r) => (r.ok ? r.text() : '')).then((html) => {
    if (!html) return;
    slot.innerHTML = html;
    slot.querySelectorAll('[data-chat]').forEach(initChat);
    const list = slot.querySelector('[data-chat-list]');
    if (list) list.scrollTop = list.scrollHeight;
  }).catch(() => { slot.innerHTML = '<div class="z-chat-empty p-4">' + (window.zt ? window.zt('Could not load the chat. Reload the page, or log in again.') : 'Could not load the chat.') + '</div>'; loaded = false; });
  let loaded = false;
  // Open: load (or reload) the chat; closed: its live line is let go, so it holds no connection.
  side.addEventListener('show.bs.offcanvas', () => { if (!loaded) { loaded = true; load(btn.dataset.chatLaunch); } });
  side.addEventListener('hidden.bs.offcanvas', () => { slot.querySelectorAll('[data-chat]').forEach((b) => b._es && b._es.close()); slot.innerHTML = ''; loaded = false; });
  slot.addEventListener('click', (e) => { const tab = e.target.closest('[data-chat-tab]'); if (tab) { e.preventDefault(); load(tab.getAttribute('href')); } });
});

