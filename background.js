/**
 * Simple Ad Blocker - service worker
 *
 * ブロックは静的ルール(rules/*.json, priority 1)が担当する。
 * ホワイトリストは「動的ルール(priority 1000, allowAllRequests)」として登録し、
 * そのサイトのフレーム配下のリクエストをすべてブロック対象から除外する。
 */

const DEFAULTS = {
  enabled: true,        // 拡張全体のON/OFF
  cosmetic: true,       // CSSで広告の残骸を隠すか
  blockTracking: false, // トラッキングもブロックするか
  whitelist: []         // 広告を許可するドメイン(["example.com", ...])
};

const WHITELIST_RULE_OFFSET = 1; // 動的ルールIDの開始値

/** 入力文字列からホスト名だけを取り出して正規化する */
function normalizeDomain(input) {
  let value = String(input || '').trim().toLowerCase();
  if (!value) return '';
  if (!value.includes('://')) value = 'http://' + value;
  try {
    const host = new URL(value).hostname;
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** host がホワイトリスト(サブドメイン含む)に一致するか */
function isWhitelisted(host, whitelist) {
  const target = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!target) return false;
  return whitelist.some((entry) => target === entry || target.endsWith('.' + entry));
}

async function getConfig() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  cfg.whitelist = Array.isArray(cfg.whitelist) ? cfg.whitelist : [];
  return cfg;
}

/** enabled / blockTracking に応じて静的ルールセットを切り替える */
async function applyRulesets(cfg) {
  const enableRulesetIds = [];
  const disableRulesetIds = [];

  (cfg.enabled ? enableRulesetIds : disableRulesetIds).push('ads');
  (cfg.enabled && cfg.blockTracking ? enableRulesetIds : disableRulesetIds).push('tracking');

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds,
    disableRulesetIds
  });
}

/** ホワイトリストを動的な許可ルールに反映する */
async function applyWhitelistRules(cfg) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();

  const addRules = cfg.whitelist.map((domain, index) => ({
    id: WHITELIST_RULE_OFFSET + index,
    priority: 1000, // 静的ブロックルール(priority 1)より必ず優先させる
    action: { type: 'allowAllRequests' },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ['main_frame', 'sub_frame']
    }
  }));

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules
  });
}

async function syncAll() {
  const cfg = await getConfig();
  await applyRulesets(cfg);
  await applyWhitelistRules(cfg);
  return cfg;
}

/** タブごとにバッジ表示(OFFのときだけ出す)を更新する */
async function updateBadge(tabId, url, cfg) {
  if (!tabId) return;
  const config = cfg || (await getConfig());

  let off = !config.enabled;
  if (!off && url) {
    try {
      off = isWhitelisted(new URL(url).hostname, config.whitelist);
    } catch {
      off = false;
    }
  }

  await chrome.action.setBadgeText({ tabId, text: off ? 'OFF' : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#8a8f98' });
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set({ ...DEFAULTS, ...stored });
  await syncAll();
});

chrome.runtime.onStartup.addListener(() => {
  syncAll();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  const cfg = await syncAll();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) updateBadge(tab.id, tab.url, cfg);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    updateBadge(tabId, changeInfo.url || tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) updateBadge(tabId, tab.url);
});

/** popup / options からの操作 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const cfg = await getConfig();

    switch (message?.type) {
      case 'getState': {
        const host = normalizeDomain(message.url || '');
        sendResponse({
          ...cfg,
          host,
          whitelisted: host ? isWhitelisted(host, cfg.whitelist) : false
        });
        return;
      }

      case 'toggleWhitelist': {
        const domain = normalizeDomain(message.domain);
        if (!domain) {
          sendResponse({ ok: false, error: 'invalid domain' });
          return;
        }
        const set = new Set(cfg.whitelist);
        const nowWhitelisted = !isWhitelisted(domain, cfg.whitelist);

        if (nowWhitelisted) {
          set.add(domain);
        } else {
          // 完全一致だけでなく、一致した親ドメインの登録も外す
          for (const entry of [...set]) {
            if (domain === entry || domain.endsWith('.' + entry)) set.delete(entry);
          }
        }

        await chrome.storage.sync.set({ whitelist: [...set].sort() });
        sendResponse({ ok: true, whitelisted: nowWhitelisted });
        return;
      }

      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })();

  return true; // 非同期レスポンスを維持
});
