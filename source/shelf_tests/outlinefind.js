// Finding in the outline: L, then /, opens a box at the top of Contents, or of the Library's outline, that narrows it
// to the chapters and headings whose names hold the words; ↓ or Enter steps into them, Esc clears, then closes.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded } = require('./common');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const errs = [];
  for (const [w, h, mob] of [[1280, 860, false], [393, 800, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, ...(mob && engine !== 'firefox' ? { isMobile: true } : {}), hasTouch: mob }); await route(ctx);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e)));
    const ready = () => loaded(p);
    await p.goto('http://pp.test/pages-piled/#flow'); await ready();
    const T = () => p.evaluate(() => { const vis = el => el.offsetParent !== null; return { box: !document.getElementById('tocFindBox').hidden, focus: document.activeElement.id || document.activeElement.className, value: document.getElementById('tocFind').value, n: document.getElementById('tocFindN').textContent,
      shown: [...document.querySelectorAll('#tocList .toc-item, #tocList .toc-outline a')].filter(vis).map(a => a.querySelector('.t').textContent), sel: document.querySelector('#tocList .k-sel .t')?.textContent || null, chap: document.getElementById('chap')?.textContent || document.title }; });
    const tag = mob ? 'phone' : 'computer';
    if (!mob) {
      await p.keyboard.press('L'); await p.waitForTimeout(300); await p.keyboard.press('/'); await p.waitForTimeout(300);
      let t = await T(); ok(`${tag}: L, then /: the outline's find box opens with the keys`, t.box && t.focus === 'tocFind', t);
      for (const ch of 'glid') { await p.keyboard.type(ch); await p.waitForTimeout(120); }
      t = await T(); ok(`${tag}: "glid" narrows Contents to Gliding under its chapter`, JSON.stringify(t.shown) === JSON.stringify(['Scroll', 'Gliding']) && t.n === '1', t);
      await p.fill('#tocFind', ''); for (const ch of 'place') { await p.keyboard.type(ch); await p.waitForTimeout(120); }
      t = await T(); ok(`${tag}: "place", c and all, stays in the box and finds the chapter and heading`, t.value === 'place' && t.focus === 'tocFind' && t.shown.includes('Keeping your place'), t);
      await p.fill('#tocFind', 'glid'); await p.waitForTimeout(200);
      await p.keyboard.press('ArrowDown'); await p.waitForTimeout(200); t = await T();
      ok(`${tag}: ↓ steps into what was found`, t.sel === 'Scroll', t);
      await p.keyboard.press('j'); await p.waitForTimeout(200); t = await T(); ok(`${tag}: j moves to Gliding`, t.sel === 'Gliding', t);
      await p.keyboard.press('Escape'); await p.waitForTimeout(250); t = await T();
      ok(`${tag}: Esc in what was found goes back to the box, words kept, Contents still open`, t.focus === 'tocFind' && t.value === 'glid' && t.box && t.shown.length === 2, t);
      await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150); await p.keyboard.press('j'); await p.waitForTimeout(150);
      await p.keyboard.press('Enter'); await p.waitForTimeout(900);
      const page = await p.evaluate(() => [...document.querySelectorAll('#desk .pagedjs_page.is-current h3')].map(h => h.textContent));
      ok(`${tag}: Enter goes to it`, page.includes('Gliding'), page);
      await p.keyboard.press('L'); await p.waitForTimeout(300); await p.keyboard.press('/'); await p.waitForTimeout(200);
      t = await T(); ok(`${tag}: the box opens again with its words kept until cleared`, t.box && t.focus === 'tocFind', t);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200); t = await T();
      ok(`${tag}: Esc clears the words, and Contents is whole again`, t.box && t.value === '' && t.shown.length > 13, t);
      await p.keyboard.press('Escape'); await p.waitForTimeout(300); t = await T();
      ok(`${tag}: Esc again closes the box and gives the keys back to Contents`, !t.box && !!t.sel, t);
      await p.keyboard.press('L'); await p.waitForTimeout(300);
      // the Library's outline
      await p.keyboard.press('o'); await p.waitForTimeout(500); await p.keyboard.press('L'); await p.waitForTimeout(300); await p.keyboard.press('/'); await p.waitForTimeout(300);
      const O = () => p.evaluate(() => { const o = document.getElementById('libOutline'), inp = o.querySelector('.o-find input'); return { focus: document.activeElement === inp ? 'oFind' : (document.activeElement.className || document.activeElement.id), value: inp?.value, libFind: document.getElementById('libFind').value, shown: [...o.querySelectorAll('a')].filter(a => a.offsetParent !== null).map(a => a.querySelector('.t').textContent), sel: o.querySelector('a.o-sel .t')?.textContent || null, lib: !document.getElementById('books').hidden }; });
      let o = await O(); ok(`${tag}: Library, L, then /: the outline's own box`, o.focus === 'oFind', o);
      for (const ch of 'keys') { await p.keyboard.type(ch); await p.waitForTimeout(120); }
      o = await O(); ok(`${tag}: "keys" narrows the outline to Keys, and the Library's find stays empty`, JSON.stringify(o.shown) === JSON.stringify(['Keys']) && o.libFind === '' && o.value === 'keys', o);
      await p.keyboard.press('ArrowDown'); await p.waitForTimeout(200); o = await O(); ok(`${tag}: ↓ steps into the outline`, o.sel === 'Keys', o);
      await p.keyboard.press('Escape'); await p.waitForTimeout(250); o = await O();
      ok(`${tag}: Esc there goes back to the outline's box, words kept, the Library open`, o.focus === 'oFind' && o.value === 'keys' && o.lib, o);
      await p.keyboard.press('Escape'); await p.waitForTimeout(200); o = await O(); ok(`${tag}: Esc clears the words`, o.value === '' && o.focus === 'oFind' && o.lib, o);
      await p.keyboard.press('Escape'); await p.waitForTimeout(250); o = await O(); ok(`${tag}: Esc closes the box and gives the keys back to the outline`, o.lib && !!o.sel, o);
      await p.keyboard.press('/'); await p.waitForTimeout(200); await p.keyboard.type('keys'); await p.waitForTimeout(250);
      await p.keyboard.press('Enter'); await p.waitForTimeout(300); o = await O();
      ok(`${tag}: Enter with one left goes there`, !o.lib, o);
      const page2 = await p.evaluate(() => [...document.querySelectorAll('#desk .pagedjs_page.is-current h2')].map(h => h.textContent));
      ok(`${tag}: …to the Keys chapter`, page2.includes('Keys'), page2);
    } else {
      // a phone: Contents' Find button, then a tap on what was found
      await p.evaluate(() => document.getElementById('tocBtn').click()); await p.waitForTimeout(500);
      const fb = await p.evaluate(() => { const r = document.getElementById('tocFindBtn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; });
      await p.touchscreen.tap(fb.x, fb.y); await p.waitForTimeout(300);
      let t = await T(); ok(`${tag}: Contents' Find button opens the box`, t.box && t.focus === 'tocFind' && fb.w > 0, { t, fb });
      await p.keyboard.type('strip'); await p.waitForTimeout(300); t = await T();
      ok(`${tag}: typing narrows Contents`, t.shown[0] === 'Strip', t);
      const hit = await p.evaluate(() => { const a = [...document.querySelectorAll('#tocList .toc-item')].find(x => x.offsetParent && x.querySelector('.t').textContent === 'Strip').getBoundingClientRect(); return { x: a.left + a.width / 2, y: a.top + a.height / 2 }; });
      await p.touchscreen.tap(hit.x, hit.y); await p.waitForTimeout(900);
      const page = await p.evaluate(() => [...document.querySelectorAll('#desk .pagedjs_page.is-current h2')].map(h => h.textContent));
      ok(`${tag}: a tap goes there`, page.includes('Strip'), page);
    }
    await ctx.close();
  }
  console.log(`outlinefind ${engine}: ${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close(); process.exit(fails ? 1 : 0);
})();
