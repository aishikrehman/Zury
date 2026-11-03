// Searchable pickers (Tom Select, as in Tabler) backed by Zury's lookup APIs:
// data-picker="wiki" | "language" | "user" | "namespace".
(function () {
  if (!window.TomSelect) return;

  const ENDPOINT = { language: '/api/languages', user: '/api/users' };
  const json = (url) => fetch(url, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : []));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function remote(el, kind) {
    return new window.TomSelect(el, {
      valueField: 'value',
      labelField: 'text',
      searchField: ['text', 'value', 'localName'],
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
          if (kind === 'language' && item.code) {
            return `<div>${esc(item.text)} <span class="text-secondary small">${esc(item.code)}</span></div>`;
          }
          return `<div>${esc(item.text)}</div>`;
        },
        no_results: () => '<div class="no-results">No matches</div>',
        option_create: (data) => `<div class="create">Use “${esc(data.input)}”</div>`,
      },
    });
  }

  // Wiki: first the language (or "Commons, Wikidata and other wikis"), then that
  // language's wikis. Both show the English name with the local one beside it.
  const withLocal = (item) =>
    `<div class="d-flex align-items-baseline gap-2"><span>${esc(item.text)}${item.localName ? ` <span class="text-secondary">${esc(item.localName)}</span>` : ''}</span>` +
    `<span class="ms-auto text-secondary small">${esc(item.hint || '')}</span></div>`;
  const label = (item) => (item.localName ? `${item.text} · ${item.localName}` : item.text);

  function wiki(el) {
    const row = document.createElement('div');
    row.className = 'row g-2';
    row.innerHTML =
      '<div class="col-sm-6"><div class="form-hint mt-0 mb-1">1. Language</div></div>' +
      '<div class="col-sm-6"><div class="form-hint mt-0 mb-1">2. Wiki</div></div>';
    el.parentNode.insertBefore(row, el);
    const langSelect = document.createElement('select');
    langSelect.setAttribute('aria-label', 'Language of the wiki');
    langSelect.setAttribute('placeholder', 'Choose a language…');
    row.children[0].appendChild(langSelect);
    el.setAttribute('placeholder', 'Then choose the wiki…');
    row.children[1].appendChild(el);

    const wikis = new window.TomSelect(el, {
      valueField: 'value',
      labelField: 'label',
      searchField: ['text', 'localName', 'value'],
      maxOptions: 500,
      render: { option: withLocal, item: (item) => `<div>${esc(item.label)}</div>`, no_results: () => '<div class="no-results">No matches</div>' },
    });
    const loadWikis = (code, keep) => {
      wikis.clear(true);
      wikis.clearOptions();
      if (!code) return wikis.disable();
      wikis.enable();
      json(`/api/wiki-languages/${encodeURIComponent(code)}`).then((list) => {
        wikis.addOptions(list.map((w) => ({ ...w, label: label(w), hint: w.value })));
        if (keep) wikis.setValue(keep, true);
      });
    };

    const languages = new window.TomSelect(langSelect, {
      valueField: 'value',
      labelField: 'label',
      searchField: ['text', 'localName', 'value'],
      maxOptions: 500,
      render: { option: withLocal, item: (item) => `<div>${esc(item.label)}</div>`, no_results: () => '<div class="no-results">No matches</div>' },
      onChange: (code) => {
        loadWikis(code);
        el.dispatchEvent(new Event('change'));
      },
    });

    const initial = el.value;
    wikis.disable();
    json('/api/wiki-languages').then((list) => {
      languages.addOptions(list.map((l) => ({ ...l, label: label(l), hint: l.value === 'special' ? '' : `${l.value} · ${l.count}` })));
      if (!initial) return;
      json(`/api/wiki-of?db=${encodeURIComponent(initial)}`).then(({ language }) => {
        if (!language) return;
        languages.setValue(language, true);
        loadWikis(language, initial);
      });
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
    else if (kind === 'wiki') wiki(el);
    else if (ENDPOINT[kind]) remote(el, kind);
  });
})();
