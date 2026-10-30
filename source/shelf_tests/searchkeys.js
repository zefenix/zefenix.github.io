// The reader's search, by keys: what each key does, and that Esc steps back one level at a time and leaves nothing behind.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded } = require('./common');
const longBook = require('./longbook.js');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await route(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const key = await longBook(p);
  await p.goto(`http://pp.test/pages-piled/?opened=${key}`);
  await loaded(p);
  const S = () => p.evaluate(() => ({ page: +document.getElementById('pageNum').value, box: !document.getElementById('searchBox').hidden, chip: document.getElementById('chip').hidden ? null : document.querySelector('#chip .chip-q').textContent.replace(/\s+/g, ' ').trim(),
    marks: CSS.highlights ? (CSS.highlights.get('hits')?.size || 0) : -1, focus: document.activeElement.id || document.activeElement.tagName, lib: !document.getElementById('books').hidden, peek: document.getElementById('tocPanel').classList.contains('peek') }));
  const k = async (key, ms = 350) => { await p.keyboard.press(key); await p.waitForTimeout(ms); };
  const search = async w => { await k('/', 200); await p.keyboard.type(w); await p.waitForTimeout(700); };
  let s = await S(); const start = s.page;

  await search('lantern'); s = await S(); ok('/ and typing: the box is open and the page goes to a match', s.box && s.focus === 'q' && s.page !== start, s);
  await k('Escape'); s = await S(); ok('Esc while typing cancels outright: box shut, back where you were, no highlights or chip', !s.box && s.page === start && !s.chip && s.marks === 0 && s.focus === 'desk', s);
  await k('Escape'); s = await S(); ok('Esc again changes nothing', !s.box && s.page === start && !s.lib, s);

  await search('lantern'); await k('ArrowDown'); await k('ArrowDown'); s = await S(); const at = s.page;
  await k('Enter'); s = await S(); ok('↓ ↓ Enter: box shut, stays at that match, chip says which', !s.box && s.page === at && /of \d+/.test(s.chip || '') && s.marks > 0, s);
  const nth = () => +((s.chip || '').match(/(\d+) of \d+/) || [0, 0])[1], was = nth();
  await k('n'); s = await S(); ok('n: the next match', nth() === was + 1, s);
  await k('N'); s = await S(); ok('N: back one', nth() === was, s);
  const here = s.page;
  await k('Escape'); s = await S(); ok('Esc clears the highlights and chip, page stays', !s.chip && s.marks === 0 && s.page === here, s);
  await k('Escape'); s = await S(); ok('Esc again changes nothing', !s.chip && s.page === here && !s.lib, s);
  await k('j'); s = await S(); ok('j turns the page after', s.page === here + 1, s);

  await search('jkhl'); s = await S(); ok('j k h l type into the box and turn no page', s.box && (await p.evaluate(() => document.getElementById('q').value)) === 'jkhl', s);
  await k('Escape');
  // unpin Contents so c really peeks
  if (await p.evaluate(() => !document.getElementById('tocPanel').hidden && !document.getElementById('tocPanel').classList.contains('peek'))) await k('C', 500);
  await search('lantern'); await k('Enter'); await p.keyboard.press('c'); await p.waitForTimeout(500);
  s = await S(); const peeked = s.peek;
  await k('Escape'); s = await S(); ok('with a peek over the highlights, Esc shuts the peek first', peeked && !s.peek && !!s.chip, { peeked, ...s });
  await k('Escape'); s = await S(); ok('then Esc clears the highlights', !s.chip && s.marks === 0, s);

  await search('lantern'); await k('Enter'); await k('/', 200); s = await S(); ok('/ again reopens the box with the words', s.box && (await p.evaluate(() => document.getElementById('q').value)) === 'lantern', s);
  await p.keyboard.press('Control+a'); await p.keyboard.type(':noh'); await k('Enter'); s = await S(); ok(':noh Enter clears the highlights', !s.box && !s.chip && s.marks === 0, s);

  await search('lantern'); await p.mouse.click(640, 480); await p.waitForTimeout(400); s = await S(); ok('a click on the page shuts the box and keeps the match', !s.box && !!s.chip, s);
  await k('Escape'); s = await S(); ok('Esc then clears', !s.chip, s);
  await search('tokio'); s = await S(); ok('no match: the box says so, the page stays', s.box && (await p.evaluate(() => document.querySelector('#results .empty')?.textContent || '')).startsWith('Nothing'), s);
  await k('Enter'); s = await S(); ok('Enter on no match shuts the box with nothing left', !s.box && !s.chip, s);

  console.log(`${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.join(' | ') || 'none'}`);
  await b.close();
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.log('CRASH', String(e.stack || e).slice(0, 600)); process.exitCode = 1; });
