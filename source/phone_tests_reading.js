// Reading and text: the reading zone, the minimap's mark, Listen's keys and stay, search jumps, sections,
// spreads, the pile, the colophon and the book's own text.
// A missing or covered control is the evidence a test looks for, so it fails as an assertion, not a script error.
const assert = require('node:assert');
const shown = page => page.evaluate(() => [...document.querySelectorAll('#desk .is-current')].map(p => +p.dataset.pageNumber));
const saying = page => page.evaluate(() => window.testSpeech.current?.text ?? null);
const spoken = page => page.evaluate(() => window.testSpeech.history.slice());
const visible = (page, selector) => page.evaluate(s => !!document.querySelector(s)?.checkVisibility(), selector);
const rect = (page, selector) => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, cy: r.top + r.height / 2 }; }, selector);

// A finger on whatever is drawn at the element's centre, after bringing it into view; it must not be covered.
async function tap(page, touch, target, name) {
  const el = typeof target === 'string' ? page.locator(target).first() : target.first();
  if (!await el.count()) assert.fail(`${name} is not there to tap`);
  const at = await el.evaluate(e => {
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, hit = document.elementFromPoint(x, y);
    return { x, y, open: !!hit && (hit === e || e.contains(hit)), hit: hit && (hit.id || hit.className || hit.tagName) };
  });
  if (!at.open) assert.fail(`${name} is covered by ${at.hit}`);
  await touch.tap(at.x, at.y);
}
// A range input tapped at a share of its width, or dragged from one share to another.
async function slide(page, touch, selector, name, to, from) {
  if (!await page.locator(selector).count()) assert.fail(`${name} slider is not there`);
  const b = await page.locator(selector).evaluate(e => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width }; });
  const x = f => b.x + 8 + f * (b.w - 16);
  if (from == null) await touch.tap(x(to), b.y);
  else await touch.swipe([x(from), b.y], [x(to), b.y], { steps: 12, ms: 240 });
}
// Options on a phone shows one tab of groups; the released reader had no tabs and showed every group.
async function openOptions(page, touch, tabName) {
  await tap(page, touch, '#optsBtn', 'Options');
  const tab = page.locator('#optTabs button', { hasText: tabName });
  if (await tab.count() && await tab.isVisible()) await tap(page, touch, tab, `the ${tabName} tab`);
}
// Each shown row of an Options group: its label, then its buttons, slider and readout.
const optionRows = (page, heading) => page.evaluate(heading => {
  const section = [...document.querySelectorAll('#options section')].find(s => s.querySelector('h3').textContent === heading);
  return [...section.querySelectorAll('.row')].filter(r => r.checkVisibility()).map(r => [...r.children].map(c =>
    c.matches('.seg') ? [...c.children].map(b => b.textContent).join('/') : c.tagName === 'INPUT' ? 'slider' : c.textContent.trim()).join(' '));
}, heading);
const readout = (page, selector) => page.evaluate(s => document.querySelector(s).nextElementSibling.textContent, selector);

