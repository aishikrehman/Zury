// Review window: buttons set the decision; keys A (accept), R (reject),
// S (skip), 1–9 (values of the first mark) and Ctrl+Enter (save).
(function () {
  const form = document.querySelector('[data-review-form]');
  if (!form) return;
  const decision = form.querySelector('[data-decision]');

  form.querySelectorAll('[data-decide]').forEach((button) =>
    button.addEventListener('click', () => {
      decision.value = button.dataset.decide;
    }),
  );

  document.addEventListener('keydown', (e) => {
    const inField = e.target instanceof Element && e.target.closest('input[type="text"], textarea, select, [contenteditable]');
    if (inField) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && decision.value) form.requestSubmit();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'a' || key === 'r') {
      e.preventDefault();
      form.querySelector(`[data-decide="${key === 'a' ? 'accept' : 'reject'}"]`).click();
    } else if (key === 's') {
      const skip = document.querySelector('[data-review-skip]');
      if (skip) location.href = skip.href;
    } else if (/^[1-9]$/.test(key)) {
      const options = form.querySelectorAll('[data-mark-group="0"] input');
      const option = options[Number(key) - 1];
      if (option) option.checked = true;
    }
  });
})();
