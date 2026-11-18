/**
 * 解析・テンプレートのテスト。
 * 実行: node tests/run-tests.js
 *
 * 過去問（大学の試験問題）を使うテストは tests/fixtures.js と tests/exam-tests.js にあり、
 * 公開リポジトリには含めていない。2つがある環境では自動で一緒に実行する。
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const Parser = require(path.join(root, 'js/parser.js'));
const VM = require(path.join(root, 'js/variable-manager.js'));
const TE = require(path.join(root, 'js/template-engine.js'));

const defs = JSON.parse(fs.readFileSync(path.join(root, 'data/tasks.json'), 'utf8'));
const files = ['aws', 'lamp', 'user-directory', 'basic-auth', 'wordpress', 'jupyter', 'docker'].map((n) =>
  JSON.parse(fs.readFileSync(path.join(root, 'data/templates', n + '.json'), 'utf8')));
const templates = TE.indexTemplates(files);

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; }
  else { fail++; console.log('  NG ' + label + ': expected ' + JSON.stringify(expected) + ' / actual ' + JSON.stringify(actual)); }
}

function load(text) {
  const parsed = Parser.parse(text);
  const model = VM.build(parsed, defs);
  const v = (varName) => (VM.byVar(model, varName) || {});
  const plan = TE.buildPlan(model, defs, templates, { confirmations: {} });
  return { parsed, model, v, plan };
}

// 例として使うアドレス（実在のサーバではない）
const dns = 'ec2-198-51-100-10.compute-1.amazonaws.com';
const pasted = `~ $ chmod 400 "test.pem"
~ $ ssh -i "test.pem" ec2-user@${dns}
The authenticity of host '${dns} (198.51.100.10)' can't be established.
[ec2-user@ip-172-31-0-1 ~]$`;

// ------------------------------------------------------------------
// 手入力モード（問題文なし）
// ------------------------------------------------------------------
console.log('■ 手入力モード');
const man = Parser.createManual([{ type: 'lamp' }, { type: 'userdir' }, { type: 'wordpress' }, { type: 'wordpress' }], defs);
const mm = VM.build(man, defs);
const mv = (n) => VM.byVar(mm, n) || {};
eq('手入力: 課題番号', man.tasks.map((t) => t.number + ':' + t.type + ':' + (t.prefix || '')), ['1:lamp:', '2:userdir:', '3:wordpress:wordpress', '4:wordpress:wordpress_t4']);
eq('手入力: 初期は未設定', mv('linux_user').status, 'unset');
VM.set(mm, mm.server, 'common_password', 'Abc12@');
eq('手入力: 共通パスワードを仮反映', [mv('mysql_root_password').value, mv('mysql_root_password').status], ['Abc12@', 'review']);
VM.set(mm, mm.tasks[1], 'user', 'taro');
const mplan = TE.buildPlan(mm, defs, templates, { confirmations: {} });
eq('手入力: useradd', mplan.sections.find((s) => s.uid === 't2').steps.find((s) => s.templateId === 'ud-useradd').lines[0].text, 'sudo useradd taro');
eq('手入力: 未設定のタイトルは項目名', mplan.sections.find((s) => s.uid === 't2').steps.find((s) => s.templateId === 'ud-index').title, '（作成するファイル名） の作成');
eq('手入力: LAMP一括コマンドは原文のまま', mplan.sections.find((s) => s.type === 'lamp').steps.find((s) => s.templateId === 'lamp-all').lines[0].text, templates['lamp-all'].lines[0].original);
eq('手入力: WordPressのダウンロードは原文のまま', mplan.sections.find((s) => s.uid === 't3').steps.find((s) => s.templateId === 'wp-download').lines[0].text,
  'cd /var/www &&wget https://ja.wordpress.org/latest-ja.tar.gz&&tar xzvf latest-ja.tar.gz');

// 授業の課題・練習の印
const awsLaunch = mplan.sections[0].steps.find((s) => s.templateId === 'aws-launch');
eq('課題: 起動設定に「自由」と「やる」の印', awsLaunch.guide.map((g) => g.practice && g.practice.level), ['free', 'must', 'must', 'must', 'must', 'must', 'must', null]);
eq('課題: 起動設定の値入力欄は出さない', awsLaunch.vars.length, 0);
eq('課題: 説明あり', !!awsLaunch.practiceNote, true);

const rootVar = mplan.sections.find((s) => s.type === 'lamp').steps.find((s) => s.templateId === 'lamp-mysql-password').vars.find((v) => v.var === 'mysql_root_password');
eq('課題: rootパスワードは「自分で決めてOK」', /自分で決めた/.test(rootVar.modeHint), true);

// ------------------------------------------------------------------
// 手順書から値を入力 → 同じ変数を使うステップに反映
// ------------------------------------------------------------------
console.log('■ 手順書からの値入力');
const lampSteps = (p) => p.sections.find((s) => s.type === 'lamp').steps;
let pwStep = lampSteps(mplan).find((s) => s.templateId === 'lamp-mysql-password');
eq('初期パスワード未入力はコピー不可', pwStep.inputs[0].copyable, false);
eq('ステップの変数一覧に初期パスワード', pwStep.vars.map((v) => v.var), ['mysql_root_password', 'mysql_temp_password']);
const ref = mm.vars.mysql_temp_password;
VM.set(mm, ref.task, ref.key, 'Xy7#tmp');
const mplan2 = TE.buildPlan(mm, defs, templates, { confirmations: {} });
pwStep = lampSteps(mplan2).find((s) => s.templateId === 'lamp-mysql-password');
eq('入力後: 初期パスワード', [pwStep.inputs[0].text, pwStep.inputs[0].copyable], ['Xy7#tmp', true]);
eq('入力後: 一括コマンドの欄にも同じ値', lampSteps(mplan2).find((s) => s.templateId === 'lamp-all').inputs[0].text, 'Xy7#tmp');
eq('入力後: set password', pwStep.lines[1].text, "set password for root@localhost = 'Abc12@';");

// ------------------------------------------------------------------
// 接続情報の貼り付け → publicDNS の置き換え
// ------------------------------------------------------------------
console.log('■ 接続情報');
eq('ターミナル出力から抽出', VM.parseConnection(pasted), { ssh_command: 'ssh -i "test.pem" ec2-user@' + dns, public_dns: dns, ssh_chmod: 'chmod 400 "test.pem"' });
eq('入力欄に改行が消えた形で貼っても抽出', VM.parseConnection(pasted.replace(/\n/g, ' ')).public_dns, dns);
eq('DNSだけでも可', VM.parseConnection(dns).public_dns, dns);
VM.set(mm, mm.server, 'public_dns', pasted);
eq('貼り付け後 public_dns', mv('public_dns').value, dns);
eq('貼り付け後 ssh_command', mv('ssh_command').value, 'ssh -i "test.pem" ec2-user@' + dns);
eq('サーバURL', mv('site_root').value, 'http://' + dns + '/');
// 入力途中の文字はDNSにしない／ssh 欄に貼っても DNS が入る
const mm2 = VM.build(Parser.createManual([{ type: 'lamp' }], defs), defs);
VM.set(mm2, mm2.server, 'public_dns', 'ssh -i');
eq('入力途中はDNSにしない', VM.get(mm2, mm2.server, 'public_dns').value, '');
VM.set(mm2, mm2.server, 'ssh_command', 'ssh -i "a.pem" ec2-user@' + dns);
eq('ssh 欄に貼ってもDNSが入る', VM.get(mm2, mm2.server, 'public_dns').value, dns);
const conn = TE.buildPlan(mm2, defs, templates, { confirmations: {} }).sections[0].steps.find((s) => s.templateId === 'aws-connect');
eq('接続ステップは貼り付け欄1つ（個別の入力欄なし）', [conn.connectPaste, conn.vars.length], [true, 0]);
VM.set(mm, mm.tasks[0], 'phpmyadmin_url', 'http://publicDNS/phpMyAdmin/');
eq('URLの publicDNS を置換', mv('phpmyadmin_url').value, 'http://' + dns + '/phpMyAdmin/');

// ------------------------------------------------------------------
// 過去問（あれば）
// ------------------------------------------------------------------
let F = null, examTests = null;
try { F = require('./fixtures.js'); examTests = require('./exam-tests.js'); } catch (e) { F = null; }
if (F && examTests) examTests({ eq, load, VM, TE, templates, defs, F, pasted, dns });
else console.log('※ 過去問のテスト（tests/fixtures.js・tests/exam-tests.js）が無いためスキップしました');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
