/**
 * progress.js — 作業の完了チェックと進捗の管理。
 * 保存するのは「どのステップを完了したか」「どの相違を承認したか」だけで、
 * パスワード等の設定値は保存しない（試験ごとのキーで localStorage に分離して保存）。
 */
(function (global) {
  'use strict';
  const SES = global.SES || (global.SES = {});
  const PREFIX = 'ses-progress:';

  function storage() {
    try { return global.localStorage || null; } catch (e) { return null; }
  }

  function load(examKey) {
    const s = storage();
    let data = null;
    if (s) { try { data = JSON.parse(s.getItem(PREFIX + examKey) || 'null'); } catch (e) { data = null; } }
    return Object.assign({ done: {}, confirmations: {} }, data || {});
  }

  function save(examKey, prog) {
    const s = storage();
    if (!s) return;
    // 念のため、保存するキーを限定する（値は真偽値のみ）
    const clean = { done: {}, confirmations: {}, updated: new Date().toISOString() };
    Object.keys(prog.done || {}).forEach((k) => { if (prog.done[k]) clean.done[k] = true; });
    Object.keys(prog.confirmations || {}).forEach((k) => { if (prog.confirmations[k]) clean.confirmations[k] = true; });
    s.setItem(PREFIX + examKey, JSON.stringify(clean));
  }

  function clear(examKey) {
    const s = storage();
    if (s) s.removeItem(PREFIX + examKey);
  }

  /** ステップの完了判定（一括コマンドと段階コマンドの対応も考慮） */
  function isDone(step, section, prog) {
    if (prog.done[step.uid]) return true;
    if (step.coveredBy && prog.done[step.coveredBy]) return true;
    const covered = section.steps.filter((s) => s.coveredBy === step.uid);
    if (covered.length && covered.every((s) => prog.done[s.uid])) return true;
    return false;
  }

  function sectionStatus(section, steps, prog) {
    const total = steps.length;
    const done = steps.filter((s) => isDone(s, section, prog)).length;
    let status = 'todo';
    if (total && done === total) status = 'done';
    else if (done > 0) status = 'doing';
    return { total, done, status, label: { todo: '未着手', doing: '進行中', done: '完了' }[status] };
  }

  SES.Progress = { load, save, clear, isDone, sectionStatus };
})(typeof window !== 'undefined' ? window : globalThis);
