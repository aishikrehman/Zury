// Step wizard for <form data-wizard>: "steps" goes one step at a time with
// Back / Next and ends on a review; "tabs" lets any step be opened directly.
(function () {
  document.querySelectorAll('form[data-wizard]').forEach((form) => {
    // One page (new events): every section is shown; nothing to step through.
    if (form.dataset.wizard === 'page') return;
    const sequential = form.dataset.wizard === 'steps';
    const panes = [...form.querySelectorAll('.wizard-pane')];
    const links = [...form.querySelectorAll('[data-step-link]')];
    const back = form.querySelector('[data-wizard-back]');
    const next = form.querySelector('[data-wizard-next]');
    const submit = form.querySelector('[data-wizard-submit]');
    const count = form.querySelector('[data-wizard-count]');
    const review = form.querySelector('[data-review]');
    let current = 0;
    let reached = 0;

    // The field's label: the nearest column that has one (pickers move the label's "for").
    const fieldLabel = (el) => {
      const col = el.closest('[class*="col-"]:has(> .form-label)');
      const label = col?.querySelector(':scope > .form-label');
      return (label ? label.childNodes[0].textContent : el.name).trim();
    };
    const dateText = (v) => {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? v : d.toLocaleString(window.zuryLocale, { dateStyle: 'medium', timeStyle: 'short' });
    };

    // Required fields in a step: marks the empty ones and returns whether all are filled.
    function checkStep(i) {
      let ok = true;
      panes[i].querySelectorAll('[required]').forEach((el) => {
        const filled = el.value.trim() !== '' && (!el.minLength || el.minLength < 0 || el.value.trim().length >= el.minLength);
        el.classList.toggle('is-invalid', !filled);
        el.tomselect?.wrapper.classList.toggle('is-invalid', !filled);
        if (!filled) ok = false;
      });
      return ok;
    }

    function buildReview() {
      if (!review) return;
      const sections = panes.slice(0, -1).map((pane) => {
        const rows = [];
        const seen = new Set();
        pane.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
          if (el.type === 'hidden' || el.disabled || el.closest('fieldset[disabled]')) return;
          let value = '';
          if (el.type === 'checkbox' || el.type === 'radio') {
            if (!el.checked) return;
            // The option's own words, without its description.
            const label = el.closest('label');
            const part = label && (label.querySelector('strong') || label.querySelector('.form-check-label, .form-selectgroup-label'));
            const name = (part?.childNodes[0]?.textContent || label?.textContent || el.value).trim();
            if (el.type === 'radio' || el.classList.contains('form-selectgroup-input')) {
              const key = el.name;
              const prev = rows.find((r) => r.key === key);
              if (prev) return void (prev.value += `, ${name}`);
              const group = fieldLabel(el);
              return rows.push({ key, label: group, value: name });
            }
            return rows.push({ key: el.name, label: name, value: zt('Yes') });
          }
          if (seen.has(el.name)) return;
          seen.add(el.name);
          if (el.tagName === 'SELECT') value = [...el.selectedOptions].map((o) => o.textContent.trim()).filter(Boolean).join(', ');
          else value = el.type === 'datetime-local' && el.value ? dateText(el.value) : el.value.trim();
          if (value) rows.push({ key: el.name, label: fieldLabel(el), value });
        });
        const title = pane.querySelector('h3')?.textContent || '';
        return { title, rows, index: panes.indexOf(pane) };
      });
      review.replaceChildren(
        ...sections.map(({ title, rows, index }) => {
          const card = document.createElement('div');
          card.className = 'mb-4';
          const head = document.createElement('div');
          head.className = 'd-flex align-items-center mb-2';
          head.innerHTML = '<h4 class="m-0"></h4><button type="button" class="btn btn-sm btn-ghost-primary ms-auto"></button>';
          head.querySelector('h4').textContent = title;
          head.querySelector('button').textContent = zt('Edit');
          head.querySelector('button').addEventListener('click', () => show(index));
          const grid = document.createElement('div');
          grid.className = 'datagrid';
          if (!rows.length) {
            grid.innerHTML = '<div class="text-secondary"></div>';
            grid.firstChild.textContent = zt('Nothing set.');
          }
          for (const r of rows) {
            const item = document.createElement('div');
            item.className = 'datagrid-item';
            item.innerHTML = '<div class="datagrid-title"></div><div class="datagrid-content" style="white-space: pre-line"></div>';
            item.children[0].textContent = r.label;
            item.children[1].textContent = r.value;
            grid.appendChild(item);
          }
          card.append(head, grid);
          return card;
        }),
      );
    }

    function show(i, scroll = true) {
      current = i;
      reached = Math.max(reached, i);
      panes.forEach((p, n) => p.classList.toggle('d-none', n !== i));
      links.forEach((a, n) => (a.closest('.step-item') || a).classList.toggle('active', n === i));
      if (sequential) {
        const last = i === panes.length - 1;
        back.disabled = i === 0;
        next.classList.toggle('d-none', last);
        submit.classList.toggle('d-none', !last);
        count.textContent = zt('Step {n} of {total}', { n: i + 1, total: panes.length });
        if (last) buildReview();
      }
      // The open tab is in the address, so a refresh (or a shared link) opens it again.
      if (!sequential && panes[i].id) history.replaceState(null, '', `#${panes[i].id}`);
      if (scroll) form.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    links.forEach((a, n) =>
      a.addEventListener('click', (e) => {
        e.preventDefault();
        // While creating, only steps already reached (or the next one, if this one is complete) open.
        if (sequential && n > reached && !(n === current + 1 && checkStep(current))) return;
        // A new event: a later tab opens only when the tabs before it have their required fields
        // (superusers can go anywhere).
        if (form.hasAttribute('data-guard') && n > current) {
          for (let k = current; k < n; k += 1) if (!checkStep(k)) return show(k);
        }
        show(n);
      }),
    );
    next?.addEventListener('click', () => {
      if (checkStep(current)) show(current + 1);
    });
    back?.addEventListener('click', () => show(current - 1));
    form.addEventListener('input', (e) => e.target.classList.remove('is-invalid'));
    form.addEventListener('change', (e) => e.target.tomselect?.wrapper.classList.remove('is-invalid'));
    // Enter in a text field moves on rather than submitting half a form.
    form.addEventListener('keydown', (e) => {
      if (sequential && e.key === 'Enter' && e.target.tagName === 'INPUT' && current < panes.length - 1) {
        e.preventDefault();
        next.click();
      }
    });

    // After the server found problems, open the first step that has one.
    const firstError = panes.findIndex((p) => p.querySelector('.is-invalid, .invalid-feedback'));
    if (firstError >= 0) {
      reached = panes.length - 1;
      show(firstError, false);
    } else {
      const fromHash = panes.findIndex((p) => `#${p.id}` === location.hash);
      show(fromHash >= 0 && !sequential ? fromHash : 0, false);
    }
  });
})();
