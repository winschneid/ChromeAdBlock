// 開発用の簡易テスト: node ad-blocker/_test.js
const fs = require('fs');
const vm = require('vm');

const store = { enabled: true, cosmetic: true, blockTracking: false, whitelist: [] };
const calls = { rulesets: null, dynamic: null };
const listeners = { message: null, storage: null };

const chrome = {
  storage: {
    sync: {
      get: async (defaults) => ({ ...defaults, ...store }),
      set: async (obj) => Object.assign(store, obj)
    },
    onChanged: { addListener: (fn) => (listeners.storage = fn) }
  },
  declarativeNetRequest: {
    updateEnabledRulesets: async (o) => (calls.rulesets = o),
    getDynamicRules: async () => calls.dynamic?.addRules || [],
    updateDynamicRules: async (o) => (calls.dynamic = o)
  },
  tabs: {
    query: async () => [],
    get: async () => null,
    onUpdated: { addListener() {} },
    onActivated: { addListener() {} }
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener: (fn) => (listeners.message = fn) }
  }
};

const ctx = vm.createContext({ chrome, console, setTimeout, URL, Set });
vm.runInContext(fs.readFileSync(__dirname + '/background.js', 'utf8'), ctx);

const send = (msg) => new Promise((resolve) => listeners.message(msg, {}, resolve));

let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got=${JSON.stringify(actual)}\n      want=${JSON.stringify(expected)}`}`);
};

(async () => {
  // 1. 初期状態
  let state = await send({ type: 'getState', url: 'https://news.example.com/article/1' });
  check('初期状態ではブロック対象', state.whitelisted, false);
  check('ホスト名を抽出する', state.host, 'news.example.com');

  // 2. ホワイトリストに追加
  const added = await send({ type: 'toggleWhitelist', domain: 'https://www.example.com/page' });
  check('www を除いて登録される', store.whitelist, ['example.com']);
  check('追加の戻り値', added, { ok: true, whitelisted: true });

  // 3. ストレージ変更でルールが再生成される
  await listeners.storage({ whitelist: {} }, 'sync');
  check('許可ルールが1件生成される', calls.dynamic.addRules.length, 1);
  check('allowAllRequests / 高優先度', [calls.dynamic.addRules[0].action.type, calls.dynamic.addRules[0].priority], ['allowAllRequests', 1000]);
  check('urlFilter の形式', calls.dynamic.addRules[0].condition.urlFilter, '||example.com^');
  check('静的ルールは有効のまま', calls.rulesets.enableRulesetIds, ['ads']);

  // 4. サブドメインも許可される
  state = await send({ type: 'getState', url: 'https://news.example.com/article/1' });
  check('サブドメインも許可扱い', state.whitelisted, true);
  state = await send({ type: 'getState', url: 'https://example.com.evil.test/' });
  check('前方一致の偽装は許可しない', state.whitelisted, false);

  // 5. サブドメインから解除すると親の登録も外れる
  await send({ type: 'toggleWhitelist', domain: 'news.example.com' });
  check('解除で親ドメインの登録も削除', store.whitelist, []);

  // 6. トラッキングON / 全体OFF
  store.blockTracking = true;
  await listeners.storage({ blockTracking: {} }, 'sync');
  check('トラッキングも有効化', calls.rulesets.enableRulesetIds, ['ads', 'tracking']);
  store.enabled = false;
  await listeners.storage({ enabled: {} }, 'sync');
  check('全体OFFで全ルールセット停止', calls.rulesets.disableRulesetIds, ['ads', 'tracking']);

  console.log(failed ? `\n${failed} test(s) failed` : '\nすべて成功');
  process.exit(failed ? 1 : 0);
})();
