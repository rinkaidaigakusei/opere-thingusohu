/**
 * variable-manager.js — 抽出した設定値（変数）の管理。
 *
 * - 用途ごとに別の変数として保持する（linux_user / basic_auth_id / wordpress_user … を混同しない）
 * - 状態: extracted=抽出済み / review=要確認 / unset=未設定 / edited=修正済み / na=不要
 * - 優先順位: 1. 課題内の明記 → 2. 共通パスワード → 3. ユーザーの修正（修正したら最優先）
 * - 問題文の「学籍番号」「学校の自分のメールアドレス」は受験者情報が入力されたときだけ置換する
 * - パスワードは画面上のメモリでのみ保持し、保存はしない
 */
(function (global) {
  'use strict';
  const SES = global.SES || (global.SES = {});

  const STATUS_LABEL = { extracted: '抽出済み', review: '要確認', unset: '未設定', edited: '修正済み', na: '不要' };
  const SEVERITY = { unset: 3, review: 2, edited: 0, extracted: 0, na: 0 };

  // 問題文中の「プレースホルダ的な語」→ 受験者情報の変数
  // soft: 未入力でも状態を下げない（publicDNS は問題文のURLの書式としてそのまま有効）
  const TOKENS = [
    { token: '学籍番号', lookup: (m) => get(m, m.profile, 'student_id').value, label: '学籍番号' },
    { token: '学校の自分のメールアドレス', lookup: (m) => get(m, m.profile, 'email_address').value, label: 'メールアドレス' },
    { token: 'publicDNS', lookup: (m) => get(m, m.server, 'public_dns').value, label: 'パブリックDNS', soft: true },
  ];

  /**
   * AWSの「接続」画面のコマンドや、接続時のターミナル出力を貼り付けたものから
   * パブリックDNS・chmod・ssh の各行を取り出す（貼り付けた文字列そのものを使い、コマンドは作らない）
   */
  function parseConnection(text) {
    const s = String(text || '');
    const out = {};
    const ssh = s.match(/ssh\s+-i\s+("[^"]+"|\S+)\s+([A-Za-z0-9_.-]+)@([A-Za-z0-9.-]+)/);
    if (ssh) {
      out.ssh_command = ssh[0];
      out.public_dns = ssh[3];
    }
    const chmod = s.match(/chmod\s+400\s+("[^"]+"|\S+\.pem)/);
    if (chmod) out.ssh_chmod = chmod[0];
    if (!out.public_dns) {
      const host = s.match(/(?:https?:\/\/)?([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.amazonaws\.com)/) || s.trim().match(/^(?:https?:\/\/)?([A-Za-z0-9.-]+\.[A-Za-z]{2,})\/?$/) || s.trim().match(/^(?:https?:\/\/)?(\d{1,3}(?:\.\d{1,3}){3})\/?$/);
      if (host) out.public_dns = host[1];
    }
    return out;
  }

  function worse(a, b) {
    return (SEVERITY[a] || 0) >= (SEVERITY[b] || 0) ? a : b;
  }

  function makeField(def, parsed, prefix) {
    const p = parsed || {};
    return {
      key: def.key,
      var: def.var.replace('{p}', prefix || ''),
      label: def.label,
      hint: def.hint || '',
      secret: !!def.secret,
      multiline: !!def.multiline,
      derived: !!def.derived,
      workValue: !!def.workValue, // 問題文には無く、作業中にわかる値（MySQL初期パスワードなど）
      raw: p.value || '',
      value: p.value || '',
      parsedStatus: p.status || null,
      source: p.source || '',
      note: p.note || '',
      passwordMode: p.passwordMode || null,
      edited: false,
    };
  }

  function makeTask(uid, def, parsedFields, extra) {
    const fields = {};
    (def.fields || []).forEach((fd) => {
      fields[fd.key] = makeField(fd, parsedFields[fd.key], extra.prefix);
    });
    return Object.assign({ uid, type: extra.type, typeName: def.name, unregistered: !!def.unregistered, fields }, extra);
  }

  /** 解析結果＋課題定義からモデルを作る */
  function build(parsed, defs) {
    const model = {
      examTitle: parsed.examTitle,
      examKey: parsed.examKey,
      warnings: parsed.warnings || [],
      manual: !!parsed.manual,
      profile: makeTask('profile', defs.profile, {}, { type: 'profile', number: null, title: defs.profile.name }),
      server: makeTask('server', defs.types.server, parsed.server, { type: 'server', number: 0, title: 'サーバ基本情報' }),
      tasks: [],
    };
    parsed.tasks.forEach((t) => {
      const def = defs.types[t.type] || defs.types.unknown;
      model.tasks.push(
        makeTask('t' + t.number, def, t.fields, {
          type: t.type,
          number: t.number,
          title: t.title,
          points: t.points,
          prefix: t.prefix,
          isExtra: t.isExtra,
          rawText: t.rawText,
        })
      );
    });
    indexVars(model);
    return model;
  }

  function indexVars(model) {
    model.vars = {};
    allTasks(model).forEach((task) => {
      Object.values(task.fields).forEach((f) => {
        if (!model.vars[f.var]) model.vars[f.var] = { task, key: f.key };
      });
    });
  }

  function allTasks(model) {
    return [model.profile, model.server].concat(model.tasks);
  }

  function findTask(model, uid) {
    return allTasks(model).find((t) => t.uid === uid) || null;
  }

  function byVar(model, varName) {
    const ref = model.vars[varName];
    return ref ? get(model, ref.task, ref.key) : null;
  }

  function taskOfType(model, type) {
    return model.tasks.find((t) => t.type === type) || null;
  }

  // ------------------------------------------------------------------
  // 実効値の計算
  // ------------------------------------------------------------------
  function commonPassword(model) {
    return get(model, model.server, 'common_password');
  }

  function baseValue(model, task, f) {
    if (f.edited) return { value: f.value, status: f.value ? 'edited' : 'unset', note: 'ユーザーが修正' };

    if (f.derived) return derive(model, task, f);
    if (f.workValue) return { value: '', status: 'unset', note: '作業中に入力する値（手順書の画面からも入力できます）' };

    // WordPress課題の Linux パスワード（su 用）
    if (task.type === 'wordpress' && f.key === 'linux_password') {
      const user = get(model, task, 'user').value;
      const linuxUser = byVar(model, 'linux_user');
      if (user === 'ec2-user') return { value: '', status: 'na', note: 'ec2-user はログイン時のユーザーのためパスワード不要' };
      if (linuxUser && user && user === linuxUser.value) {
        const pw = byVar(model, 'linux_password');
        return { value: pw.value, status: pw.status === 'unset' ? 'unset' : 'extracted', note: '課題2と同じユーザーのため、課題2のパスワード（linux_password）を使用' };
      }
    }

    if (f.passwordMode === 'common') {
      const c = commonPassword(model);
      return { value: c.value, status: c.value ? 'extracted' : 'unset', note: '問題文で共通パスワードを参照（' + (f.source || '指定されたパスワード') + '）' };
    }
    if (f.passwordMode === 'none' && !f.raw) {
      const c = commonPassword(model);
      if (c.value) {
        return { value: c.value, status: 'review', note: model.manual ? '未入力のため共通パスワードを仮に反映しています' : 'この課題にパスワードの記載なし。「全てのパスワードは…」の共通パスワードを仮に反映しています' };
      }
      return { value: '', status: 'unset', note: model.manual ? '未入力（共通パスワードを入れると仮に反映されます）' : '問題文に記載なし' };
    }
    if (!f.raw) return { value: '', status: 'unset', note: f.hint ? '' : (model.manual ? '未入力' : '問題文から取得できませんでした') };
    return { value: f.raw, status: f.parsedStatus || 'extracted', note: f.note };
  }

  /** WordPress の設置ディレクトリから公開ディレクトリ・サブディレクトリ・展開先を算出 */
  function derive(model, task, f) {
    if (f.key === 'site_root') {
      const dns = get(model, model.server, 'public_dns').value;
      return dns
        ? { value: 'http://' + dns + '/', status: 'extracted', note: 'パブリックDNSから作成' }
        : { value: 'http://publicDNS/', status: 'review', note: 'パブリックDNSを入力すると実際のURLになります' };
    }
    if (f.key === 'wp_url') {
      const user = get(model, task, 'user').value;
      const sub = get(model, task, 'subdir');
      if (!user) return { value: '', status: 'unset', note: '' };
      const path = sub.status !== 'na' && sub.value ? sub.value + '/' : '';
      return { value: 'http://publicDNS/~' + user + '/' + path + 'wordpress/', status: 'extracted', note: 'note の展開先（wordpress/）から算出' };
    }
    const inst = get(model, task, 'install_dir');
    const user = get(model, task, 'user');
    const m = inst.value && inst.value.match(/^\/home\/([^/]+)\/([^/]+)\/?(.*?)\/?$/);
    if (f.key === 'public_dir') {
      if (m) return { value: m[2], status: inst.status === 'unset' ? 'review' : 'extracted', note: '設置ディレクトリ ' + inst.value + ' から算出' };
      const pd = byVar(model, 'public_dir');
      if (pd && pd.value) return { value: pd.value, status: 'review', note: '設置ディレクトリの指定が無いため、課題2の公開ディレクトリを仮に使用' };
      return { value: '', status: 'unset', note: '' };
    }
    if (f.key === 'subdir') {
      if (m) return m[3] ? { value: m[3], status: 'extracted', note: '設置ディレクトリ ' + inst.value + ' から算出' } : { value: '', status: 'na', note: 'サブディレクトリの指定なし' };
      return { value: '', status: 'na', note: '設置ディレクトリの指定なし' };
    }
    if (f.key === 'target_dir') {
      if (inst.value) {
        let note = '設置ディレクトリと同じ';
        let status = inst.status === 'unset' ? 'unset' : 'extracted';
        if (m && user.value && m[1] !== user.value) { status = 'review'; note = '設置ディレクトリのユーザー（' + m[1] + '）がWordPressの設置ユーザーと異なります'; }
        return { value: inst.value, status, note };
      }
      const pd = get(model, task, 'public_dir');
      if (user.value && pd.value) return { value: '/home/' + user.value + '/' + pd.value + '/', status: 'review', note: '問題文に設置ディレクトリの指定なし。ユーザーと公開ディレクトリから推定' };
      return { value: '', status: 'unset', note: '' };
    }
    return { value: '', status: 'unset', note: '' };
  }

  /** 実効値 {value, status, note, label, var, secret} */
  function get(model, task, key) {
    const f = task && task.fields[key];
    if (!f) return { value: '', status: 'unset', note: '', label: key, var: key };
    if (f._computing) return { value: '', status: 'unset', note: '循環参照', label: f.label, var: f.var };
    f._computing = true;
    try {
      let { value, status, note } = baseValue(model, task, f);
      const notes = note ? [note] : [];
      if (task.type !== 'profile' && value) {
        TOKENS.forEach((tk) => {
          if (value.indexOf(tk.token) < 0) return;
          const pv = tk.lookup(model);
          if (pv) {
            value = value.split(tk.token).join(pv);
            notes.push('問題文の「' + tk.token + '」を' + (tk.soft ? '接続先の値' : '受験者情報の値') + 'に置換');
          } else if (tk.soft) {
            notes.push('パブリックDNSを入力すると「' + tk.token + '」が置き換わります');
          } else if (value.trim() === tk.token) {
            status = worse(status, 'unset');
            notes.push('問題文では「' + tk.token + '」（実際の値は未記載）。受験者情報に入力すると反映されます');
          } else {
            status = worse(status, 'review');
            notes.push('「' + tk.token + '」を含みます。受験者情報に入力すると置換されます');
          }
        });
      }
      return { value, status, note: notes.join(' / '), label: f.label, var: f.var, secret: f.secret, source: f.source };
    } finally {
      f._computing = false;
    }
  }

  function set(model, task, key, value) {
    const f = task.fields[key];
    if (!f) return;
    if (task.type === 'server' && key === 'public_dns') {
      // ssh コマンドやターミナル出力を貼り付けた場合は、DNS・chmod・ssh を取り出して各欄へ
      const c = parseConnection(value);
      f.value = c.public_dns || value.trim();
      f.edited = true;
      ['ssh_command', 'ssh_chmod'].forEach((k) => {
        if (c[k] && task.fields[k]) { task.fields[k].value = c[k]; task.fields[k].edited = true; }
      });
      return;
    }
    f.value = value;
    f.edited = true;
  }

  function reset(model, task, key) {
    const f = task.fields[key];
    if (!f) return;
    f.value = f.raw;
    f.edited = false;
  }

  /** 確認画面用の集計 */
  function summary(model) {
    const c = { extracted: 0, review: 0, unset: 0, edited: 0, na: 0 };
    allTasks(model).forEach((t) => {
      if (t.type === 'profile') return;
      Object.keys(t.fields).forEach((k) => { if (!t.fields[k].workValue) c[get(model, t, k).status]++; });
    });
    return c;
  }

  const VariableManager = { build, get, set, reset, byVar, allTasks, findTask, taskOfType, summary, parseConnection, STATUS_LABEL, worse };
  SES.VariableManager = VariableManager;
  if (typeof module !== 'undefined' && module.exports) module.exports = VariableManager;
})(typeof window !== 'undefined' ? window : globalThis);
