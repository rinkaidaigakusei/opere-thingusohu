/**
 * app.js — 画面遷移とイベント処理。
 * 流れ: 問題文入力 → 解析 → 解析結果の確認・修正 → 手順書を生成 → ステップ/一覧表示 → 完了チェック
 */
(function () {
  'use strict';
  const { Parser, VariableManager: VM, TemplateEngine: TE, StepView, ListView, Progress, Clipboard, UI, Memo } = window.SES;
  const e = UI.esc;

  const TEMPLATE_FILES = ['aws', 'lamp', 'user-directory', 'basic-auth', 'wordpress', 'jupyter', 'docker'];
  const UI_KEY = 'ses-ui';

  const state = {
    defs: null,
    templates: null,
    model: null,
    plan: null, // 確認画面用（編集のたびに再計算）
    finalPlan: null, // 「手順書を生成」で確定したもの
    prog: { done: {}, confirmations: {} },
    reviewed: false,
    dirty: false, // 生成後に値が変更された
    mode: 'bulk',
    view: 'step',
    current: 0,
    openSections: {},
    editingMemo: null,
  };

  // ------------------------------------------------------------------
  // 初期化
  // ------------------------------------------------------------------
  async function loadData() {
    const get = (p) => fetch(p, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); });
    state.defs = await get('data/tasks.json');
    const files = await Promise.all(TEMPLATE_FILES.map((n) => get('data/templates/' + n + '.json')));
    state.templates = TE.indexTemplates(files);
  }

  function loadUiPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      if (p.mode === 'bulk' || p.mode === 'staged') state.mode = p.mode;
      if (p.view === 'step' || p.view === 'list') state.view = p.view;
    } catch (err) { /* ignore */ }
  }
  function saveUiPrefs() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ mode: state.mode, view: state.view })); } catch (err) { /* ignore */ }
  }

  // ------------------------------------------------------------------
  // 画面遷移
  // ------------------------------------------------------------------
  function goto(screen) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + screen));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.screen === screen));
    if (screen === 'review' && state.model) renderReview();
    if (screen === 'procedure') renderProcedure();
    if (screen === 'progress') renderProgress();
    renderMemo();
    window.scrollTo(0, 0);
  }

  function enableTabs() {
    const tab = (s) => document.querySelector('.tab[data-screen="' + s + '"]');
    tab('review').disabled = !state.model;
    tab('procedure').disabled = !state.finalPlan;
    tab('progress').disabled = !state.finalPlan;
  }

  // ------------------------------------------------------------------
  // 画面1 → 解析
  // ------------------------------------------------------------------
  function doParse() {
    const text = document.getElementById('problem-text').value;
    if (!text.trim()) { Clipboard.toast('問題文を貼り付けてください', 'warn'); return; }
    if (!state.defs) { Clipboard.toast('データを読み込めていません', 'warn'); return; }
    startModel(Parser.parse(text));
  }

  /** 手入力モード：選んだ課題だけの空の設定画面を作る */
  function doManual() {
    if (!state.defs) { Clipboard.toast('データを読み込めていません', 'warn'); return; }
    const checked = (type) => { const el = document.querySelector('[data-manual="' + type + '"]'); return el && el.checked; };
    const sel = [];
    ['lamp', 'userdir', 'basic', 'wordpress', 'jupyter'].forEach((t) => { if (checked(t)) sel.push({ type: t }); });
    const extra = Math.max(0, Math.min(5, Number(document.getElementById('manual-wp-extra').value) || 0));
    for (let i = 0; i < extra; i++) sel.push({ type: 'wordpress' });
    ['wpadmin_basic', 'docker_mysql', 'docker_other'].forEach((t) => { if (checked(t)) sel.push({ type: t }); });
    if (!sel.length) { Clipboard.toast('課題を1つ以上選んでください', 'warn'); return; }
    startModel(Parser.createManual(sel, state.defs));
  }

  function startModel(parsed) {
    state.model = VM.build(parsed, state.defs);
    state.prog = Progress.load(parsed.examKey);
    state.finalPlan = null;
    state.reviewed = false;
    state.dirty = false;
    state.current = 0;
    recompute();
    renderReview();
    enableTabs();
    goto('review');
  }

  function recompute() {
    state.plan = TE.buildPlan(state.model, state.defs, state.templates, { confirmations: state.prog.confirmations });
  }

  // ------------------------------------------------------------------
  // 画面2：解析結果確認
  // ------------------------------------------------------------------
  function fieldRow(task, key) {
    const f = task.fields[key];
    const v = VM.get(state.model, task, key);
    const input = f.multiline
      ? '<textarea rows="3" data-action="edit" data-task="' + e(task.uid) + '" data-key="' + e(key) + '">' + e(v.value) + '</textarea>'
      : '<input type="text" spellcheck="false" autocomplete="off" data-action="edit" data-task="' + e(task.uid) + '" data-key="' + e(key) + '" value="' + e(v.value) + '" placeholder="（未入力）">';
    const src = [];
    if (f.hint) src.push('<span class="src">' + e(f.hint) + '</span>');
    if (f.source && !f.derived) src.push('<span class="src" title="問題文の該当箇所">問題文：「' + e(f.source) + '」</span>');
    if (v.note) src.push('<span class="note">' + e(v.note) + '</span>');
    return '<tr class="frow st-' + e(v.status) + '"><th>' + e(f.label) + (f.secret ? ' <span class="lock" title="パスワード：保存・送信しません">🔒</span>' : '') + '<div class="var">' + e(f.var) + '</div></th>' +
      '<td class="fval">' + input + '</td><td class="fst">' + UI.chip(v.status) + '</td>' +
      '<td class="fsrc">' + src.join('') + '</td>' +
      '<td class="fact">' + (f.edited ? '<button class="link" data-action="reset-field" data-task="' + e(task.uid) + '" data-key="' + e(key) + '">元に戻す</button>' : '') + '</td></tr>';
  }

  function fieldTable(task) {
    const keys = Object.keys(task.fields);
    if (!keys.length) return '<p class="muted">抽出する設定値がありません。</p>';
    return '<table class="ftable"><tbody>' + keys.map((k) => fieldRow(task, k)).join('') + '</tbody></table>';
  }

  function mismatchHtml(m) {
    let h = '<div class="mismatch' + (m.confirmed ? ' is-confirmed' : '') + '">';
    h += '<h4>' + e(m.title) + ' ' + (m.confirmed ? '<span class="chip chip-edited">確認済み</span>' : '<span class="chip chip-review">未確認</span>') + '</h4>';
    h += '<dl class="mm"><div><dt>1. note記事の元の内容</dt><dd>' + e(m.note) + '</dd></div>' +
      '<div><dt>2. 試験問題の指定</dt><dd>' + e(m.exam) + '</dd></div>' +
      '<div><dt>3. 相違点</dt><dd>' + e(m.diff) + '</dd></div>' +
      '<div><dt>4. 変更が必要か</dt><dd>' + e(m.needChange) + '</dd></div>' +
      '<div><dt>5. 確認状態</dt><dd>' + (m.confirmed ? (m.type === 'info' ? '確認済み' : '承認済み（手順書に反映）') : '未確認（' + (m.type === 'info' ? '手順書には未登録として表示' : 'noteの元の内容のまま') + '）') + '</dd></div></dl>';
    if (m.type === 'proposal') h += UI.diff(m.original, m.proposed);
    const label = m.type === 'info' ? '確認しました' : (m.type === 'proposal' ? 'この変更案を承認して反映' : '試験の値で置き換えることを承認');
    h += m.confirmed
      ? '<button class="btn" data-action="unconfirm" data-id="' + e(m.id) + '">承認を取り消す</button>'
      : '<button class="btn btn-primary" data-action="confirm" data-id="' + e(m.id) + '">' + e(label) + '</button>';
    h += '</div>';
    return h;
  }

  function renderReview() {
    const m = state.model;
    const sum = VM.summary(m);
    const scrollY = window.scrollY;
    let h = '<h2>解析結果の確認・修正</h2>';
    h += '<p class="lead">' + e(m.examTitle || '（タイトル不明）') + '</p>';
    h += '<div class="summary">' + ['extracted', 'edited', 'review', 'unset', 'na'].map((s) => UI.chip(s) + ' ' + sum[s]).join('　') + '</div>';
    h += m.manual
      ? '<p class="muted small">手入力モードです。各欄に値を入力してください（入力欄から離れると反映されます）。「未設定」の欄を含むコマンドはコピーできません。</p>'
      : '<p class="muted small">値は直接編集できます。「要確認」「未設定」の項目を中心に確認してください。問題文に書かれていない値は補完していません。</p>';
    m.warnings.forEach((w) => { h += '<div class="notice notice-warn">' + e(w) + '</div>'; });

    // 検出された課題
    h += '<div class="card"><h3>検出された課題</h3><div class="task-chips">';
    m.tasks.forEach((t) => {
      const def = state.defs.types[t.type] || {};
      h += '<span class="task-chip' + (def.unregistered ? ' unreg' : '') + '">課題' + t.number + '：' + e(t.typeName) + (t.isExtra ? '（追加）' : '') + (def.unregistered ? '<small>テンプレート未登録</small>' : '') + '</span>';
    });
    h += '</div></div>';

    // 受験者情報
    h += '<div class="card"><h3>' + e(state.defs.profile.name) + '</h3><p class="muted small">入力は任意です。入力するまで「学籍番号」を含む値は未設定・要確認のままになります。保存はしません。</p>' + fieldTable(m.profile) + '</div>';
    h += '<div class="card"><h3>サーバ基本情報</h3>' + fieldTable(m.server) + '</div>';

    m.tasks.forEach((t) => {
      const def = state.defs.types[t.type] || {};
      h += '<div class="card"><h3>課題' + t.number + '：' + e(t.typeName) + (t.isExtra ? '（追加）' : '') + ' <small class="muted">' + e(t.title) + (t.points ? '（' + e(t.points) + '）' : '') + '</small>' +
        (def.unregistered ? ' <span class="badge badge-warn">テンプレート未登録</span>' : '') + '</h3>';
      h += fieldTable(t);
      h += (t.rawText ? '<details class="rawtext"><summary>この課題の問題文</summary><pre>' + e(t.rawText) + '</pre></details>' : '') + '</div>';
    });

    // noteとの相違
    const mms = state.plan.mismatches;
    h += '<div class="card"><h3>noteと試験問題の相違 <small class="muted">' + mms.filter((x) => !x.confirmed).length + '件 未確認</small></h3>';
    h += mms.length ? mms.map(mismatchHtml).join('') : '<p class="muted">相違は見つかりませんでした。</p>';
    h += '</div>';

    // 生成
    h += '<div class="card generate"><label class="done-check"><input type="checkbox" id="reviewed"' + (state.reviewed ? ' checked' : '') + ' data-action="reviewed"> 抽出結果を確認しました</label>';
    if (state.finalPlan && state.dirty) h += '<div class="notice notice-warn">手順書の生成後に値が変更されています。反映するには再生成してください。</div>';
    h += '<button class="btn btn-primary btn-lg" data-action="generate"' + (state.reviewed ? '' : ' disabled') + '>' + (state.finalPlan ? '手順書を再生成' : '手順書を生成') + '</button></div>';

    document.getElementById('review').innerHTML = h;
    window.scrollTo(0, scrollY);
  }

  // ------------------------------------------------------------------
  // 画面3：手順書
  // ------------------------------------------------------------------
  function stepsOf(sec) { return TE.stepsForMode(sec, state.mode); }

  function flatSteps() {
    const flat = [];
    state.finalPlan.sections.forEach((sec) => stepsOf(sec).forEach((step) => flat.push({ step, section: sec })));
    return flat;
  }

  function isDoneFlat(x) { return Progress.isDone(x.step, x.section, state.prog); }

  function renderMini() {
    const flat = flatSteps();
    const done = flat.filter(isDoneFlat).length;
    const pct = flat.length ? Math.round((done / flat.length) * 100) : 0;
    document.getElementById('mini-bar').style.width = pct + '%';
    document.getElementById('mini-text').textContent = '進捗 ' + pct + '%（' + done + '/' + flat.length + '）';
  }

  function renderProcedure() {
    if (!state.finalPlan) return;
    document.querySelectorAll('[data-action="set-view"]').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    document.querySelectorAll('[data-action="set-mode"]').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    document.getElementById('mode-help').textContent = state.mode === 'bulk'
      ? '一括実行モード：noteの連結コマンド（&&）をそのまま表示します。1回のコピーで複数の処理を実行できますが、時間がかかることがあります。'
      : '段階実行モード：連結コマンドを作業単位に分けて表示します（順番はnoteと同じ）。少しずつ実行して確認できます。';

    renderConnBar();
    const pending = state.finalPlan.mismatches.filter((m) => !m.confirmed);
    let banner = '';
    if (state.dirty) banner += '<div class="notice notice-warn">解析結果が変更されています。反映するには「解析結果確認」で手順書を再生成してください。</div>';
    if (pending.length) banner += '<div class="notice notice-warn">noteと試験問題の相違が ' + pending.length + ' 件 未確認です（該当箇所はnoteの元の内容のまま表示しています）。<button class="link" data-action="goto" data-screen="review">確認する</button></div>';
    document.getElementById('procedure-banner').innerHTML = banner;

    const container = document.getElementById('procedure');
    if (state.view === 'step') {
      const flat = flatSteps();
      if (state.current >= flat.length) state.current = Math.max(0, flat.length - 1);
      StepView.render(container, flat, state.current, { mode: state.mode, isDone: isDoneFlat, editingMemo: state.editingMemo });
    } else {
      ListView.render(container, state.finalPlan.sections, {
        mode: state.mode,
        stepsOf,
        status: (sec, steps) => Progress.sectionStatus(sec, steps, state.prog),
        isDone: (step, sec) => Progress.isDone(step, sec, state.prog),
        openSections: state.openSections,
      });
    }
    renderMini();
    renderMemoLinkState();
  }

  /** 接続先（パブリックDNS）の入力欄。入れると手順書の publicDNS がすべて置き換わる */
  function renderConnBar() {
    const m = state.model;
    const dns = VM.get(m, m.server, 'public_dns').value;
    const chmod = VM.get(m, m.server, 'ssh_chmod').value;
    const ssh = VM.get(m, m.server, 'ssh_command').value;
    let h = '<label class="conn-row"><span class="conn-label">接続先（パブリックDNS）</span>' +
      '<input type="text" spellcheck="false" autocomplete="off" data-action="edit-var" data-var="public_dns" data-step="conn" value="' + e(dns) + '" ' +
      'placeholder="AWSの「接続方法」の ssh コマンド（またはターミナルの出力）をそのまま貼り付け"></label>';
    if (dns) {
      const root = 'http://' + dns + '/';
      h += '<div class="conn-info">' + UI.linkify(root) + ' <span class="muted small">← 手順書の「publicDNS」はすべてこのアドレスに置き換わっています</span>' + UI.copyBtn(root, true, 'URLをコピー') + '</div>';
    } else {
      h += '<div class="conn-info muted small">入力すると、Apacheの確認（It works!）・phpMyAdmin・各課題の投稿URLなどが実際のアドレスのリンクになります。</div>';
    }
    if (chmod || ssh) {
      h += '<div class="conn-cmds">';
      if (chmod) h += '<div class="cmd-row"><pre><code>' + e(chmod) + '</code></pre>' + UI.copyBtn(chmod, true) + '</div>';
      if (ssh) h += '<div class="cmd-row"><pre><code>' + e(ssh) + '</code></pre>' + UI.copyBtn(ssh, true) + '</div>';
      h += '<p class="muted small">貼り付けたAWSの接続コマンド（再接続用）</p></div>';
    }
    document.getElementById('conn-bar').innerHTML = h;
  }

  // ------------------------------------------------------------------
  // 画面4：進捗
  // ------------------------------------------------------------------
  function renderProgress() {
    if (!state.finalPlan) return;
    const flat = flatSteps();
    const done = flat.filter(isDoneFlat).length;
    const pct = flat.length ? Math.round((done / flat.length) * 100) : 0;
    let h = '<h2>進捗確認</h2><p class="muted small">表示中の実行方式（' + (state.mode === 'bulk' ? '一括実行' : '段階実行') + '）のステップで集計しています。進捗はこのブラウザに保存されます（パスワード等の値は保存しません）。</p>';
    h += '<div class="card"><div class="big-progress"><div class="bar"><span style="width:' + pct + '%"></span></div><strong>' + pct + '%</strong> <span class="muted">' + done + ' / ' + flat.length + ' ステップ完了</span></div></div>';
    h += '<div class="card"><h3>課題ごとの進捗</h3><table class="ptable"><tbody>';
    state.finalPlan.sections.forEach((sec) => {
      const st = Progress.sectionStatus(sec, stepsOf(sec), state.prog);
      const p = st.total ? Math.round((st.done / st.total) * 100) : 0;
      h += '<tr><th>' + e(sec.name) + (sec.unregistered ? ' <span class="badge badge-warn">未登録</span>' : '') + '</th><td><span class="st st-' + st.status + '">' + st.label + '</span></td>' +
        '<td class="pbar"><div class="bar"><span style="width:' + p + '%"></span></div></td><td>' + st.done + '/' + st.total + '</td></tr>';
    });
    h += '</tbody></table></div>';
    const undone = flat.map((x, i) => Object.assign({ i }, x)).filter((x) => !isDoneFlat(x));
    h += '<div class="card"><h3>未完了の作業（' + undone.length + '）</h3>';
    h += undone.length ? '<ul class="undone">' + undone.map((x) => '<li><button class="link" data-action="jump" data-index="' + x.i + '">' + e(x.section.name) + ' ／ ' + e(x.step.title) + '</button></li>').join('') + '</ul>' : '<p>すべて完了しました。</p>';
    h += '</div>';
    h += '<button class="btn btn-danger" data-action="reset-progress">この試験の進捗をリセット</button>';
    document.getElementById('progress').innerHTML = h;
  }

  // ------------------------------------------------------------------
  // 逐次メモ
  // ------------------------------------------------------------------
  /** 手順書画面で表示中のステップ（メモの紐づけ先） */
  function currentStepInfo() {
    if (!state.finalPlan || !document.getElementById('screen-procedure').classList.contains('active') || state.view !== 'step') return null;
    const x = flatSteps()[state.current];
    return x ? { uid: x.step.uid, label: x.section.name + ' ／ ' + x.step.title } : null;
  }

  function stepInfoByUid(uid) {
    if (!state.finalPlan) return null;
    for (const sec of state.finalPlan.sections) {
      const st = sec.steps.find((s) => s.uid === uid);
      if (st) return { uid, label: sec.name + ' ／ ' + st.title };
    }
    return null;
  }

  function renderMemo() {
    const list = Memo.all();
    document.getElementById('memo-count').textContent = list.length;
    const panel = document.getElementById('memo-panel');
    if (panel.hidden) return;
    const cur = currentStepInfo();
    const link = document.getElementById('memo-link');
    link.disabled = !cur;
    link.parentElement.title = cur ? cur.label : '手順書のステップ表示を開いているときに紐づけできます';
    document.getElementById('memo-list').innerHTML = list.length
      ? list.map((m) => UI.memoItem(m, state.editingMemo, true)).join('')
      : '<li class="muted small">まだメモはありません。</li>';
    const ul = document.getElementById('memo-list');
    ul.scrollTop = ul.scrollHeight;
  }

  /** ステップを移動したときは、パネルの「紐づけ先」だけ更新（入力中の文字は消さない） */
  function renderMemoLinkState() {
    const cur = currentStepInfo();
    const link = document.getElementById('memo-link');
    if (!link) return;
    link.disabled = !cur;
    link.parentElement.title = cur ? cur.label : '手順書のステップ表示を開いているときに紐づけできます';
  }

  function refreshAfterMemo() {
    renderMemo();
    if (document.getElementById('screen-procedure').classList.contains('active') && state.view === 'step') renderProcedure();
  }

  function addMemoFromPanel() {
    const ta = document.getElementById('memo-input');
    const step = document.getElementById('memo-link').checked ? currentStepInfo() : null;
    if (Memo.add(ta.value, step)) { ta.value = ''; refreshAfterMemo(); Clipboard.toast('メモを追加しました'); }
  }

  function addMemoForStep(uid) {
    const ta = document.querySelector('.memo-input[data-memo-step="' + uid + '"]');
    if (ta && Memo.add(ta.value, stepInfoByUid(uid))) { refreshAfterMemo(); Clipboard.toast('メモを追加しました'); }
  }

  // ------------------------------------------------------------------
  // 手順書からその場で値を入力 → 手順書を即時更新
  // ------------------------------------------------------------------
  let varTimer = null;
  function applyVarEdit(input) {
    const ref = state.model && state.model.vars[input.dataset.var];
    if (!ref) return;
    VM.set(state.model, ref.task, ref.key, input.value);
    recompute();
    state.finalPlan = state.plan; // 手順書の画面で入力した値は、その場で確定として反映
    const sel = { v: input.dataset.var, s: input.dataset.step, pos: input.selectionStart };
    rememberOpenSections();
    const y = window.scrollY;
    renderProcedure();
    window.scrollTo(0, y);
    const again = document.querySelector('[data-action="edit-var"][data-var="' + sel.v + '"][data-step="' + sel.s + '"]');
    if (again) { again.focus(); try { again.setSelectionRange(sel.pos, sel.pos); } catch (err) { /* ignore */ } }
  }

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!t.dataset || t.dataset.action !== 'edit-var') return;
    clearTimeout(varTimer);
    varTimer = setTimeout(() => applyVarEdit(t), 350);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || !(ev.ctrlKey || ev.metaKey)) return;
    const t = ev.target;
    if (t.id === 'memo-input') { ev.preventDefault(); addMemoFromPanel(); }
    else if (t.dataset && t.dataset.memoStep) { ev.preventDefault(); addMemoForStep(t.dataset.memoStep); }
    else if (t.classList && t.classList.contains('memo-edit')) { ev.preventDefault(); Memo.update(t.dataset.id, t.value); state.editingMemo = null; refreshAfterMemo(); }
  });

  // ------------------------------------------------------------------
  // イベント
  // ------------------------------------------------------------------
  function onEdit(target) {
    const task = VM.findTask(state.model, target.dataset.task);
    VM.set(state.model, task, target.dataset.key, target.value);
    if (state.finalPlan) state.dirty = true;
    recompute();
    renderReview();
  }

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    const a = t.dataset && t.dataset.action;
    if (a === 'edit') onEdit(t);
    else if (a === 'reviewed') {
      state.reviewed = t.checked;
      const btn = document.querySelector('[data-action="generate"]');
      if (btn) btn.disabled = !t.checked;
    } else if (a === 'toggle-step') {
      state.prog.done[t.dataset.uid] = t.checked;
      Progress.save(state.model.examKey, state.prog);
      if (state.view === 'step' && t.checked) {
        // 完了したら次のステップへ
        const flat = flatSteps();
        if (state.current < flat.length - 1 && flat[state.current].step.uid === t.dataset.uid) state.current++;
      }
      rememberOpenSections();
      renderProcedure();
    } else if (t.id === 'sample-select' && t.value) {
      document.getElementById('problem-text').value = window.SES.Fixtures[t.value];
      t.value = '';
    }
  });

  function rememberOpenSections() {
    document.querySelectorAll('.list-sec').forEach((d) => { state.openSections[d.dataset.sec] = d.open; });
  }

  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-action]');
    if (!t || t.disabled) return;
    const a = t.dataset.action;
    if (['edit', 'reviewed', 'toggle-step'].indexOf(a) >= 0) return;
    switch (a) {
      case 'goto': goto(t.dataset.screen); break;
      case 'parse': doParse(); break;
      case 'manual': doManual(); break;
      case 'toggle-memo': {
        const p = document.getElementById('memo-panel');
        p.hidden = !p.hidden;
        document.body.classList.toggle('memo-open', !p.hidden);
        renderMemo();
        if (!p.hidden) document.getElementById('memo-input').focus();
        break;
      }
      case 'memo-add': addMemoFromPanel(); break;
      case 'memo-add-step': addMemoForStep(t.dataset.uid); break;
      case 'memo-edit': state.editingMemo = t.dataset.id; refreshAfterMemo(); break;
      case 'memo-cancel': state.editingMemo = null; refreshAfterMemo(); break;
      case 'memo-save': {
        const ta = t.closest('.memo-item').querySelector('.memo-edit');
        Memo.update(t.dataset.id, ta.value);
        state.editingMemo = null;
        refreshAfterMemo();
        break;
      }
      case 'memo-delete':
        if (window.confirm('このメモを削除しますか？')) { Memo.remove(t.dataset.id); refreshAfterMemo(); }
        break;
      case 'memo-clear':
        if (Memo.all().length && window.confirm('メモをすべて削除します。よろしいですか？')) { Memo.clearAll(); refreshAfterMemo(); }
        break;
      case 'memo-copy-all': {
        const ok = await Clipboard.copy(Memo.asText());
        Clipboard.toast(ok ? 'メモをすべてコピーしました' : 'コピーできませんでした', ok ? '' : 'warn');
        break;
      }
      case 'memo-jump': {
        const idx = state.finalPlan ? flatSteps().findIndex((x) => x.step.uid === t.dataset.uid) : -1;
        if (idx < 0) { Clipboard.toast('現在の表示モードにはこのステップがありません', 'warn'); break; }
        state.current = idx; state.view = 'step'; saveUiPrefs(); goto('procedure');
        break;
      }
      case 'clear-input':
        document.getElementById('problem-text').value = '';
        break;
      case 'copy': {
        const ok = await Clipboard.copy(t.dataset.copy);
        Clipboard.toast(ok ? 'コピーしました' : 'コピーできませんでした', ok ? '' : 'warn');
        if (ok) { t.classList.add('copied'); setTimeout(() => t.classList.remove('copied'), 1200); }
        break;
      }
      case 'reset-field': {
        const task = VM.findTask(state.model, t.dataset.task);
        VM.reset(state.model, task, t.dataset.key);
        if (state.finalPlan) state.dirty = true;
        recompute(); renderReview();
        break;
      }
      case 'confirm':
      case 'unconfirm':
        state.prog.confirmations[t.dataset.id] = a === 'confirm';
        Progress.save(state.model.examKey, state.prog);
        if (state.finalPlan) state.dirty = true;
        recompute(); renderReview();
        break;
      case 'generate':
        if (!state.reviewed) return;
        recompute();
        state.finalPlan = state.plan;
        state.dirty = false;
        enableTabs();
        goto('procedure');
        break;
      case 'set-view': state.view = t.dataset.view; saveUiPrefs(); renderProcedure(); break;
      case 'set-mode': rememberOpenSections(); state.mode = t.dataset.mode; saveUiPrefs(); renderProcedure(); break;
      case 'goto-step': state.current = Number(t.dataset.index); renderProcedure(); window.scrollTo(0, 0); break;
      case 'next-undone': {
        const flat = flatSteps();
        const order = flat.map((x, i) => i).filter((i) => i > state.current).concat(flat.map((x, i) => i).filter((i) => i <= state.current));
        const nx = order.find((i) => !isDoneFlat(flat[i]));
        if (nx === undefined) Clipboard.toast('未完了のステップはありません');
        else { state.current = nx; renderProcedure(); window.scrollTo(0, 0); }
        break;
      }
      case 'open-step': {
        const idx = flatSteps().findIndex((x) => x.step.uid === t.dataset.uid);
        if (idx >= 0) { state.current = idx; state.view = 'step'; saveUiPrefs(); renderProcedure(); window.scrollTo(0, 0); }
        break;
      }
      case 'jump': state.current = Number(t.dataset.index); state.view = 'step'; goto('procedure'); break;
      case 'reset-progress':
        if (window.confirm('この試験の完了チェックと相違の承認をすべてリセットします。よろしいですか？')) {
          Progress.clear(state.model.examKey);
          state.prog = Progress.load(state.model.examKey);
          recompute();
          state.finalPlan = state.plan;
          renderProgress();
        }
        break;
      default: break;
    }
  });

  // ------------------------------------------------------------------
  loadUiPrefs();
  renderMemo();
  // 過去問データ（tests/fixtures.js）が無い環境では「過去問で試す」を出さない
  if (!window.SES.Fixtures) { const s = document.querySelector('.sample'); if (s) s.hidden = true; }
  loadData().catch((err) => {
    const box = document.getElementById('load-error');
    box.hidden = false;
    box.innerHTML = 'テンプレートデータを読み込めませんでした（' + e(err.message) + '）。<br>index.html を直接開くと読み込めません。フォルダ内の <b>start.bat</b> から起動してください。';
  });
})();
