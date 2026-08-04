// 学生端更新通知。内容来自同目录 release-notes.json；网络失败时静默跳过。
(function () {
  'use strict';

  function addText(parent, tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function showUpdate(info) {
    const seenKey = 'flash_update_seen_' + (window.DECK_SLUG || 'deck');
    try { if (localStorage.getItem(seenKey) === String(info.version)) return; } catch (e) {}
    const old = document.getElementById('updateOverlay');
    if (old) old.remove();
    if (!document.getElementById('updateOverlayStyle')) {
      const style = document.createElement('style');
      style.id = 'updateOverlayStyle';
      style.textContent = '#updateOverlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}.ub-back{position:absolute;inset:0;background:rgba(0,0,0,.55)}.ub-card{position:relative;background:#fff;padding:26px 24px;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);width:min(440px,92vw)}.ub-title{font-size:20px;font-weight:800;color:#1f2937;margin:0 0 14px}.ub-notes{margin:0 0 20px;padding-left:20px;color:#374151;font-size:15px;line-height:1.7}.ub-actions{display:flex;gap:12px;justify-content:flex-end}.ub-actions button{padding:11px 18px;border:0;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}.ub-later{background:#f3f4f6;color:#4b5563}.ub-refresh{background:#4f46e5;color:#fff}';
      document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.id = 'updateOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'updateTitle');
    const backdrop = document.createElement('div');
    backdrop.className = 'ub-back';
    const card = document.createElement('div');
    card.className = 'ub-card';
    const title = addText(card, 'div', 'ub-title', info.title || '闪卡已更新');
    title.id = 'updateTitle';
    const list = document.createElement('ul');
    list.className = 'ub-notes';
    const notes = Array.isArray(info.notes) ? info.notes : [info.notes || ''];
    notes.filter(Boolean).forEach(function (note) { addText(list, 'li', '', String(note)); });
    card.appendChild(list);
    const actions = document.createElement('div');
    actions.className = 'ub-actions';
    const later = addText(actions, 'button', 'ub-later', '稍后再说');
    const refresh = addText(actions, 'button', 'ub-refresh', '立即刷新');
    later.type = refresh.type = 'button';
    card.appendChild(actions);
    overlay.appendChild(backdrop);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    later.onclick = function () { overlay.remove(); };
    refresh.onclick = function () {
      try { localStorage.setItem(seenKey, String(info.version)); } catch (e) {}
      location.reload();
    };
    refresh.focus();
  }

  async function checkForUpdate() {
    try {
      const response = await fetch('./release-notes.json?_=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) return;
      const info = await response.json();
      if (info && info.version) showUpdate(info);
    } catch (e) {}
  }

  window.__checkForUpdate = checkForUpdate;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkForUpdate);
  else checkForUpdate();
})();
