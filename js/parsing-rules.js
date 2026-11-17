/**
 * parsing-rules.js — 課題の種類ごとの抽出ルール（ルールベース）。
 *
 * 各ルールは「正規化済みテキスト（cmp）」から値を取り出し、
 *   { value, source, status?, note?, passwordMode? }
 * を返す。取れなかった値は返さない（＝未設定）。問題文に無い値は補完しない。
 *
 * passwordMode:
 *   'explicit' … 課題内でパスワードが明記されている
 *   'common'   … 課題内で「指定されたパスワード」等と共通パスワードを参照している
 *   'none'     … 課題内に記載なし（共通パスワードが適用されるかは要確認）
 */
(function (global) {
  'use strict';
  const SES = global.SES || (global.SES = {});

  const ID = '[A-Za-z0-9_.\\-]+';
  const TOKEN_OR_ID = '(学籍番号|' + ID + ')';

  function clip(s, n) {
    s = String(s).replace(/\s+/g, ' ').trim();
    n = n || 90;
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /** 正規表現にマッチしたら {value, source} を返す */
  function grab(text, re, opts) {
    opts = opts || {};
    const m = text.match(re);
    if (!m) return null;
    let v = m[opts.group || 1];
    if (v == null) return null;
    v = opts.keepSpaces ? v.trim() : v.replace(/\s+/g, opts.joinWith != null ? opts.joinWith : '').trim();
    if (!v) return null;
    const r = { value: v, source: clip(m[0]) };
    if (opts.note) r.note = opts.note;
    return r;
  }

  function url(text) {
    // 投稿URLは「http://...」 / (投稿URLは、http://...)
    return grab(text, /投稿\s*URL\s*は、?\s*「(https?:[^」]+)」/) || grab(text, /投稿\s*URL\s*は、?\s*(https?:[^)]+)\)/);
  }

  function put(out, key, r) {
    if (r) out[key] = r;
  }

  // ------------------------------------------------------------------
  // サーバ基本情報（課題1より前のヘッダ部分）
  // ------------------------------------------------------------------
  function server(text) {
    const o = {};
    const title = text.split('\n').map((l) => l.trim()).find((l) => l);
    if (title) o._title = title;

    put(o, 'server_name', grab(text, new RegExp('サーバ名\\s*(' + ID + ')')));
    put(o, 'machine_image', grab(text, /マシンイメージ\s*([^\n・]+)/, { keepSpaces: true }));
    const it = grab(text, /インスタンスタイプ\s*([a-z0-9]+\.[a-z0-9]+)/i);
    if (it && /推奨/.test(text.slice(text.indexOf('インスタンスタイプ'), text.indexOf('インスタンスタイプ') + 40))) it.note = '問題文では「推奨」';
    put(o, 'instance_type', it);
    put(o, 'storage', grab(text, /ストレージ容量\s*(\d+\s*GB)/i));
    put(o, 'key_pair_name', grab(text, new RegExp('キーペア名\\s*:\\s*(' + ID + ')')));

    const net = text.match(/ネットワーク設定\s*([^\n・]+)/);
    if (net) {
      const tokens = net[1].match(/HTTPS?|SSH|\d{2,5}/gi) || [];
      if (tokens.length) o.ports = { value: tokens.join(', '), source: clip(net[0]) };
    }
    put(o, 'common_password', grab(text, /(?:全て|すべて)のパスワードは、?\s*「([^」]+)」/));
    return o;
  }

  // ------------------------------------------------------------------
  // 課題1: LAMP
  // ------------------------------------------------------------------
  function lamp(text) {
    const o = {};
    put(o, 'phpmyadmin_url', url(text));
    const explicit = grab(text, /root\s*の?パスワードは、?\s*「([^」]+)」/);
    if (explicit) {
      explicit.passwordMode = 'explicit';
      o.mysql_root_password = explicit;
    } else {
      const ref = text.match(/root\s*で指定されたパスワード[^\n]*/);
      o.mysql_root_password = ref
        ? { value: '', source: clip(ref[0]), passwordMode: 'common' }
        : { value: '', passwordMode: 'none' };
    }
    return o;
  }

  // ------------------------------------------------------------------
  // 課題2: ユーザディレクトリ
  // ------------------------------------------------------------------
  function userdir(text, raw) {
    const o = {};
    put(o, 'user', grab(text, /ユーザー?名は、?\s*「([^」]+)」/));
    const pw = grab(text, /パスワードは、?\s*「([^」]+)」/);
    if (pw) { pw.passwordMode = 'explicit'; o.password = pw; } else o.password = { value: '', passwordMode: 'none' };
    put(o, 'public_dir', grab(text, /公開ディレクトリは、?\s*「([^」]+)」/));
    put(o, 'index_file_name', grab(text, new RegExp('公開フォルダ内に\\s*(' + ID + '\\.(?:html?|php))')));

    // ファイル内容は改行・空白を保ったraw側から取る
    const cm = raw.match(/以下のとおりとします。?[ \t]*\n([\s\S]*?)\n[ \t]*・/);
    if (cm) {
      const content = cm[1].split('\n').map((l) => l.trim()).filter((l) => l).join('\n');
      if (content) o.index_file_content = { value: content, source: clip(cm[0]) };
    }
    put(o, 'url', url(text));
    return o;
  }

  // ------------------------------------------------------------------
  // 課題3: Basic認証
  // ------------------------------------------------------------------
  function basic(text) {
    const o = {};
    put(o, 'owner', grab(text, /ユーザー?「([^」]+)」のホームディレクトリ/));
    put(o, 'parent_dir', grab(text, /ホームディレクトリ内にある「([^」]+)」/));
    put(o, 'dir', grab(text, /「([^」]+)」というディレクトリ/));
    put(o, 'id', grab(text, /ID\s*は、?\s*「([^」]+)」/));
    const pw = grab(text, /パスワードは、?\s*「([^」]+)」/);
    if (pw) { pw.passwordMode = 'explicit'; o.password = pw; } else o.password = { value: '', passwordMode: 'none' };
    put(o, 'directory_index', grab(text, /(DirectoryIndex[^。]*)。/, { joinWith: '' }));
    put(o, 'url', url(text));
    return o;
  }

  // ------------------------------------------------------------------
  // 課題4・6・8: WordPress
  // ------------------------------------------------------------------
  function wordpress(text) {
    const o = {};
    const u = grab(text, new RegExp('公開するユーザー?名\\s*:\\s*(' + ID + ')'));
    if (u && /新規ユーザー?作成/.test(text)) u.note = '問題文に「新規ユーザ作成」と記載';
    put(o, 'user', u);
    put(o, 'db_name', grab(text, new RegExp('データベース名\\s*:\\s*(' + ID + ')')));
    put(o, 'db_collation', grab(text, /照合順序\s*:\s*([A-Za-z0-9_]+)/));
    put(o, 'install_dir', grab(text, /設置ディレクトリ\s*:\s*(\/\S+?)\s*に設置/));
    const top = text.match(/(https?:\/\/\S*?)にアクセスすると\s*wordpress\s*のトップ画面/i);
    if (top) o.install_condition = { value: top[1].replace(/\s+/g, '') + ' でWordPressのトップ画面を表示', source: clip(top[0]) };

    // 「WordPressに関する設定」の表（公開するユーザ名 と取り違えないよう、表の部分だけを見る）
    const si = text.search(/サイトのタイトル/);
    const table = si >= 0 ? text.slice(si) : '';
    if (table) {
      put(o, 'site_title', grab(table, new RegExp('サイトのタイトル\\s*' + TOKEN_OR_ID)));
      put(o, 'login_user', grab(table, new RegExp('ユーザー?名\\s*' + TOKEN_OR_ID)));
      put(o, 'email', grab(table, /メールアドレス\s*(学校の自分のメールアドレス|[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+)/));
      put(o, 'search_engine', grab(table, /検索エンジンでの表示\s*(チェック入れる\(表示しない\)|[^\n・]+)/));
    }
    const pt = grab(text, /タイトル\s*:\s*「([^」]+)」/, { keepSpaces: true });
    if (pt) {
      if (/\d+X{2,}/i.test(pt.value)) { pt.status = 'review'; pt.note = '「XXX」部分は学籍番号の例と思われます（問題文の表記のまま）'; }
      o.post_title = pt;
    }
    if (/投稿内容に指定はない/.test(text)) o.post_condition = { value: '投稿内容に指定なし', source: '投稿内容に指定はない' };
    else {
      const img = grab(text, /画像\s*:\s*([^\n]+)/, { keepSpaces: true });
      if (img) o.post_condition = { value: '画像: ' + img.value, source: img.source };
    }
    put(o, 'url', url(text));
    // WordPress課題にはLinux・WordPressログインのパスワード記載が無い（あれば明記として扱う）
    const pw = grab(text, /パスワードは、?\s*「([^」]+)」/);
    o.linux_password = { value: '', passwordMode: 'none' };
    o.login_password = pw ? Object.assign(pw, { passwordMode: 'explicit' }) : { value: '', passwordMode: 'none' };
    return o;
  }

  // ------------------------------------------------------------------
  // 課題5: Jupyter
  // ------------------------------------------------------------------
  function jupyter(text) {
    const o = {};
    put(o, 'user', grab(text, new RegExp('設置するユーザー?\\s*(' + ID + ')')));
    const pw = grab(text, /ログインするパスワード\s*([!-~]+)/);
    if (pw) {
      pw.passwordMode = 'explicit';
      if (/Jupyter/i.test(pw.value)) { pw.status = 'review'; pw.note = '表の区切りが読み取れず、後ろの文字列が混ざった可能性'; }
      o.password = pw;
    } else o.password = { value: '', passwordMode: 'none' };
    put(o, 'port', grab(text, /アクセスするポート\s*(\d+)/));
    put(o, 'program_condition', grab(text, /(Jupyter\s*ファイルを作成し[^\n・]*)/, { keepSpaces: true }));
    put(o, 'url', url(text));
    return o;
  }

  // ------------------------------------------------------------------
  // 課題7: wp-admin の Basic認証
  // ------------------------------------------------------------------
  function wpadminBasic(text) {
    const o = {};
    put(o, 'target_task', grab(text, /課題\s*(\d+)\s*で構築した\s*WordPress/i));
    put(o, 'id', grab(text, /ID\s*は、?\s*「([^」]+)」/));
    const pw = grab(text, /パスワード\s*は、?\s*「([^」]+)」/);
    if (pw) { pw.passwordMode = 'explicit'; o.password = pw; } else o.password = { value: '', passwordMode: 'none' };
    const conds = [];
    const ci = text.indexOf('以下の条件');
    if (ci >= 0) {
      text.slice(ci).split('・').slice(1).forEach((c) => {
        const t = c.replace(/\(投稿[\s\S]*$/, '').replace(/\s+/g, '').trim();
        if (t) conds.push(t);
      });
    }
    if (conds.length) o.conditions = { value: conds.join('\n'), source: '以下の条件を満たすこと' };
    put(o, 'url', url(text));
    return o;
  }

  // ------------------------------------------------------------------
  // 課題9: Docker MySQL / 課題10: 別イメージ
  // ------------------------------------------------------------------
  function dockerMysql(text) {
    const o = {};
    put(o, 'image', grab(text, /イメージは、?\s*([A-Za-z0-9_.\-\/:]+)\s*とする/));
    put(o, 'container_name', grab(text, /コンテナ名は、?\s*「([^」]+)」/));
    const pw = grab(text, /MySQL\s*のパスワードは、?\s*「([^」]+)」/i);
    if (pw) { pw.passwordMode = 'explicit'; o.password = pw; } else o.password = { value: '', passwordMode: 'none' };
    put(o, 'install_url', grab(text, /インストールは下記より実施\s*(https?:\/\/\S+?)(?=\s|※|$)/));
    put(o, 'image_url', grab(text, /(https?:\/\/hub\.docker\.com\/\S+?)(?=\s|・|$)/));
    put(o, 'notes', grab(text, /(管理者権限があるユーザでインストールすること)/, { keepSpaces: true }));
    return o;
  }

  function dockerOther(text) {
    const o = {};
    put(o, 'condition', grab(text, /(課題\s*\d+\s*とは異なるイメージ[^\n(。]*)/, { keepSpaces: true }));
    put(o, 'example', grab(text, /\(例\s*:\s*([^)]*)\)/, { keepSpaces: true }));
    return o;
  }

  const ParsingRules = {
    server,
    byType: {
      lamp,
      userdir,
      basic,
      wordpress,
      jupyter,
      wpadmin_basic: wpadminBasic,
      docker_mysql: dockerMysql,
      docker_other: dockerOther,
      unknown: () => ({}),
    },
  };
  SES.ParsingRules = ParsingRules;
  if (typeof module !== 'undefined' && module.exports) module.exports = ParsingRules;
})(typeof window !== 'undefined' ? window : globalThis);
