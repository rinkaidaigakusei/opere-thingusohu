/**
 * task-detector.js — 問題文を「課題ブロック」に分割し、課題の種類を判定する。
 * 課題番号だけでなく、課題名・本文の内容で判定する。
 */
(function (global) {
  'use strict';
  const SES = global.SES || (global.SES = {});

  // 「課題 N :」「課題N：」の見出し（コロン必須。本文中の「課題3で設定した〜」とは区別する）
  const HEADING_RE = /課題\s*(\d+)\s*:/g;

  // 判定順が重要（WordPress課題の本文には「LAMP環境を構築後」が含まれる等）
  const TYPE_RULES = [
    { type: 'docker_other', test: (b) => /docker/i.test(b) && /異なるイメージ/.test(b) },
    { type: 'docker_mysql', test: (b) => /docker/i.test(b) },
    { type: 'wpadmin_basic', test: (b) => /wp-admin/i.test(b) && /basic\s*認証/i.test(b) },
    { type: 'wordpress', test: (b) => /wordpress/i.test(b) && /データベース名/.test(b) },
    { type: 'jupyter', test: (b) => /jupyter/i.test(b) },
    { type: 'basic', test: (b) => /basic\s*認証/i.test(b) },
    { type: 'userdir', test: (b) => /ユーザー?ディレクトリ/.test(b) },
    { type: 'lamp', test: (b) => /LAMP/i.test(b) && /phpMyAdmin/i.test(b) },
  ];

  /** cmp（正規化済みテキスト）を課題ブロックに分割する */
  function splitBlocks(cmp, raw) {
    const heads = [];
    let m;
    HEADING_RE.lastIndex = 0;
    while ((m = HEADING_RE.exec(cmp)) !== null) {
      heads.push({ number: Number(m[1]), index: m.index, headLen: m[0].length });
    }
    const header = heads.length ? cmp.slice(0, heads[0].index) : cmp;
    const blocks = heads.map((h, i) => {
      const end = i + 1 < heads.length ? heads[i + 1].index : cmp.length;
      const body = cmp.slice(h.index + h.headLen, end);
      return { number: h.number, body, heading: cmp.slice(h.index, h.index + h.headLen) };
    });

    // raw（改行・空白を保ったテキスト）側も同じ見出しで分割（ファイル内容の抽出用）
    const rawHeads = [];
    HEADING_RE.lastIndex = 0;
    while ((m = HEADING_RE.exec(raw)) !== null) rawHeads.push({ number: Number(m[1]), index: m.index, headLen: m[0].length });
    blocks.forEach((b) => {
      const idx = rawHeads.findIndex((r) => r.number === b.number);
      if (idx >= 0) {
        const r = rawHeads[idx];
        const end = idx + 1 < rawHeads.length ? rawHeads[idx + 1].index : raw.length;
        b.rawBody = raw.slice(r.index + r.headLen, end);
      } else {
        b.rawBody = b.body;
      }
    });
    return { header, blocks };
  }

  function extractTitle(body) {
    const firstLine = body.split('\n')[0] || '';
    const t = firstLine.replace(/\(.*$/, '').trim();
    const pts = firstLine.match(/\(([^)]*)\)/);
    return { title: t, points: pts ? pts[1] : '' };
  }

  function classify(body) {
    for (const r of TYPE_RULES) if (r.test(body)) return r.type;
    return 'unknown';
  }

  function detect(cmp, raw) {
    const { header, blocks } = splitBlocks(cmp, raw);
    let wpCount = 0;
    const tasks = blocks.map((b) => {
      const type = classify(b.body);
      // 見出しは改行を保った raw 側の1行目から取る（cmp は日本語の行が連結されている）
      const { title, points } = extractTitle((b.rawBody || b.body).replace(/^[ \t]+/, ''));
      let prefix = null;
      if (type === 'wordpress') {
        prefix = wpCount === 0 ? 'wordpress' : 'wordpress_t' + b.number;
        wpCount++;
      }
      return { number: b.number, type, title, points, prefix, body: b.body, rawBody: b.rawBody, isExtra: type === 'wordpress' && wpCount > 1 };
    });
    return { header, tasks };
  }

  const TaskDetector = { detect, classify, splitBlocks };
  SES.TaskDetector = TaskDetector;
  if (typeof module !== 'undefined' && module.exports) module.exports = TaskDetector;
})(typeof window !== 'undefined' ? window : globalThis);
