// The Library: Pages, Piled can be hidden and shown again; your own books each have a × that asks, then removes.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded } = require('./common');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await route(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const ready = () => loaded(p);
  await p.goto('http://pp.test/pages-piled/'); await ready();
  for (const t of ['Test notes', 'More notes']) await p.evaluate(async t => window.bookTools.saveBook({ v: 1, title: t, site: 'your files', url: 'file:///' + t, from: 'files', at: new Date().toISOString(), chapters: [{ title: 'One', url: 'file:///' + t + '/one.md', markdown: '# One\n\nA line about flowers.' }] }), t);
  const books = () => p.evaluate(() => [...document.querySelectorAll('#shelfList .lib-book:not([hidden]) .t')].map(t => t.textContent));
  const note = () => p.evaluate(() => document.getElementById('shelfHidden').textContent);
  const pick = async title => { await p.evaluate(t => [...document.querySelectorAll('#shelfList .lib-book')].find(r => r.querySelector('.t').textContent === t).click(), title); await p.waitForTimeout(300); };
  const btn = label => p.evaluate(l => { const b = [...document.querySelectorAll('#booksNow button')].find(x => x.textContent === l); if (b) b.click(); return !!b; }, label);
  await p.keyboard.press('B'); await p.waitForTimeout(700);
  let s = await books(); ok('one list: Pages, Piled, then your books', s[0] === 'Pages, Piled' && s.length === 3, s);
  ok('the heading says Books, with Remove all for yours', await p.evaluate(() => document.querySelector('.lib-sec-head h3').textContent === 'Books' && !!document.getElementById('clearAll')), null);
  ok('the bookmarklet card reads “Bookmarklet: read any page”', await p.evaluate(() => /Bookmarklet: read any page/i.test(document.getElementById('bmCard').textContent) && !!document.querySelector('#bmCard a[href="https://code.claude.com/docs"]')), null);
  await pick('Pages, Piled'); ok('Pages, Piled offers Hide from the Library', await btn('Hide from the Library'), null); await p.waitForTimeout(400);
  s = await books(); ok('hidden: only your books show', !s.includes('Pages, Piled') && s.length === 2, s);
  ok('the heading says 1 hidden · Show it', /1 hidden/.test(await note()) && /Show it/.test(await note()), await note());
  await p.keyboard.press('/'); await p.keyboard.type('flow'); await p.waitForTimeout(2200);
  ok('Library find leaves it out', !(await p.evaluate(() => document.getElementById('libFound').textContent)).includes('Pages, Piled'), await p.evaluate(() => document.getElementById('libFound').textContent.slice(0, 80)));
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.reload(); await ready(); await p.keyboard.press('B'); await p.waitForTimeout(700);
  ok('still hidden after a reload', !(await books()).includes('Pages, Piled'), await books());
  await p.evaluate(() => document.querySelector('#shelfHidden button').click()); await p.waitForTimeout(300);
  ok('Show it shows it, faded', (await books()).includes('Pages, Piled') && await p.evaluate(() => !!document.querySelector('#shelfList .lib-book.put-away')), await books());
  await pick('Pages, Piled'); ok('it offers Show in the Library', await btn('Show in the Library'), null); await p.waitForTimeout(400);
  ok('back, and nothing hidden', (await books()).includes('Pages, Piled') && !(await note()), await note());
  // your own books' ×: ask, then remove
  const xOf = t => p.evaluate(t => { const r = [...document.querySelectorAll('#shelfList .lib-book')].find(r => r.querySelector('.t').textContent === t); const x = r && r.querySelector('.x'); if (!x) return null; const b = x.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, own: !!r }; }, t);
  ok('Pages, Piled has no ×', !(await xOf('Pages, Piled')), null);
  await p.hover('#shelfList .lib-book:nth-child(2)'); await p.waitForTimeout(200);
  let x = await xOf('More notes'); await p.mouse.click(x.x, x.y); await p.waitForTimeout(200);
  ok('a first click on × asks', await p.evaluate(() => document.querySelector('#shelfList .x.ask')?.textContent) === 'Remove?', null);
  await p.mouse.move(5, 5); await p.waitForTimeout(200);
  ok('moving away cancels', !(await p.evaluate(() => !!document.querySelector('#shelfList .x.ask'))) && (await books()).includes('More notes'), await books());
  await p.hover('#shelfList .lib-book:nth-child(2)'); x = await xOf('More notes'); await p.mouse.click(x.x, x.y); await p.waitForTimeout(150); await p.mouse.click(x.x, x.y);
  // the removal waits on IndexedDB, which a loaded WebKit took more than 600 ms to finish
  await p.waitForFunction(() => ![...document.querySelectorAll('#shelfList .lib-book .t')].some(t => t.textContent === 'More notes'), null, { timeout: 10000, polling: 100 }).catch(() => {});
  s = await books(); ok('the second click removes it, and only it', !s.includes('More notes') && s.includes('Test notes') && s.includes('Pages, Piled'), s);
  console.log(`${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.join(' | ') || 'none'}`);
  await b.close();
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.log('CRASH', String(e.stack || e).slice(0, 600)); process.exit(1); });
