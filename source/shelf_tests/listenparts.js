// Listen reads on into the next part: at the end of part 1 it opens part 2 at its first chapter and carries on there;
// where the browser won't speak before a tap, it says how to go on.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded } = require('./common');
const longBook = require('./longbook.js');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await route(ctx);
  // a voice that finishes each sentence at once; window.__refuse makes it refuse, as a browser does before a tap
  await ctx.addInitScript(() => {
    window.__said = JSON.parse(sessionStorage.getItem('said') || '[]');
    const voice = { name: 'Test', lang: 'en-US', default: true, localService: true, voiceURI: 'Test' };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speaking: true, pending: false, getVoices: () => [voice], addEventListener() {},
      speak(u) { if (sessionStorage.getItem('refuse')) { setTimeout(() => u.onerror && u.onerror({ error: 'not-allowed' }), 5); return; } window.__said.push(u.text); sessionStorage.setItem('said', JSON.stringify(window.__said.slice(-5))); setTimeout(() => u.onend && u.onend(), 2); }, cancel() {}, pause() {}, resume() {} } });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const ready = () => loaded(p);
  const key = await longBook(p);
  await p.goto(`http://pp.test/pages-piled/?opened=${key}`); await ready();
  const info = await p.evaluate(() => ({ parts: window.bookInfo.parts.length, last: window.bookInfo.toc.filter(t => t.part === 1).pop(), next: window.bookInfo.toc.find(t => t.part === 2) }));
  await p.goto(`http://pp.test/pages-piled/?opened=${key}#${info.last.id}`); await ready(); await p.waitForTimeout(500);
  await p.keyboard.press('End'); await p.waitForTimeout(600);   // the part's last page, so only a few sentences are left
  await p.keyboard.press('a');
  await p.waitForURL(u => /part=2/.test(String(u)), { timeout: 30000 }).catch(() => {});
  await ready();
  await p.waitForFunction(n => !location.search.includes('listen=') && window.__said.some(t => t.includes(`chapter ${n} `)), info.next.title.replace(/\D/g, ''), { timeout: 20000 }).catch(() => {});
  const after = await p.evaluate(() => ({ part: window.bookInfo.part, url: location.search, said: window.__said.filter(t => /^In chapter/.test(t)).slice(0, 3), reading: document.querySelector('.app').classList.contains('listening') }));
  ok(`at the end of part 1 (${info.last.title}), Listen opens part 2 and reads on from ${info.next.title}`, after.part === 2 && !/listen=/.test(after.url) && after.said.some(t => t.includes(`chapter ${info.next.title.replace(/\D/g, '')} `)), { info, after });
  await p.keyboard.press('a'); await p.waitForTimeout(300);
  // a browser that won't speak before a tap: Listen says how to go on
  await p.evaluate(() => sessionStorage.setItem('refuse', '1'));
  const last2 = await p.evaluate(() => window.bookInfo.toc.filter(t => t.part === 2).pop().id);
  await p.goto(`http://pp.test/pages-piled/?opened=${key}&part=2&listen=on#${last2}`); await ready(); await p.waitForTimeout(1500);
  const refused = await p.evaluate(() => ({ toast: document.getElementById('toast').textContent, reading: document.querySelector('.app').classList.contains('listening'), url: location.search }));
  ok('where the browser refuses to speak, it says: press a or tap Listen', /Part 2 is open\. Press a, or tap Listen, to read on\./.test(refused.toast) && !refused.reading && !/listen=/.test(refused.url), refused);
  // the last part: Listen stops at its end
  await p.evaluate(() => sessionStorage.removeItem('refuse'));
  const lastId = await p.evaluate(() => window.bookInfo.toc[window.bookInfo.toc.length - 1].id);
  await p.goto(`http://pp.test/pages-piled/?opened=${key}&part=${info.parts}#${lastId}`); await ready(); await p.waitForTimeout(500);
  await p.keyboard.press('a'); await p.waitForTimeout(4000);
  // reading a whole chapter, a busy Firefox can take longer than 4 s: give it up to a minute to stop
  await p.waitForFunction(() => !document.querySelector('.app').classList.contains('listening'), null, { timeout: 60000 }).catch(() => {});
  const end = await p.evaluate(() => ({ part: window.bookInfo.part, reading: document.querySelector('.app').classList.contains('listening') }));
  ok('in the last part, Listen stops at the end', end.part === info.parts && !end.reading, end);
  console.log(`listenparts ${engine}: ${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  await b.close(); process.exit(fails ? 1 : 0);
})();
