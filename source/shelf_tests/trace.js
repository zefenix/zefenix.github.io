// The highlighter (H): click or tap to mark a sentence or paragraph; it stays as you read.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded, settled } = require('./common');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
// a point on the words of the nth paragraph shown, in the pages or the scroll column, once the pages have stopped moving
const wordAt = async (p, where, n, word = 3) => (await settled(p), p.evaluate(([where, n, word]) => {
  const root = where === 'pages' ? document.querySelector('#desk .pagedjs_page.is-current') : document.getElementById('article');
  const box = (where === 'pages' ? document.getElementById('desk') : document.getElementById('scroller')).getBoundingClientRect();
  const ps = [...root.querySelectorAll('p')].filter(x => x.textContent.split(/\s+/).length > 12 && (() => { const r = x.getBoundingClientRect(); return r.top > box.top + 20 && r.top < box.bottom - 80; })());
  const el = ps[n] || ps[0]; if (!el) return null;
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const t = tw.nextNode(); const words = [...t.textContent.matchAll(/\S+/g)]; const w = words[Math.min(word, words.length - 1)];
  const rg = document.createRange(); rg.setStart(t, w.index); rg.setEnd(t, w.index + w[0].length); const r = rg.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, word: w[0], para: el.textContent.replace(/\s+/g, ' ').slice(0, 30) };
}, [where, n, word]));
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await route(ctx);
  await ctx.addInitScript(() => {
    window.__said = [];
    const voice = { name: 'Test', lang: 'en-US', default: true, localService: true, voiceURI: 'Test' };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speaking: false, pending: false, getVoices: () => [voice], addEventListener() {}, speak(u) { window.__said.push(u.text); }, cancel() {}, pause() {}, resume() {} } });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const ready = () => loaded(p);
  const T = () => p.evaluate(() => { const h = CSS.highlights.get('trace'); const r = h && [...h][0]; return { on: document.querySelector('.app').classList.contains('tracing'), text: r ? r.toString().replace(/\s+/g, ' ') : null, page: +document.getElementById('pageNum').value, scroll: Math.round(document.getElementById('scroller').scrollTop) }; });
  const k = async (key, ms = 450) => { await p.keyboard.press(key); await p.waitForTimeout(ms); };
  const set = (name, v) => p.evaluate(([n, v]) => document.querySelector(`[data-setting="${n}"] [data-value="${v}"]`).click(), [name, v]);
  await p.goto('http://pp.test/pages-piled/#flow'); await ready();
  await k('H'); let s = await T(); ok('H: on, a sentence of the page marked', s.on && !!s.text, s);
  const first = s.text;
  await k('w'); s = await T(); ok('w: the next sentence', s.text && s.text !== first, s);
  await k('q'); s = await T(); ok('q: back', s.text === first, s);
  let at = await wordAt(p, 'pages', 1, 6); await p.mouse.click(at.x, at.y); await p.waitForTimeout(300);
  s = await T(); ok('a click marks the sentence under it', s.text && s.text.includes(at.word), { s, at });
  const marked = s.text, page = s.page;
  await k('l', 800); s = await T(); ok('turning the page leaves the mark where it is', s.text === marked && s.page === page + 1, s);
  await k('r', 800); s = await T(); ok('r goes back to it', s.page === page && s.text === marked, s);
  await k('W'); s = await T(); ok('W: whole paragraphs, the one holding it', s.text.length > marked.length && s.text.includes(marked.trim().slice(0, 15)), s);
  at = await wordAt(p, 'pages', 0, 2); await p.mouse.click(at.x, at.y); await p.waitForTimeout(300);
  s = await T(); ok('a click marks the paragraph under it', s.text && s.text.startsWith(at.para.slice(0, 20)), { s, at });
  await k('Q'); s = await T(); ok('Q: back to sentences', s.text.length < 400 && s.text.split(/[.!?] /).length <= 2, s);
  // Strip: the pages either side lie flat, so a click there marks without moving the page
  await set('arrange', 'strip'); await p.waitForTimeout(900); await settled(p);
  const side = await p.evaluate(() => { const cur = document.querySelector('#desk .pagedjs_page.is-current'), all = [...document.querySelectorAll('#desk .pagedjs_page')], nb = all[all.indexOf(cur) + 1];
    for (const para of nb.querySelectorAll('p')) { const tw = document.createTreeWalker(para, NodeFilter.SHOW_TEXT); let t; while ((t = tw.nextNode())) for (const w of t.textContent.matchAll(/[A-Za-z]{5,}/g)) { const rg = document.createRange(); rg.setStart(t, w.index); rg.setEnd(t, w.index + w[0].length); const r = rg.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); if (r.width && x > 0 && x < innerWidth && y > 60 && y < innerHeight - 60 && hit && nb.contains(hit)) return { x, y, word: w[0] }; } }
    return null; });
  const pBefore = (await T()).page;
  if (side) { await p.mouse.click(side.x, side.y); await p.waitForTimeout(500); }
  s = await T(); ok('Strip: a click on the page beside marks there, and the page stays put', !!side && s.page === pBefore && s.text && s.text.includes(side.word), { s, side, pBefore });
  await set('arrange', 'flow'); await p.waitForTimeout(600);
  // plain text: the mark stays put as you scroll; a step out of sight brings it back
  await set('mode', 'text'); await p.waitForTimeout(1500);
  at = await wordAt(p, 'text', 1, 4); await p.mouse.click(at.x, at.y); await p.waitForTimeout(300);
  s = await T(); const mt = s.text; ok('plain text: a click marks the sentence', mt && mt.includes(at.word), { s, at });
  await p.mouse.move(700, 450); await p.mouse.wheel(0, 1400); await p.waitForTimeout(1200);
  s = await T(); ok('scrolling away leaves the mark where it is', s.text === mt, s);
  const away = await p.evaluate(() => { const h = CSS.highlights.get('trace'), r = [...h].find(r => document.getElementById('article').contains(r.startContainer)), rr = r.getBoundingClientRect(), box = document.getElementById('scroller').getBoundingClientRect(); return !(rr.bottom > box.top && rr.top < box.bottom); });
  // a smooth scroll moves only as the browser draws, which a busy WebKit can hold off for seconds: wait for it to come to rest
  const scrollStill = async () => { for (let i = 0; i < 40; i++) if (!(await p.evaluate(() => new Promise(r => { const el = document.getElementById('scroller'), was = el.scrollTop; requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => r(el.scrollTop !== was), 200))); })))) return; };
  const sc = s.scroll; await k('w', 1200); await scrollStill(); s = await T();
  const vis = await p.evaluate(() => { const h = CSS.highlights.get('trace'), r = [...h].find(r => document.getElementById('article').contains(r.startContainer)), rr = r.getBoundingClientRect(), box = document.getElementById('scroller').getBoundingClientRect(); return rr.bottom > box.top && rr.top < box.bottom; });
  ok('w: the next sentence, in sight (scrolled there only if it was out of sight)', s.text !== mt && vis, { s, vis, sc, away });
  // Listen from the mark, and back to it after
  const from = (await T()).text;
  await k('a', 800); const said = await p.evaluate(() => window.__said[0] || '');
  ok('a: Listen starts at the mark', said.includes(from.trim().slice(0, 15)), { said: said.slice(0, 40), from });
  await k('a', 600); s = await T(); ok('when Listen stops, the mark is on its last sentence', s.on && !!s.text, s);
  // kept on across a reload
  await p.reload(); await ready(); await p.waitForTimeout(500); s = await T(); ok('after a reload the highlighter is still on', s.on && !!s.text, s);
  await k('H'); s = await T(); ok('H turns it off', !s.on && !s.text, s);
  await ctx.close();
  // a phone: Options turns it on, a tap marks
  const ph = await b.newContext({ viewport: { width: 393, height: 780 }, ...(engine === 'firefox' ? {} : { isMobile: true }), hasTouch: true }); await route(ph);
  const q = await ph.newPage(); q.on('pageerror', e => errs.push(String(e)));
  await q.goto('http://pp.test/pages-piled/#flow'); await loaded(q);
  await q.evaluate(() => document.querySelector('[data-setting="highlighter"] [data-value="sentence"]').click()); await q.waitForTimeout(400);
  at = await wordAt(q, 'pages', 1, 4); await q.touchscreen.tap(at.x, at.y); await q.waitForTimeout(400);
  const ts = await q.evaluate(() => { const h = CSS.highlights.get('trace'); const r = h && [...h][0]; return r ? r.toString() : null; });
  ok('phone: Options turns it on, and a tap marks the sentence', ts && ts.includes(at.word), { ts, at });
  console.log(`${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.join(' | ') || 'none'}`);
  await b.close();
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.log('CRASH', String(e.stack || e).slice(0, 600)); process.exit(1); });
