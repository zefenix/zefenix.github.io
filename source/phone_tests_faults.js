// Reader faults found after a1a0610, kept as tests: the fixed ones guard against their return, and any still marked fault fails until fixed.
// The released build, e8eef4e, already has this round's phone features, so a test it passes guards against their loss.
const RELEASED = 'e8eef4e already has it';
const desktopAt = width => () => ({ viewport: { width, height: 900 } });
// By key and by the clock, not by click or by frame: idle headless WebKit draws no frames, so a click's wait for a
// steady button, or a wait polled each frame, never ends.
const searchChip = async page => {
  await page.locator('#desk').focus(); await page.keyboard.press('/'); await page.locator('#q').fill('page', { timeout: 40000 });   // a loaded Firefox took over 15 s to open the box
  await page.waitForFunction(() => document.querySelector('#results .result'), null, { polling: 100 });
  await page.keyboard.press('Enter');
};
const listen = async page => { await page.locator('#desk').focus(); await page.keyboard.press('a'); await page.waitForFunction(() => window.testSpeech.current, null, { polling: 100 }); };

module.exports = [
  {
    id: 'fault-cover-subtitle',
    commit: '13ff52d',
    fault: "Listen says the cover's subtitle with a doubled full stop, 'screen..', as it adds a stop to each cover line",
    what: "Listen reads the cover's title and subtitle, each ending in one full stop, then chapter 1's heading",
    async run({ page, assert }) {
      await listen(page);
      for (let n = 1; n < 3; n++) {
        await page.evaluate(() => window.testSpeech.finish());
        await page.waitForFunction(n => window.testSpeech.history.length > n, n, { timeout: 3000 }).catch(() => {});
      }
      assert.deepEqual(await page.evaluate(() => window.testSpeech.history.slice()), ['Pages, Piled.', 'A reader that keeps what you are reading in the middle of the screen.', 'Chapter 1. Why pages.'], 'the cover is read as two lines, then chapter 1 begins');
    },
  },
  {
    id: 'fault-listen-item-selection', engines: ['chromium', 'firefox', 'webkit'],
    fault: "a selection in a list item's second sentence starts Listen at the item's first sentence; e8eef4e started at the selected one",
    what: 'Listen starts at the selected sentence inside a list item, as it does inside a paragraph',
    profile: desktopAt(1440),
    async run({ page, assert }) {
      const from = async (selector, phrase) => {
        const target = page.locator(`#desk ${selector}`).first();
        const number = await target.evaluate(el => el.closest('.pagedjs_page').dataset.pageNumber);
        await page.locator('#pageNum').fill(number); await page.locator('#pageNum').press('Enter');
        await page.waitForFunction(n => document.querySelector(`#desk .pagedjs_page[data-page-number="${n}"]`).classList.contains('is-current'), number);
        await page.locator('#desk').focus();
        await target.evaluate((el, phrase) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let text;
          while ((text = walker.nextNode()) && !text.textContent.includes(phrase));
          const range = document.createRange(), at = text.textContent.indexOf(phrase);
          range.setStart(text, at); range.setEnd(text, at + 1);
          getSelection().removeAllRanges(); getSelection().addRange(range);
        }, phrase);
        await page.keyboard.press('a');
        await page.waitForFunction(() => window.testSpeech.current);
        const said = await page.evaluate(() => window.testSpeech.current.text);
        await page.keyboard.press('Escape');
        return said;
      };
      assert.deepEqual([await from('#why-place', 'A page does.'), await from('#screen-parts > li', 'Each panel’s button')],
        ['A page does.', 'Each panel’s button sits above its panel.'], 'Listen starts at the selected sentence, in a paragraph and in a list item');
    },
  },
  {
    id: 'fault-options-narrow', engines: ['chromium', 'firefox', 'webkit'],
    fault: 'at 320 to 350 pixels the Highlighter and Zen exit rows are 325 pixels wide, wider than Options, so Options scrolls sideways',
    what: 'at 320 pixels every row of Options fits inside it, so Options never scrolls sideways',
    profile: (kit, engine) => kit.phone(engine, 320),
    async run({ page, assert }) {
      await page.locator('#desk').focus(); await page.keyboard.press('O');
      await page.waitForSelector('#options', { state: 'visible' });
      await page.getByRole('tab', { name: 'All', exact: true }).dispatchEvent('click');
      const fit = await page.evaluate(() => {
        const o = document.querySelector('#options'), right = o.getBoundingClientRect().left + o.clientWidth;
        return { wide: [...o.querySelectorAll('.seg')].filter(e => e.checkVisibility() && e.getBoundingClientRect().right > right + 0.5).map(e => e.dataset.setting), sideways: o.scrollWidth - o.clientWidth };
      });
      assert.deepEqual(fit, { wide: [], sideways: 0 }, `every Options row ends inside Options: ${JSON.stringify(fit)}`);
    },
  },
  {
    id: 'fault-dock-overflow',
    fault: 'at 381 pixels the bottom bar is 1 pixel wider than the screen and does not fold, since fitDock folds it only past 1 pixel',
    what: 'at 381 pixels the bottom bar fits the screen, or folds',
    profile: (kit, engine) => kit.phone(engine, 381),
    async run({ page, assert }) {
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => { const d = document.querySelector('#dock'); return d.scrollWidth - d.clientWidth; });
      assert.equal(overflow, 0, `the bottom bar overflows by ${overflow} px`);
    },
  },
  {
    id: 'fault-row-overflow', engines: ['chromium', 'firefox', 'webkit'],
    baselineMayPass: RELEASED,
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
    baselineMayPass: RELEASED,
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
    baselineMayPass: RELEASED,
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
      await page.waitForSelector('#app:not(.loading)', { timeout: 120000 }); await page.keyboard.press('Escape');   // repaginating takes as long as the first setting
      await page.locator('#desk').focus(); await page.keyboard.press(']'); await page.keyboard.press(']');
      await page.waitForFunction(() => window.testSpeech.current?.text === 'Chapter 2. One page, two piles.');
      await page.waitForTimeout(600);
      const where = await page.evaluate(() => ({ spoken: +[...CSS.highlights.get('speak')][1].startContainer.parentElement.closest('.pagedjs_page').dataset.pageNumber, shown: [...document.querySelectorAll('#desk .is-current')].map(p => +p.dataset.pageNumber) }));
      assert(where.shown.includes(where.spoken), `the spoken page is shown: ${JSON.stringify(where)}`);
    },
  },
];
const kit_box = (page, selector) => require('./browser_kit').box(page, selector);
