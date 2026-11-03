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
    const ns = $('eligibleNamespaces');
    if (ns?.tomselect && option?.dataset.namespaces) ns.tomselect.settings.placeholder = `Default: ${option.dataset.namespaces}`;
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
    hint.textContent = inSeries ? 'Part of a series: the address is the series and the edition.' : 'Made from the title; you can change it.';
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
    showAddress();
  });
  edition.addEventListener('input', showAddress);
  showAddress();
})();
