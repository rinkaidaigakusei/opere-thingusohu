# 開発者向けメモ

## 方針

- コマンドは note 記事（https://note.com/deft_snipe6047/n/n0b0969e8cbe5 ）の原文のまま。試験ごとに変わる部分だけを `{{変数}}` にしている
- note に無いコマンドは作らない（Basic認証・Docker などは「テンプレート未登録」として値だけ表示）
- 問題文に書かれていない値は補完しない（「学籍番号」は受験者情報に入力されたときだけ置き換える）
- パスワードは送信・永続保存しない。localStorage に保存するのは完了チェック・相違の承認・表示設定だけ。作業メモは sessionStorage
- 実行するのはコマンドの生成・表示・コピーまで（SSH や AWS は操作しない）

## ファイル構成

```
index.html
serve.py / start.bat   ローカル起動（127.0.0.1:8755、キャッシュ無効）
css/style.css, responsive.css
img/                   操作ガイド用の画像（It works!、vi の画面）
docs/                  説明書
js/
  parser.js            問題文の正規化（PDFの部首文字・改行対策）と解析の入口、手入力モードの空データ作成
  parsing-rules.js     課題ごとの抽出ルール（正規表現）
  task-detector.js     課題の分割・種類の判定（番号ではなく内容で判定）
  variable-manager.js  変数の状態管理・共通パスワード・学籍番号・パブリックDNSの置き換え
  template-engine.js   テンプレートへの値の反映、noteとの相違の検出、ステップで使う変数の一覧
  step-view.js / list-view.js / ui-common.js   表示
  progress.js          完了チェック（値は保存しない）
  memo.js              作業メモ（sessionStorage）
  clipboard.js         コピー
  app.js               画面遷移・イベント
data/
  tasks.json           課題の種類ごとの設定項目と手順（どのテンプレートを使うか）
  templates/*.json     note由来のコマンドテンプレート
tests/
  run-tests.js         解析・テンプレートのテスト（node tests/run-tests.js）
  fixtures.js          過去問の問題文（※公開リポジトリには含めない。.gitignore 済み）
  exam-tests.js        過去問を使うテストと期待値（※同上）
```

## テスト

```bash
node tests/run-tests.js
```

`tests/fixtures.js` と `tests/exam-tests.js`（過去問）が無い環境では、過去問を使うテストはスキップされます。
自分で過去問のテストを書くときは、この2つのファイルを用意してください（どちらも .gitignore 済み）。

## テンプレートの追加（Basic認証・Docker など）

`data/templates/basic-auth.json` などに次の形で追加し、`data/tasks.json` の該当課題の `steps` に
`{ "template": "ID" }` を追加して `"unregistered": true` を外す。

```json
{
  "id": "basic-xxx",
  "title": "作業名",
  "kind": "bulk | individual | aux | checklist",
  "modes": ["bulk", "staged"],
  "runAs": "{{owner}}",
  "workdir": "/home/{{owner}}/{{parent_dir}}",
  "lines": [
    { "original": "元のコマンド", "template": "{{dir}} などを入れたコマンド", "staged": ["分割1", "分割2"] }
  ],
  "inputs": [{ "label": "入力する値", "value": "{{password}}", "secret": true }],
  "guide": [{ "text": "画面の説明", "img": "img/xxx.png" }],
  "checkUrl": { "label": "確認ページを開く", "url": "{{site_root}}xxx/" },
  "variables": {},
  "notes": [],
  "verify": "完了確認方法",
  "source": "元記事の参照箇所",
  "history": [{ "date": "YYYY-MM-DD", "change": "内容" }]
}
```

`{{...}}` には、その課題の項目名（tasks.json の `key`、例: `dir`, `id`, `password`）か、
アプリ全体の変数名（`var`、例: `linux_user`, `public_dir`, `site_root`）が使える。

## 更新したとき

`index.html` の `?v=YYYYMMDD` を更新すると、GitHub Pages など他の環境でも古いファイルがキャッシュされにくくなる。
