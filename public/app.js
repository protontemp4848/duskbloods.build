// Category pages (grid, list or table): text filter, tag select and live count.
const filters = document.querySelector('[data-filters]');
if (filters) {
  const text = filters.querySelector('[data-filter-text]');
  const tag = filters.querySelector('[data-filter-tag]');
  const count = filters.querySelector('[data-count]');
  const rows = [...document.querySelectorAll('main [data-entry]')];
  const empty = document.querySelector('[data-empty]');

  const apply = () => {
    const terms = text.value.toLowerCase().split(/\s+/).filter(Boolean);
    const wanted = tag?.value ?? '';
    let shown = 0;
    for (const row of rows) {
      const ok = terms.every((t) => row.dataset.search.includes(t)) && (!wanted || row.dataset.tags.split('|').includes(wanted));
      row.hidden = !ok;
      if (ok) shown++;
    }
    count.textContent = `${shown} ${shown === 1 ? 'entry' : 'entries'}`;
    empty.hidden = shown > 0;
  };
  text.addEventListener('input', apply);
  tag?.addEventListener('change', apply);
}

// Sortable tables: click a header to sort; numbers sort numerically.
for (const table of document.querySelectorAll('[data-entries]')) {
  const tbody = table.tBodies[0];
  const original = [...tbody.rows];
  const cellText = (row, i) => row.cells[i].textContent.trim();
  for (const button of table.querySelectorAll('th button[data-sort]')) {
    button.addEventListener('click', () => {
      const th = button.parentElement;
      const i = Number(button.dataset.sort);
      // Cycles ascending -> descending -> sheet order.
      const next = { none: 'ascending', ascending: 'descending', descending: 'none' }[th.getAttribute('aria-sort') ?? 'none'];
      for (const other of table.querySelectorAll('th')) other.removeAttribute('aria-sort');
      let rows = original;
      if (next !== 'none') {
        th.setAttribute('aria-sort', next);
        const dir = next === 'ascending' ? 1 : -1;
        rows = [...original].sort((a, b) => {
          const x = cellText(a, i), y = cellText(b, i);
          if (!x || !y) return x ? -1 : y ? 1 : 0; // blanks last
          const nx = parseFloat(x), ny = parseFloat(y);
          return dir * (Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y, undefined, { numeric: true }));
        });
      }
      tbody.append(...rows);
    });
  }
}

// Sheet image URLs can break (typos, hotlink blocking): drop the image rather than show a broken icon.
function onBrokenImage(img) {
  const entry = img.closest('.entry--image');
  if (entry) {
    entry.classList.remove('entry--image');
    img.closest('figure')?.remove();
  } else if (img.parentElement?.classList.contains('portrait')) {
    const blank = document.createElement('span');
    blank.className = 'portrait-blank';
    blank.setAttribute('aria-hidden', 'true');
    blank.textContent = img.parentElement.querySelector('strong')?.textContent.slice(0, 1) ?? '';
    img.replaceWith(blank);
  } else {
    img.remove();
  }
}
for (const img of document.querySelectorAll('main img')) {
  if (img.complete && img.naturalWidth === 0) onBrokenImage(img);
  else img.addEventListener('error', () => onBrokenImage(img), { once: true });
}

// "/" jumps to the search box (the category filter when there is one), like most wikis.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(input|select|textarea)$/i.test(document.activeElement?.tagName ?? '')) return;
  const box = document.querySelector('[data-filter-text]') ?? document.querySelector('[data-search-box]');
  if (box) { e.preventDefault(); box.focus(); }
});

// Wide tables scroll sideways; fade the right edge while there's more to see.
for (const wrap of document.querySelectorAll('.table-wrap')) {
  const update = () => {
    wrap.toggleAttribute('data-more', wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 1);
    wrap.toggleAttribute('data-scrolled', wrap.scrollLeft > 0);
  };
  wrap.addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
}

// On narrow screens the category tabs scroll sideways; start with the current one in view.
const currentTab = document.querySelector('.tabs [aria-current]');
if (currentTab) {
  const tabs = currentTab.parentElement;
  tabs.scrollLeft = currentTab.offsetLeft - tabs.offsetLeft - 16;
}

// "Report a problem": send without leaving the page (the form also works without JavaScript).
for (const form of document.querySelectorAll('[data-report]')) {
  const status = form.querySelector('[data-report-status]');
  const button = form.querySelector('button');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    status.classList.remove('report-status--error');
    status.textContent = 'Sending…';
    try {
      const res = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)), headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Sorry, that didn’t send. Please try again in a moment.');
      status.textContent = 'Thanks, your report was sent.';
      form.querySelector('textarea').value = '';
    } catch (err) {
      status.classList.add('report-status--error');
      // A network failure surfaces as TypeError("Failed to fetch"); say something human instead.
      status.textContent = err instanceof TypeError ? 'Couldn’t reach the site. Check your connection and try again.' : err.message;
    } finally {
      button.disabled = false;
    }
  });
}
