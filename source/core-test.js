// 純ロジックの検算。実行: node source/core-test.js
// index.html の <script id="core"> を取り出して読み込み、往復・添え文・壊れたリンク・止める文字・ひな形・下書きの読み込みを確かめる
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1];
const ctx = { module: { exports: {} }, TextEncoder, TextDecoder, btoa, atob, console };
vm.createContext(ctx); vm.runInContext(src, ctx);
const PG = ctx.module.exports;
let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log('NG', name, '\n  got ', g, '\n  want', w); }
}
const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hashOf = a => '#v1=' + b64(JSON.stringify(a));
const draftOf = d => Object.assign(PG.emptyDraft(), d);

// S1 Card1の値で往復・添え文
const c1 = PG.toConfig(PG.sampleDraft()).cfg;
eq('S1 cfg', c1.photos, [[1, '本体の全体', 3], [4, '本体の右側にある型番シール', 20], [5, '水が垂れている所のアップ', 1], [6, '室外機の全体と置き場所', 2]]);
eq('S1 roundtrip', PG.decodeHash('#' + PG.encode(c1)), c1);
eq('S1 url', PG.makeUrl('https://x.test/photo-guide-link/', c1).indexOf('https://x.test/photo-guide-link/#v1='), 0);
eq('S1 msg 2/4', PG.message(c1, [true, true, false, false]),
  '写真を2枚お送りします\n1 本体の全体\n2 本体の右側にある型番シール\n3 水が垂れている所のアップ（撮れませんでした）\n4 室外機の全体と置き場所（撮れませんでした）');
eq('S1 tips', PG.tipList(20), ['文字が読めるまで近づいて', '斜めから（光の反射をよける）']);

// S2 全部・なし・1枚
eq('S2 all', PG.message(c1, [true, true, true, true]).split('\n')[0], '写真を4枚お送りします');
eq('S2 all no mark', /撮れませんでした/.test(PG.message(c1, [true, true, true, true])), false);
eq('S2 none = 印を使っていない', PG.message(c1, [false, false, false, false]), '写真をお送りします\n1 本体の全体\n2 本体の右側にある型番シール\n3 水が垂れている所のアップ\n4 室外機の全体と置き場所');
const one = PG.toConfig(draftOf({ shop: 'A店', task: '見積もり', photos: [{ fig: 2, what: '正面', tips: 0 }] })).cfg;
eq('S2 one', PG.message(one, [true]), '写真を1枚お送りします\n1 正面');

// S3 往復の文字
['日本語😀𠮷ｶﾅ＃＆', '"引用"\\と[角]', '；，、。'].forEach((s, i) => {
  const r = PG.toConfig(draftOf({ shop: 'S' + i, task: s.slice(0, 10), note: s, photos: [{ fig: 8, what: s, tips: 0 }] }));
  eq('S3 ok ' + i, r.errors, []);
  if (r.cfg) eq('S3 rt ' + i, PG.decodeHash(PG.encode(r.cfg)), r.cfg);
});

// S4 壊れたハッシュ
const good = [1, 'A店', '見積もり', [[1, '全体', 1]], ''];
eq('S4 good', !!PG.decodeHash(hashOf(good)), true);
const bad = {
  empty: '', cut: hashOf(good).slice(0, -5), v2: hashOf(good).replace('v1', 'v2'), notArr: hashOf({ a: 1 }),
  zero: hashOf([1, 'A', 'B', [], '']), seven: hashOf([1, 'A', 'B', Array(7).fill([1, 'x', 0]), '']),
  fig0: hashOf([1, 'A', 'B', [[0, 'x', 0]], '']), fig9: hashOf([1, 'A', 'B', [[9, 'x', 0]], '']), figStr: hashOf([1, 'A', 'B', [['1', 'x', 0]], '']),
  bit64: hashOf([1, 'A', 'B', [[1, 'x', 64]], '']), bit4: hashOf([1, 'A', 'B', [[1, 'x', 15]], '']), bitNeg: hashOf([1, 'A', 'B', [[1, 'x', -1]], '']),
  whatEmpty: hashOf([1, 'A', 'B', [[1, '', 0]], '']), longShop: hashOf([1, 'あ'.repeat(31), 'B', [[1, 'x', 0]], '']),
  longWhat: hashOf([1, 'A', 'B', [[1, 'い'.repeat(25), 0]], '']), photoLen: hashOf([1, 'A', 'B', [[1, 'x']], '']),
  arrLen: hashOf([1, 'A', 'B', [[1, 'x', 0]]]), ver: hashOf([2, 'A', 'B', [[1, 'x', 0]], '']), extraSp: hashOf([1, 'A ', 'B', [[1, 'x', 0]], '']),
  blockedInHash: hashOf([1, 'A', 'B', [[1, '通帳の表紙', 0]], '']), linkInHash: hashOf([1, 'A', 'see example.com', [[1, 'x', 0]], '']),
  huge: '#v1=' + 'A'.repeat(1500), junk: '#v1=@@@', badUtf8: '#v1=' + Buffer.from([0xff, 0xfe]).toString('base64')
};
Object.keys(bad).forEach(k => eq('S4 ' + k, PG.decodeHash(bad[k]), null));

