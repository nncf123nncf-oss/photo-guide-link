// 実画面の確認（Chrome headless / CDP）。実行: node source/check.js <出力フォルダ>
// 作る→URL→開く、375px/880px/1000pxの矩形、ライト/ダーク、撮れたの印と添え文、印の保存、XSS、壊れたリンク、下書き、並べ替え、計測ビーコン
const fs = require('fs'), path = require('path'), http = require('http');
const { launch } = require('./cdp');
const OUT = path.resolve(process.argv[2] || 'check-out');
fs.mkdirSync(OUT, { recursive: true });
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'));
const PORT = 8781, ORIGIN = 'http://127.0.0.1:' + PORT + '/';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); }).listen(PORT);
let ng = 0;
const ok = (name, cond, info) => { if (!cond) ng++; console.log((cond ? 'OK ' : 'NG ') + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
const measure = `(()=>{const out={sw:document.documentElement.scrollWidth,iw:innerWidth,over:[],small:[]};
  document.querySelectorAll('main *').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&r.right>innerWidth+0.5)out.over.push(e.tagName+'.'+(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className))});
  document.querySelectorAll('main button:not([hidden]), main input[type=text], main select, main label.tip').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&(r.height<43.5||r.width<43.5))out.small.push((e.textContent||e.type||e.tagName).slice(0,14)+':'+Math.round(r.width)+'x'+Math.round(r.height))});
  out.over=[...new Set(out.over)].slice(0,8);out.small=out.small.slice(0,8);return out})()`;
const click = t => `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent===${JSON.stringify(t)});if(!b)throw new Error('no button '+${JSON.stringify(t)});b.click();return true})()`;

(async () => {
  const b = await launch(9431);
  const reqs = [];
  b.on(m => { if (m.method === 'Network.requestWillBeSent') reqs.push(m.params.request.url); });
  await b.send('Network.enable');
  // 本番の計測に検算の閲覧を混ぜないため、計測ビーコンを止める
  await b.send('Network.setBlockedURLs', { urls: ['*cloudflareinsights.com*'] });
  const errs = [];
  b.on(m => { if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description)); });

  // 1) 作る画面 375px・空
  await b.open(ORIGIN, 375, 900, 2, true, 'light');
  await b.ev(`localStorage.clear();sessionStorage.clear()`); await b.open(ORIGIN, 375, 900, 2, true, 'light');
  let m = await b.ev(measure); ok('make-empty 375 no overflow', m.sw <= 375 && !m.over.length, m);
  ok('make-empty 375 targets>=44', !m.small.length, m.small);
  await b.ev(click('リンクを作る')); await b.sleep(200);
  ok('empty errors', /店名を入れてください/.test(await b.ev(`document.querySelector('.errors[role=alert]').innerText`)));
  // 2) サンプル → リンク
  await b.ev(`window.confirm=()=>true;` + click('サンプルを入れる')); await b.sleep(300);
  m = await b.ev(measure); ok('make-sample 375 no overflow', m.sw <= 375 && !m.over.length, m); ok('make-sample 375 targets', !m.small.length, m.small);
  await b.ev(click('リンクを作る')); await b.sleep(300);
  const gen = await b.ev(`({len:document.querySelector('.len').textContent,url:document.querySelector('textarea.urlbox').value})`);
  ok('url generated', /#v1=/.test(gen.url), gen.len);
  fs.writeFileSync(path.join(OUT, 'sample-url.txt'), gen.url);
  // 3) コツは3つまで（4つ目が押せない）
  const tipState = await b.ev(`(()=>{const r=document.querySelector('.row');const ins=[...r.querySelectorAll('.tip input')];ins.filter(i=>!i.checked)[0].click();return ins.map(i=>(i.checked?'c':'-')+(i.disabled?'d':''))})()`);
  ok('tips max 3', tipState.filter(s => s[0] === 'c').length === 3 && tipState.filter(s => s === '-d').length === 3, tipState);
  // 4) 並べ替え（写真1を下へ → 1と2が入れ替わり、フォーカスが動いた写真の「下へ」に）
  const mv = await b.ev(`(()=>{document.querySelector('.row .row-head button:nth-of-type(2)').click();const ws=[...document.querySelectorAll('.row input[type=text]')].map(i=>i.value);return {ws,focus:document.activeElement.getAttribute('aria-label')}})()`);
  ok('reorder', mv.ws[0] === '本体の右側にある型番シール' && mv.ws[1] === '本体の全体' && mv.focus === '写真2を下へ', mv);
  const firstUp = await b.ev(`document.querySelector('.row .row-head button').disabled`); ok('first up disabled', firstUp === true);
  // 5) 下書きがリロード後に戻る
  await b.open(ORIGIN, 375, 900, 2, true, 'light');
  const kept = await b.ev(`[...document.querySelectorAll('.row input[type=text]')].map(i=>i.value)`);
  ok('draft restored', kept[0] === '本体の右側にある型番シール' && kept.length === 4, kept);
  // 6) ひな形の選び直し（確認を断ると変わらない／受けると変わる）
  const pre = await b.ev(`(()=>{const s=document.querySelectorAll('select')[0];window.confirm=()=>false;s.value='clean';s.dispatchEvent(new Event('change'));const a=document.querySelectorAll('.row').length;window.confirm=()=>true;s.value='clean';s.dispatchEvent(new Event('change'));const w=[...document.querySelectorAll('.row input[type=text]')].map(i=>i.value);return {a,w}})()`);
  ok('preset confirm', pre.a === 4 && pre.w[0] === 'お部屋の全体' && pre.w.length === 3, pre);
  // 7) 止める言葉（身分証）
  const idErr = await b.ev(`(()=>{const i=document.querySelector('.row input[type=text]');i.value='免許証の表';i.dispatchEvent(new Event('input'));${click('リンクを作る')};return document.querySelector('.errors[role=alert]').innerText})()`);
  ok('id word blocked', /身分証やお金に関わる書類/.test(idErr), idErr.replace(/\n/g, ' / '));

  // 8) デスクトップ1000px 作る画面（Card2の第一候補）
  await b.ev(`localStorage.clear()`); await b.open(ORIGIN, 1000, 900, 2, false, 'light');
  await b.ev(`window.confirm=()=>true;` + click('サンプルを入れる')); await b.sleep(300); await b.ev(click('リンクを作る')); await b.sleep(300);
  m = await b.ev(measure); ok('make 1000 no overflow', m.sw <= 1000 && !m.over.length, m);
  ok('two columns', await b.ev(`getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length===2`));
  await b.shot(path.join(OUT, 'make-1000.png'), { x: 0, y: 0, width: 1000, height: await b.ev('document.documentElement.scrollHeight') });

  // 9) 開く画面 375px ライト（iPhoneの幅・DPR2）
  const url = gen.url.replace(/^[^#]*/, ORIGIN);
  await b.open(url, 375, 812, 2, true, 'light');
  const v = await b.ev(`({shop:document.querySelector('.v-shop').textContent,task:document.querySelector('.v-task').textContent,cards:document.querySelectorAll('.shot').length,prog:document.querySelector('.progress').textContent,notice:!!document.querySelector('.notice'),safety:document.querySelector('.safety').innerText.length>50,figs:document.querySelectorAll('.shot svg.fig path, .shot svg.fig rect').length})`);
  ok('view content', v.shop === 'サンプル電器サービス' && v.cards === 4 && v.prog === '4枚中0枚 撮れました' && v.notice && v.safety && v.figs > 8, v);
  m = await b.ev(measure); ok('view 375 no overflow', m.sw <= 375 && !m.over.length, m); ok('view 375 targets', !m.small.length, m.small);
  await b.ev(`document.querySelectorAll('.check')[0].click();document.querySelectorAll('.check')[1].click()`); await b.sleep(100);
  const after = await b.ev(`({prog:document.querySelector('.progress').textContent,msg:document.querySelector('textarea.msgbox').value,pressed:[...document.querySelectorAll('.check')].map(x=>x.getAttribute('aria-pressed')),done:document.querySelectorAll('.shot.done').length})`);
  ok('checks', after.prog === '4枚中2枚 撮れました' && after.pressed.join() === 'true,true,false,false' && after.done === 2, after);
  ok('message', after.msg === '写真を2枚お送りします\n1 本体の全体\n2 本体の右側にある型番シール\n3 水が垂れている所のアップ（撮れませんでした）\n4 室外機の全体と置き場所（撮れませんでした）', after.msg);
  await b.shot(path.join(OUT, 'view-375-light.png'), { x: 0, y: 0, width: 375, height: await b.ev('document.documentElement.scrollHeight') });
  // 10) 印の保存（リロードで残る・別のリンクでは引き継がない）
  await b.open(url, 375, 812, 2, true, 'light');
  ok('checks kept after reload', await b.ev(`document.querySelector('.progress').textContent`) === '4枚中2枚 撮れました');
  const other = ORIGIN + '#v1=' + Buffer.from(JSON.stringify([1, 'B店', '別の用件', [[1, 'a', 0], [2, 'b', 0], [3, 'c', 0], [4, 'd', 0]], ''])).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await b.open(other, 375, 812, 2, true, 'light');
  ok('checks not shared', await b.ev(`document.querySelector('.progress').textContent`) === '4枚中0枚 撮れました');
  // 11) コピー（headlessでは clipboard が拒否されることがある。どちらの経路でも利用者に結果が出ること）
  await b.open(url, 375, 812, 2, true, 'light');
  await b.ev(click('添え文をコピー')); await b.sleep(400);
  const cpm = await b.ev(`document.querySelector('.panel .okmsg').textContent`);
  ok('copy feedback', /コピーしました|長押しして/.test(cpm), cpm);
  // 12) ダーク
  await b.open(url, 375, 812, 2, true, 'dark');
  await b.ev(`document.querySelectorAll('.check')[0].click()`);
  const dk = await b.ev(`({bg:getComputedStyle(document.body).backgroundColor,ln:getComputedStyle(document.querySelector('svg.fig .ln')).stroke,ac:getComputedStyle(document.querySelector('svg.fig .ac')).stroke})`);
  ok('dark colors', dk.bg === 'rgb(21, 19, 13)' && dk.ln !== 'none', dk);
  await b.shot(path.join(OUT, 'view-375-dark.png'), { x: 0, y: 0, width: 375, height: await b.ev('document.documentElement.scrollHeight') });
  // 13) 880px（開く画面は1カラム・最大560px）
  await b.open(url, 880, 900, 1, false, 'light');
  m = await b.ev(measure); ok('view 880', m.sw <= 880 && !m.over.length && await b.ev(`document.querySelector('.viewpage').getBoundingClientRect().width<=560`), m);
  // 14) 全図8種のダーク表示（作る画面の選択で全部出す）
  const figHtml = await b.ev(`Object.keys(PG_FIG).length`); ok('8 figs', figHtml === 8);

  // 15) XSS（中身を直接組んだリンク）
  const x = '<img src=x onerror=window.__x=1>';
  const xh = ORIGIN + '#v1=' + Buffer.from(JSON.stringify([1, x.slice(0, 30), '"><script>window.__x=2</script>'.slice(0, 24), [[1, '</svg><script>window.__x=3</script>'.slice(0, 24), 0]], x])).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await b.open(xh, 375, 812, 2, true, 'light');
  const xr = await b.ev(`({x:window.__x||0,imgs:document.querySelectorAll('main img').length,scripts:document.querySelectorAll('main script').length,shop:document.querySelector('.v-shop').textContent})`);
  ok('xss inert', xr.x === 0 && xr.imgs === 0 && xr.scripts === 0 && xr.shop.indexOf('<img') === 0, xr);
  // 16) 壊れたリンク
  for (const h of ['#v1=abc', '#v2=xx', '#v1=' + 'A'.repeat(1600)]) {
    await b.open(ORIGIN + h, 375, 812, 2, true, 'light');
    ok('broken ' + h.slice(0, 12), /リンクを開けませんでした/.test(await b.ev(`document.querySelector('h1').textContent`)));
  }
  // 17) 外部への通信（ビーコン以外にない）・リンク
  const ext = [...new Set(reqs.filter(u => !u.startsWith(ORIGIN) && !u.startsWith('data:')))];
  ok('no external requests except beacon', ext.every(u => /cloudflareinsights\.com/.test(u)), ext);
  const hrefs = await b.ev(`[...document.querySelectorAll('a')].map(a=>a.getAttribute('href'))`);
  ok('links only footer', hrefs.every(h => h === 'https://michi-portfolio.vercel.app/' || h === 'mailto:nncf123nncf@gmail.com') && !hrefs.includes('#'), hrefs);
  ok('no page errors', !errs.length, errs);
  b.close(); srv.close();
  console.log(ng ? 'check: ' + ng + ' NG' : 'check: all OK');
  process.exit(ng ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
