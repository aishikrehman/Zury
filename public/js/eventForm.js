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

  // Address: from the title until changed by hand; /<series>/<edition> when part of a series.
  const title = $('title');
  const slug = form.querySelector('[data-slug]');
  const series = $('seriesSlug');
  const edition = $('edition');
  const seriesAddress = form.querySelector('[data-series-address]');
  const hint = form.querySelector('[data-address-hint]');
  if (!slug) return;
  const slugify = (t) =>
    t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  let slugEdited = slug.value !== '' && slug.value !== slugify(title.value);
  title.addEventListener('input', () => {
    if (!slugEdited) slug.value = slugify(title.value);
  });
  slug.addEventListener('input', () => {
    slugEdited = slug.value !== '';
  });

  function showAddress() {
    const s = series.value.trim();
    const inSeries = s !== '' && !slug.classList.contains('is-invalid');
    slug.classList.toggle('d-none', inSeries);
    seriesAddress.classList.toggle('d-none', !inSeries);
    seriesAddress.classList.toggle('flex-fill', inSeries);
    seriesAddress.textContent = `${slugify(s).slice(0, 40)}/${edition.value.trim().toLowerCase() || '…'}`;
    hint.textContent = zt(inSeries ? 'Part of a series: the address is the series and the edition.' : 'Made from the title; you can change it.');
  }
  // Values filled in from a series; cleared again if the series changes or is removed.
  const prev = $('previousEditionUrl');
  let autoEdition = null;
  let autoPrev = null;
  series.addEventListener('change', () => {
    if (autoEdition !== null && edition.value === autoEdition) edition.value = '';
    if (autoPrev !== null && prev && prev.value === autoPrev) prev.value = '';
    autoEdition = autoPrev = null;
    // An existing series: suggest the next edition and link the latest one.
    const item = series.value && series.tomselect?.options[series.value];
    if (item?.latest) {
      if (!edition.value && /^\d+$/.test(item.latest)) edition.value = autoEdition = String(Number(item.latest) + 1);
      if (prev && !prev.value) prev.value = autoPrev = `${location.origin}/${series.value}/${item.latest}`;
    }
    // Its editions as choices; picking an existing one makes this wiki join it.
    editions = item?.editions || [];
    const list = document.getElementById('edition-list');
    if (list) list.replaceChildren(...[...new Set([autoEdition, ...editions].filter(Boolean))].map((e) => Object.assign(document.createElement('option'), { value: e })));
    showAddress();
    showJoin();
  });
  let editions = [];
  const joinHint = form.querySelector('[data-edition-hint]');
  const showJoin = () => joinHint && joinHint.classList.toggle('d-none', !editions.includes(edition.value.trim()));
  edition.addEventListener('input', () => { showAddress(); showJoin(); });
  showAddress();
})();

// Review settings: the tie choice is for a majority, the pass mark for a score.
(function () {
  const rule = document.querySelector('[data-decision-rule]');
  if (!rule) return;
  const show = () => document.querySelectorAll('[data-show-for]').forEach((el) => { el.hidden = el.dataset.showFor !== rule.value; });
  rule.addEventListener('change', show);
  show();
})();