// S5 止める文字
['http://x', 'www.x', 'example.com', 'ネイル.com', 'a@b', '090-1234-5678', '09012345678', '０９０ １２３４ ５６７８', '+81 90 1234 5678'].forEach(s =>
  eq('S5 block ' + s, !!PG.blockedReason(s), true));
['型番', '右から2番目', '3枚目', '200V', '幅180cm', '2026年11月14日', '買取の品', '査定', 'M.Nail'].forEach(s =>
  eq('S5 pass ' + s, PG.blockedReason(s), ''));
['免許証の表', '健康保険証', 'マイナンバーカード', '通帳', 'キャッシュカード', 'クレジットカード', 'パスポート', '暗証番号', '本人確認', '身分証', '在留カード', 'ｷｬｯｼｭｶｰﾄﾞ', 'マイナ ンバー', '通　帳'].forEach(s =>
  eq('S5 id ' + s, PG.blockedReason(s), 'id'));
eq('S5 id error text', PG.toConfig(draftOf({ shop: 'A', task: 'B', photos: [{ fig: 1, what: '免許証', tips: 0 }] })).errors, ['写真1の「何を撮るか」：このページでは、身分証やお金に関わる書類の写真はお願いできません']);
eq('S5 phone error text', PG.toConfig(draftOf({ shop: 'A 03-1234-5678', task: 'B', photos: [{ fig: 1, what: 'x', tips: 0 }] })).errors, ['店名に電話番号らしい文字は入れられません（型番などの長い数字も止まります）']);
// レビュー①で素通りした言い方（身分証・お金の書類）
const inv = [0xfe0f, 0x034f, 0x3164, 0x2800, 0x180e].map(c => '通' + String.fromCharCode(c) + '帳');
['運転免許の表と裏', '免許の表面', 'マイナカードの表', '健康保険の証', '口座番号が分かる所', 'キャッシュのカード', 'クレカの表と裏', 'デビットカード', '住民票', '年金手帳', '学生証', '社員証',
  '顔写真', 'ご本人の自撮り', '暗証', 'PIN番号', 'カードの裏の3桁', '印鑑', '実印', '残高の画面', 'つうちょうの1ページ目', 'めんきょしょう', 'ツウチョウ', '通・帳', '通/帳', '通_帳',
  'ID card', 'passport', 'bank book'].concat(inv).forEach(s => eq('S5 id2 ' + s, PG.blockedReason(s), 'id'));
eq('S5 invisible in hash', PG.decodeHash(hashOf([1, 'A', 'B', [[1, inv[2], 0]], ''])), null);
// 誤検知しないこと
['マイナスドライバー', 'キャッシュレス対応', '型番', '3枚目', 'スピン', 'ピンの位置', '本体の裏側', 'ハンドメイド'].forEach(s => eq('S5 pass2 ' + s, PG.blockedReason(s), ''));
// リンク・送り先の誘導
['lin.ee/abc', 'forms.gle/abc', 'youtu.be/x', 'x.gd/abc', 'sample.ai', 'sample(dot)com', 'sample ドット com'].forEach(s => eq('S5 link2 ' + s, PG.blockedReason(s), 'link'));
['LINE ID sagi123に送ってください', 'ID検索 abc', 'インスタのDMへ', '友だち追加してください', 'ラインIDはこちら'].forEach(s => eq('S5 lead ' + s, PG.blockedReason(s), 'lead'));
// 漢数字の電話番号
['090一1234一5678', '〇九〇 一二三四 五六七八'].forEach(s => eq('S5 kanji phone ' + s, PG.blockedReason(s), 'phone'));
eq('S5 kanji date pass', PG.blockedReason('二〇二六年十一月'), '');
// 店名の銀行・役所
['サンプル銀行 お手続き窓口', '〇〇市役所', 'ゆうちょ窓口'].forEach(s => eq('S5 org ' + s, PG.toConfig(draftOf({ shop: s, task: 'B', photos: [{ fig: 1, what: 'x', tips: 0 }] })).errors, ['店名に銀行・役所などの名前は入れられません']));
eq('S5 org in hash', PG.decodeHash(hashOf([1, 'サンプル銀行', 'B', [[1, 'x', 0]], ''])), null);
eq('S5 org ok in what', PG.toConfig(draftOf({ shop: 'A店', task: 'B', photos: [{ fig: 1, what: '銀行の看板の横の入口', tips: 0 }] })).errors, []);
// 絵文字で上限まで埋めると、リンクを作る時点で止まる（開くと壊れているにならない）
const emo = PG.toConfig(draftOf({ shop: '😀'.repeat(30), task: '😀'.repeat(24), note: '😀'.repeat(80), photos: Array(6).fill({ fig: 8, what: '😀'.repeat(24), tips: 52 }) }));
eq('S5 emoji too long', emo.errors, ['文字が多すぎてリンクにできません。絵文字や文を短くしてください']);

