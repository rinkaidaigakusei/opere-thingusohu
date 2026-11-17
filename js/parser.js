/**
 * parser.js — 問題文の正規化と解析の入口。
 *
 * 正規化:
 *   raw … NFKC（PDFコピー時の「⽤」「⾏」などの部首文字や全角記号を通常文字に）＋改行統一
 *   cmp … raw から「日本語に隣接する空白」と「日本語どうしの間の改行」を除いた照合用テキスト
 *         （PDFの折り返しで「パスワ\nード」のように分断されても照合できるようにする）
 *
 * 将来AI解析を追加する場合は、parse() と同じ形の結果を返す関数を用意して差し替える。
 */
(function (global) {
  'use strict';
  const SES = global.SES || (global.SES = {});
  const Rules = SES.ParsingRules || (typeof require !== 'undefined' ? require('./parsing-rules.js') : null);
  const Detector = SES.TaskDetector || (typeof require !== 'undefined' ? require('./task-detector.js') : null);

  const NON_ASCII = '[^\\x00-\\x7F]';

  function normalizeRaw(text) {
    return String(text || '')
      .normalize('NFKC')
      .replace(/\r\n?/g, '\n')
      .replace(/ /g, ' ');
  }

  function toCompact(raw) {
    return raw
      .replace(new RegExp('[ \\t]+(?=' + NON_ASCII + ')', 'g'), '')
      .replace(new RegExp('(' + NON_ASCII + ')[ \\t]+', 'g'), '$1')
      .replace(new RegExp('(' + NON_ASCII + ')\\n(?=' + NON_ASCII + ')', 'g'), '$1')
      .replace(/[ \t]+\n/g, '\n');
  }

  /** 秘密情報を含まない試験キー（進捗の保存に使う） */
  function examKey(cmp) {
    let h = 5381;
    const s = cmp.replace(/\s+/g, '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'exam-' + h.toString(36);
  }

  function parse(text) {
    const raw = normalizeRaw(text);
    const cmp = toCompact(raw);
    const { header, tasks } = Detector.detect(cmp, raw);
    const serverFields = Rules.server(header);
    delete serverFields._title;
    const title = (raw.split('\n').map((l) => l.trim()).find((l) => l) || '').replace(/\s+/g, ' ');

    const parsedTasks = tasks.map((t) => {
      const rule = Rules.byType[t.type] || Rules.byType.unknown;
      return {
        number: t.number,
        type: t.type,
        title: t.title,
        points: t.points,
        prefix: t.prefix,
        isExtra: t.isExtra,
        rawText: t.rawBody.trim(),
        fields: rule(t.body, t.rawBody),
      };
    });

    const warnings = [];
    if (!tasks.length) warnings.push('「課題 N :」形式の見出しが見つかりませんでした。問題文全体を貼り付けたか確認してください。');
    const nums = tasks.map((t) => t.number);
    nums.forEach((n, i) => { if (nums.indexOf(n) !== i) warnings.push('課題' + n + 'が重複して検出されました。'); });
    parsedTasks.filter((t) => t.type === 'unknown').forEach((t) => warnings.push('課題' + t.number + '「' + t.title + '」は種類を判定できませんでした（手順書には未対応として表示）。'));

    return { examTitle: title, examKey: examKey(cmp), server: serverFields, tasks: parsedTasks, warnings };
  }

  /**
   * 問題文を使わない「手入力モード」用に、解析結果と同じ形の空データを作る。
   * selection: [{ type, isExtra }] … 並び順どおりに課題1, 2, 3 … の番号を振る
   * 値はすべて空（＝未設定）。パスワード欄は共通パスワードを仮に反映できるようにしておく。
   */
  function createManual(selection, defs) {
    let wpCount = 0;
    const tasks = selection.map((sel, i) => {
      const number = i + 1;
      const def = defs.types[sel.type] || defs.types.unknown;
      const fields = {};
      (def.fields || []).forEach((fd) => {
        if (fd.secret && !fd.workValue) fields[fd.key] = { value: '', passwordMode: 'none' };
      });
      let prefix = null;
      if (sel.type === 'wordpress') {
        prefix = wpCount === 0 ? 'wordpress' : 'wordpress_t' + number;
        wpCount++;
      }
      return { number, type: sel.type, title: def.name, points: '', prefix, isExtra: sel.type === 'wordpress' && wpCount > 1, rawText: '', fields };
    });
    const sig = selection.map((s) => s.type).join(',');
    const d = new Date();
    const day = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    return {
      examTitle: '手入力モード（問題文なし）',
      examKey: 'manual-' + day + '-' + examKey(sig),
      manual: true,
      server: {},
      tasks,
      warnings: [],
    };
  }

  const Parser = { parse, normalizeRaw, toCompact, createManual };
  SES.Parser = Parser;
  if (typeof module !== 'undefined' && module.exports) module.exports = Parser;
})(typeof window !== 'undefined' ? window : globalThis);
