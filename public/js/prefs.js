// Display preferences from the floating accessibility button, kept in this browser.
(function () {
  const root = document.documentElement;
  const prefs = { wide: 'zury-wide', textLarge: 'zury-text-lg' };

  function save(key, on) {
    try {
      localStorage.setItem(`zury:${key}`, on ? '1' : '0');
    } catch {
      // Storage can be unavailable (private mode); the change still applies to this page.
    }
  }

  document.querySelectorAll('[data-zury-pref]').forEach((input) => {
    const key = input.dataset.zuryPref;
    input.checked = root.classList.contains(prefs[key]);
    input.addEventListener('change', () => {
      root.classList.toggle(prefs[key], input.checked);
      save(key, input.checked);
      window.dispatchEvent(new Event('resize'));
    });
  });
})();
