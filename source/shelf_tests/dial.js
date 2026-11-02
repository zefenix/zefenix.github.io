// The page slider, plain by default, and as a dial: a drag turns pages from where you are and a tap goes nowhere. A swipe
// up from left of it switches between them, in Zen too, its place a bar or a knob; Options' Page control does the same. Nothing
// lies over the ticks, and in the scroll views the dial turns by page or, by Dial moves, glides.
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
  const st = () => p.evaluate(() => ({ mark: (o => getComputedStyle(o, '::after').content !== 'none' ? 'knob' : 'bar')(document.querySelector('.tick.on')), bar: parseFloat(getComputedStyle(document.querySelector('.tick.on'), '::before').height), barColour: getComputedStyle(document.querySelector('.tick.on'), '::before').backgroundColor, knobColour: getComputedStyle(document.querySelector('.tick.on'), '::after').backgroundColor, tickColour: getComputedStyle(document.querySelector('.tick:not(.on)'), '::before').backgroundColor, tocHidden: document.getElementById('tocPanel').hidden, dial: document.getElementById('ticks').classList.contains('dial'), page: +document.getElementById('pageNum').value, toast: document.getElementById('toast').textContent, tucked: document.querySelector('.app').classList.contains('tucked'), lib: !document.getElementById('books').hidden }));
  const tk = () => p.evaluate(() => { const r = document.getElementById('ticks').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width, top: r.top }; });
  let s = await st(), t = await tk();
  ok('the slider starts plain, its place a tick of the usual height in the active colour', !s.dial && s.mark === 'bar' && (s.bar === 9 || s.bar === 15) && s.barColour !== s.tickColour, s);
  const active = s.barColour;
  const left = () => p.evaluate(() => { const r = document.getElementById('statL').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const flip = async () => { const l = await left(); await drag(l.x, l.y, 0, -60, 6); return st(); };
  const p00 = s.page;
  await drag(t.x + t.w / 2, t.top - 30, 0, 60, 6); s = await st();
  ok('a swipe down from just above the slider no longer switches it', !s.dial, s);
  await p.evaluate(p => { const i = document.getElementById('pageNum'); i.value = p; i.dispatchEvent(new Event('change', { bubbles: true })); }, p00); await p.waitForTimeout(600);
  s = await flip();
  ok('a swipe up from left of the slider makes it a dial, its place a plain tick with a knob of a quieter colour at its foot, and no panel opens', s.dial && s.mark === 'knob' && (s.bar === 9 || s.bar === 15) && s.barColour === s.tickColour && s.knobColour !== active && s.knobColour !== s.tickColour && /dial/.test(s.toast) && s.tocHidden, s);
  const p0 = s.page;
  await drag(t.x + 40, t.y, 90, 0); s = await st();
  ok('a drag of 90 px turns 5 pages from where you are', s.page === p0 + 5, { p0, s });
  await drag(t.x + t.w - 20, t.y, -36, 0); s = await st();
  ok('a drag back of 36 px turns 2 back, wherever it starts on the slider', s.page === p0 + 3, { p0, s });
  // Playwright's tap sends a touch, and so pointer events, in every engine, so the taps are tried in all three
  { await p.touchscreen.tap(t.x + t.w * 0.9, t.y); await p.waitForTimeout(600); s = await st(); ok('a tap on the dial goes nowhere', s.page === p0 + 3, s); }
  s = await flip();
  ok('the same swipe makes it a slider, and turns no page', !s.dial && s.page === p0 + 3 && /slider/.test(s.toast), s);
  { await p.touchscreen.tap(t.x + 2, t.y); await p.waitForTimeout(700); s = await st(); ok('as a slider, a tap goes to the page under it', s.page <= 2, s); }
  s = await flip();
  ok('the same swipe makes it a dial again', s.dial && /dial/.test(s.toast), s);
  // in Zen
  const nx = await p.evaluate(() => { const r = document.getElementById('next').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await drag(nx.x, nx.y, 0, 80, 6); s = await st();
  if (s.tucked) { s = await flip(); ok('in Zen, the swipe up switches it too, and Zen stays', !s.dial && s.tucked, s); }
  else ok('in Zen, the swipe up switches it too, and Zen stays (Zen did not start)', false, s);
  await ctx.close();
  // a computer: the mouse drags the dial, 12 px a page; Options sets Jump
  const c2 = await b.newContext({ viewport: { width: 1280, height: 860 } }); await route(c2);
  const q = await c2.newPage(); q.on('pageerror', e => errs.push(String(e)));
  await q.goto('http://pp.test/pages-piled/#flow');
  await loaded(q); await q.waitForTimeout(600);
  const T = await q.evaluate(() => { const r = document.getElementById('ticks').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
  const pg = () => q.evaluate(() => +document.getElementById('pageNum').value);
  await q.evaluate(() => document.querySelector('[data-setting="slider"] [data-value="dial"]').click()); await q.waitForTimeout(300);
  const m0 = await pg();
  await q.mouse.move(T.x + 30, T.y); await q.mouse.down(); for (let i = 1; i <= 6; i++) { await q.mouse.move(T.x + 30 + 8 * i, T.y); await q.waitForTimeout(30); } await q.mouse.up(); await q.waitForTimeout(700);
  ok('with a mouse, 48 px turns 4 pages', (await pg()) === m0 + 4, { m0, now: await pg() });
  await q.evaluate(() => document.querySelector('[data-setting="slider"] [data-value="jump"]').click()); await q.waitForTimeout(300);
  await q.mouse.click(T.x + 3, T.y); await q.waitForTimeout(700);
  ok('Options, Page control, Slider: a click goes to the page under it', (await pg()) <= 2, await pg());
  // the look: the ticks stand on the slider's foot, and nothing lies over them
  const look = await q.evaluate(() => {
    document.querySelector('[data-setting="slider"] [data-value="dial"]').click();
    const a = getComputedStyle(document.getElementById('ticks'), '::after');
    const on = document.querySelector('.tick.on'), k = getComputedStyle(on, '::after');
    return { foot: on.getBoundingClientRect().bottom, knob: on.getBoundingClientRect().top + parseFloat(k.top) + parseFloat(k.height), align: getComputedStyle(document.querySelector('.tick')).alignItems, cover: a.content, image: a.backgroundImage, stripGoes: !!document.querySelector('[data-setting="stripDir"]') };
  });
  const hover = await q.evaluate(() => [...document.querySelectorAll('.tick:not(.on)')].slice(-3, -2).map(t => { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })[0]);
  const under = async mode => {
    await q.evaluate(m => document.querySelector(`[data-setting="slider"] [data-value="${m}"]`).click(), mode);
    await q.mouse.move(hover.x - 1, hover.y); await q.mouse.move(hover.x, hover.y); await q.waitForTimeout(350);   // Firefox reads :hover from a move, and a click from a script can clear it
    const lit = await q.evaluate(() => { const on = document.querySelector('.tick:hover'), rest = document.querySelector('.tick:not(.on):not(:hover)'); return { hovering: !!on, tick: on && getComputedStyle(on, '::before').backgroundColor, rest: getComputedStyle(rest, '::before').backgroundColor, cursor: on && getComputedStyle(on).cursor }; });
    await q.mouse.move(5, 5);
    return lit;
  };
  const litS = await under('jump'), litD = await under('dial');
  ok('as a slider, a tick under the pointer is not lit', litS.hovering && litS.tick === litS.rest, litS);
  ok('as a dial, a tick under the pointer is not lit', litD.hovering && litD.tick === litD.rest && litD.cursor === 'ew-resize', litD);
  ok('the knob sits at the foot of its tick', Math.abs(look.foot - look.knob) <= 1, look);
  ok('the ticks stand on the slider\'s foot', look.align === 'flex-end', look);
  const shades = await q.evaluate(() => new Set([...document.querySelectorAll('.tick:not(.on)')].map(t => getComputedStyle(t, '::before').backgroundColor)).size);
  ok('read and unread ticks are one colour', shades === 1, shades);
  ok('nothing is drawn over the ticks', look.cover === 'none' && look.image === 'none', look);
  ok('Strip goes is gone from Options', !look.stripGoes, look);
  // the scroll views: by page, or a glide with the drag
  const dragMouse = async () => { await q.mouse.move(T.x + 30, T.y); await q.mouse.down(); for (let i = 1; i <= 6; i++) { await q.mouse.move(T.x + 30 + 8 * i, T.y); await q.waitForTimeout(30); } await q.mouse.up(); await q.waitForTimeout(700); };
  const set = (k, v) => q.evaluate(([k, v]) => document.querySelector(`[data-setting="${k}"] [data-value="${v}"]`).click(), [k, v]);
  const top = () => q.evaluate(() => { const a = document.querySelector('.app').dataset.view === 'linear' ? document.getElementById('desk') : document.getElementById('scroller'); return Math.round(a.scrollTop); });
  for (const mode of ['text', 'pages']) {
    await set('mode', mode); await q.waitForTimeout(1500);
    await set('dialScroll', 'page');
    const p1 = await pg(); await dragMouse();
    ok(`${mode} scroll, by page: 48 px turns 4 pages`, (await pg()) === p1 + 4, { p1, now: await pg() });
    await set('dialScroll', 'glide');
    const y0 = await top(), p2 = await pg(); await dragMouse(); const y1 = await top();
    ok(`${mode} scroll, glide: 48 px moves the text 48 × 4 × the glide speed, no whole pages`, Math.abs(y1 - y0 - 230) <= 12 && (await pg()) - p2 <= 1, { y0, y1, p2, now: await pg() });
  }
  await set('slider', 'jump'); ok('Dial moves shows only for the dial', await q.evaluate(() => document.querySelector('.dial-opt').hidden), null);
  console.log(`dial ${engine}: ${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close(); process.exit(fails ? 1 : 0);
})();
