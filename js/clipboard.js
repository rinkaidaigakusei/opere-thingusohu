/**
 * clipboard.js — コマンドのコピー。外部送信はしない（ブラウザのクリップボードのみ）。
 */
(function (global) {
  'use strict';
  const SES = global.SES || (global.SES = {});

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  async function copy(text) {
    if (navigator.clipboard && global.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fallback */ }
    }
    return fallbackCopy(text);
  }

  let toastTimer = null;
  function toast(msg, kind) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 1800);
  }

  SES.Clipboard = { copy, toast };
})(typeof window !== 'undefined' ? window : globalThis);
