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
  // Live: the line reopens itself if it closes; and every 30 s (and on coming back to the tab) any missed
  // messages are fetched, so nothing waits for a refresh.
  const open = () => {
    const es = listen(new EventSource(streamUrl()));
    es.addEventListener('error', () => { if (es.readyState === 2) { setTimeout(() => { if (box.isConnected) box._es = open(); }, 3000); } });
    return es;
  };
  if (live) {
    box._es = open();
    const sweep = () => { if (box.isConnected && !document.hidden) pull(); };
    // The chat page: a quick backstop (5 s); elsewhere 30 s is enough.
    box._sweep = setInterval(sweep, location.pathname.startsWith('/inbox') ? 5000 : 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sweep(); });
  }
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


