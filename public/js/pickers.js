// Searchable pickers (Tom Select, as in Tabler) backed by Zury's lookup APIs:
// data-picker="wiki" | "language" | "user" | "namespace".
(function () {
  if (!window.TomSelect) return;

  const ENDPOINT = { wiki: '/api/wikis', language: '/api/languages', user: '/api/users' };
  const json = (url) => fetch(url, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : []));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function remote(el, kind) {
    return new window.TomSelect(el, {
      valueField: 'value',
      labelField: 'text',
      searchField: ['text', 'value'],
      maxOptions: 50,
      loadThrottle: 250,
      preload: kind !== 'user' ? 'focus' : false,
      create: kind === 'user',
      createOnBlur: kind === 'user',
      plugins: el.multiple ? ['remove_button'] : [],
      load(query, callback) {
        json(`${ENDPOINT[kind]}?q=${encodeURIComponent(query)}`).then(callback).catch(() => callback());
      },
      render: {
        option(item) {
          if (kind === 'wiki' && item.url) {
            return `<div><div>${esc(item.value)}</div><div class="text-secondary small">${esc(item.url.replace(/^https?:\/\//, ''))}</div></div>`;
          }
          return `<div>${esc(item.text)}</div>`;
        },
        no_results: () => '<div class="no-results">No matches</div>',
        option_create: (data) => `<div class="create">Use “${esc(data.input)}”</div>`,
      },
    });
  }

  // Namespace options follow the wiki chosen in another field.
  function namespaces(el) {
    const source = document.getElementById(el.dataset.wikiSource);
    const ts = new window.TomSelect(el, { valueField: 'value', labelField: 'text', searchField: ['text'], plugins: ['remove_button'], maxOptions: 200 });
    const reload = (wiki) => {
      if (!wiki) return;
      json(`/api/wikis/${encodeURIComponent(wiki)}/namespaces`).then((items) => {
        const keep = ts.getValue();
        ts.clearOptions();
        ts.addOptions(items);
        ts.setValue(keep, true);
      });
    };
    reload(source && source.value);
    if (source) source.addEventListener('change', () => reload(source.value));
  }

  document.querySelectorAll('[data-picker]').forEach((el) => {
    const kind = el.dataset.picker;
    if (kind === 'namespace') namespaces(el);
    else if (ENDPOINT[kind]) remote(el, kind);
  });
})();
