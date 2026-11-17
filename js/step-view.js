/**
 * step-view.js — ステップ表示（作業を1つずつ順番に進める表示）。
 */
(function (global) {
  'use strict';
  const SES = global.SES || (global.SES = {});
  const UI = SES.UI;

  function stepCard(step, section, opts) {
    const e = UI.esc;
    const done = opts.done;
    let h = '<article class="step-card' + (done ? ' is-done' : '') + (step.unregistered ? ' is-unregistered' : '') + '" data-step="' + e(step.uid) + '">';
    h += '<header class="step-head">';
    h += '<div class="step-pos">' + e(section.name) + ' ／ Step ' + (opts.index + 1) + ' / ' + opts.total + '</div>';
    h += '<h3>' + e(step.title) + (step.optional ? ' <span class="badge">任意</span>' : '') + '</h3>';
    h += '<div class="step-tags"><span class="kind kind-' + e(step.kind) + '">' + e(step.kindLabel || '') + '</span>';
    if (step.unregistered) h += '<span class="badge badge-warn">テンプレート未登録</span>';
    h += '</div></header>';

    h += '<dl class="step-meta">';
    h += '<div><dt>実行するユーザー</dt><dd>' + e(step.runAs) + '</dd></div>';
    h += '<div><dt>作業ディレクトリ</dt><dd>' + e(step.workdir) + '</dd></div>';
    h += '<div><dt>前提条件</dt><dd>' + e(step.prerequisites) + '</dd></div>';
    h += '</dl>';

    if (step.unregistered) {
      h += '<div class="notice notice-warn">この課題（作業）に対応するnote由来のコマンドテンプレートはまだ登録されていません。<br>' +
        '課題の検出：完了 ／ 設定値の抽出：可能な範囲で実施 ／ 手順書：テンプレート未登録 ／ コマンド：未設定</div>';
    }
    step.cautions.forEach((c) => { h += '<div class="notice notice-warn">' + e(c) + '</div>'; });
    h += UI.varEditor(step, false);

    if (step.lines.length) {
      h += '<section class="step-sec"><h4>実行するコマンド</h4>';
      step.lines.forEach((l) => { h += UI.commandLine(l, opts.mode); });
      h += '</section>';
    }
    if (step.inputs.length) {
      h += '<section class="step-sec"><h4>入力する値</h4>';
      step.inputs.forEach((i) => { h += UI.valueRow(i); });
      h += '</section>';
    }
    if (step.editInstructions.length) {
      h += '<section class="step-sec"><h4>編集内容（note記載）</h4><ol class="edit-list">';
      step.editInstructions.forEach((x) => { h += '<li>' + UI.segments(x) + '</li>'; });
      h += '</ol></section>';
    }
    if (step.fileContent) {
      h += '<section class="step-sec"><h4>' + e(step.fileContent.label) + '</h4><div class="cmd-row"><pre class="file"><code>' + UI.segments(step.fileContent) + '</code></pre>' +
        UI.copyBtn(step.fileContent.text, step.fileContent.copyable, 'コピー', '「学籍番号」などが未入力です') + '</div></section>';
    }
    if (step.checkUrl) h += '<section class="step-sec"><h4>確認するページ</h4>' + UI.checkUrlBox(step.checkUrl) + '</section>';
    if (step.guide && step.guide.length) h += '<section class="step-sec"><h4>操作ガイド（画面の見え方）</h4>' + UI.guideList(step.guide, false) + '</section>';
    if (step.reference.length) {
      h += '<section class="step-sec"><h4>設定値</h4>';
      step.reference.forEach((x) => { h += UI.valueRow(x); });
      h += '</section>';
    }
    if (step.notes.length) {
      h += '<section class="step-sec"><h4>注意事項</h4><ul class="notes">';
      step.notes.forEach((n) => { h += '<li>' + UI.linkify(n) + '</li>'; });
      h += '</ul></section>';
    }
    h += '<section class="step-sec"><h4>完了確認方法</h4><p>' + UI.linkify(step.verify) + '</p></section>';
    if (step.source) {
      h += '<details class="source"><summary>元記事の参照箇所・変更履歴</summary><p>' + e(step.source) + '</p><ul>' +
        step.history.map((x) => '<li>' + e(x.date) + '：' + e(x.change) + '</li>').join('') + '</ul></details>';
    }
    if (SES.Memo) {
      const memos = SES.Memo.forStep(step.uid);
      h += '<section class="step-sec step-memo"><h4>このステップのメモ</h4>';
      if (memos.length) h += '<ul class="memo-list">' + memos.map((m) => UI.memoItem(m, opts.editingMemo, false)).join('') + '</ul>';
      h += '<div class="memo-add"><textarea rows="2" class="memo-input" data-memo-step="' + e(step.uid) + '" placeholder="例：初期パスワード、パブリックDNS、エラー内容など（Ctrl+Enterで追加）"></textarea>' +
        '<button class="btn" data-action="memo-add-step" data-uid="' + e(step.uid) + '">メモを追加</button></div></section>';
    }
    h += '<label class="done-check big"><input type="checkbox" data-action="toggle-step" data-uid="' + e(step.uid) + '"' + (done ? ' checked' : '') + '> このステップを完了した</label>';
    h += '</article>';
    return h;
  }

  /** flat: [{step, section}] */
  function render(container, flat, current, opts) {
    const e = UI.esc;
    if (!flat.length) { container.innerHTML = '<p class="empty">表示するステップがありません。</p>'; return; }
    current = Math.max(0, Math.min(current, flat.length - 1));
    let nav = '<nav class="step-index" aria-label="ステップ一覧">';
    let lastSec = null;
    flat.forEach((x, i) => {
      if (x.section.uid !== lastSec) {
        if (lastSec !== null) nav += '</ol>';
        nav += '<div class="idx-sec">' + e(x.section.name) + '</div><ol>';
        lastSec = x.section.uid;
      }
      const done = opts.isDone(x);
      nav += '<li class="' + (i === current ? 'current ' : '') + (done ? 'done' : '') + '"><button data-action="goto-step" data-index="' + i + '">' +
        '<span class="mark">' + (done ? '✓' : '') + '</span>' + e(x.step.title) + '</button></li>';
    });
    nav += '</ol></nav>';

    const cur = flat[current];
    const sectionSteps = flat.filter((x) => x.section.uid === cur.section.uid);
    let main = '<div class="step-main">';
    main += stepCard(cur.step, cur.section, { mode: opts.mode, done: opts.isDone(cur), editingMemo: opts.editingMemo, index: sectionSteps.indexOf(cur), total: sectionSteps.length });
    main += '<div class="step-nav">' +
      '<button class="btn" data-action="goto-step" data-index="' + (current - 1) + '"' + (current === 0 ? ' disabled' : '') + '>← 前へ</button>' +
      '<button class="btn" data-action="next-undone">次の未完了へ</button>' +
      '<button class="btn btn-primary" data-action="goto-step" data-index="' + (current + 1) + '"' + (current === flat.length - 1 ? ' disabled' : '') + '>次へ →</button>' +
      '</div></div>';
    container.innerHTML = '<div class="step-layout">' + nav + main + '</div>';
    const curBtn = container.querySelector('.step-index li.current');
    if (curBtn && curBtn.scrollIntoView) curBtn.scrollIntoView({ block: 'nearest' });
  }

  SES.StepView = { render, stepCard };
})(typeof window !== 'undefined' ? window : globalThis);
