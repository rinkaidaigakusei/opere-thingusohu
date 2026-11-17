/**
 * memo.js — 作業しながら逐次メモを残す機能。
 *
 * - メモは時刻と「そのとき作業していたステップ」を付けて、追加した順に並ぶ
 * - MySQLの初期パスワードなどを書くことがあるため、localStorage（永続）には保存しない。
 *   sessionStorage に置くので、リロードしても残り、ブラウザのタブを閉じると消える
 */
(function (global) {
  'use strict';
  const SES = global.SES || (global.SES = {});
  const KEY = 'ses-memo';

  function store() {
    try { return global.sessionStorage || null; } catch (e) { return null; }
  }

  let entries = [];
  (function load() {
    const s = store();
    if (!s) return;
    try { entries = JSON.parse(s.getItem(KEY) || '[]') || []; } catch (e) { entries = []; }
  })();

  function persist() {
    const s = store();
    if (s) s.setItem(KEY, JSON.stringify(entries));
  }

  function now() {
    const d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function add(text, step) {
    text = String(text || '').replace(/\s+$/, '');
    if (!text.trim()) return null;
    const e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), time: now(), text, stepUid: step ? step.uid : null, stepLabel: step ? step.label : '' };
    entries.push(e);
    persist();
    return e;
  }

  function update(id, text) {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    e.text = text;
    persist();
  }

  function remove(id) {
    entries = entries.filter((x) => x.id !== id);
    persist();
  }

  function clearAll() {
    entries = [];
    persist();
  }

  function all() { return entries.slice(); }
  function forStep(uid) { return entries.filter((x) => x.stepUid === uid); }

  function asText() {
    return entries.map((e) => '[' + e.time + (e.stepLabel ? ' ' + e.stepLabel : '') + ']\n' + e.text).join('\n\n');
  }

  SES.Memo = { add, update, remove, clearAll, all, forStep, asText };
})(typeof window !== 'undefined' ? window : globalThis);
