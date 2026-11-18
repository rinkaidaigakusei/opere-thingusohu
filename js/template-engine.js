/**
 * template-engine.js — note由来のコマンドテンプレートに確認済みの値を反映し、手順書（プラン）を作る。
 *
 * ルール:
 * - コマンドは original（note原文）を基準にし、変わるのは {{変数}} の部分だけ
 * - noteの値と試験の値が違い、構造に関わる変数（confirmIfDifferent）はユーザー承認まで note の値のまま
 * - コマンド自体の変更案（proposal）はユーザー承認まで適用しない（元のコマンドと比較できる）
 * - 未設定の値を含むコマンドはコピー不可にする（不完全なコマンドの実行を防ぐ）
 */
(function (global) {
  'use strict';
  const SES = global.SES || (global.SES = {});
  const VM = SES.VariableManager || (typeof require !== 'undefined' ? require('./variable-manager.js') : null);

  const PH = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  const TOKEN_RE = /学籍番号|学校の自分のメールアドレス/;
  const KIND_LABEL = { bulk: '一括実行コマンド', individual: '個別実行コマンド', aux: '移動・操作補助', checklist: '確認・手作業' };

  function indexTemplates(files) {
    const map = {};
    files.forEach((f) => (f.templates || []).forEach((t) => { map[t.id] = Object.assign({ category: f.category }, t); }));
    return map;
  }

  // ------------------------------------------------------------------
  // コンテキスト（プレースホルダの解決）
  // ------------------------------------------------------------------
  function makeContext(model, task, step, tpl, state, mismatches) {
    const bind = step.bind || {};
    const meta = tpl.variables || {};

    function rawResolve(name) {
      const local = bind[name] || name;
      if (task.fields[local]) return VM.get(model, task, local);
      if (model.vars[name]) return VM.byVar(model, name);
      return null;
    }

    function resolve(name) {
      const r = rawResolve(name);
      if (!r) return { value: '', status: 'unset', var: name, label: name, missing: true };
      const m = meta[name];
      if (m && m.confirmIfDifferent && m.noteValue && r.value && r.value !== m.noteValue) {
        const id = 'var:' + r.var;
        if (!mismatches.find((x) => x.id === id)) {
          mismatches.push({
            id,
            type: 'variable',
            taskUid: task.uid,
            title: (task.number ? '課題' + task.number + '：' : '') + r.label + ' がnoteの例と異なります',
            note: 'note記事: ' + m.noteValue,
            exam: '試験問題: ' + r.value,
            diff: m.noteValue + ' → ' + r.value,
            needChange: 'noteのコマンド・設定内容の「' + m.noteValue + '」を「' + r.value + '」に置き換える必要があります（userdir.conf の編集内容も含む）。',
            confirmed: !!state.confirmations[id],
          });
        }
        if (!state.confirmations[id]) {
          return Object.assign({}, r, { value: m.noteValue, status: 'pending', note: '試験の値「' + r.value + '」との相違を確認するまで、noteの値のままです' });
        }
      }
      return r;
    }

    function predicate(expr) {
      if (!expr) return true;
      const neg = expr[0] === '!';
      const key = neg ? expr.slice(1) : expr;
      const user = VM.get(model, task, 'user').value;
      const linuxUser = (VM.byVar(model, 'linux_user') || {}).value || '';
      let v = false;
      switch (key) {
        case 'needsHomeSetup': v = !!user && user !== linuxUser; break;
        case 'isNewUser': v = !!user && user !== linuxUser && user !== 'ec2-user'; break;
        case 'isEc2User': v = user === 'ec2-user'; break;
        case 'hasSubdir': { const s = VM.get(model, task, 'subdir'); v = s.status !== 'na' && (!!s.value || s.status === 'unset'); break; }
        case 'installAtTop': v = !!VM.get(model, task, 'install_condition').value; break;
        default: v = false;
      }
      return neg ? !v : v;
    }

    return { resolve, predicate };
  }

  /** 文字列内の {{x}} を解決し、表示用セグメントを作る */
  function render(str, ctx) {
    const segments = [];
    const unresolved = [];
    let review = false;
    let last = 0;
    let text = '';
    String(str || '').replace(PH, (all, name, offset) => {
      if (offset > last) { segments.push({ t: 'text', v: str.slice(last, offset) }); text += str.slice(last, offset); }
      const r = ctx.resolve(name);
      // 「学籍番号」等が未置換のまま残っている値はコマンドに使えない
      const tokenLeft = TOKEN_RE.test(r.value || '');
      const ok = r.value !== '' && r.status !== 'unset' && !tokenLeft;
      if (!ok && r.status !== 'na') unresolved.push(r.var || name);
      if (r.status === 'review' || r.status === 'pending') review = true;
      segments.push({ t: 'var', name, var: r.var || name, value: r.value, status: ok ? r.status : (r.status === 'na' ? 'na' : 'unset'), label: r.label, secret: !!r.secret, note: r.note || '' });
      text += ok || tokenLeft ? r.value : (r.status === 'na' ? '' : '{{' + (r.var || name) + '}}');
      last = offset + all.length;
      return all;
    });
    if (last < String(str || '').length) { segments.push({ t: 'text', v: str.slice(last) }); text += str.slice(last); }
    return { text, segments, unresolved, review, copyable: unresolved.length === 0 };
  }

  /** 説明文用：未設定の値は {{変数名}} ではなく（項目名）で表示 */
  function labelText(r) {
    return r.segments.map((s) => (s.t === 'text' ? s.v : (s.value && s.status !== 'unset' ? s.value : '（' + (s.label || s.var) + '）'))).join('');
  }

  function renderLine(line, ctx, state, task, tpl, mismatches) {
    let src = line.template || line.original;
    let staged = line.staged || null;
    let proposalApplied = false;
    let workdirOverride = null;

    if (line.proposal) {
      const p = line.proposal;
      const id = 'prop:' + p.id + ':' + task.uid;
      const confirmed = !!state.confirmations[id];
      const proposed = render(p.command, ctx);
      mismatches.push({
        id,
        type: 'proposal',
        taskUid: task.uid,
        title: '課題' + task.number + '：' + tpl.title + '（コマンドの変更案）',
        note: 'note記事のコマンド: ' + line.original,
        exam: render('試験問題の設置先: {{target_dir}}', ctx).text,
        diff: render(p.changedPart, ctx).text,
        needChange: render(p.reason, ctx).text,
        original: line.original,
        proposed: proposed.text,
        proposedCopyable: proposed.copyable,
        confirmed,
      });
      if (confirmed) {
        src = p.command;
        staged = p.staged || null;
        proposalApplied = true;
        workdirOverride = p.workdir || null;
      }
    }

    const r = render(src, ctx);
    const out = {
      kind: line.kind || tpl.kind,
      original: line.original,
      text: r.text,
      segments: r.segments,
      unresolved: r.unresolved,
      review: r.review,
      copyable: r.copyable,
      changed: r.text !== line.original,
      proposalApplied,
      hasProposal: !!line.proposal,
      note: line.note || '',
      staged: staged ? staged.map((s) => render(s, ctx)) : null,
    };
    return { line: out, workdirOverride };
  }

  // ------------------------------------------------------------------
  // プランの生成
  // ------------------------------------------------------------------
  function buildStep(model, task, stepDef, templates, state, mismatches) {
    const tpl = stepDef.inline ? Object.assign({ kind: 'individual', modes: ['bulk', 'staged'], lines: [], variables: {}, source: 'このアプリ（note由来のコマンドなし）' }, stepDef.inline) : templates[stepDef.template];
    if (!tpl) return { missingTemplate: stepDef.template };
    const ctx = makeContext(model, task, stepDef, tpl, state, mismatches);
    const when = stepDef.when || tpl.when;
    if (!ctx.predicate(when)) return null;

    const r = (s) => render(s, ctx);
    let workdir = tpl.workdir;
    const lines = (tpl.lines || []).map((l) => {
      const x = renderLine(l, ctx, state, task, tpl, mismatches);
      if (x.workdirOverride) workdir = x.workdirOverride;
      return x.line;
    });
    const cautions = [];
    Object.entries(tpl.cautionWhen || {}).forEach(([pred, msg]) => { if (ctx.predicate(pred)) cautions.push(r(msg).text); });
    lines.filter((l) => l.hasProposal && !l.proposalApplied).forEach(() => cautions.push('noteの元のコマンドのままです。試験の設置先と異なる可能性があります（解析結果確認画面の「noteと試験問題の相違」で変更案を確認できます）。'));

    return withVars(model, {
      uid: task.uid + ':' + tpl.id,
      templateId: tpl.id,
      taskUid: task.uid,
      // タイトルに未設定の値があるときは {{変数名}} ではなく項目名で表示
      title: labelText(r(tpl.title)),
      kind: tpl.kind || 'individual',
      kindLabel: KIND_LABEL[tpl.kind || 'individual'],
      modes: tpl.modes || ['bulk', 'staged'],
      optional: !!tpl.optional,
      unregistered: !!tpl.unregistered,
      coveredBy: stepDef.coveredBy ? task.uid + ':' + stepDef.coveredBy : null,
      runAs: r(tpl.runAs || '-').text,
      workdir: r(workdir || '-').text,
      lines,
      inputs: (tpl.inputs || []).map((i) => Object.assign(r(i.value), { label: i.label, secret: !!i.secret })),
      fileContent: tpl.fileContent ? Object.assign(r(tpl.fileContent.content), { label: r(tpl.fileContent.label).text }) : null,
      editInstructions: (tpl.editInstructions || []).map((s) => r(s)),
      reference: (tpl.reference || []).map((x) => Object.assign(r(x.value), { label: x.label, secret: !!x.secret })),
      checkUrl: tpl.checkUrl ? Object.assign(r(tpl.checkUrl.url), { label: tpl.checkUrl.label }) : null,
      // practice: 授業の課題・練習のときだけ出す印（{ level: "free" | "must", text }）
      guide: (tpl.guide || []).map((g) => ({ text: labelText(r(g.text)), img: g.img || '', practice: model.practice ? g.practice || null : null })),
      practiceNote: model.practice && tpl.practiceNote ? labelText(r(tpl.practiceNote)) : '',
      hideVars: !!(tpl.hideVars || (model.practice && tpl.practiceHideVars)),
      connectPaste: !!tpl.connectPaste,
      prerequisites: r(tpl.prerequisites || '-').text,
      notes: (tpl.notes || []).map((n) => r(n).text),
      cautions,
      verify: r(tpl.verify || '-').text,
      source: tpl.source || '',
      history: tpl.history || [],
    });
  }

  /**
   * ステップで使っている変数の一覧（手順書の画面からその場で値を入力・修正するため）
   * 入力すると変数そのものが更新され、同じ変数を使う全ステップに即時反映される。
   */
  function withVars(model, step) {
    const seen = {};
    const vars = [];
    const visit = (r) => {
      if (!r || !r.segments) return;
      r.segments.forEach((s) => {
        if (s.t !== 'var' || seen[s.var] || !model.vars[s.var]) return;
        seen[s.var] = true;
        const ref = model.vars[s.var];
        const v = VM.get(model, ref.task, ref.key);
        if (v.status === 'na') return;
        const f = ref.task.fields[ref.key];
        const modeHint = model.practice ? f.practiceHint : f.examHint;
        vars.push({ var: s.var, label: v.label, value: v.value, status: v.status, secret: !!v.secret, note: v.note, hint: f.hint || '', modeHint: modeHint || '', taskUid: ref.task.uid, key: ref.key, pending: s.status === 'pending' || /確認するまで/.test(s.note || '') });
      });
    };
    step.lines.forEach((l) => { visit(l); (l.staged || []).forEach(visit); });
    step.inputs.forEach(visit);
    if (step.fileContent) visit(step.fileContent);
    step.editInstructions.forEach(visit);
    step.reference.forEach(visit);
    if (step.checkUrl) visit(step.checkUrl);
    step.vars = step.hideVars ? [] : vars;
    return step;
  }

  /** 課題に対応するテンプレートが無い場合の手動ステップ（抽出値を一覧表示） */
  function manualStep(model, task) {
    const reference = Object.keys(task.fields).map((k) => {
      const v = VM.get(model, task, k);
      return { label: v.label, text: v.value, segments: [{ t: 'var', var: v.var, value: v.value, status: v.value ? v.status : 'unset', label: v.label, secret: v.secret }], copyable: !!v.value, secret: v.secret };
    });
    return withVars(model, {
      uid: task.uid + ':manual',
      templateId: 'manual',
      taskUid: task.uid,
      title: task.typeName + '（テンプレート未登録）',
      kind: 'checklist',
      kindLabel: KIND_LABEL.checklist,
      modes: ['bulk', 'staged'],
      unregistered: true,
      runAs: '-',
      workdir: '-',
      lines: [],
      inputs: [],
      fileContent: null,
      editInstructions: [],
      reference,
      prerequisites: '-',
      notes: task.type === 'unknown' ? ['課題の種類を判定できませんでした。問題文を確認してください。'] : [],
      cautions: [],
      verify: '自分で作業し、完了したらチェック',
      source: '',
      history: [],
    });
  }

  function buildPlan(model, defs, templates, state) {
    const mismatches = [];
    const sections = [];
    const missing = [];
    const all = [model.server].concat(model.tasks);
    all.forEach((task) => {
      const def = task.type === 'server' ? defs.types.server : defs.types[task.type] || defs.types.unknown;
      let steps = [];
      (def.steps || []).forEach((sd) => {
        const s = buildStep(model, task, sd, templates, state, mismatches);
        if (s && s.missingTemplate) missing.push(s.missingTemplate);
        else if (s) steps.push(s);
      });
      if (def.unregistered && !steps.length) steps = [manualStep(model, task)];
      sections.push({
        uid: task.uid,
        number: task.number,
        type: task.type,
        name: task.type === 'server' ? 'サーバ基本情報（AWS）' : '課題' + task.number + '：' + task.typeName + (task.isExtra ? '（追加）' : ''),
        title: task.title,
        unregistered: !!def.unregistered,
        steps,
      });
    });
    // 「~user/ 直下でトップ表示」はnoteの手順との相違として確認対象にする
    model.tasks.filter((t) => t.type === 'wordpress' && VM.get(model, t, 'install_condition').value).forEach((t) => {
      const id = 'info:wp-top:' + t.uid;
      mismatches.push({
        id,
        type: 'info',
        taskUid: t.uid,
        title: '課題' + t.number + '：WordPressの表示場所',
        note: 'note記事: wordpress/ ディレクトリに展開して http://publicDNS/~ユーザー/wordpress/ で表示',
        exam: '試験問題: ' + VM.get(model, t, 'install_condition').value,
        diff: '表示するURL（設置場所）が異なる',
        needChange: 'noteの手順だけでは条件を満たせません。対応する手順はnoteに無いため、テンプレート未登録として表示します。',
        confirmed: !!state.confirmations[id],
      });
    });
    return { sections, mismatches, missingTemplates: missing };
  }

  /** モード（bulk/staged）で表示するステップに絞る */
  function stepsForMode(section, mode) {
    return section.steps.filter((s) => s.modes.indexOf(mode) >= 0);
  }

  const TemplateEngine = { indexTemplates, buildPlan, stepsForMode, render, KIND_LABEL };
  SES.TemplateEngine = TemplateEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = TemplateEngine;
})(typeof window !== 'undefined' ? window : globalThis);
