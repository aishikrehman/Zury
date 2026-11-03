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

  // Wiki: first the project (Wikipedia, Wiktionary… or Commons and other single
  // wikis), then the wiki by language, shown in English and in its own script.
  function wiki(el) {
    const project = document.createElement('select');
    project.className = 'form-select mb-2';
    project.setAttribute('aria-label', 'Project');
    project.innerHTML = '<option value="">Choose a project…</option>';
    el.parentNode.insertBefore(project, el);

    let items = [];
    const ts = new window.TomSelect(el, {
      valueField: 'value',
      labelField: 'label',
      searchField: ['text', 'localName', 'value', 'lang'],
      maxOptions: 500,
      render: {
        option: (item) => {
          const local = item.localName ? ` <span class="text-secondary">${esc(item.localName)}</span>` : '';
          return `<div class="d-flex align-items-baseline gap-2"><span>${esc(item.text)}${local}</span><span class="ms-auto text-secondary small">${esc(item.value)}</span></div>`;
        },
        item: (item) => `<div>${esc(item.label)}</div>`,
        no_results: () => '<div class="no-results">No matches</div>',
      },
    });
    const label = (w) => (w.localName ? `${w.text} · ${w.localName}` : w.text);
    const load = (family, keep) => {
      ts.clear(true);
      ts.clearOptions();
      if (!family) return ts.disable();
      ts.enable();
      json(`/api/wikis?project=${encodeURIComponent(family)}`).then((list) => {
        items = list.map((w) => ({ ...w, label: label(w) }));
        ts.addOptions(items);
        if (keep && items.some((w) => w.value === keep)) ts.setValue(keep, true);
      });
    };
    project.addEventListener('change', () => {
      load(project.value);
      el.dispatchEvent(new Event('change'));
    });

    const initial = el.value;
    json('/api/projects').then((list) => {
      for (const p of list) project.add(new Option(`${p.text} (${p.count})`, p.value));
      if (!initial) return load('');
      json(`/api/wikis?db=${encodeURIComponent(initial)}`).then(({ project: family }) => {
        if (!family) return;
        project.value = family;
        load(family, initial);
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
