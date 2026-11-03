// zt('Step {n} of {total}', { n: 2, total: 5 }): text for the browser scripts in
// the page's language, from the dictionary the server put in #zury-i18n.
(function () {
  let dict = {};
  try {
    dict = JSON.parse(document.getElementById('zury-i18n')?.textContent || '{}');
  } catch {
    dict = {};
  }
  const locale = document.documentElement.lang === 'bn' ? 'bn-BD' : 'en-GB';
  const number = new Intl.NumberFormat(locale);
  window.zuryLocale = locale;
  window.zt = (text, values) =>
    (dict[text] || text).replace(/\{(\w+)\}/g, (m, key) => {
      if (!values || !(key in values)) return m;
      return typeof values[key] === 'number' ? number.format(values[key]) : String(values[key]);
    });
})();