// S6 XSS（文字としてそのまま往復する。表示は check.js で確認）
const xss = '<img src=x onerror=alert(1)>';
const rx = PG.toConfig(draftOf({ shop: xss.slice(0, 30), task: '"><script>', note: '</svg><script>', photos: [{ fig: 1, what: '</svg><script>', tips: 0 }] }));
eq('S6 ok', rx.errors, []);
eq('S6 rt', PG.decodeHash(PG.encode(rx.cfg)), rx.cfg);

// S7 ひな形
eq('S7 presets', PG.PRESETS.map(p => p.photos.length), [4, 4, 3, 4, 4]);
PG.PRESETS.forEach(p => {
  const r = PG.toConfig(draftOf({ shop: 'A店', task: '見積もり', photos: PG.presetPhotos(p.id) }));
  eq('S7 valid ' + p.id, r.errors, []);
  eq('S7 no money words ' + p.id, /買取|査定/.test(JSON.stringify(p)), false);
});
eq('S7 blank', PG.presetPhotos('blank'), [{ fig: 1, what: '', tips: 0 }]);
eq('S7 hasPhotoText', [PG.hasPhotoText(PG.emptyDraft()), PG.hasPhotoText(PG.sampleDraft())], [false, true]);

// 入力の検証
eq('V empty', PG.toConfig(PG.emptyDraft()).errors, ['店名を入れてください', '用件を入れてください', '写真1の「何を撮るか」を入れてください']);
eq('V 7 photos', PG.toConfig(draftOf({ shop: 'A', task: 'B', photos: Array(7).fill({ fig: 1, what: 'x', tips: 0 }) })).errors, ['撮ってほしい写真は6枚までです']);
eq('V 0 photos', PG.toConfig(draftOf({ shop: 'A', task: 'B', photos: [] })).errors, ['撮ってほしい写真を1枚以上入れてください']);
eq('V 4 tips', PG.toConfig(draftOf({ shop: 'A', task: 'B', photos: [{ fig: 1, what: 'x', tips: 15 }] })).errors, ['写真1のコツは3つまでです']);
eq('V long', PG.toConfig(draftOf({ shop: 'あ'.repeat(31), task: 'B', photos: [{ fig: 1, what: 'x', tips: 0 }] })).errors, ['店名は30字までです']);
eq('V emoji count', PG.toConfig(draftOf({ shop: '😀'.repeat(30), task: 'B', photos: [{ fig: 1, what: 'x', tips: 0 }] })).errors, []);
eq('V clean', PG.toConfig(draftOf({ shop: ' A\n店 ', task: 'B', photos: [{ fig: 1, what: 'x', tips: 0 }] })).cfg.shop, 'A 店');
eq('V 6 photos max url', PG.makeUrl('https://nncf123nncf-oss.github.io/photo-guide-link/', PG.toConfig(draftOf({ shop: 'あ'.repeat(30), task: 'い'.repeat(24), note: 'う'.repeat(80), photos: Array(6).fill({ fig: 8, what: 'え'.repeat(24), tips: 52 }) })).cfg).split('#')[1].length <= PG.HASH_MAX, true);

// 下書きの読み込み（壊れた保存値）
eq('D null', PG.sanitizeDraft(null), PG.emptyDraft());
eq('D bad', PG.sanitizeDraft({ shop: 1, photos: [{ fig: 99, what: 3, tips: 63 }, null] }).photos, [{ fig: 1, what: '', tips: 0 }, { fig: 1, what: '', tips: 0 }]);
eq('D trim 6', PG.sanitizeDraft({ photos: Array(9).fill({ fig: 2, what: 'a', tips: 1 }) }).photos.length, 6);

// 撮れたの印の保存
eq('C key differs', PG.checkKey(c1) === PG.checkKey(one), false);
eq('C parse', [PG.parseChecks('[1,0,0,1]', 4), PG.parseChecks('[1,0]', 4), PG.parseChecks('x', 4), PG.parseChecks('[1,2,0,0]', 4)], [[true, false, false, true], null, null, null]);

console.log('core-test: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
