// Live chat: new messages arrive over a server-sent event stream (made into HTML on the server);
// sending posts the form in the background. Enter sends, Shift+Enter starts a new line.
document.querySelectorAll('[data-chat]').forEach((box) => {
  const list = box.querySelector('[data-chat-list]');
  const form = box.querySelector('[data-chat-form]');
  const bottom = () => { list.scrollTop = list.scrollHeight; };
  bottom();
  const url = box.dataset.stream + (box.dataset.stream.includes('?') ? '&' : '?') + 'after=' + (box.dataset.last || 0);
  const es = new EventSource(url);
  es.onmessage = (e) => {
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
  es.addEventListener('clear', () => { list.querySelectorAll('.z-chat-msg').forEach((el) => el.remove()); });
  es.addEventListener('hide', (e) => { const el = list.querySelector('[data-id="' + e.data + '"]'); if (el) el.remove(); });
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
      .then((r) => { if (r.error) { text.value = body.get('body'); alert(r.error); } })
      .catch(() => { text.value = body.get('body'); });
  });
});
