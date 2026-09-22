const DEFAULTS = {
  enabled: true,
  cosmetic: true,
  blockTracking: false,
  whitelist: []
};

const els = {
  enabled: document.getElementById('enabled'),
  cosmetic: document.getElementById('cosmetic'),
  blockTracking: document.getElementById('blockTracking'),
  addForm: document.getElementById('addForm'),
  domainInput: document.getElementById('domainInput'),
  list: document.getElementById('list'),
  empty: document.getElementById('empty')
};

function normalizeDomain(input) {
  let value = String(input || '').trim().toLowerCase();
  if (!value) return '';
  if (!value.includes('://')) value = 'http://' + value;
  try {
    const host = new URL(value).hostname;
    if (!host.includes('.')) return '';
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function renderList(whitelist) {
  els.list.textContent = '';
  els.empty.hidden = whitelist.length > 0;

  for (const domain of whitelist) {
    const li = document.createElement('li');

    const span = document.createElement('span');
    span.className = 'domain';
    span.textContent = domain;

    const button = document.createElement('button');
    button.className = 'remove';
    button.type = 'button';
    button.textContent = '削除';
    button.addEventListener('click', async () => {
      const { whitelist: current = [] } = await chrome.storage.sync.get({ whitelist: [] });
      await chrome.storage.sync.set({ whitelist: current.filter((d) => d !== domain) });
    });

    li.append(span, button);
    els.list.append(li);
  }
}

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  els.enabled.checked = cfg.enabled;
  els.cosmetic.checked = cfg.cosmetic;
  els.blockTracking.checked = cfg.blockTracking;
  renderList(Array.isArray(cfg.whitelist) ? cfg.whitelist : []);
}

for (const key of ['enabled', 'cosmetic', 'blockTracking']) {
  els[key].addEventListener('change', () => {
    chrome.storage.sync.set({ [key]: els[key].checked });
  });
}

els.addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const domain = normalizeDomain(els.domainInput.value);
  if (!domain) {
    els.domainInput.select();
    return;
  }
  const { whitelist = [] } = await chrome.storage.sync.get({ whitelist: [] });
  if (!whitelist.includes(domain)) {
    await chrome.storage.sync.set({ whitelist: [...whitelist, domain].sort() });
  }
  els.domainInput.value = '';
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') load();
});

load();
