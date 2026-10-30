// The bottom bar folds the views and the styles into one button each when its parts no longer fit side by side.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded, settled } = require('./common');
const longBook = require('./longbook.js');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const errs = [];
  const open = async w => {
    const ctx = await b.newContext({ viewport: { width: w, height: 800 }, ...(engine === 'firefox' ? {} : { isMobile: true }), hasTouch: true }); await route(ctx);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e)));
    await p.goto('http://pp.test/pages-piled/#flow');
    await loaded(p);
    await p.waitForTimeout(500);
    return { ctx, p };
  };
  const state = p => p.evaluate(() => { const d = document.getElementById('dock'), vis = el => !!el && el.getBoundingClientRect().width > 0;
    return { compact: d.classList.contains('compact'), over: d.scrollWidth > d.clientWidth + 1, picks: [...d.querySelectorAll('.pick')].filter(vis).length, rows: [...d.querySelectorAll('.dpick > .seg')].filter(vis).length, facing: document.querySelector('[data-setting="mode"] [data-value="facing"]').getAttribute('aria-pressed') === 'true' }; });
  const longNumbers = p => p.evaluate(() => { document.getElementById('pageNum').value = '120'; document.getElementById('unitExtra').textContent = '–121'; document.getElementById('unitTotal').textContent = '/ 125'; dispatchEvent(new Event('resize')); });   // the reader re-measures on its own page changes; faked numbers ask as a resize does
  // wide: everything fits, nothing folds
  let { ctx, p } = await open(1000);
  let s = await state(p); ok('wide: the rows show as they are', !s.compact && s.picks === 0 && s.rows === 2, s);
  await ctx.close();
  // a phone: fits as it is
  ({ ctx, p } = await open(393));
  s = await state(p); ok('a 393 phone: fits, nothing folds', !s.compact && !s.over, s);
  await ctx.close();
  // between: long page numbers would overflow, so it folds
  ({ ctx, p } = await open(540));
  await longNumbers(p); await p.waitForTimeout(300);
  s = await state(p); ok('540 with long page numbers: folds, and nothing overflows', s.compact && !s.over && s.picks === 2 && s.rows === 0, s);
  const pick = await p.evaluate(() => { const r = document.querySelector('.dpick .pick').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.touchscreen.tap(pick.x, pick.y); await p.waitForTimeout(300);
  s = await state(p); ok('a tap on the views button opens its row', s.rows === 1, s);
  const fb = await p.evaluate(() => { const r = document.querySelector('[data-setting="mode"] [data-value="facing"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; });
  await p.touchscreen.tap(fb.x, fb.y); await p.waitForTimeout(700); await settled(p); await longNumbers(p); await p.waitForTimeout(300);   // Facing sets real page numbers once its pages land
  s = await state(p); ok('picking Facing sets it and folds the row away', s.facing && s.rows === 0, s);
  const icon = await p.evaluate(() => document.querySelector('.dpick .pick').innerHTML === document.querySelector('[data-setting="mode"] [data-value="facing"] svg').outerHTML);
  ok('the views button now shows Facing', icon, icon);
  await p.touchscreen.tap(pick.x, pick.y); await p.waitForTimeout(300);
  s = await state(p); ok('…and opens again', s.compact && s.rows === 1, s);
  await p.touchscreen.tap(200, 300); await p.waitForTimeout(300);
  s = await state(p); ok('a tap elsewhere puts the row away', s.rows === 0, s);
  await p.evaluate(() => { document.getElementById('pageNum').value = '1'; document.getElementById('unitExtra').textContent = ''; document.getElementById('unitTotal').textContent = '/ 5'; dispatchEvent(new Event('resize')); });
  await p.waitForTimeout(300);
  s = await state(p); ok('short numbers again: unfolds', !s.compact && !s.over, s);
  await ctx.close();
  // a real book in facing view, as on the owner's phone ("20–21 / 25"): across the tight widths the bar never overflows,
  // folds only where its parts would meet, and at page 1 unfolds where they fit
  ({ ctx, p } = await open(540));
  const key = await longBook(p);
  await p.goto(`http://pp.test/pages-piled/?opened=${key}`);
  await loaded(p);
  await p.evaluate(() => document.querySelector('[data-setting="mode"] [data-value="facing"]').click()); await p.waitForTimeout(800);
  const goTo = async n => { await p.evaluate(n => { const b = document.getElementById('pageNum'); b.focus(); b.value = String(n); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); b.blur(); }, n); await p.waitForTimeout(900); };
  const fits = () => p.evaluate(() => { const d = document.getElementById('dock'), was = d.classList.contains('compact'); d.classList.remove('compact'); const f = d.scrollWidth <= d.clientWidth + 1 && d.querySelector('.dock-ctl').getBoundingClientRect().right <= d.querySelector('.dock-page').getBoundingClientRect().left - 6; d.classList.toggle('compact', was); return f; });
  const seen = [];
  for (const w of [521, 526, 531, 536, 545]) {
    await p.setViewportSize({ width: w, height: 800 }); await p.waitForTimeout(700);
    await goTo(40);
    let st40 = await state(p), fit40 = await fits(), txt = await p.evaluate(() => document.querySelector('.dock-page').textContent.replace(/\s+/g, ' ').trim());
    await goTo(1);
    let st1 = await state(p), fit1 = await fits();
    seen.push(`${w}: ${txt} ${st40.compact ? 'folded' : 'open'}, p1 ${st1.compact ? 'folded' : 'open'}`);
    ok(`${w}px: no overflow, folded exactly when it would not fit`, !st40.over && !st1.over && st40.compact === !fit40 && st1.compact === !fit1, { w, st40, fit40, st1, fit1 });
  }
  console.log('  ' + seen.join(' · '));
  ok('some width folds at page 40 and opens at page 1', seen.some(x => /folded, p1 open/.test(x)), seen);
  await ctx.close();
  console.log(`dockfit ${engine}: ${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close(); process.exit(fails ? 1 : 0);
})();
