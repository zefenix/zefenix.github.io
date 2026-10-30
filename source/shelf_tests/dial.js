// The page slider as a dial, the default: a drag turns pages from where you are, a tap goes nowhere; a swipe down from
// just above it switches to jump and back, in Zen too; Options' Page slider does the same.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded } = require('./common');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const errs = [];
  // a phone
  const ctx = await b.newContext({ viewport: { width: 393, height: 800 }, ...(engine === 'firefox' ? {} : { isMobile: true }), hasTouch: true }); await route(ctx);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://pp.test/pages-piled/#flow');
  await loaded(p); await p.waitForTimeout(600);
  const cdp = engine === 'chromium' ? await ctx.newCDPSession(p) : null;
  // a finger: real touch in Chromium; elsewhere the pointer events one sends, captured as the browser would
  const drag = async (x, y, dx, dy, steps = 10) => {
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / steps, y: y + dy * i / steps }] }); await p.waitForTimeout(30); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await p.evaluate(async ([x, y, dx, dy, steps]) => {
      const el = document.elementFromPoint(x, y), o = { pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true, composed: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x, clientY: y }));
      const ticks = document.getElementById('ticks'), cap = ticks.hasPointerCapture && el.closest('#ticks') ? ticks : null;
      for (let i = 1; i <= steps; i++) { (cap || document.elementFromPoint(x + dx * i / steps, y + dy * i / steps) || document).dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x + dx * i / steps, clientY: y + dy * i / steps })); await new Promise(r => setTimeout(r, 30)); }
      (cap || document.elementFromPoint(x + dx, y + dy) || document).dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x + dx, clientY: y + dy }));
    }, [x, y, dx, dy, steps]);
    await p.waitForTimeout(700);
  };
  const st = () => p.evaluate(() => ({ dial: document.getElementById('ticks').classList.contains('dial'), page: +document.getElementById('pageNum').value, toast: document.getElementById('toast').textContent, tucked: document.querySelector('.app').classList.contains('tucked'), lib: !document.getElementById('books').hidden }));
  const tk = () => p.evaluate(() => { const r = document.getElementById('ticks').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width, top: r.top }; });
  let s = await st(), t = await tk();
  ok('the slider starts as a dial', s.dial, s);
  const p0 = s.page;
  await drag(t.x + 40, t.y, 90, 0); s = await st();
  ok('a drag of 90 px turns 5 pages from where you are', s.page === p0 + 5, { p0, s });
  await drag(t.x + t.w - 20, t.y, -36, 0); s = await st();
  ok('a drag back of 36 px turns 2 back, wherever it starts on the slider', s.page === p0 + 3, { p0, s });
  // Playwright's tap sends a touch, and so pointer events, in every engine, so the taps are tried in all three
  { await p.touchscreen.tap(t.x + t.w * 0.9, t.y); await p.waitForTimeout(600); s = await st(); ok('a tap on the dial goes nowhere', s.page === p0 + 3, s); }
  // switch to jump by a swipe down from just above it
  await drag(t.x + t.w / 2, t.top - 30, 0, 60, 6); s = await st();
  ok('a swipe down from just above the slider makes it a slider, and turns no page', !s.dial && s.page === p0 + 3 && /jump/.test(s.toast), s);
  { await p.touchscreen.tap(t.x + 2, t.y); await p.waitForTimeout(700); s = await st(); ok('as a slider, a tap goes to the page under it', s.page <= 2, s); }
  await drag(t.x + t.w / 2, t.top - 30, 0, 60, 6); s = await st();
  ok('the same swipe makes it a dial again', s.dial && /dial/.test(s.toast), s);
  // in Zen
  const nx = await p.evaluate(() => { const r = document.getElementById('next').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await drag(nx.x, nx.y, 0, 80, 6); s = await st();
  if (s.tucked) { t = await tk(); await drag(t.x + t.w / 2, t.top - 30, 0, 60, 6); s = await st(); ok('in Zen, the swipe down switches it too, and Zen stays', !s.dial && s.tucked, s); await drag(t.x + t.w / 2, t.top - 30, 0, 60, 6); }
  else ok('in Zen, the swipe down switches it too, and Zen stays (Zen did not start)', false, s);
  await ctx.close();
  // a computer: the mouse drags the dial, 12 px a page; Options sets Jump
  const c2 = await b.newContext({ viewport: { width: 1280, height: 860 } }); await route(c2);
  const q = await c2.newPage(); q.on('pageerror', e => errs.push(String(e)));
  await q.goto('http://pp.test/pages-piled/#flow');
  await loaded(q); await q.waitForTimeout(600);
  const T = await q.evaluate(() => { const r = document.getElementById('ticks').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
  const pg = () => q.evaluate(() => +document.getElementById('pageNum').value);
  const m0 = await pg();
  await q.mouse.move(T.x + 30, T.y); await q.mouse.down(); for (let i = 1; i <= 6; i++) { await q.mouse.move(T.x + 30 + 8 * i, T.y); await q.waitForTimeout(30); } await q.mouse.up(); await q.waitForTimeout(700);
  ok('with a mouse, 48 px turns 4 pages', (await pg()) === m0 + 4, { m0, now: await pg() });
  await q.evaluate(() => document.querySelector('[data-setting="slider"] [data-value="jump"]').click()); await q.waitForTimeout(300);
  await q.mouse.click(T.x + 3, T.y); await q.waitForTimeout(700);
  ok('Options, Page slider, Jump: a click goes to the page under it', (await pg()) <= 2, await pg());
  console.log(`dial ${engine}: ${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close(); process.exit(fails ? 1 : 0);
})();
