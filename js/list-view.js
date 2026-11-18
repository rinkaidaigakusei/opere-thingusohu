/**
 * list-view.js — 一覧表示（全作業を課題ごとに折りたたみで確認する表示）。
 */
(function (global) {
  'use strict';
  const SES = global.SES || (global.SES = {});
  const UI = SES.UI;

  function render(container, sections, opts) {
    const e = UI.esc;
    let h = '';
    sections.forEach((sec) => {
      const steps = opts.stepsOf(sec);
      const st = opts.status(sec, steps);
      h += '<details class="list-sec" ' + (opts.openSections[sec.uid] === false ? '' : 'open') + ' data-sec="' + e(sec.uid) + '">';
      h += '<summary><span class="sec-name">' + e(sec.name) + '</span><span class="st st-' + st.status + '">' + e(st.label) + ' ' + st.done + '/' + st.total + '</span>' +
        (sec.unregistered ? '<span class="badge badge-warn">テンプレート未登録</span>' : '') + '</summary>';
      steps.forEach((step, i) => {
        const done = opts.isDone(step, sec);
        h += '<div class="list-step' + (done ? ' is-done' : '') + '">';
        h += '<div class="list-step-head"><label class="done-check"><input type="checkbox" data-action="toggle-step" data-uid="' + e(step.uid) + '"' + (done ? ' checked' : '') + '>' +
          '<span>' + (i + 1) + '. ' + e(step.title) + '</span></label>' +
          '<span class="list-meta">' + e(step.runAs) + ' ｜ ' + e(step.workdir) + '</span>' +
          '<button class="link" data-action="open-step" data-uid="' + e(step.uid) + '">詳細</button></div>';
        if (step.unregistered) h += '<p class="muted">note由来のコマンドテンプレートは未登録です。</p>';
        if ((step.kind === 'checklist' || step.unregistered) && step.notes.length) h += '<ul class="notes small muted">' + step.notes.map((n) => '<li>' + e(n) + '</li>').join('') + '</ul>';
        if (step.practiceNote) h += '<div class="notice notice-practice small">📚 課題・練習：' + e(step.practiceNote) + '</div>';
        step.cautions.forEach((c) => { h += '<div class="notice notice-warn small">' + e(c) + '</div>'; });
        h += UI.varEditor(step, true);
        if (step.connectPaste) h += UI.connectPaste(step);
        step.lines.forEach((l) => { h += UI.commandLine(l, opts.mode); });
        step.inputs.forEach((x) => { h += UI.valueRow(x); });
        if (step.editInstructions.length) h += '<ol class="edit-list small">' + step.editInstructions.map((x) => '<li>' + UI.segments(x) + '</li>').join('') + '</ol>';
        if (step.fileContent) h += '<div class="kv"><span class="kv-label">' + e(step.fileContent.label) + '</span></div><div class="cmd-row"><pre class="file"><code>' + UI.segments(step.fileContent) + '</code></pre>' + UI.copyBtn(step.fileContent.text, step.fileContent.copyable) + '</div>';
        if (step.checkUrl) h += UI.checkUrlBox(step.checkUrl);
        if (step.guide && step.guide.length) h += UI.guideList(step.guide, true);
        if (step.reference.length && step.kind !== 'checklist' && !step.unregistered) step.reference.forEach((x) => { h += UI.valueRow(x); });
        if (step.reference.length && (step.kind === 'checklist' || step.unregistered)) h += '<div class="ref-grid">' + step.reference.map((x) => UI.valueRow(x)).join('') + '</div>';
        h += '</div>';
      });
      h += '</details>';
    });
    container.innerHTML = h || '<p class="empty">表示する作業がありません。</p>';
  }

  SES.ListView = { render };
})(typeof window !== 'undefined' ? window : globalThis);
