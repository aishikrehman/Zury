// Behaviour of the event form (form[data-event-form]): type-specific fields
// follow the chosen type, and the address follows the title or the series.
(function () {
  const form = document.querySelector('form[data-event-form]');
  if (!form) return;
  const creating = form.dataset.wizard === 'steps';
  const $ = (id) => document.getElementById(id);

  // Type: show that type's settings; on a new event also its default switches.
  const typeSelect = form.querySelector('[data-type-select]');
  function applyType(fromUser) {
    const type = typeSelect.value;
    form.querySelectorAll('[data-type-fields]').forEach((fs) => {
      const mine = fs.dataset.typeFields === type;
      fs.disabled = !mine;
      fs.classList.toggle('d-none', !mine);
    });
    const option = typeSelect.selectedOptions[0];
    const describe = form.querySelector('[data-type-description]');
    if (describe) describe.textContent = option?.dataset.description || '';
    for (const step of ['rules', 'judging']) {
      const line = form.querySelector(`[data-guide="${step}"]`);
      if (line) line.textContent = option?.dataset[`guide${step[0].toUpperCase()}${step.slice(1)}`] || '';
    }
    const ns = $('eligibleNamespaces');
    if (ns?.tomselect && option?.dataset.namespaces) ns.tomselect.settings.placeholder = zt('Default: {list}', { list: option.dataset.namespaces });
    if (fromUser && creating && option?.dataset.defaults) {
      for (const [key, value] of Object.entries(JSON.parse(option.dataset.defaults))) {
        const box = $(key);
        if (box) box.checked = value;
      }
    }
  }
  if (typeSelect) {
    typeSelect.addEventListener('change', () => applyType(true));
    applyType(false);
  }

  // Marks: rows of "name" + "Label = points, …", kept as JSON in a hidden field.
  const marksBox = form.querySelector('[data-marks-editor]');
  if (marksBox) {
    const input = marksBox.querySelector('[data-marks-input]');
    const rows = marksBox.querySelector('[data-marks-rows]');
    const PRESETS = {
      accept: { name: zt('Accepted'), values: [{ label: zt('Yes'), points: 1 }, { label: zt('No'), points: 0 }] },
      quality: { name: zt('Quality'), values: [0, 1, 2, 3].map((n) => ({ label: String(n), points: n })) },
    };
    const toText = (values) => values.map((v) => `${v.label} = ${v.points}`).join(', ');
    const fromText = (text) =>
      text.split(',').map((part) => {
        const [label, points] = part.split('=').map((x) => (x || '').trim());
        return { label, points: Number(points || 0) };
      }).filter((v) => v.label);
    const save = () => {
      input.value = JSON.stringify(
        [...rows.children].map((row) => ({ name: row.querySelector('[data-name]').value.trim(), values: fromText(row.querySelector('[data-values]').value) })).filter((m) => m.name),
      );
    };
    const addRow = (mark = { name: '', values: [] }) => {
      const row = document.createElement('div');
      row.className = 'row g-2 mb-2 align-items-center';
      row.innerHTML =
        '<div class="col-md-4"><input class="form-control" data-name maxlength="60"></div>' +
        '<div class="col"><input class="form-control" data-values></div>' +
        '<div class="col-auto"><button type="button" class="btn btn-icon btn-ghost-danger"><i class="ti ti-x"></i></button></div>';
      row.querySelector('[data-name]').placeholder = zt('Mark, e.g. Accepted');
      row.querySelector('[data-values]').placeholder = zt('Values with points, e.g. Yes = 1, No = 0');
      row.querySelector('button').setAttribute('aria-label', zt('Remove mark'));
      row.querySelector('[data-name]').value = mark.name;
      row.querySelector('[data-values]').value = toText(mark.values);
      row.querySelector('button').addEventListener('click', () => {
        row.remove();
        save();
      });
      row.addEventListener('input', save);
      rows.appendChild(row);
      save();
    };
    try {
      JSON.parse(input.value || '[]').forEach(addRow);
    } catch {
      /* the server reports unreadable marks */
    }
    marksBox.querySelector('[data-marks-add]').addEventListener('click', () => addRow());
    marksBox.querySelectorAll('[data-marks-preset]').forEach((b) => b.addEventListener('click', () => addRow(PRESETS[b.dataset.marksPreset])));
  }

  // Address: the parent's part (/events, /<series> or /<series>/<edition>) and a name: from the
  // title until changed by hand, or the event's type in an edition (/wam/2026/writing).
  const title = $('title');
  const slug = form.querySelector('[data-slug]');
  const series = $('seriesSlug');
  const edition = $('edition');
  const prefix = form.querySelector('[data-address-prefix]');
  const hint = form.querySelector('[data-address-hint]');
  if (!slug) return;
  const slugify = (t) =>
    t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  let slugEdited = slug.value !== '' && slug.value !== slugify(title.value);
  title.addEventListener('input', () => {
    if (!slugEdited && !edition.value.trim()) slug.value = slugify(title.value);
  });
  slug.addEventListener('input', () => {
    slugEdited = slug.value !== '';
  });

  function showAddress() {
    const s = slugify(series.value.trim()).slice(0, 40);
    const e = edition.value.trim().toLowerCase();
    // In an edition the event is named by its wiki's code (/wam/2026/bn): no name to type.
    // In an edition the rest of the address is fixed (series/edition/wiki code): shown, greyed out.
    prefix.textContent = s && e ? `${prefix.dataset.origin}/` : `${prefix.dataset.origin}/${s ? `${s}/` : ''}`;
    slug.disabled = !!(s && e);
    if (s && e) slug.value = `${s}/${e}/…`;
    else if (!slugEdited || slug.value === edition.dataset.current) slug.value = slugify(title.value);
    hint.textContent = '';
  }
  if (typeSelect) typeSelect.addEventListener('change', showAddress);
  // Live check: is the address free? Asked a moment after typing stops.
  const status = form.querySelector('[data-address-status]');
  let timer = null;
  let asked = 0;
  function check() {
    if (!status) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = new URLSearchParams({ slug: slug.value.trim(), series: series.value.trim(), edition: edition.value.trim(), wiki: ($('primaryWiki') || {}).value || '', exclude: form.dataset.eventId || '' });
      const mine = ++asked;
      try {
        const r = await (await fetch(`/api/address?${q}`, { headers: { Accept: 'application/json' } })).json();
        if (mine !== asked) return;
        status.className = 'small mt-1 ' + (r.free ? 'text-success' : 'text-danger');
        status.replaceChildren();
        const icon = Object.assign(document.createElement('i'), { className: 'ti me-1 ' + (r.free ? 'ti-circle-check' : 'ti-alert-circle') });
        const msg = r.free ? zt('Free: {path}', { path: r.path }) : r.reason === 'edition' ? zt('This edition already has an event for this wiki.') : r.reason === 'series' ? zt('That series name is taken.') : r.reason === 'form' ? zt('Use lowercase letters, numbers and hyphens.') : zt('Taken.');
        const fixed = slug.disabled;
        if (fixed && r.path) slug.value = r.path.slice(1);
        // The full address is already shown; only a problem needs a line of its own.
        if (fixed && r.free) { status.replaceChildren(); return; }
        status.append(icon, msg);
        if (!r.free && r.suggestion) {
          const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-link btn-sm p-0 ms-2', textContent: zt('Use {name}', { name: r.suggestion }) });
          b.addEventListener('click', () => { slug.value = r.suggestion; slugEdited = true; check(); });
          status.append(b);
        }
      } catch {
        status.textContent = '';
      }
    }, 350);
  }
  [slug, title, series, edition].forEach((el) => el && el.addEventListener('input', check));
  [series, edition, $('primaryWiki')].forEach((el) => el && el.addEventListener('change', check));
  check();
  // Edition: the chosen series' editions (newest first); a new series has none yet. The latest
  // one links as the previous edition when that field is empty.
  const prev = $('previousEditionUrl');
  let autoPrev = null;
  function fillEditions(item, keep, chosen) {
    const list = item?.editionList || [];
    const options = [Object.assign(document.createElement('option'), { value: '', textContent: edition.dataset.noneLabel })];
    for (const e of list) {
      const o = Object.assign(document.createElement('option'), { value: e.slug, textContent: e.title && e.title !== e.slug ? `${e.slug} — ${e.title}` : e.slug });
      options.push(o);
    }
    edition.replaceChildren(...options);
    edition.value = keep && list.some((e) => e.slug === keep) ? keep : '';
    edition.disabled = !list.length;
    if (chosen && autoPrev !== null && prev && prev.value === autoPrev) prev.value = '';
    if (chosen) autoPrev = null;
    if (chosen && item?.latest && prev && !prev.value) prev.value = autoPrev = `${location.origin}/${item.value}/${item.latest}`;
    showAddress();
  }
  series.addEventListener('change', () => fillEditions(series.value && series.tomselect?.options[series.value], null, true));
  edition.addEventListener('change', showAddress);
  // Opening the form with a series already chosen (editing, or a link from an edition page).
  if (series.value) {
    fetch(`/api/series?q=${encodeURIComponent(series.value)}`).then((r) => r.json()).then((rows) => {
      fillEditions(rows.find((r) => r.value === series.value), edition.dataset.current);
    }).catch(() => {});
  } else {
    edition.disabled = true;
  }
  showAddress();
})();

