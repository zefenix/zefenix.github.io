// The Library's keys, state by state: what each key does, and that Esc only ever steps back one level.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded } = require('./common');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await route(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://pp.test/pages-piled/');
  await loaded(p);
  // one opened book, so Remove all can be tried
  await p.evaluate(async () => { await window.bookTools.saveBook({ v: 1, title: 'Test notes', site: 'your files', url: 'file:///test-notes', from: 'files', at: new Date().toISOString(), chapters: [{ title: 'One', url: 'file:///test-notes/one.md', markdown: '# One\n\nA borrowed line about slices, kept in my notes.' }, { title: 'Two', url: 'file:///test-notes/two.md', markdown: '# Two\n\nMore slices, and more notes on them.' }] }); });
  const S = () => p.evaluate(() => { const a = document.activeElement;
    return { open: !document.getElementById('books').hidden, focus: a === document.getElementById('libFind') ? 'find' : a.classList.contains('f-row') ? 'found' : a.closest && a.closest('#libOutline') ? 'outline' : a.classList.contains('lib-book') ? 'book' : a === document.body ? 'body' : (a.id || a.tagName),
      find: document.getElementById('libFind').value, words: !document.getElementById('libFound').hidden, sel: document.querySelector('.lib-book[aria-selected] .t')?.textContent || null,
      view: document.querySelector('#libView [aria-pressed="true"]')?.dataset.v, inOutline: document.getElementById('libOutline').classList.contains('active'), outline: document.querySelector('#libOutline .o-title')?.textContent,
      asking: !!document.querySelector('#clearBox .danger'), keys: !document.getElementById('keyHelp').hidden }; });
  const key = async (k, ms = 150) => { await p.keyboard.press(k); await p.waitForTimeout(ms); };
  const esc = () => key('Escape', 250);
  const openLib = async () => { await key('B', 500); };

  // 1. Open with nothing chosen: keys pick a book, Esc lets go, Esc closes.
  await openLib();
  let s = await S(); ok('B opens the Library', s.open, s);
  await key('l'); s = await S(); ok('l picks the first book', !!s.sel && s.focus === 'book', s);
  await key('l'); s = await S(); ok('l moves to the next book', s.sel === 'Test notes', s);
  await esc(); s = await S(); ok('Esc lets go of the book, Library stays', s.open && !s.sel, s);
  await esc(); s = await S(); ok('Esc again closes', !s.open, s);

  // 2. In the find box every letter types; nothing else happens.
  await openLib(); await key('/');
  await p.keyboard.type('jkhlbvLoB?c'); await p.waitForTimeout(300);
  s = await S(); ok('letters type into the find box and change nothing else', s.open && s.focus === 'find' && s.find === 'jkhlbvLoB?c' && s.view === 'list' && !s.keys && !s.inOutline, s);
  await esc(); s = await S(); ok('Esc in the box clears it, focus stays', s.open && s.focus === 'find' && s.find === '' && !s.words, s);
  await esc(); s = await S(); ok('Esc again leaves the box', s.open && s.focus !== 'find', s);
  await esc(); s = await S(); ok('Esc again closes', !s.open, s);

  // 3. A title: Enter steps into the books found; Esc back to the box, then clear, leave, close.
  await openLib(); await key('/'); await p.keyboard.type('notes'); await p.waitForTimeout(2200);
  await key('Enter'); s = await S(); ok('Enter goes into the books found', s.focus === 'book' && s.sel === 'Test notes', s);
  await key('j'); s = await S(); ok('j from the last book goes down into the places found', s.focus === 'found', s);
  await key('k'); s = await S(); ok('k from the first place goes back up to the book', s.focus === 'book', s);
  await esc(); s = await S(); ok('Esc: back to the box, words kept', s.focus === 'find' && s.find === 'notes' && s.words && !s.sel, s);
  await esc(); s = await S(); ok('Esc: clears', s.find === '' && !s.words, s);
  await esc(); await esc(); s = await S(); ok('Esc, Esc: leaves the box, closes', !s.open, s);

  // 4. Words only: Enter goes to the places; L shows that book's outline and comes back.
  await openLib(); await key('/'); await p.keyboard.type('slices'); await p.waitForTimeout(2200);
  await key('Enter'); s = await S(); ok('Enter with no title match goes to the places found', s.focus === 'found', s);
  await key('j'); await key('j');
  const row = await p.evaluate(() => document.activeElement.getAttribute('href'));
  s = await S(); ok('the outline follows the place found', s.outline === await p.evaluate(() => document.activeElement._book.title), s);
  await key('L'); s = await S(); ok('L: into that book’s outline, at a chapter holding the words', s.inOutline && s.focus === 'outline' && await p.evaluate(() => document.querySelector('#libOutline a.o-sel')?.classList.contains('o-hit')), s);
  await key('j'); await key('L'); s = await S(); ok('L again: back to the same place', s.focus === 'found' && await p.evaluate(h => document.activeElement.getAttribute('href') === h, row), s);
  await key('L'); await esc(); s = await S(); ok('Esc in the outline: back to the same place, not closed', s.open && s.focus === 'found' && !s.inOutline, s);
  await key('h'); await key('l'); s = await S(); ok('h and l do nothing on a place found', s.focus === 'found', s);
  await esc(); s = await S(); ok('Esc: to the box', s.focus === 'find' && s.find === 'slices', s);
  await esc(); s = await S(); ok('Esc: clears, all books back', s.find === '' && !s.words && (await p.evaluate(() => document.querySelectorAll('.lib-book:not([hidden])').length)) === 2, s);
  await key('Tab'); s = await S();
  await esc(); s = await S(); ok('Esc when out of the box with it empty: closes', !s.open, s);

  // 5. A book's own outline: L in, Esc out to the book, Esc lets go, Esc closes.
  await openLib(); await key('l'); await key('l');
  await key('L'); s = await S(); ok('L from a book: its outline', s.inOutline && s.outline === 'Test notes', s);
  await key('j'); await key('h'); await key('l'); s = await S(); ok('h and l stay in the outline', s.inOutline && s.sel === 'Test notes', s);
  await esc(); s = await S(); ok('Esc: back to the book', !s.inOutline && s.focus === 'book' && s.sel === 'Test notes', s);
  await key('b'); s = await S(); ok('b switches to Shelf', s.view === 'shelf', s);
  await key('b'); s = await S(); ok('b back to List, the default', s.view === 'list', s);
  await esc(); await esc(); s = await S(); ok('Esc, Esc: let go, close', !s.open, s);

  // 6. Remove all: Esc cancels and keeps the Library open.
  await openLib(); await p.click('#clearAll'); await p.waitForTimeout(200);
  s = await S(); ok('Remove all asks first', s.asking, s);
  await esc(); s = await S(); ok('Esc cancels Remove all, Library stays', s.open && !s.asking, s);
  // 7. ? opens the keys over the Library; Esc closes the keys only.
  await key('?'); s = await S(); ok('? opens the keys', s.keys, s);
  await esc(); s = await S(); ok('Esc closes the keys, Library stays', !s.keys && s.open, s);
  await esc(); s = await S(); ok('Esc closes the Library', !s.open, s);
  // 8. o and B close it from a book; the reader's vim keys work after.
  await openLib(); await key('l'); await key('o', 400); s = await S(); ok('o closes the Library', !s.open, s);
  const p0 = await p.evaluate(() => document.getElementById('pageNum').value); await key('j', 400);
  ok('j turns the page in the reader after', await p.evaluate(v => document.getElementById('pageNum').value !== v, p0), p0);

  console.log(`${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.join(' | ') || 'none'}`);
  await b.close();
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.log('CRASH', String(e.stack || e).slice(0, 600)); process.exitCode = 1; });
