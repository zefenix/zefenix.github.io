// Reader faults found after a1a0610, kept as tests: the fixed ones guard against their return, and any still marked fault fails until fixed.
const desktopAt = width => () => ({ viewport: { width, height: 900 } });
const searchChip = async page => {
  await page.locator('#searchBtn').click(); await page.locator('#q').fill('page');
  await page.waitForFunction(() => document.querySelector('#results .result'));
  await page.locator('#q').press('Enter');
};
const listen = async page => { await page.locator('#listenBtn').click(); await page.waitForFunction(() => window.testSpeech.current); };

module.exports = [
  {
    id: 'fault-row-overflow', engines: ['chromium', 'firefox', 'webkit'],
    commit: '9bd421e a8e4e6c',
    what: 'with Listen and a search chip at 320 pixels, every button in the row under the top bar ends inside the screen',
    profile: kit => kit.phone('chromium', 320),
    async run({ page, assert }) {
      await searchChip(page); await listen(page);
      const row = await page.evaluate(() => [...document.querySelectorAll('#tray button')].filter(e => e.checkVisibility()).map(e => [e.getAttribute('aria-label') || e.id, Math.round(e.getBoundingClientRect().right)]));
      assert.equal(row.length, 9, `the row shows Listen's five steps and the chip's four buttons: ${JSON.stringify(row)}`);
      assert.deepEqual(row.filter(([, right]) => right > 320), [], `every row button ends inside 320 pixels: ${JSON.stringify(row)}`);
    },
  },
  {
    id: 'fault-chip-clip', engines: ['chromium', 'firefox', 'webkit'],
    commit: '9bd421e',
    what: "on a phone the search chip's buttons fit inside the chip",
    async run({ page, assert }) {
      await searchChip(page);
      const fit = await page.evaluate(() => {
        const chip = document.querySelector('#chip').getBoundingClientRect();
        return [...document.querySelectorAll('#chip button')].map(b => { const r = b.getBoundingClientRect(); return [b.id, r.top >= chip.top && r.bottom <= chip.bottom]; });
      });
      assert(await page.locator('#tray #chip').count(), 'the search chip sits in the row under the top bar');
      assert.deepEqual(fit, [['chipQ', true], ['chipPrev', true], ['chipNext', true], ['chipClear', true]], 'every chip button fits inside the chip');
    },
  },
  {
    id: 'fault-desktop-back',
    commit: '9164fc6 2af2a8a',
    what: 'at 961 pixels, with Listen away and a search chip, the minimap button ends inside the window',
    profile: desktopAt(961),
    async run({ page, assert }) {
      await page.locator('.seg[data-setting="mode"] button[data-value="single"]').click();
      await searchChip(page); await listen(page);
      await page.locator('#pageNum').fill('5'); await page.locator('#pageNum').press('Enter');
      await page.waitForFunction(() => document.querySelector('#app').classList.contains('listen-away'), null, { timeout: 3000 }).catch(() => {});
      assert(await page.evaluate(() => document.querySelector('#app').classList.contains('listen-away')), 'turning away from Listen\'s page marks Listen away');
      const map = await kit_box(page, '#mapBtn');
      assert(map.right <= 961, `the minimap button ends at ${map.right}, inside 961`);
    },
  },
  {
    id: 'fault-text-line',
    commit: '1f55e14',
    // a regression guard: a1a0610 kept the line too
    baselineMayPass: true,
    what: 'in plain text, opening search and closing it with Enter leaves the reading line where it was',
    profile: desktopAt(1440),
    async run({ page, assert }) {
      await page.locator('.seg[data-setting="mode"] button[data-value="text"]').click();
      await page.locator('#searchBtn').click(); await page.locator('#q').fill('c4.2');
      await page.waitForFunction(() => document.querySelector('#results .jump'));
      await page.locator('#q').press('Enter');
      await page.waitForTimeout(1000);
      const line = () => page.locator('#scroller').evaluate(s => s.scrollTop + s.clientHeight / 2 - document.querySelector('#article').offsetTop);
      const before = await line();
      await page.locator('#searchBtn').click(); await page.waitForTimeout(500);
      const opened = await line();
      await page.locator('#q').press('Enter'); await page.waitForTimeout(500);
      assert.deepEqual([opened - before, await line() - before], [0, 0], 'the reading line stays put as search opens and closes');
    },
  },
  {
    id: 'fault-a4-listen-page',
    commit: '2af2a8a',
    what: 'after an A4 repagination, ]] while Listen reads turns to the page whose first sentence it reads',
    engines: ['firefox'],
    // a regression guard: a1a0610 mostly followed too
    baselineMayPass: true,
    profile: () => ({ viewport: { width: 390, height: 844 } }),
    async run({ page, assert }) {
      await page.locator('#desk').focus();
      await page.keyboard.press('l'); await page.keyboard.press('l');
      await page.locator('#desk #why-place').evaluate(el => {
        const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode(), at = text.textContent.indexOf('A page does.');
        const range = document.createRange(); range.setStart(text, at); range.setEnd(text, at + 1);
        getSelection().removeAllRanges(); getSelection().addRange(range);
      });
      await page.keyboard.press('a');
      await page.waitForFunction(() => window.testSpeech.current?.text === 'A page does.');
      await page.locator('#optsBtn').click(); await page.locator('#paperSel').selectOption('a4');
      await page.waitForSelector('#app:not(.loading)'); await page.keyboard.press('Escape');
      await page.locator('#desk').focus(); await page.keyboard.press(']'); await page.keyboard.press(']');
      await page.waitForFunction(() => window.testSpeech.current?.text === 'Chapter 2. One page, two piles.');
      await page.waitForTimeout(600);
      const where = await page.evaluate(() => ({ spoken: +[...CSS.highlights.get('speak')][1].startContainer.parentElement.closest('.pagedjs_page').dataset.pageNumber, shown: [...document.querySelectorAll('#desk .is-current')].map(p => +p.dataset.pageNumber) }));
      assert(where.shown.includes(where.spoken), `the spoken page is shown: ${JSON.stringify(where)}`);
    },
  },
];
const kit_box = (page, selector) => require('./browser_kit').box(page, selector);
