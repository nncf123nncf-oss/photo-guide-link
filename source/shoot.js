// 投稿カード用の素材を撮る（Chrome headless / CDP・DPR2）。実行: node source/shoot.js <出力フォルダ> [--probe]
// 01-x-primary: 開く画面（お客さん側）。写真1・2に「撮れた」の印をつけた状態で、進み具合〜写真3のカードまで
// 02-make-1000: 作る画面（お店側）1000px・2列。左に店名〜写真1の枠、右にお客さんから見える画面のプレビュー（リンクを作る前。URLは写さない）
// 03-message-560: 開く画面の下部（撮るときの注意と添え文のコピー）（予備）
// 見本はすべて架空（サンプル電器サービス）。画面の「サンプルを入れる」で入る値をそのまま使う
const fs = require('fs'), path = require('path'), http = require('http');
const { launch } = require('./cdp');
const OUT = path.resolve(process.argv[2] || 'shots');
const PROBE = process.argv.includes('--probe');
fs.mkdirSync(OUT, { recursive: true });
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8793, ORIGIN = 'http://127.0.0.1:' + PORT + '/';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); }).listen(PORT);
const rect = sel => `(()=>{const e=typeof ${JSON.stringify(sel)}==='string'?document.querySelector(${JSON.stringify(sel)}):null;const r=e.getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height}})()`;
const rectEv = js => `(()=>{const e=${js};const r=e.getBoundingClientRect();return {x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height}})()`;
const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
const pad = (a, p) => ({ x: Math.max(0, a.x - p), y: Math.max(0, a.y - p), width: a.w + p * 2, height: a.h + p * 2 });
const click = t => `[...document.querySelectorAll('button')].find(x=>x.textContent===${JSON.stringify(t)}).click()`;
const report = (name, c) => console.log(name, JSON.stringify({ w: Math.round(c.width), h: Math.round(c.height), ratio: +(c.width / c.height).toFixed(3) }));

(async () => {
  const b = await launch(9474);
  await b.send('Network.enable');
  await b.send('Network.setBlockedURLs', { urls: ['*cloudflareinsights.com*'] });
  // 作る画面にサンプルを入れる。リンクは作らない（共有用URLの欄に撮影用サーバーのアドレスが出るため、写さない）
  // 高さを大きくして、右の列（position: sticky・max-height）が途中で切れないようにする
  await b.open(ORIGIN, 1000, 4200, 2, false, 'light');
  await b.ev(`localStorage.clear();sessionStorage.clear();window.confirm=()=>true;` + click('サンプルを入れる')); await b.sleep(600);
  const url = await b.ev(`PG.makeUrl(${JSON.stringify(ORIGIN)}, PG.toConfig(PG.sampleDraft()).cfg)`);

  // 02: 1000px・2列。左の店名〜写真1の枠、右のプレビューの見出し〜プレビューの写真2のカード
  const row1 = await b.ev(rectEv(`document.querySelectorAll('.row')[0]`));
  const form = await b.ev(rectEv(`document.querySelector('.layout > div > .panel')`));
  const pv1 = await b.ev(rectEv(`document.querySelector('.sticky .shot')`));
  const pvH = await b.ev(rectEv(`document.querySelector('.sticky h2')`));
  console.log('rects', JSON.stringify({ row1, form, pv1, pvH }));
  // 下端は右のプレビューの写真2のカードの下まで（その下の写真3のカードが途中で切れて写らないように。左の写真1の枠は下の余白が少し切れる）
  const pv2 = await b.ev(rectEv(`document.querySelectorAll('.sticky .shot')[1]`));
  const c2a = pad(union(union({ x: form.x, y: form.y, w: form.w, h: 1 }, pvH), pv2), 14);
  const c2 = Object.assign(c2a, { height: pv2.y + pv2.h + 6 - c2a.y });
  report('02-make-1000', c2);
  if (!PROBE) await b.shot(path.join(OUT, '02-make-1000.png'), c2);

  // 01: 開く画面。幅560px（開く画面の最大幅）・DPR2。写真1・2に「撮れた」の印。480px以上ではカードが横並び（文が左・図が右）
  for (const w of PROBE ? [390, 430, 480, 560] : [560]) {
    await b.open(url, w, 1600, 2, true, 'light');
    await b.ev(`sessionStorage.clear();location.reload()`); await b.sleep(600);
    await b.ev(`document.querySelectorAll('.check')[0].click();document.querySelectorAll('.check')[1].click()`); await b.sleep(200);
    const prog = await b.ev(rect('.progress'));
    const s3 = await b.ev(rectEv(`document.querySelectorAll('.shot')[2]`));
    const c1 = pad(union(prog, s3), 12);
    report('01-view-' + w, c1);
    if (!PROBE) await b.shot(path.join(OUT, '01-x-primary.png'), c1);
    // 03: 同じ画面の下部（注意と添え文）
    if (!PROBE) {
      const saf = await b.ev(rect('.safety'));
      const box = await b.ev(rectEv(`document.querySelector('.msgbox').closest('.panel')`));
      const c3 = pad(union(saf, box), 12);
      report('03-message-' + w, c3);
      await b.shot(path.join(OUT, '03-message-560.png'), c3);
    }
  }
  b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
