const els = {
  host: document.getElementById('host'),
  siteState: document.getElementById('siteState'),
  siteHint: document.getElementById('siteHint'),
  siteToggle: document.getElementById('siteToggle'),
  globalToggle: document.getElementById('globalToggle'),
  count: document.getElementById('count'),
  options: document.getElementById('options'),
  reload: document.getElementById('reload')
};

let currentTab = null;
let currentHost = '';

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function renderSiteState(blocking, enabled) {
  const active = enabled && blocking;
  els.siteState.textContent = !enabled ? '停止中' : blocking ? 'ブロック中' : '許可中';
  els.siteState.className = 'badge ' + (active ? 'on' : 'off');
  els.siteToggle.checked = blocking;
  els.siteToggle.disabled = !enabled || !currentHost;
  els.siteHint.textContent = blocking
    ? 'OFFにするとホワイトリストに追加されます'
    : 'ホワイトリストに登録済み(広告を許可)';
}

/** このタブでブロックされたリクエスト数を取得する(activeTab 権限で参照可能) */
async function loadCount() {
  if (!currentTab?.id) return;
  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({
      tabId: currentTab.id
    });
    els.count.textContent = rulesMatchedInfo.length;
  } catch {
    els.count.textContent = '–';
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  const state = await send({ type: 'getState', url: tab?.url || '' });
  currentHost = state.host || '';

  els.host.textContent = currentHost || '(このページでは利用できません)';
  els.globalToggle.checked = state.enabled;
  renderSiteState(!state.whitelisted, state.enabled);

  loadCount();
}

els.siteToggle.addEventListener('change', async () => {
  if (!currentHost) return;
  const result = await send({ type: 'toggleWhitelist', domain: currentHost });
  if (!result?.ok) return;
  renderSiteState(!result.whitelisted, els.globalToggle.checked);
  if (currentTab?.id) chrome.tabs.reload(currentTab.id);
});

els.globalToggle.addEventListener('change', async () => {
  const enabled = els.globalToggle.checked;
  await chrome.storage.sync.set({ enabled });
  const state = await send({ type: 'getState', url: currentTab?.url || '' });
  renderSiteState(!state.whitelisted, enabled);
  if (currentTab?.id) chrome.tabs.reload(currentTab.id);
});

els.options.addEventListener('click', () => chrome.runtime.openOptionsPage());
els.reload.addEventListener('click', () => {
  if (currentTab?.id) chrome.tabs.reload(currentTab.id);
  window.close();
});

init();
