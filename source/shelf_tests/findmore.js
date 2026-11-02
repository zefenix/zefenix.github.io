// The Library's words found: the first few places per book, every one on asking, each opening the reader at that match;
// and cc while L has the keys in Contents.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded } = require('./common');
const longBook = require('./longbook.js');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await route(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const ready = () => loaded(p);
  await longBook(p);
  await p.goto('http://pp.test/pages-piled/#flow'); await ready();
  // cc in Contents while L has the keys
  await p.keyboard.press('L'); await p.waitForTimeout(400);
  const tocState = () => p.evaluate(() => ({ sel: document.querySelector('#tocList .k-sel')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 30), heads: document.querySelectorAll('#tocList .toc-outline a').length && [...document.querySelectorAll('#tocList .toc-outline a')].some(a => a.offsetParent !== null), peek: !!document.querySelector('.panel.peek, .panel.peeking') }));
  const t0 = await tocState();
  // the reader pairs cc within 300 ms of the keys' own stamps; a busy WebKit spaced two presses 80 ms apart by more, so they go back to back
  await p.keyboard.press('c'); await p.keyboard.press('c'); await p.waitForTimeout(500);
  const t1 = await tocState();
  ok('L, then cc: the headings switch, and Contents keeps the keys', t1.heads !== t0.heads && !!t1.sel, { t0, t1 });
  await p.keyboard.press('c'); await p.keyboard.press('c'); await p.waitForTimeout(500);
  const t2 = await tocState();
  ok('…cc again switches them back, on the same chapter', t2.heads === t0.heads && !!t2.sel && t2.sel.slice(0, 6) === t1.sel.slice(0, 6), { t1, t2 });
  await p.keyboard.press('Escape'); await p.keyboard.press('L'); await p.waitForTimeout(300);
  // the Library: L, then Ctrl+F, then typing at a person's pace; the words found redraw the outline, which keeps out of the way
  // (with L, / finds in the outline instead; outlinefind.js tries that)
  await p.keyboard.press('o'); await p.waitForTimeout(500); await p.keyboard.press('L'); await p.waitForTimeout(300); await p.keyboard.press('Control+f'); await p.waitForTimeout(200);
  for (const ch of 'cache lantern') { await p.keyboard.type(ch); await p.waitForTimeout(260); }
  await p.waitForTimeout(600);
  const typed = await p.evaluate(() => ({ value: document.getElementById('libFind').value, focus: document.activeElement.id, lib: !document.getElementById('books').hidden }));
  ok('Library, L, Ctrl+F, then typing slowly: every letter, c too, goes into the find box', typed.value === 'cache lantern' && typed.focus === 'libFind' && typed.lib, typed);
  await p.fill('#libFind', ''); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  const closed = await p.evaluate(() => document.getElementById('books').hidden); if (!closed) { await p.keyboard.press('Escape'); await p.waitForTimeout(400); }
  // the Library's words found
  await p.keyboard.press('o'); await p.waitForTimeout(500);
  await p.fill('#libFind', 'lantern'); await p.waitForTimeout(1800);
  const F = () => p.evaluate(() => { const g = document.getElementById('libFound'); return { rows: g.querySelectorAll('.f-row').length, more: g.querySelector('.f-all')?.textContent || null, note: g.querySelector('p.f-more:not(:has(button))')?.textContent || null, metas: [...g.querySelectorAll('.f-row .r-meta')].slice(0, 3).map(x => x.textContent) }; });
  let f = await F();
  ok('the first 12 places show, several from one chapter, numbered', f.rows === 12 && f.metas[1] === 'Chapter 1 · 2', f);
  ok('a button offers every place, saying how many it can list', /^Show all 500 of 1200 places$/.test(f.more || ''), f);
  await p.click('#libFound .f-all'); await p.waitForTimeout(500);
  f = await F(); const focused = await p.evaluate(() => document.activeElement.classList.contains('f-row'));
  ok('Show all lists 500 places, keeps the keys on the first new one, and says where the rest are', f.rows === 500 && focused && /first 500/.test(f.note || ''), { f, focused });
  const lib = await p.evaluate(() => { const L = document.getElementById('books'); return L.scrollHeight > L.clientHeight * 3; });
  ok('the Library scrolls through them', lib, lib);
  // the third place of chapter 2 opens the reader at that match
  const href = await p.evaluate(() => [...document.querySelectorAll('#libFound .f-row')].find(a => a.querySelector('.r-meta').textContent === 'Chapter 2 · 3').getAttribute('href'));
  ok('a place links to its match within the chapter', /[?&]at=2(&|#)/.test(href) && /#/.test(href), href);
  await p.goto('http://pp.test/pages-piled/' + href); await ready(); await p.waitForTimeout(1200);
  const at = await p.evaluate(() => ({ chip: document.getElementById('chip')?.textContent.replace(/\s+/g, ' ').trim(), url: location.search }));
  ok('it opens the reader at that match: chapter 2’s third, the 43rd in its part', /43 of 400/.test(at.chip || '') && !/at=/.test(at.url), at);
  console.log(`findmore ${engine}: ${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close(); process.exit(fails ? 1 : 0);
})();
