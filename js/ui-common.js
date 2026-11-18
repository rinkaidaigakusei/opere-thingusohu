/**
 * ui-common.js — ステップ表示・一覧表示・確認画面で共通の描画部品。
 */
(function (global) {
  'use strict';
  const SES = global.SES || (global.SES = {});

  const STATUS_LABEL = { extracted: '抽出済み', review: '要確認', unset: '未設定', edited: '修正済み', na: '不要', pending: '確認待ち' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** 文中のURLをクリックで開けるリンクにする（publicDNS のままのURLはリンクにしない） */
  function linkify(text) {
    return esc(text).replace(/https?:\/\/[^\s"'<>（）、。]+/g, (u) => {
      if (/publicDNS/.test(u)) return '<span class="url-pending" title="パブリックDNSを入力するとリンクになります">' + u + '</span>';
      return '<a href="' + u + '" target="_blank" rel="noopener noreferrer" class="ext">' + u + '</a>';
    });
  }

  function chip(status) {
    return '<span class="chip chip-' + esc(status) + '">' + esc(STATUS_LABEL[status] || status) + '</span>';
  }

  /** 変数部分をハイライトしたテキスト */
  function segments(r) {
    if (!r || !r.segments) return esc(r && r.text);
    return r.segments.map((s) => {
      if (s.t === 'text') return esc(s.v);
      const shown = s.value !== '' ? s.value : (s.status === 'na' ? '' : '‹未設定:' + s.var + '›');
      const title = s.var + '（' + (s.label || '') + '）' + (s.note ? '\n' + s.note : '');
      return '<span class="v v-' + esc(s.status) + '" title="' + esc(title) + '">' + esc(shown) + '</span>';
    }).join('');
  }

  function copyBtn(text, copyable, label, reason) {
    if (!copyable) {
      return '<button class="btn-copy" disabled title="' + esc(reason || '未設定の値を含むためコピーできません') + '">コピー不可</button>';
    }
    return '<button class="btn-copy" data-action="copy" data-copy="' + esc(text) + '">' + esc(label || 'コピー') + '</button>';
  }

  /** 単語単位の簡易差分（noteの原文と比較） */
  function diff(a, b) {
    const ta = String(a).split(/(\s+|&&)/).filter((x) => x !== '');
    const tb = String(b).split(/(\s+|&&)/).filter((x) => x !== '');
    const n = ta.length, m = tb.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0, left = '', right = '';
    while (i < n && j < m) {
      if (ta[i] === tb[j]) { left += esc(ta[i]); right += esc(tb[j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { left += '<del>' + esc(ta[i]) + '</del>'; i++; }
      else { right += '<ins>' + esc(tb[j]) + '</ins>'; j++; }
    }
    while (i < n) left += '<del>' + esc(ta[i++]) + '</del>';
    while (j < m) right += '<ins>' + esc(tb[j++]) + '</ins>';
    return '<div class="diff"><div class="diff-row"><span class="diff-label">note原文</span><code>' + left + '</code></div>' +
      '<div class="diff-row"><span class="diff-label">変更後</span><code>' + right + '</code></div></div>';
  }

  const KIND_SHORT = { bulk: '一括', individual: '個別', aux: '移動・切替', checklist: '確認' };

  /** コマンド1行分（モードに応じて一括 or 分割表示） */
  function commandLine(line, mode) {
    let html = '<div class="cmd cmd-' + esc(line.kind) + '">';
    html += '<div class="cmd-meta"><span class="kind kind-' + esc(line.kind) + '">' + esc(KIND_SHORT[line.kind] || line.kind) + '</span>';
    if (line.note) html += '<span class="cmd-note">' + esc(line.note) + '</span>';
    if (line.proposalApplied) html += '<span class="badge badge-changed">変更案を適用</span>';
    else if (line.hasProposal) html += '<span class="badge badge-warn">note原文のまま（要確認）</span>';
    html += '</div>';

    if (mode === 'staged' && line.staged && line.staged.length > 1) {
      html += '<ol class="staged">';
      line.staged.forEach((s) => {
        html += '<li><div class="cmd-row"><pre><code>' + segments(s) + '</code></pre>' + copyBtn(s.text, s.copyable) + '</div></li>';
      });
      html += '</ol>';
      html += '<div class="staged-all">' + copyBtn(line.text, line.copyable, 'noteの一括コマンドをまとめてコピー') + '</div>';
    } else {
      html += '<div class="cmd-row"><pre><code>' + segments(line) + '</code></pre>' + copyBtn(line.text, line.copyable) + '</div>';
    }
    if (line.changed) {
      html += '<details class="compare"><summary>noteの原文と比較</summary>' + diff(line.original, line.text) + '</details>';
    }
    if (!line.copyable) html += '<p class="cmd-warn">未設定の値（' + esc(line.unresolved.join(', ')) + '）があるためコピーできません。解析結果確認画面で入力してください。</p>';
    html += '</div>';
    return html;
  }

  function valueRow(item) {
    const isUrl = /^https?:\/\/\S+$/.test(item.text || '') && item.copyable !== false;
    const shown = isUrl ? linkify(item.text) : (item.secret ? '<span class="secret" data-secret="1">' + segments(item) + '</span>' : segments(item));
    return '<div class="kv"><span class="kv-label">' + esc(item.label) + '</span><span class="kv-value">' + shown + '</span>' +
      (item.text && item.copyable !== false && !/‹未設定/.test(item.text) ? copyBtn(item.text, item.copyable !== false, 'コピー') : '') + '</div>';
  }

  /**
   * 手順書の画面でその場で値を入力する欄。入力すると変数が更新され、手順書全体に即時反映される。
   * onlyOpen: 未設定・要確認の値だけ出す（一覧表示用）
   */
  function varEditor(step, onlyOpen) {
    const vars = (step.vars || []).filter((v) => !onlyOpen || v.status === 'unset' || v.status === 'review');
    if (!vars.length) return '';
    let h = '<div class="var-editor' + (onlyOpen ? ' compact' : '') + '">';
    if (!onlyOpen) h += '<div class="var-editor-head">この手順で使う値 <span class="muted small">入力するとすぐ手順書に反映されます</span></div>';
    vars.forEach((v) => {
      h += '<label class="var-row st-' + esc(v.status) + '"><span class="var-label">' + esc(v.label) + (v.secret ? ' 🔒' : '') + '<small>' + esc(v.var) + '</small></span>' +
        '<span class="var-input"><input type="text" spellcheck="false" autocomplete="off" data-action="edit-var" data-var="' + esc(v.var) + '" data-step="' + esc(step.uid) + '" value="' + esc(v.value) + '" placeholder="' + esc(v.hint || '（未入力）') + '">' +
        (v.modeHint ? '<small class="var-hint">💡 ' + esc(v.modeHint) + '</small>' : '') + '</span>' +
        chip(v.status) + '</label>';
    });
    h += '</div>';
    return h;
  }

  /**
   * 接続コマンドの貼り付け欄（1つだけ）。ssh の行からパブリックDNSを取り出すので、DNSを別に打つ必要はない。
   * 値の反映は他の入力欄と同じ edit-var（public_dns）を通る。
   */
  function connectPaste(step) {
    const val = (name) => {
      const r = (step.reference || []).find((x) => x.segments && x.segments.some((s) => s.var === name));
      return r && r.copyable ? r.text : '';
    };
    const ssh = val('ssh_command');
    const dns = val('public_dns');
    let h = '<div class="var-editor connect-paste"><div class="var-editor-head">接続コマンドを貼り付け <span class="muted small">ssh の行を貼るだけでOK（パブリックDNSは自動で取り出します）</span></div>' +
      '<input type="text" spellcheck="false" autocomplete="off" data-action="edit-var" data-var="public_dns" data-step="' + esc(step.uid) + '" value="' + esc(ssh || dns) + '" ' +
      'placeholder="ssh -i &quot;xxx.pem&quot; ec2-user@ec2-…compute-1.amazonaws.com を貼り付け">';
    h += dns
      ? '<div class="connect-result">✓ パブリックDNS：<code>' + esc(dns) + '</code>（手順書の publicDNS に反映済み）</div>'
      : '<div class="connect-result muted small">まだ貼り付けられていません</div>';
    return h + '</div>';
  }

  /** 確認用URLを開く大きいボタン（publicDNS のままなら案内だけ） */
  function checkUrlBox(c) {
    if (!c) return '';
    if (!c.text || /publicDNS/.test(c.text)) {
      return '<div class="check-url pending">' + esc(c.label) + '：<span class="url-pending">' + esc(c.text || '') + '</span><br><span class="muted small">手順書上部の「接続先」にパブリックDNS（AWSの ssh コマンド）を貼り付けると、ここが開けるリンクになります</span></div>';
    }
    return '<div class="check-url"><a class="btn btn-primary btn-lg" href="' + esc(c.text) + '" target="_blank" rel="noopener noreferrer">' + esc(c.label) + ' ↗</a>' +
      '<code>' + esc(c.text) + '</code>' + copyBtn(c.text, true, 'URLをコピー') + '</div>';
  }

  /** 画面の見え方の説明（スクリーンショット付き） */
  function guideList(guide, compact) {
    if (!guide || !guide.length) return '';
    const badge = (p) => (p ? '<span class="practice practice-' + esc(p.level) + '">' + (p.level === 'must' ? '課題でもやる' : '課題なら自由') + (p.text ? '：' + esc(p.text) : '') + '</span>' : '');
    return '<ol class="guide' + (compact ? ' compact' : '') + '">' + guide.map((g) => '<li' + (g.practice && g.practice.level === 'free' ? ' class="is-free"' : '') + '>' + badge(g.practice) + '<div>' + linkify(g.text) + '</div>' +
      (g.img ? (compact
        ? '<details><summary>画面の例</summary><img src="' + esc(g.img) + '" alt="" loading="lazy"></details>'
        : '<a href="' + esc(g.img) + '" target="_blank" rel="noopener"><img src="' + esc(g.img) + '" alt="画面の例" loading="lazy"></a>') : '') +
      '</li>').join('') + '</ol>';
  }

  /** メモ1件（editingId と一致するものは編集欄で表示） */
  function memoItem(m, editingId, showStep) {
    let h = '<li class="memo-item" data-id="' + esc(m.id) + '"><div class="memo-head"><span class="memo-time">' + esc(m.time) + '</span>';
    if (showStep && m.stepLabel) h += '<button class="link memo-step" data-action="memo-jump" data-uid="' + esc(m.stepUid) + '">' + esc(m.stepLabel) + '</button>';
    h += '<span class="spacer"></span>';
    if (editingId === m.id) {
      h += '</div><textarea class="memo-edit" rows="3" data-id="' + esc(m.id) + '">' + esc(m.text) + '</textarea>' +
        '<div class="memo-btns"><button class="btn btn-primary small-btn" data-action="memo-save" data-id="' + esc(m.id) + '">保存</button>' +
        '<button class="btn small-btn" data-action="memo-cancel">やめる</button></div></li>';
      return h;
    }
    h += '<button class="link" data-action="copy" data-copy="' + esc(m.text) + '">コピー</button>' +
      '<button class="link" data-action="memo-edit" data-id="' + esc(m.id) + '">編集</button>' +
      '<button class="link danger" data-action="memo-delete" data-id="' + esc(m.id) + '">削除</button></div>' +
      '<div class="memo-text">' + esc(m.text) + '</div></li>';
    return h;
  }

  SES.UI = { esc, linkify, chip, segments, copyBtn, diff, commandLine, valueRow, memoItem, varEditor, connectPaste, checkUrlBox, guideList, STATUS_LABEL, KIND_SHORT };
})(typeof window !== 'undefined' ? window : globalThis);
