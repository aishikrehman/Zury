// Loads the heavier scripts only on pages that use them, in order.
(function () {
  const v = document.currentScript.dataset.v || '';
  const add = (src) => {
    const s = document.createElement('script');
    s.src = src + (v ? '?v=' + v : '');
    s.async = false;
    document.body.appendChild(s);
  };
  const has = (sel) => document.querySelector(sel);
  if (has('[data-picker]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/tom-select/css/tom-select.bootstrap5.min.css';
    // Before Zury's own stylesheet, so Zury's look of the pickers wins.
    const ours = document.querySelector('link[rel="stylesheet"]');
    document.head.insertBefore(css, ours);
    add('/vendor/tom-select/js/tom-select.complete.min.js');
    add('/js/pickers.js');
  }
  if (has('[data-chart]')) add('/js/charts.js');
  if (has('form[data-wizard]')) add('/js/wizard.js');
  if (has('form[data-event-form]')) add('/js/eventForm.js');
  if (has('[data-review-form]')) add('/js/review.js');
  if (has('[data-level-setting]')) add('/js/levelSettings.js');
})();
