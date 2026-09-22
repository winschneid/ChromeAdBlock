/**
 * Simple Ad Blocker - content script (document_start, all frames)
 *
 * 1. ホワイトリスト/機能OFFなら <html> に .abw-allow を付けて hide.css を丸ごと無効化する。
 * 2. それ以外では、ブロック済み広告の「空になった親要素」を畳んで余白を消す。
 */

const DEFAULTS = {
  enabled: true,
  cosmetic: true,
  whitelist: []
};

/** ブロック対象ドメインを src に持つ iframe の判定用 */
const AD_IFRAME_SRC = /(doubleclick\.net|googlesyndication\.com|googleadservices\.com|amazon-adsystem\.com|adnxs\.com|criteo|taboola|outbrain|i-mobile\.co\.jp|microad|socdm\.com)/i;

/** 広告コンテナっぽい id / class */
const AD_CONTAINER_HINT = /(^|[-_])(ads?|advert|advertisement|banner)([-_]|$)/i;

function isWhitelisted(host, whitelist) {
  const target = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!target) return false;
  return whitelist.some((entry) => target === entry || target.endsWith('.' + entry));
}

/** 中身が空になった広告枠を畳む(高さ指定だけ残って隙間が空くのを防ぐ) */
function collapseEmptyAdContainers(root) {
  const candidates = root.querySelectorAll(
    'ins.adsbygoogle, div[id^="div-gpt-ad"], div[id^="google_ads_"], div[data-ad-slot], iframe'
  );

  for (const el of candidates) {
    if (el.tagName === 'IFRAME' && !AD_IFRAME_SRC.test(el.src || '')) continue;

    let parent = el.parentElement;
    let depth = 0;

    // 広告要素の直近の「広告っぽい」祖先を最大3階層だけ遡って畳む
    while (parent && depth < 3) {
      const marker = `${parent.id || ''} ${parent.className || ''}`;
      if (typeof parent.className === 'string' && AD_CONTAINER_HINT.test(marker)) {
        parent.style.setProperty('display', 'none', 'important');
        break;
      }
      parent = parent.parentElement;
      depth += 1;
    }
  }
}

(async () => {
  let cfg;
  try {
    cfg = await chrome.storage.sync.get(DEFAULTS);
  } catch {
    return; // 拡張のコンテキストが失われた場合は何もしない
  }

  const whitelist = Array.isArray(cfg.whitelist) ? cfg.whitelist : [];

  // フレーム自身のホストではなく、トップページのホストで判定する
  // (トップがホワイトリストなら、その中の広告フレームも許可する)
  let host = location.hostname;
  try {
    if (window.top !== window.self && document.referrer) {
      host = new URL(document.referrer).hostname;
    }
  } catch {
    /* クロスオリジンで参照できない場合は自分のホストのまま */
  }

  const allow = !cfg.enabled || !cfg.cosmetic || isWhitelisted(host, whitelist);

  if (allow) {
    document.documentElement.classList.add('abw-allow');
    return;
  }

  const run = () => collapseEmptyAdContainers(document);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }

  // 遅延読み込みされる広告枠にも対応する(過剰に走らないよう間引く)
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      run();
    }, 500);
  });

  const startObserving = () => {
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.body) startObserving();
  else document.addEventListener('DOMContentLoaded', startObserving, { once: true });
})();
