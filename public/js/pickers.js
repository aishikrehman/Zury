// Searchable pickers (Tom Select, as in Tabler) backed by Zury's lookup APIs:
// data-picker="wiki" | "language" | "user" | "namespace".
(function () {
  if (!window.TomSelect) return;

  // A single-choice picker shows its value until you start typing a search.
  const typing = (e) => {
    const w = e.target.closest && e.target.closest('.ts-wrapper.single');
    if (w) w.classList.toggle('z-typing', e.type === 'input' && e.target.value !== '');
  };
  document.addEventListener('input', typing);
  document.addEventListener('focusout', typing);

  const ENDPOINT = { language: '/api/languages', user: '/api/users', series: '/api/series', community: '/api/communities' };
  // Pickers that also accept a new value typed in.
  const CREATABLE = ['user', 'series', 'community'];
  const json = (url) => fetch(url, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : []));
  // Lists open on top of the page instead of inside the form, so opening one
  // never makes the card (or a scrolling table) grow.
  const ON_TOP = { dropdownParent: 'body' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function remote(el, kind) {
    return new window.TomSelect(el, { ...ON_TOP,
      valueField: 'value',
      labelField: 'text',
      searchField: ['text', 'value', 'localName'],
      maxOptions: 50,
      loadThrottle: 250,
      preload: kind !== 'user' ? 'focus' : false,
      create: CREATABLE.includes(kind),
      createOnBlur: CREATABLE.includes(kind),
      maxItems: el.multiple ? null : 1,
      plugins: el.multiple ? ['remove_button'] : [],
      // A picked name becomes a pill: don't offer it again, and start the next search clean.
      hideSelected: true,
      closeAfterSelect: true,
      onItemAdd() {
        this.setTextboxValue('');
        this.clearOptions((option) => this.items.includes(option.value));
        this.close();
        // A single choice: let go of the box so the picked name shows at once.
        if (!el.multiple) setTimeout(() => this.blur());
      },
      load(query, callback) {
        json(`${ENDPOINT[kind]}?q=${encodeURIComponent(query)}`).then(callback).catch(() => callback());
      },
      render: {
        option(item) {
          if (item.localName) {
            return `<div>${esc(item.text)} <span class="text-secondary">${esc(item.localName)}</span></div>`;
          }
          if (kind === 'series' && item.latest) {
            return `<div>${esc(item.text)} <span class="text-secondary small">${esc(zt('latest: {edition}', { edition: item.latest }))}</span></div>`;
          }
          if (kind === 'language' && item.code) {
            return `<div>${esc(item.text)} <span class="text-secondary small">${esc(item.code)}</span></div>`;
          }
          return `<div>${esc(item.text)}</div>`;
        },
        no_results: () => `<div class="no-results">${esc(zt('No matches'))}</div>`,
        option_create: (data) => `<div class="create">${esc(zt('Use “{text}”', { text: data.input }))}</div>`,
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
    const required = el.required ? ' required' : '';
    row.innerHTML =
      `<div class="col-sm-6"><label class="form-label${required}"></label></div>` +
      `<div class="col-sm-6"><label class="form-label${required}"></label></div>`;
    row.querySelectorAll('label')[0].textContent = el.dataset.languageLabel || zt('Language');
    row.querySelectorAll('label')[1].textContent = el.dataset.siteLabel || zt('Wiki');
    el.parentNode.insertBefore(row, el);
    const langSelect = document.createElement('select');
    langSelect.appendChild(new Option('', ''));
    langSelect.setAttribute('aria-label', 'Language of the wiki');
    langSelect.setAttribute('placeholder', zt('Choose a language or Commons, Wikidata…'));
    row.children[0].appendChild(langSelect);
    el.setAttribute('placeholder', zt('Then choose the wiki…'));
    row.children[1].appendChild(el);

    const wikis = new window.TomSelect(el, { ...ON_TOP,
      valueField: 'value',
      labelField: 'label',
      searchField: ['text', 'localName', 'value'],
      maxOptions: 500,
      onItemAdd() { setTimeout(() => this.blur()); },
      render: { option: withLocal, item: (item) => `<div>${esc(item.label)}</div>`, no_results: () => `<div class="no-results">${esc(zt('No matches'))}</div>` },
    });
    // Commons, Wikidata, Meta… have no language: they are listed in the first box
    // and picking one fills in the wiki directly; the second box is not needed.
    const MULTI = 'wiki:';
    const single = (on) => {
      row.children[1].hidden = on;
      row.querySelectorAll('label')[0].textContent = on ? el.dataset.siteLabel || zt('Wiki') : el.dataset.languageLabel || zt('Language');
    };
    const loadWikis = (code, keep) => {
      wikis.clear(true);
      wikis.clearOptions();
      single(!!code && code.startsWith(MULTI));
      if (code && code.startsWith(MULTI)) {
        const w = multiWikis.find((m) => m.value === code.slice(MULTI.length));
        if (w) { wikis.addOption(w); wikis.setValue(w.value, true); }
        return;
      }
      if (!code) return wikis.disable();
      wikis.enable();
      json(`/api/wiki-languages/${encodeURIComponent(code)}`).then((list) => {
        wikis.addOptions(list.map((w) => ({ ...w, label: label(w), hint: w.value })));
        if (keep) wikis.setValue(keep, true);
      });
    };

    const languages = new window.TomSelect(langSelect, { ...ON_TOP,
      valueField: 'value',
      labelField: 'label',
      searchField: ['text', 'localName', 'value'],
      maxOptions: 600,
      optgroupField: 'group',
      lockOptgroupOrder: true,
      optgroups: [{ value: 'multi', label: zt('Multilingual wikis') }, { value: 'lang', label: zt('Languages') }],
      onItemAdd() { setTimeout(() => this.blur()); },
      render: {
        option: withLocal,
        item: (item) => `<div>${esc(item.label)}</div>`,
        optgroup_header: (g) => `<div class="optgroup-header">${esc(g.label)}</div>`,
        no_results: () => `<div class="no-results">${esc(zt('No matches'))}</div>`,
      },
      onChange: (code) => {
        // The event's language follows the project language (not for Commons and the like).
        const hidden = document.getElementById('language');
        if (hidden) hidden.value = code && code !== 'special' && !code.startsWith(MULTI) ? code : '';
        loadWikis(code);
        el.dispatchEvent(new Event('change'));
      },
    });

    const initial = el.value;
    wikis.disable();
    let multiWikis = [];
    Promise.all([json('/api/wiki-languages'), json('/api/wiki-languages/special')]).then(([list, multi]) => {
      multiWikis = multi.map((w) => ({ ...w, label: label(w), hint: w.value }));
      languages.addOptions(multiWikis.map((w) => ({ ...w, value: MULTI + w.value, group: 'multi' })));
      languages.addOptions(list.filter((l) => l.value !== 'special').map((l) => ({ ...l, group: 'lang', label: label(l), hint: `${l.value} · ${l.count}` })));
      // Nothing is chosen for the person: a plain <select> would otherwise take the first option.
      if (!initial) return languages.clear(true);
      json(`/api/wiki-of?db=${encodeURIComponent(initial)}`).then(({ language }) => {
        if (!language) return;
        const code = language === 'special' ? MULTI + initial : language;
        languages.setValue(code, true);
        loadWikis(code, initial);
      });
    });
  }

  // Namespace options follow the wiki chosen in another field.
  function namespaces(el) {
    const source = document.getElementById(el.dataset.wikiSource);
    const ts = new window.TomSelect(el, { ...ON_TOP, valueField: 'value', labelField: 'text', searchField: ['text'], plugins: ['remove_button'], maxOptions: 200 });
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
