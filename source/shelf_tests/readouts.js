// A slider's readout in Options puts that setting back to its default.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded } = require('./common');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await route(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://pp.test/pages-piled/#flow');
  await loaded(p);
  await p.keyboard.press('O'); await p.waitForTimeout(400);
  const set = (id, v) => p.evaluate(([id, v]) => { const i = document.getElementById(id); i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  // a real click at the readout's centre: Playwright's click waits for a steady frame, which an idle headless WebKit may not draw
  const clickOn = async sel => { const c = await p.evaluate(sel => { const e = document.querySelector(sel); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel); await p.mouse.click(c.x, c.y); };
  const read = id => p.evaluate(id => ({ v: document.getElementById(id).value, out: document.getElementById(id).nextElementSibling.textContent }), id);
  for (const [id, moved, def, shown] of [['pagedSpread', 60, '28', '28%'], ['rate', 1.5, '1', '1×'], ['shade', 40, '100', '100%'], ['mapMarkOp', 80, null, null]]) {
    await set(id, moved); await p.waitForTimeout(500);
    const before = await read(id);
    await p.evaluate(id => { const o = document.getElementById(id).nextElementSibling; o.scrollIntoView({ block: 'center' }); }, id);
    await clickOn(`#${id} + output`); await p.waitForTimeout(600);
    const after = await read(id);
    ok(`${id}: a click on ${before.out} puts it back to the default${shown ? ', ' + shown : ''}`, after.v !== before.v && (def === null || (after.v === def && after.out === shown)), { before, after });
  }
  // the keyboard: Enter on a readout
  await set('glide', 1.6); await p.waitForTimeout(400);
  await p.focus('#glide + output'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  const g = await read('glide'); ok('glide: Enter on its readout puts it back too, to 1.2×', g.v === '1.2', g);
  // text size, which sets the pages again
  await set('textSize', 120); await loaded(p); await p.waitForTimeout(800);
  await clickOn('#textSize + output'); await p.waitForTimeout(800);
  await loaded(p); await p.waitForTimeout(600);
  const t = await read('textSize'); ok('text size: back to 100%, the pages set again', t.v === '100' && t.out === '100%', t);
  console.log(`readouts ${engine}: ${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close(); process.exit(fails ? 1 : 0);
})();
