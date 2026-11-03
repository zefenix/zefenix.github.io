// gn and gp: chapter by chapter, across parts.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded } = require('./common');
const longBook = require('./longbook.js');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await route(ctx);
  // when each key reached the page: the reader times g's pairs from e.timeStamp, so this says whether a pair was one
  await ctx.addInitScript(() => { window.testKeys = []; addEventListener('keydown', e => { if (e.key !== 'Shift') window.testKeys.push(e.timeStamp); }, true); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const ready = () => loaded(p);
  const at = () => p.evaluate(() => ({ chapter: document.getElementById('chap').textContent, part: window.bookInfo?.part || 1, page: +document.getElementById('pageNum').value }));
  // a key pair, then a wait for the place to change (up to 10 s: at a load of 45 this machine took more than the studio's 3), or 600 ms where it shouldn't
  // g then x, pressed again when the two reached the page 500 ms or more apart, which the reader rightly takes as two
  // single keys: at a load of 40 and more Firefox and WebKit sometimes deliver them that far apart
  const pair = async x => {
    for (let tries = 1; ; tries++) {
      await p.evaluate(() => { window.testKeys = []; });
      await p.keyboard.press('g'); await p.keyboard.press(x);
      const gap = await p.evaluate(() => window.testKeys.length > 1 ? window.testKeys[1] - window.testKeys[0] : null).catch(() => 0);
      if (gap === null || gap < 500 || tries === 3) return;
      console.log(`NOTE g and ${x} reached the page ${Math.round(gap)} ms apart, so they were not a pair; pressed again`);
      await p.waitForTimeout(600);
    }
  };
  const gx = async x => {
    const before = await p.evaluate(() => document.getElementById('chap').textContent + '|' + document.getElementById('pageNum').value + '|' + location.search);
    await pair(x);
    await p.waitForFunction(b => document.getElementById('chap').textContent + '|' + document.getElementById('pageNum').value + '|' + location.search !== b, before, { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(400);
  };
  await p.goto('http://pp.test/pages-piled/#flow'); await ready();
  let s = await at(); ok('own book: starts in Flow', s.chapter === 'Flow', s);
  await gx('n'); s = await at(); ok('gn: Strip', s.chapter === 'Strip', s);
  await gx('n'); s = await at(); ok('gn: Scroll', s.chapter === 'Scroll', s);
  await p.keyboard.press('j'); await p.waitForTimeout(400);
  await gx('p'); s = await at(); ok('gp inside a chapter: its start', s.chapter === 'Scroll', s);
  await gx('p'); s = await at(); ok('gp at its start: the chapter before', s.chapter === 'Strip', s);
  await p.keyboard.press('g'); await p.waitForTimeout(700); await p.keyboard.press('n'); await p.waitForTimeout(400);
  s = await at(); ok('g, a pause, then n: no chapter move', s.chapter === 'Strip', s);
  // a long book of the test's own: the last chapter of a part, gn opens the next part
  const key = await longBook(p);
  await p.goto(`http://pp.test/pages-piled/?opened=${key}&part=2`); await ready();
  await p.keyboard.press('G'); await p.waitForTimeout(600);
  const before = await at();
  await pair('n');
  await p.waitForFunction(() => /part=3/.test(location.search), null, { timeout: 30000 }).catch(() => {}); await ready(); await p.waitForTimeout(1600);
  s = await at(); ok('gn at the end of a part opens the next part at its first chapter', s.part === 3, { before, ...s });
  await gx('p');
  await p.waitForFunction(() => /part=2/.test(location.search), null, { timeout: 30000 }).catch(() => {}); await ready(); await p.waitForTimeout(1600);
  s = await at(); ok('gp at the first chapter of a part opens the part before, at its last chapter', s.part === 2 && s.chapter === before.chapter, s);
  // part 2 opened at its own cover, as a Next part link or ?part=2 opens it: gp goes back to part 1
  await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('piled4:anchor:')).forEach(k => localStorage.removeItem(k)));   // no saved place, so a part opens at its start
  await p.goto(`http://pp.test/pages-piled/?opened=${key}&part=2`); await ready(); await p.waitForTimeout(500);
  s = await at(); ok('part 2 opens on its cover', s.part === 2 && s.page === 1, s);
  await pair('p');
  await p.waitForFunction(() => !/part=2/.test(location.search), null, { timeout: 30000 }).catch(() => {}); await ready(); await p.waitForTimeout(1600);
  s = await at(); ok('gp on a later part\u2019s cover opens the part before, at its last chapter', s.part === 1, s);
  // mid-chapter at the start of part 2: gp first goes to the chapter's start, then to part 1
  await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('piled4:anchor:')).forEach(k => localStorage.removeItem(k)));
  await p.goto(`http://pp.test/pages-piled/?opened=${key}&part=2`); await ready(); await p.waitForTimeout(500);
  await p.keyboard.press('l'); await p.keyboard.press('l'); await p.keyboard.press('l'); await p.waitForTimeout(500);
  const mid = await at();
  await gx('p'); s = await at(); ok('gp mid-chapter: to the chapter\u2019s start, same part', s.part === 2 && s.chapter === mid.chapter && s.page < mid.page, { mid, ...s });
  await pair('p');
  await p.waitForFunction(() => !/part=2/.test(location.search), null, { timeout: 30000 }).catch(() => {}); await ready(); await p.waitForTimeout(1600);
  s = await at(); ok('gp again: part 1', s.part === 1, s);
  // gN and gP: whole parts
  await p.goto(`http://pp.test/pages-piled/?opened=${key}&part=2`); await ready(); await p.waitForTimeout(500);
  await pair('Shift+N');
  await p.waitForFunction(() => /part=3/.test(location.search), null, { timeout: 30000 }).catch(() => {}); await ready(); await p.waitForTimeout(1500);
  s = await at(); ok('gN: the next part, at its first chapter', s.part === 3 && s.chapter !== 'Cover', s);
  await pair('Shift+P');
  await p.waitForFunction(() => /part=2/.test(location.search), null, { timeout: 30000 }).catch(() => {}); await ready(); await p.waitForTimeout(1500);
  s = await at(); ok('gP: the part before', s.part === 2 && s.chapter !== 'Cover', s);
  await p.goto('http://pp.test/pages-piled/'); await ready();
  await pair('Shift+N');
  await p.waitForFunction(() => document.getElementById('toast').textContent, null, { timeout: 5000, polling: 100 }).catch(() => {});
  const said = await p.evaluate(() => document.getElementById('toast').textContent);
  ok('gN in a book of one part says so', said.includes('one part'), said);
  console.log(`${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.join(' | ') || 'none'}`);
  await b.close();
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.log('CRASH', String(e.stack || e).slice(0, 600)); process.exitCode = 1; });
