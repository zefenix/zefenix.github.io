// The keys page (?): j k scroll it, / finds a key, Esc clears then leaves the box, q closes it.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded } = require('./common');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await route(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://pp.test/pages-piled/');
  await loaded(p);
  const S = () => p.evaluate(() => ({ open: !document.getElementById('keyHelp').hidden, top: Math.round(document.getElementById('keyHelp').scrollTop), find: document.getElementById('khFind').value, focus: document.activeElement.id, rows: [...document.querySelectorAll('#keyHelp tbody tr')].filter(r => getComputedStyle(r).display !== 'none').length, page: document.getElementById('pageNum').value }));
  const k = async (key, ms = 350) => { await p.keyboard.press(key); await p.waitForTimeout(ms); };
  await k('?'); let s = await S(); const all = s.rows; ok('? opens the keys page', s.open && all > 30, s);
  await k('j'); await k('j'); s = await S(); ok('j scrolls it down, and turns no page', s.top > 50 && s.page === '1', s);
  await k('k'); s = await S(); ok('k scrolls back up', s.top < 120, s);
  await k('G', 700); s = await S(); ok('G to the end', s.top > 300, s);
  await k('g', 700); s = await S(); ok('g to the top', s.top === 0, s);
  await k('/'); await p.keyboard.type('zen'); await p.waitForTimeout(300); s = await S(); ok('/ finds: only rows about Zen', s.focus === 'khFind' && s.rows > 0 && s.rows < 6, s);
  await k('Escape'); s = await S(); ok('Esc in the box clears it', s.open && s.find === '' && s.rows === all && s.focus === 'khFind', s);
  await k('Escape'); s = await S(); ok('Esc again leaves the box, the page stays open', s.open && s.focus !== 'khFind', s);
  await k('q'); s = await S(); ok('q closes it', !s.open, s);
  await k('?'); await k('Escape'); s = await S(); ok('Esc closes it too', !s.open, s);
  console.log(`${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.join(' | ') || 'none'}`);
  await b.close();
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.log('CRASH', String(e.stack || e).slice(0, 600)); process.exitCode = 1; });
