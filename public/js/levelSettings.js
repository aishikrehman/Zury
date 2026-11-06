// Series settings form: the value field follows the chosen setting (a switch, a list or a number).
(function () {
  const form = document.querySelector('[data-level-setting]');
  if (!form) return;
  const key = form.querySelector('[name="key"]');
  const slot = form.querySelector('[data-value-slot]');
  function show() {
    const def = JSON.parse(key.selectedOptions[0].dataset.def);
    let field;
    if (def.type === 'bool' || def.type === 'enum') {
      field = document.createElement('select');
      field.className = 'form-select';
      const opts = def.type === 'bool' ? [['true', zt('Yes')], ['false', zt('No')]] : def.options.map((o) => [o, o]);
      for (const [v, l] of opts) field.append(Object.assign(document.createElement('option'), { value: v, textContent: l }));
    } else {
      field = Object.assign(document.createElement('input'), { className: 'form-control', type: 'number', min: def.min, max: def.max, step: def.type === 'float' ? 'any' : 1, required: !def.optional });
    }
    field.name = 'value';
    field.id = 'ls-value';
    slot.replaceChildren(field);
  }
  key.addEventListener('change', show);
  show();
})();
