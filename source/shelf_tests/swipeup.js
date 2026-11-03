// A swipe up from below the page, or right of the slider, opens the Library (in Zen, right of the slider first brings the menus back); a tap still opens All pages.
// Over the Library and All pages the bottom bar stays, its slider and arrows moving through what they show.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded } = require('./common');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 780 }, ...(engine === 'firefox' ? {} : { isMobile: true }), hasTouch: true }); await route(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://pp.test/pages-piled/#flow');
  await loaded(p);
  await p.waitForTimeout(800);
  const st = () => p.evaluate(() => ({ lib: !document.getElementById('books').hidden, grid: document.querySelector('.app').classList.contains('grid-on'), tucked: document.querySelector('.app').classList.contains('tucked') }));
  const box = sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, sel);
  const cdp = engine === 'chromium' ? await ctx.newCDPSession(p) : null;
  // a real finger in Chromium; elsewhere the pointer events a finger sends, as Playwright cannot drag a touch there
  const swipe = async (x, y, dx, dy) => {
    dx = Math.max(4, Math.min(389, x + dx)) - x; dy = Math.max(4, Math.min(776, y + dy)) - y;   // a finger stays on the screen
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 6, y: y + dy * i / 6 }] }); await p.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await p.evaluate(([x, y, dx, dy]) => {
      const el = document.elementFromPoint(x, y), o = { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, composed: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x, clientY: y }));
      (document.elementFromPoint(x + dx, y + dy) || document).dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x + dx, clientY: y + dy }));
    }, [x, y, dx, dy]);
    await p.waitForTimeout(600);
  };
  const back = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(500); let s = await st(); if (s.lib || s.grid) { await p.keyboard.press('Escape'); await p.waitForTimeout(500); } };
  // All pages builds its thumbnails first: a busy WebKit took 6.5 s of the 8 the studio allowed, so it gets 30
  let z = await box('#zoomStrip'), r = await box('#statR'), s;
  await p.touchscreen.tap(z.x, z.y); await p.waitForFunction(() => document.querySelector('.app').classList.contains('grid-on'), null, { timeout: 30000 }).catch(() => {});
  s = await st(); ok('a tap below the page opens All pages', s.grid && !s.lib, s); await back();
  await swipe(z.x, z.y, 4, -90);
  s = await st(); ok('a swipe up from below the page opens the Library, not All pages', s.lib && !s.grid, s); await back();
  s = await st(); ok('…and Esc closes it', !s.lib && !s.grid, s);
  await p.touchscreen.tap(r.x, r.y); await p.waitForFunction(() => document.querySelector('.app').classList.contains('grid-on'), null, { timeout: 30000 }).catch(() => {});
  s = await st(); ok('a tap right of the slider opens All pages', s.grid && !s.lib, s);
  // over All pages the slider moves through the thumbnails and leaves them open
  await p.evaluate(() => document.querySelector('[data-setting="slider"] [data-value="jump"]').click());   // these two checks tap the slider as a slider; dial.js tries the dial
  const tk = await box('#ticks'), before = await p.evaluate(() => +document.getElementById('pageNum').value);
  await p.touchscreen.tap(tk.x + tk.w * 0.45, tk.y); await p.waitForTimeout(500);
  s = await st(); const after = await p.evaluate(() => ({ f: document.activeElement.className, page: +document.getElementById('pageNum').value }));
  ok('over All pages, the slider moves the thumbnail cursor and All pages stays open', s.grid && /thumb/.test(after.f) && after.page === before, { s, after, before });
  await back();
  await swipe(r.x, r.y, -3, -90);
  s = await st(); ok('a swipe up from right of the slider opens the Library', s.lib && !s.grid && !s.tucked, s);
  const lb = await p.evaluate(() => { const L = document.getElementById('books').getBoundingClientRect(), d = document.getElementById('dock').getBoundingClientRect(); return { libBottom: Math.round(L.bottom), dockTop: Math.round(d.top), dockH: Math.round(d.height) }; });
  ok('the bottom bar stays below the Library', lb.dockH > 0 && Math.abs(lb.libBottom - lb.dockTop) <= 1, lb);
  const sc0 = await p.evaluate(() => document.getElementById('books').scrollTop), pg0 = await p.evaluate(() => +document.getElementById('pageNum').value);
  const tk2 = await box('#ticks'); await p.touchscreen.tap(tk2.x + tk2.w * 0.48, tk2.y); await p.waitForTimeout(400);
  const sc1 = await p.evaluate(() => ({ top: document.getElementById('books').scrollTop, max: document.getElementById('books').scrollHeight - document.getElementById('books').clientHeight, page: +document.getElementById('pageNum').value }));
  ok('over the Library, the slider scrolls the books, not the pages behind', sc1.max <= 0 || (sc1.top > sc0 && sc1.page === pg0), { sc0, sc1, pg0 });
  await p.evaluate(() => document.querySelector('[data-setting="slider"] [data-value="dial"]').click());
  r = await box('#statR'); await p.touchscreen.tap(r.x, r.y); await p.waitForTimeout(500);
  s = await st(); ok('a tap right of the slider goes back from the Library to the book', !s.lib && !s.grid, s);
  await swipe(z.x, z.y, 70, -20);
  s = await st(); ok('a sideways swipe there opens nothing', !s.lib && !s.grid, s);
  // the rest of the bottom bar still tucks and untucks the menus
  const pb = await box('#pageNum').catch(() => null), nav = await box('#next');
  await swipe(nav.x, nav.y, 0, 80);
  s = await st(); ok('a swipe down on the bottom bar still enters Zen', s.tucked, s);
  r = await box('#statR');
  await swipe(r.x, r.y, 0, -90);
  s = await st(); ok('in Zen, a swipe up from right of the slider brings the menus back, and opens nothing', !s.tucked && !s.lib && !s.grid, s);
  r = await box('#statR'); await swipe(r.x, r.y, 0, -90);
  s = await st(); ok('…and a second swipe up there opens the Library', s.lib && !s.tucked, s); await back();
  // the way back from the Library, under the thumb: a tap on empty space
  await swipe(z.x, z.y, 0, -90);
  const blank = await p.evaluate(() => { for (let y = innerHeight - 30; y > 100; y -= 20) for (let x = 20; x < innerWidth - 20; x += 30) { const el = document.elementFromPoint(x, y); if (el && el.matches('.library, .lib-inner, .lib-cols, .lib-main, .lib-sec, .lib-add')) return { x, y, el: el.className }; } return null; });
  if (blank) { await p.touchscreen.tap(blank.x, blank.y); await p.waitForTimeout(500); }
  s = await st(); ok('a tap on empty space in the Library goes back to the book', !!blank && !s.lib, { s, blank });
  await swipe(z.x, z.y, 0, -90);
  const fb = await box('#libFind'); await p.touchscreen.tap(fb.x, fb.y); await p.waitForTimeout(300);
  await p.touchscreen.tap(blank.x, blank.y); await p.waitForTimeout(400);
  s = await st(); const left = await p.evaluate(() => document.activeElement.id !== 'libFind');
  ok('with the find box in use, the first tap on empty space only leaves the box', s.lib && left, { s, left });
  await p.touchscreen.tap(blank.x, blank.y); await p.waitForTimeout(400);
  s = await st(); ok('…and the next goes back to the book', !s.lib, s);
  // in the Library, a sideways swipe switches Shelf and List
  await swipe(z.x, z.y, 0, -90);
  const lv = () => p.evaluate(() => ({ list: document.getElementById('books').classList.contains('v-list'), lib: !document.getElementById('books').hidden }));
  if ((await lv()).list) await p.evaluate(() => document.querySelector('#libView [data-v="shelf"]').click());
  await swipe(330, blank.y, -200, 6);
  let v = await lv(); ok('a swipe left in the Library goes to List, and the Library stays', v.list && v.lib, v);
  await swipe(60, blank.y, 160, -6);
  v = await lv(); ok('a swipe right goes back to Shelf', !v.list && v.lib, v);
  const cov = await box('#shelfList .lib-book');
  await swipe(cov.x, cov.y, 160, 4); await swipe(cov.x + 10, cov.y, -150, 4);
  v = await lv(); ok('a swipe starting on a book switches too, and opens nothing', v.list && v.lib, v);
  await swipe(200, blank.y, 6, -150);
  v = await lv(); ok('an upward swipe does not switch', v.list && v.lib, v);
  await back();
  console.log(`swipeup ${engine}: ${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close(); process.exit(fails ? 1 : 0);
})();