// Review settings: parts that belong to one choice. data-show-when="reviewMethod:stars,number" follows
// a radio group; data-show-for="score" follows the decision rule (shown when either matches).
(function () {
  const form = document.querySelector('form[data-event-form]');
  if (!form) return;
  const rule = form.querySelector('[data-decision-rule]');
  const picked = (name) => {
    const sel = form.querySelector(`select[name="${name}"]`);
    return sel ? sel.value : (form.querySelector(`input[name="${name}"]:checked`) || {}).value;
  };
  const show = () => {
    form.querySelectorAll('[data-show-when], [data-show-for]').forEach((el) => {
      let on = null;
      if (el.dataset.showWhen) {
        const [name, values] = el.dataset.showWhen.split(':');
        on = values.split(',').includes(picked(name));
      }
      if (el.dataset.showFor && rule && !rule.closest('[hidden]')) on = on || el.dataset.showFor === rule.value;
      el.hidden = !on;
    });
  };
  form.addEventListener('change', show);
  show();
})();

// Settings locked by the series or edition: shown, but not editable here.
(function () {
  const box = document.querySelector('[data-locked-settings]');
  const form = document.querySelector('form[data-event-form]');
  if (!box || !form) return;
  for (const name of JSON.parse(box.dataset.lockedSettings || '[]')) {
    form.querySelectorAll(`[name="${name}"]`).forEach((el) => {
      el.disabled = true;
      el.title = zt('Locked by the series or edition');
      const label = el.closest('.form-check, .mb-3, .col, [class*="col-"]')?.querySelector('label, .form-check-label');
      if (label && !label.querySelector('.ti-lock')) label.insertAdjacentHTML('afterbegin', '<i class="ti ti-lock me-1"></i>');
    });
  }
})();