async function search(page, query) {
  await page.locator('#desk').focus();
  await page.keyboard.press('/');
  await page.locator('#q').fill(query);
  await page.waitForTimeout(400);   // the list follows typing after a 140 ms pause
  return page.evaluate(() => [...document.querySelectorAll('#results .result.jump')].map(li => `${li.querySelector('.r-meta').textContent} | ${li.querySelector('.r-snip').textContent}`));
}
async function enterResult(page, downs) {
  for (let i = 0; i < downs; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

async function press(page, keys) {
  for (const k of keys) await page.keyboard.press(k);
  await page.waitForTimeout(300);
}
// Waits briefly for Listen to say the expected sentence, then compares, so a missing step fails with what was said.
async function hears(page, assert, expected, message) {
  await page.waitForFunction(t => window.testSpeech.current?.text === t, expected, { timeout: 2000 }).catch(() => {});
  assert.equal(await saying(page), expected, message);
}
async function listenFromPage3(page, assert) {
  await page.locator('#desk').focus();
  await press(page, ['l', 'l']);
  assert.deepEqual(await shown(page), [3], 'two page turns reach page 3, Why pages');
  await page.keyboard.press('a');
  await hears(page, assert, 'Chapter 1. Why pages.', 'Listen starts at the chapter heading');
}
const settle = page => page.waitForTimeout(700);   // Listen decides where you are 350 ms after you stop moving

const zone = page => page.evaluate(() => {
  const g = document.querySelector('.guide'), r = g.getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect();
  return { on: g.checkVisibility(), top: r.top, bottom: r.bottom, height: r.height, stageTop: s.top, stageBottom: s.bottom };
});
// The distance between two lines of a long paragraph, as set on screen.
const linePitch = (page, selector) => page.evaluate(selector => {
  const p = [...document.querySelectorAll(selector)].find(p => p.textContent.length > 300);
  const range = document.createRange();
  range.selectNodeContents(document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode());
  const tops = [...new Set([...range.getClientRects()].map(r => r.top))];
  return tops[2] - tops[1];
}, selector);
const near = (a, b, within) => Math.abs(a - b) <= within;

const keysChapter = page => page.evaluate(() => {
  const pages = [...document.querySelectorAll('#desk .pagedjs_page')];
  const at = id => pages.indexOf(document.querySelector(`#desk h2#${id}`).closest('.pagedjs_page'));
  const keys = pages.slice(at('keys'), at('built'));
  const tables = keys.flatMap(p => [...p.querySelectorAll('table')]).filter((t, i, all) => all.indexOf(t) === i);
  return {
    tables: tables.map(t => t.id),
    keys: tables.flatMap(t => [...t.tBodies[0].rows].map(r => r.cells[0].textContent.trim())),
    rows: Object.fromEntries(tables.flatMap(t => [...t.tBodies[0].rows].map(r => [r.cells[0].textContent.trim(), [...r.cells].slice(1).map(c => c.textContent.trim()).join(' | ')]))),
    elsewhere: pages.filter(p => !keys.includes(p)).flatMap(p => [...p.querySelectorAll('table')].map(t => t.id)),
  };
});

module.exports = [
  {
    id: 'zone-options',
    commit: 'd63d8ad',
    what: 'Options: Reading zone Off/On; Zone place from 0% to 100% with a catch at Middle and a readout that recentres; Zone height named Line to Tallest',
    async run({ page, assert, kit, touch }) {
      await openOptions(page, touch, 'Listen & Scroll');
      assert.deepEqual(await optionRows(page, 'Scroll'), ['Glide speed slider 1.2×', 'Reading zone Off/On'], 'Scroll offers Reading zone, with its place and height hidden while it is off');
      await tap(page, touch, '.seg[data-setting="guide"] button[data-value="1"]', 'Reading zone On');
      assert.deepEqual(await optionRows(page, 'Scroll'), ['Glide speed slider 1.2×', 'Reading zone Off/On', 'Zone place slider Middle', 'Zone height slider Medium'], 'On shows Zone place at Middle and Zone height at Medium');
      const place = async (expected, saved, message) => {
        assert.equal(await readout(page, '#guideAt'), expected, message);
        assert.equal((await kit.settings(page)).guideAt, saved, `${message}, saved as ${saved}`);
      };
      await slide(page, touch, '#guideAt', 'Zone place', 0); await place('0%', 0, 'the left end puts the zone at the top');
      await slide(page, touch, '#guideAt', 'Zone place', 0.485, 0); await place('Middle', 50, 'a drag that stops a little short of the middle is caught there');
      await slide(page, touch, '#guideAt', 'Zone place', 1); await place('100%', 100, 'the right end puts the zone at the bottom');
      await tap(page, touch, '#guideAtOut', 'the Zone place readout');
      await place('Middle', 50, 'a tap on the readout puts the zone back in the middle');
      const names = [];
      for (let v = 0; v <= 5; v++) { await slide(page, touch, '#guideLines', 'Zone height', v / 5); names.push(await readout(page, '#guideLines')); }
      assert.deepEqual(names, ['Line', 'Thin', 'Short', 'Medium', 'Tall', 'Tallest'], 'Zone height runs Line, Thin, Short, Medium, Tall, Tallest');
      assert.equal((await kit.settings(page)).guideLines, 5, 'Tallest is saved as five lines');
    },
  },
  {
    id: 'zone-place-thumb',
    commit: 'd63d8ad',
    what: 'a drag that the middle catches leaves the thumb where the finger stopped while the readout says Middle',
    async run({ page, assert, touch }) {
      await openOptions(page, touch, 'Listen & Scroll');
      await tap(page, touch, '.seg[data-setting="guide"] button[data-value="1"]', 'Reading zone On');
      await slide(page, touch, '#guideAt', 'Zone place', 0.52, 0.2);
      assert.equal(await readout(page, '#guideAt'), 'Middle', 'the readout says Middle after a drag that ends just past the middle');
      assert.equal(await page.locator('#guideAt').inputValue(), '50', 'the thumb sits at the middle the readout names');
    },
  },
  {
    id: 'zone-views',
    commit: '1f55e14',
    what: 'the zone shows in plain text and scrolled pages, a hairline or one to five book lines tall, whole at place 0 and 100, and not in All pages or the page views',
    settings: { guide: 1, view: 'scroll', scrollStyle: 'text' },
    async run({ page, assert, touch }) {
      assert.equal((await zone(page)).on, true, 'the zone shows in plain text');
      const pitch = await linePitch(page, '#article p');
      assert(near(pitch, 28.56, 0.05), `plain text sets 17 px type at 1.68 leading on a phone, a line every 28.56 px (measured ${pitch})`);
      await openOptions(page, touch, 'Listen & Scroll');
      const heights = [];
      for (let v = 0; v <= 5; v++) { await slide(page, touch, '#guideLines', 'Zone height', v / 5); heights.push((await zone(page)).height); }
      const expected = [2, ...[1, 2, 3, 4, 5].map(n => n * pitch + 4)];
      assert(heights.every((h, i) => near(h, expected[i], 0.6)), `Line is a 2 px hairline and the rest one to five lines plus edges: wanted ${expected.map(h => h.toFixed(1))}, got ${heights.map(h => h.toFixed(1))}`);
      await slide(page, touch, '#guideAt', 'Zone place', 0);
      let z = await zone(page);
      assert(near(z.top, z.stageTop, 1.01), `at 0% the zone's top meets the top of the reading area (${z.top} vs ${z.stageTop})`);
      await slide(page, touch, '#guideAt', 'Zone place', 1);
      z = await zone(page);
      assert(near(z.bottom, z.stageBottom, 1.01), `at 100% the zone's bottom meets the bottom of the reading area (${z.bottom} vs ${z.stageBottom})`);
      await page.keyboard.press('Escape');
      await tap(page, touch, '.seg[data-setting="mode"] button[data-value="pages"]', 'Scrolled pages');
      await page.waitForTimeout(400);
      z = await zone(page);
      assert.equal(z.on, true, 'the zone shows in scrolled pages');
      const pagePitch = await linePitch(page, '#desk .pagedjs_page p');
      assert(near(z.height, 5 * pagePitch + 4, 0.6), `in scrolled pages Tallest is five of the page's own lines (${pagePitch} px each): ${z.height}`);
      assert(near(z.bottom, z.stageBottom, 1.01), `in scrolled pages the zone at 100% still ends at the bottom of the reading area (${z.bottom} vs ${z.stageBottom})`);
      await page.locator('#desk').focus();
      await page.keyboard.press('t');
      await page.waitForSelector('#app.grid-on');
      assert.equal((await zone(page)).on, false, 'All pages hides the zone');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#grid', { state: 'hidden' });
      assert.equal((await zone(page)).on, true, 'leaving All pages brings the zone back');
      await tap(page, touch, '.seg[data-setting="mode"] button[data-value="single"]', 'Single page');
      await page.waitForTimeout(300);
      assert.equal((await zone(page)).on, false, 'the page views have no zone');
    },
  },
  {
    id: 'zone-edge-border', engines: ['chromium', 'firefox', 'webkit'],
    commit: 'd63d8ad',
    what: 'at 0% the zone overruns the top of the reading area by its 1 px border',
    settings: { guide: 1, guideAt: 0, view: 'scroll', scrollStyle: 'text' },
    async run({ page, assert }) {
      const z = await zone(page);
      assert.equal(z.on, true, 'the zone shows in plain text');
      assert(near(z.top, z.stageTop, 1.01), `at 0% the zone sits at the top of the reading area (${z.top} vs ${z.stageTop})`);
      const hit = await page.evaluate(y => { const e = document.elementFromPoint(200, y); return e && e.closest('#stage') ? 'stage' : e && (e.id || e.className); }, z.top + 0.5);
      assert.equal(hit, 'stage', `the zone's top edge (${z.top}) lies in the reading area (from ${z.stageTop}), not under the top bar`);
    },
  },
  {
    id: 'map-mark',
    commit: '9164fc6',
    what: 'the minimap shows the percent read faintly in its box; Minimap mark hides it and Mark strength sets how faint',
    async run({ page, assert, kit, touch }) {
      assert.equal(await page.locator('#mapPct').count(), 1, 'the minimap has a percentage mark');
      await tap(page, touch, '#mapBtn', 'the minimap button');
      const mark = () => page.evaluate(() => { const m = document.querySelector('#mapPct'); return { text: m.textContent, shown: m.checkVisibility(), opacity: getComputedStyle(m).opacity, read: document.querySelector('#statR').textContent }; });
      assert.deepEqual(await mark(), { text: '5%', shown: true, opacity: '0.3', read: '5%' }, 'on the cover the mark reads 5%, as the percent read does, at 30% strength');
      await page.locator('#desk').focus();
      await press(page, Array(10).fill('l'));
      assert.deepEqual(await mark(), { text: '50%', shown: true, opacity: '0.3', read: '50%' }, 'on page 11 of 22 the mark and the percent read both say 50%');
      const [band, pct] = [await rect(page, '#mapBand'), await rect(page, '#mapPct')];
      assert(near(band.cy, pct.cy, 1) && pct.top > band.top && pct.bottom < band.bottom, 'the mark sits in the middle of the minimap box');
      await openOptions(page, touch, 'Panels');
      assert.deepEqual((await optionRows(page, 'Panels')).slice(2, 5), ['Minimap Show/Hide', 'Minimap mark Show/Hide', 'Mark strength slider 30%'], 'Panels offers Minimap mark and Mark strength');
      await slide(page, touch, '#mapMarkOp', 'Mark strength', 1);
      assert.deepEqual([await readout(page, '#mapMarkOp'), (await mark()).opacity], ['100%', '1'], 'full strength draws the mark solid');
      await slide(page, touch, '#mapMarkOp', 'Mark strength', 0);
      assert.deepEqual([await readout(page, '#mapMarkOp'), (await mark()).opacity], ['5%', '0.05'], 'the faintest strength is 5%');
      await tap(page, touch, '.seg[data-setting="mapMark"] button[data-value="0"]', 'Minimap mark Hide');
      assert.equal((await mark()).shown, false, 'Hide takes the mark away');
      assert.deepEqual((await optionRows(page, 'Panels')).slice(3, 5), ['Minimap mark Show/Hide', 'Chapter and page Left/Right/Off'], 'with the mark hidden its strength is hidden too');
      const saved = await kit.settings(page);
      assert.deepEqual([saved.mapMark, saved.mapMarkOp], [0, 5], 'the mark and its strength are saved');
      await tap(page, touch, '.seg[data-setting="mapMark"] button[data-value="1"]', 'Minimap mark Show');
      assert.equal((await mark()).shown, true, 'Show brings the mark back');
    },
  },
  {
    id: 'listen-qw', engines: ['chromium', 'firefox', 'webkit'],
    commit: '9164fc6',
    what: 'while Listen reads, q and w step a sentence back and on, Q and W a paragraph; stopped, they do nothing',
    async run({ page, assert }) {
      await page.locator('#desk').focus();
      await press(page, ['l', 'l']);
      await press(page, ['q', 'w', 'Q', 'W']);
      assert.deepEqual([await shown(page), await spoken(page)], [[3], []], 'with Listen stopped q w Q W neither speak nor move');
      await page.keyboard.press('a');
      await hears(page, assert, 'Chapter 1. Why pages.', 'Listen starts at the chapter heading');
      const steps = [
        ['w', 'A scrolling page has no bottom you can feel, and its text never stays still long enough to become a place.', 'w steps a sentence on'],
        ['w', 'A page does.', 'w again steps another sentence on'],
        ['q', 'A scrolling page has no bottom you can feel, and its text never stays still long enough to become a place.', 'q steps a sentence back'],
        ['w', 'A page does.', 'w steps on again'],
        ['Q', 'A scrolling page has no bottom you can feel, and its text never stays still long enough to become a place.', 'Q goes back to the start of this paragraph'],
        ['W', 'Pages also give reading edges: somewhere to stop, a sense of how much is left, and a number that means the same words to everyone. paged.js brings real pages to ordinary HTML in the browser; this reader is about showing them on a screen.', 'W goes on to the next paragraph'],
        ['Q', 'A scrolling page has no bottom you can feel, and its text never stays still long enough to become a place.', 'Q at a paragraph start goes to the paragraph before'],
        ['W', 'Pages also give reading edges: somewhere to stop, a sense of how much is left, and a number that means the same words to everyone. paged.js brings real pages to ordinary HTML in the browser; this reader is about showing them on a screen.', 'W goes on again'],
        ['W', 'Chapter 2. One page, two piles.', 'W goes on into the next chapter'],
      ];
      for (const [key, text, message] of steps) { await page.keyboard.press(key); await hears(page, assert, text, message); }
      await page.keyboard.press('Escape');
      const before = (await spoken(page)).length, at = await shown(page);
      await press(page, ['q', 'w', 'Q', 'W']);
      assert.deepEqual([await shown(page), (await spoken(page)).length], [at, before], 'after Esc stops Listen, q w Q W neither speak nor move');
    },
  },
  {
    id: 'listen-stay',
    commit: '2af2a8a',
    what: 'Listen stays by default: a swipe away leaves the page there while Listen reads on; the back-to-Listen button and r bring the page back',
    async run({ page, assert, touch }) {
      await listenFromPage3(page, assert);
      assert.equal(await visible(page, '#rowBack'), false, 'the back-to-Listen button is hidden while you are with Listen');
      const d = await rect(page, '#desk');
      await touch.swipe([200, d.cy], [60, d.cy]);
      await settle(page);
      assert.deepEqual(await shown(page), [4], 'the swipe turns to page 4');
      assert.equal(await saying(page), 'Chapter 1. Why pages.', 'Listen keeps reading where it was');
      assert.equal(await visible(page, '#rowBack'), true, 'the back-to-Listen button appears');
      await page.evaluate(() => window.testSpeech.finish());
      await hears(page, assert, 'A scrolling page has no bottom you can feel, and its text never stays still long enough to become a place.', 'Listen reads on to its next sentence');
      assert.deepEqual(await shown(page), [4], 'the page stays where you went while Listen reads on');
      await tap(page, touch, '#rowBack', 'the back-to-Listen button');
      await page.waitForTimeout(300);
      assert.deepEqual(await shown(page), [3], 'the back-to-Listen button brings back the page being read');
      assert.equal(await visible(page, '#rowBack'), false, 'back with Listen, the button goes');
      await page.locator('#desk').focus();
      await page.keyboard.press('l');
      await settle(page);
      assert.deepEqual([await shown(page), await visible(page, '#rowBack')], [[4], true], 'l moves away again and the button returns');
      await page.keyboard.press('r');
      await page.waitForTimeout(300);
      assert.deepEqual([await shown(page), await visible(page, '#rowBack')], [[3], false], 'r brings back the page being read');
      assert.equal(await saying(page), 'A scrolling page has no bottom you can feel, and its text never stays still long enough to become a place.', 'coming back does not restart the sentence');
    },
  },
  {
    id: 'listen-stay-old-setting', engines: ['chromium', 'firefox', 'webkit'],
    commit: '2af2a8a',
    what: 'a saved listenStay: 0 (the old Follow) is ignored: Listen still stays, and the next save drops the key',
    settings: { listenStay: 0 },
    async run({ page, assert, kit }) {
      await listenFromPage3(page, assert);
      await page.keyboard.press('l');
      await settle(page);
      assert.deepEqual([await shown(page), await saying(page), await visible(page, '#rowBack')], [[4], 'Chapter 1. Why pages.', true], 'with the old listenStay: 0 saved, Listen still stays and offers the way back');
      await page.keyboard.press('Escape');
      await page.keyboard.press('v');
      await page.waitForTimeout(300);
      const saved = await kit.settings(page);
      assert.deepEqual(['listenStay' in saved, saved.listenMode, saved.arrange], [false, 'stay', 'pile'], 'the next saved settings have listenMode stay and no listenStay');
    },
  },
  {
    id: 'listen-follow',
    commit: '2af2a8a',
    what: 'with When you move away set to Follow, moving away takes Listen to the new page and no back button shows',
    async run({ page, assert, kit, touch }) {
      await openOptions(page, touch, 'Listen & Scroll');
      assert.deepEqual((await optionRows(page, 'Listen'))[2], 'When you move away Stay/Follow', 'Listen offers When you move away: Stay or Follow');
      await tap(page, touch, '.seg[data-setting="listenMode"] button[data-value="follow"]', 'Follow');
      assert.equal((await kit.settings(page)).listenMode, 'follow', 'Follow is saved');
      await page.keyboard.press('Escape');
      await listenFromPage3(page, assert);
      await page.keyboard.press('l');
      await settle(page);
      assert.deepEqual(await shown(page), [4], 'l turns to page 4');
      await hears(page, assert, 'Chapter 2. One page, two piles.', 'Listen follows to the first sentence of page 4');
      assert.equal(await visible(page, '#rowBack'), false, 'Follow shows no back-to-Listen button');
    },
  },
  {
    id: 'search-c6.', engines: ['chromium', 'firefox', 'webkit'],
    commit: '9164fc6',
    what: 'c6. lists chapter 6 and each of its pages; Enter on c6.2 goes to page 13',
    async run({ page, assert }) {
      assert.deepEqual(await search(page, 'c6.'), [
        'Go to chapter | 6 · Search   ·   pp. 12–13',
        'c6.1 · p12 | Page 12   ·   Search Press / or Ctrl+f. Matches are listed with a line of…',
        'c6.2 · p13 | Page 13   ·   Going back After any jump, whether a search, a topic, gg, G or a…',
      ], 'c6. offers the chapter and its pages');
      await enterResult(page, 2);
      assert.deepEqual(await shown(page), [13], 'Enter on c6.2 opens page 13');
    },
  },
  {
    id: 'search-s4', engines: ['chromium', 'firefox', 'webkit'],
    commit: '9164fc6',
    what: 's4 lists chapter 4\'s sections; Enter on 4.4 goes to page 10',
    async run({ page, assert }) {
      assert.deepEqual(await search(page, 's4'), [
        'Go to section | 4.1 · Two styles   ·   c4.1 · p. 8',
        'Go to section | 4.2 · Gliding   ·   c4.2 · p. 9',
        'Go to section | 4.3 · Reading zone   ·   c4.2 · p. 9',
        'Go to section | 4.4 · Keeping your place   ·   c4.3 · p. 10',
      ], 's4 offers the four sections of chapter 4');
      await enterResult(page, 3);
      assert.deepEqual(await shown(page), [10], 'Enter on 4.4 opens page 10');
    },
  },
  {
    id: 'search-s4.2', engines: ['chromium', 'firefox', 'webkit'],
    commit: '9164fc6',
    what: 's4.2 offers section 4.2 and Enter goes to its page',
    async run({ page, assert }) {
      assert.deepEqual(await search(page, 's4.2'), ['Go to section | 4.2 · Gliding   ·   c4.2 · p. 9'], 's4.2 offers section 4.2 alone');
      await enterResult(page, 0);
      assert.deepEqual(await shown(page), [9], 'Enter opens page 9, where Gliding starts');
    },
  },
  {
    id: 'search-4.', engines: ['chromium', 'firefox', 'webkit'],
    commit: '1f55e14',
    what: '4. lists chapter 4, its sections and its pages; Enter on c4.3 goes to page 10',
    async run({ page, assert }) {
      assert.deepEqual(await search(page, '4.'), [
        'Go to chapter | 4 · Scroll   ·   pp. 8–10',
        'Go to section | 4.1 · Two styles   ·   c4.1 · p. 8',
        'Go to section | 4.2 · Gliding   ·   c4.2 · p. 9',
        'Go to section | 4.3 · Reading zone   ·   c4.2 · p. 9',
        'Go to section | 4.4 · Keeping your place   ·   c4.3 · p. 10',
        'c4.1 · p8 | Page 8   ·   Scroll Pages are not always the best way to read. Many people…',
        'c4.2 · p9 | Page 9   ·   Pages Text Figure 4. Scroll’s two styles, switched with v: the…',
        'c4.3 · p10 | Page 10   ·   Keeping your place What Scroll gives up is the book as an…',
      ], '4. offers the chapter, then its sections, then its pages');
      await enterResult(page, 7);
      assert.deepEqual(await shown(page), [10], 'Enter on c4.3 opens page 10');
    },
  },
  {
    id: 'search-4.2', engines: ['chromium', 'firefox', 'webkit'],
    commit: '1f55e14',
    what: '4.2 offers section 4.2 and chapter 4\'s page 2; Enter goes to page 9',
    async run({ page, assert }) {
      assert.deepEqual(await search(page, '4.2'), [
        'Go to section | 4.2 · Gliding   ·   c4.2 · p. 9',
        'c4.2 · p9 | Chapter 4, page 2   ·   Scroll',
      ], '4.2 offers section 4.2, then chapter 4\'s second page');
      await enterResult(page, 1);
      assert.deepEqual(await shown(page), [9], 'Enter on c4.2 opens page 9');
    },
  },
  {
    id: 'sections-numbered',
    commit: 'adf4e05',
    what: 'each section heading is numbered from its chapter, in the pages and in plain text',
    async run({ page, assert, touch }) {
      const numbered = scope => page.evaluate(scope => [...document.querySelectorAll(`${scope} h3`)].filter(h => getComputedStyle(h, '::before').content !== 'none')
        .map(h => `${getComputedStyle(h, '::before').content.replace(/"/g, '')} ${h.textContent.trim()}`), scope);
      const expected = ['4.1 Two styles', '4.2 Gliding', '4.3 Reading zone', '4.4 Keeping your place', '6.1 What to type', '6.2 Going back',
        '9.1 The parts', '9.2 Making room', '9.3 Theme and Options', '10.1 Moving', '10.2 Panels and tools', '10.3 Listening', '10.4 Mouse and touch'];
      assert.deepEqual(await numbered('#desk'), expected, 'the pages number each section from its chapter');
      await tap(page, touch, '.seg[data-setting="mode"] button[data-value="text"]', 'Plain text');
      await page.waitForTimeout(300);
      assert.deepEqual(await numbered('#article'), expected, 'plain text numbers them the same');
    },
  },
  {
    id: 'sections-listen', engines: ['chromium', 'firefox', 'webkit'],
    commit: '9164fc6',
    what: 'Listen announces a section as "Section 4.1. Two styles."',
    async run({ page, assert }) {
      await page.locator('#desk').focus();
      await press(page, Array(7).fill('l'));
      assert.deepEqual(await shown(page), [8], 'seven page turns reach page 8, where chapter 4 starts');
      await page.keyboard.press('a');
      await hears(page, assert, 'Chapter 4. Scroll.', 'Listen starts at the chapter heading');
      await page.keyboard.press('}');
      await hears(page, assert, 'Pages are not always the best way to read.', '} goes to the first paragraph');
      await page.keyboard.press('}');
      await hears(page, assert, 'Section 4.1. Two styles.', 'the next paragraph is the section heading, announced with its number');
    },
  },
  {
    id: 'grid-spreads',
    commit: '9164fc6',
    what: 'from facing view All pages shows spreads with the cover alone on the right; arrows move a spread at a time; f switches to single pages and back',
    async run({ page, assert, touch }) {
      await tap(page, touch, '.seg[data-setting="mode"] button[data-value="facing"]', 'Facing pages');
      await page.waitForTimeout(300);
      await page.locator('#desk').focus();
      await page.keyboard.press('t');
      await page.waitForSelector('#app.grid-on');
      const cells = () => page.evaluate(() => [...document.querySelector('#gridList').children].map(c => c.classList.contains('spread')
        ? [...c.children].map(t => +t.getAttribute('aria-label').match(/^Page (\d+)/)[1]) : +c.getAttribute('aria-label').match(/^Page (\d+)/)[1]));
      const focused = () => page.evaluate(() => document.activeElement.getAttribute('aria-label'));
      assert.deepEqual(await cells(), [[1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15], [16, 17], [18, 19], [20, 21], [22]], 'All pages pairs the pages as facing view does');
      const cover = await page.evaluate(() => { const s = document.querySelector('#gridList .spread').getBoundingClientRect(), t = document.querySelector('#gridList .spread .thumb-page').getBoundingClientRect(); return { right: Math.round(s.right - t.right), left: Math.round(t.left - s.left), half: Math.round(s.width / 2) }; });
      assert(cover.right === 0 && cover.left >= cover.half - 2, `the cover sits alone on the right of its spread (${JSON.stringify(cover)})`);
      assert.equal(await focused(), 'Page 1, Cover', 'All pages opens on the cover');
      const moves = [['ArrowRight', 'Page 2, Contents'], ['ArrowRight', 'Page 4, One page, two piles'], ['l', 'Page 6, Flow'], ['ArrowLeft', 'Page 4, One page, two piles'], ['ArrowDown', 'Page 8, Scroll']];
      for (const [key, label] of moves) { await page.keyboard.press(key); assert.equal(await focused(), label, `${key} moves a spread at a time, to ${label}`); }
      await page.keyboard.press('f');
      assert.deepEqual(await cells(), Array.from({ length: 22 }, (_, i) => i + 1), 'f shows single pages');
      await page.keyboard.press('ArrowRight');
      assert.equal(await focused(), 'Page 9', 'in single pages ArrowRight moves one page');
      await page.keyboard.press('f');
      assert.equal((await cells()).length, 12, 'f again goes back to spreads');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#grid', { state: 'hidden' });
      assert.deepEqual(await shown(page), [8, 9], 'Enter opens pages 8 and 9 facing');
    },
  },
  {
    id: 'pile-tilt',
    commit: '9164fc6',
    what: 'in Pile the cover sits square and neighbouring sheets tilt within a quarter degree of each other',
    async run({ page, assert, touch }) {
      await tap(page, touch, '#arrangeSeg button[data-value="pile"]', 'Pile');
      await page.locator('#desk').focus();
      await press(page, Array(6).fill('l'));
      await page.waitForTimeout(600);
      const sheets = await page.evaluate(() => [...document.querySelectorAll('#desk .pagedjs_page')].map(p => {
        const m = new DOMMatrix(getComputedStyle(p).transform);
        return { n: +p.dataset.pageNumber, deg: Math.atan2(m.m12, m.m11) * 180 / Math.PI, seen: getComputedStyle(p).opacity === '1', current: p.classList.contains('is-current') };
      }));
      assert.deepEqual(sheets.filter(s => s.current).map(s => s.n), [7], 'six turns reach page 7');
      assert(Math.abs(sheets[0].deg) < 0.005, `the cover lies square in the pile (tilt ${sheets[0].deg.toFixed(2)}°)`);
      const piles = [sheets.slice(0, 6), sheets.slice(7).filter(s => s.seen)];
      for (const pile of piles) for (let i = 1; i < pile.length; i++) {
        const step = Math.abs(pile[i].deg - pile[i - 1].deg);
        assert(step <= 0.25, `pages ${pile[i - 1].n} and ${pile[i].n} tilt ${step.toFixed(2)}° apart, more than a quarter degree`);
      }
    },
  },
  {
    id: 'colophon', engines: ['chromium', 'firefox', 'webkit'],
    commit: '9164fc6',
    what: 'the colophon is four lines ending "Imagined by zefenix." with a link to https://zefenix.github.io/',
    async run({ page, assert }) {
      await page.locator('#desk').focus();
      await press(page, ['G']);
      assert.deepEqual(await shown(page), [await page.locator('#desk .pagedjs_page').count()], 'G opens the last page');
      const colophon = await page.evaluate(() => {
        const c = document.querySelector('#desk .is-current .colophon');
        if (!c) return null;
        const a = c.querySelector('a');
        return { lines: [...c.children].map(p => p.textContent), tops: [...c.children].map(p => p.getBoundingClientRect().top), link: a && [a.textContent, a.href] };
      });
      assert(colophon, 'the last page ends with the colophon');
      assert.deepEqual(colophon.lines, ['Set in Literata, by TypeTogether.', 'Paginated in the browser by paged.js.', 'Made with Claude and Codex.', 'Imagined by zefenix.'], 'the colophon has exactly these four lines');
      assert(colophon.tops.every((t, i) => !i || t > colophon.tops[i - 1]), 'each line sits on its own row');
      assert.deepEqual(colophon.link, ['zefenix', 'https://zefenix.github.io/'], 'zefenix links to https://zefenix.github.io/');
    },
  },
  {
    id: 'colophon-listen', engines: ['chromium', 'firefox', 'webkit'],
    commit: '9164fc6',
    what: 'Listen reads the colophon one line at a time',
    async run({ page, assert }) {
      await page.locator('#desk').focus();
      await press(page, ['G']);
      await page.keyboard.press('a');
      await page.waitForFunction(() => window.testSpeech.current);
      for (let i = 0; i < 12 && await saying(page); i++) { await page.evaluate(() => window.testSpeech.finish()); await page.waitForTimeout(120); }
      assert.deepEqual((await spoken(page)).slice(-4), ['Set in Literata, by TypeTogether.', 'Paginated in the browser by paged.js.', 'Made with Claude and Codex.', 'Imagined by zefenix.'], 'the colophon is four utterances, one per line');
      assert.equal(await page.locator('#listenBtn').getAttribute('aria-pressed'), 'false', 'Listen stops after the last line');
    },
  },
  {
    id: 'text-chapters', engines: ['chromium', 'firefox', 'webkit'],
    commit: 'adf4e05',
    what: 'the book has 12 chapters, Topics its own chapter 7, in the contents and in the pages',
    async run({ page, assert }) {
      const titles = ['1 Why pages', '2 One page, two piles', '3 Flow', '4 Scroll', '5 Thumbnails', '6 Search', '7 Topics', '8 Listening', '9 The screen', '10 Keys', '11 How it is built', '12 Open questions'];
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#desk .toc li')].map(li => `${li.querySelector('.n').textContent} ${li.querySelector('.t').textContent}`)), titles, 'the contents page lists 12 chapters with Topics as 7');
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#desk h2[data-n]')].map(h => `${h.dataset.n} ${h.textContent.trim()}`)), titles, 'the pages open the same 12 chapters');
    },
  },
  {
    id: 'text-no-absolute-page', engines: ['chromium', 'firefox', 'webkit'],
    commit: 'adf4e05',
    what: 'no "absolute page 9" anywhere in the book; the search sentence ends at chapter 4\'s second page',
    async run({ page, assert }) {
      const texts = await page.evaluate(() => ({ pages: document.querySelector('#desk').textContent, text: document.querySelector('#article').textContent, topics: document.querySelector('#tocPanel').textContent, find: document.querySelector('#desk #find-list').textContent.replace(/\s+/g, ' ') }));
      assert(texts.find.endsWith('Try / now and type flow, or c4.2 for chapter 4’s second page.'), `the search chapter ends its try-it sentence at chapter 4's second page: ${texts.find.slice(-120)}`);
      assert.deepEqual(['pages', 'text', 'topics'].filter(k => /absolute page 9/.test(texts[k])), [], 'neither the pages, the plain text nor the topics say absolute page 9');
    },
  },
  {
    id: 'text-keys', engines: ['chromium', 'firefox', 'webkit'],
    commit: 'adf4e05',
    what: 'the Keys chapter holds the one key list, with z, q w Q W, r back to Listen and f in All pages',
    async run({ page, assert }) {
      const k = await keysChapter(page);
      assert.deepEqual(k.tables, ['keys-table', 'keys-tools', 'keys-listen'], 'Keys holds three tables: moving, panels and tools, listening');
      assert.deepEqual(k.elsewhere, ['find-syntax'], 'no other chapter has a key table');
      assert.deepEqual(k.keys, ['j k', 'h l ← →', '↓ ↑, Page Down, Page Up', 'Home, End', 'd u', 'Space, Shift+Space', 'gg G', 'r', 's', 'f', 'v', 't', '- = 0', 'c', 'C', 'm', 'z', 'F', 'FF', 'e', 'O', 'a', '/ Ctrl+f', 'n N', 'Enter', 'Esc, Ctrl+[', 'q w, ( )', 'Q W, { }', '[[ ]]'], 'the key list names each key once');
      assert.equal(k.rows.r, 'Return: to Listen’s sentence if you moved away, otherwise to before your last jump; again to come back | Same', 'r returns to Listen first');
      assert.equal(k.rows.f, 'Facing pages on, off; in All pages, spreads or single pages | Open at facing pages', 'f pairs pages in All pages');
      assert.equal(k.rows.z, 'Zen: hide the menus, keep the page slider', 'z is Zen');
      assert.equal(k.rows['q w, ( )'], 'Previous, next sentence', 'q w step a sentence');
      assert.equal(k.rows['Q W, { }'], 'Previous, next paragraph; back goes first to the start of this one', 'Q W step a paragraph');
    },
  },
  {
    id: 'text-keys-complete', engines: ['chromium', 'firefox', 'webkit'],
    commit: 'adf4e05',
    what: 'the key list names every key the reader handles, among them ↑ ↓, Page Up, Page Down, Home, End and Enter',
    async run({ page, assert }) {
      const named = (await keysChapter(page)).keys.join(' ');
      assert.deepEqual(['↑', '↓', 'Page Up', 'Page Down', 'Home', 'End', 'Enter'].filter(key => !named.includes(key)), [], 'the Keys chapter names every key the reader handles');
    },
  },
  {
    id: 'text-figure6',
    commit: '83532f5',
    what: 'Figure 6 as the reader is now: numbered marks 1 to 9, the bottom row 6 to 9 on one line left to right, 48%, c3.2, 16 and / 22',
    async run({ page, assert }) {
      const at = await page.evaluate(() => +document.querySelector('#desk #fig-screen').closest('.pagedjs_page').dataset.pageNumber);
      await page.locator('#desk').focus();
      await press(page, Array(at - 1).fill('l'));
      assert.deepEqual(await shown(page), [at], `the page turns reach Figure 6 on page ${at}`);
      const fig = await page.evaluate(() => {
        const svg = document.querySelector('#desk #fig-screen svg');
        const marks = [...svg.querySelectorAll('.d-num')].map(g => { const r = g.querySelector('circle').getBoundingClientRect(); return { n: g.textContent.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        return { labels: [...svg.querySelectorAll('text')].filter(t => !t.closest('.d-num')).map(t => t.textContent), marks };
      });
      assert.deepEqual(fig.labels, ['Contents · Topics', 'Pages, Piled · The screen', 'Search · Listen', 'Minimap', '48%', 'c3.2', '48%', '16', '/ 22'], 'Figure 6 labels the bar, the minimap\'s 48% and the bottom bar\'s c3.2, 48%, 16 and / 22');
      assert.deepEqual(fig.marks.map(m => m.n), ['1', '2', '3', '4', '5', '6', '7', '8', '9'], 'Figure 6 numbers nine parts');
      const row = fig.marks.slice(5);
      assert(row.every(m => Math.abs(m.y - row[0].y) < 0.5) && row.every((m, i) => !i || m.x > row[i - 1].x), `marks 6 to 9 share the bottom row, left to right: ${JSON.stringify(row)}`);
    },
  },
  {
    id: 'options-key-note',
    commit: 'a1960dd',
    what: "on a computer, Options' key note names z for Zen, r's return to Listen, q w for sentences and Q W for paragraphs",
    profile: kit => kit.desktop(),
    async run({ page, assert }) {
      await page.locator('#optsBtn').click();
      const note = await page.locator('#options > .note').textContent();
      for (const part of ['r back to where you were, or to Listen', 'z Zen', 'q w or ( ) sentence', 'Q W or { } paragraph']) assert(note.includes(part), `the key note says "${part}": ${note}`);
    },
  },
  {
    id: 'text-listen-steps',
    commit: '83532f5',
    what: 'Listening says where the step buttons are on a phone and on a computer, and on a computer the buttons beside Listen step by sentence',
    profile: kit => kit.desktop(),
    async run({ page, assert }) {
      const text = await page.evaluate(() => document.querySelector('#book').content.querySelector('#listen-aloud').textContent.replace(/\s+/g, ' '));
      assert(text.includes('On a phone, a row of buttons under the top bar does the same; on a computer, the buttons beside Listen step by sentence.'), `Listening says where the steps are: ${text}`);
      await page.locator('#listenBtn').click();
      await hears(page, assert, 'A paged-reading prototype', 'Listen starts at the cover');
      assert.deepEqual(await page.evaluate(() => ['#listenPrev', '#listenNext'].map(s => document.querySelector(s).checkVisibility())), [true, true], 'on a computer the step buttons sit beside Listen');
      await page.locator('#listenNext').click();
      const next = await saying(page);
      await page.locator('#listenPrev').click();
      await hears(page, assert, 'A paged-reading prototype', 'the step before Listen goes back a sentence');
      assert.notEqual(next, 'A paged-reading prototype', 'the step after Listen goes on a sentence');
    },
  },
];
