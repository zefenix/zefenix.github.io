// Library click: by default a click selects a book and a second opens it; Options can make one click open it.
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
  // a click that opens a book navigates a little later in Firefox and WebKit; wait for the new page before reading it
  const opened = async () => { await p.waitForURL(/[?&]opened=/, { timeout: 15000 }).catch(() => {}); await ready(); };
  await longBook(p);
  await p.goto('http://pp.test/pages-piled/#flow'); await ready();
  const st = () => p.evaluate(() => ({ lib: !document.getElementById('books').hidden, view: document.querySelector('#libView [aria-pressed="true"]')?.dataset.v, sel: document.querySelector('.lib-book[aria-selected="true"]')?._book?.title || null, url: location.search, title: document.title }));
  const row = async t => { await p.waitForFunction(t => [...document.querySelectorAll('#shelfList .lib-book')].some(x => x._book.title === t), t, { timeout: 10000 }); return p.evaluate(t => { const r = [...document.querySelectorAll('#shelfList .lib-book')].find(x => x._book.title === t).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, t); };
  await p.keyboard.press('o'); await p.waitForTimeout(500);
  let s = await st(); ok('the Library opens in List', s.lib && s.view === 'list', s);
  let r = await row('A long test book'); await p.mouse.click(r.x, r.y); await p.waitForTimeout(500);
  s = await st(); ok('by default a click selects the book and opens nothing', s.lib && s.sel === 'A long test book' && !s.url.includes('opened'), s);
  await p.mouse.dblclick(r.x, r.y); await opened(); await p.waitForTimeout(500);
  s = await st(); ok('a double click opens it', s.url.includes('opened'), s);
  // Options: Library click, Open
  await p.goto('http://pp.test/pages-piled/#flow'); await ready();
  await p.evaluate(() => document.querySelector('[data-setting="libClick"] [data-value="open"]').click());
  await p.keyboard.press('o'); await p.waitForTimeout(500);
  r = await row('Pages, Piled'); await p.mouse.click(r.x, r.y); await p.waitForTimeout(500);
  s = await st(); ok('set to Open: a click on the book being read goes back to it', !s.lib && !s.url.includes('opened'), s);
  await p.keyboard.press('o'); await p.waitForTimeout(500);
  r = await row('A long test book'); await p.mouse.click(r.x, r.y); await opened(); await p.waitForTimeout(500);
  s = await st(); ok('set to Open: one click opens another book', s.url.includes('opened'), s);
  await p.waitForTimeout(800);
  const kept = await p.evaluate(() => document.querySelector('[data-setting="libClick"] [aria-pressed="true"]')?.dataset.value);
  ok('the choice is kept', kept === 'open', kept);
  console.log(`libclick ${engine}: ${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close(); process.exit(fails ? 1 : 0);
})();
