// The phone's bars, Options, Zen, the slider's sides, peeks, swipes and the minimap by touch.
const tapOn = async (page, touch, selector) => {
  const r = await page.locator(selector).first().evaluate(el => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await touch.tap(r.x, r.y);
};
const shown = (page, selector) => page.evaluate(s => !!document.querySelector(s)?.checkVisibility(), selector);
const exists = async (page, assert, selector, what) => assert.equal(await page.locator(selector).count(), 1, what);
const until = (page, fn, arg, timeout = 3000) => page.waitForFunction(fn, arg, { timeout }).catch(() => {});
const pageNum = page => page.inputValue('#pageNum');
const lastSaid = async (page, assert, count) => {
  await until(page, n => window.testSpeech.history.length >= n, count);
  const h = await page.evaluate(() => window.testSpeech.history.slice());
  assert.equal(h.length, count, `utterance ${count} was spoken, got ${JSON.stringify(h)}`);
  return h[count - 1];
};
const startListen = async (page, touch, assert) => {
  await tapOn(page, touch, '#listenBtn');
  assert.equal(await lastSaid(page, assert, 1), 'A paged-reading prototype', 'Listen starts at the cover');
};
// The kit's swipe waits on the page between moves, which a loaded machine stretches past the 100 ms the
// minimap reads a flick's speed over; this one paces the moves by the clock and does not wait for each.
async function flick(page, [x, y0], [, y1], { steps = 6, every = 16 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: y == null ? [] : [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  await send('touchStart', y0);
  const sent = [];
  for (let i = 1; i <= steps; i++) { await new Promise(r => setTimeout(r, every)); sent.push(send('touchMove', y0 + (y1 - y0) * i / steps)); }
  sent.push(send('touchEnd'));
  await Promise.all(sent);
  await cdp.detach();
}
// The reader tells the tap that ends a peek from its click by the events' own times; stamping them 40 ms apart, as
// a phone stamps a finger, keeps a busy machine from stretching that gap past the reader's 800 ms.
async function stampedTap(page, x, y) {
  const cdp = await page.context().newCDPSession(page), at = Date.now() / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }], timestamp: at });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: at + 0.04 });
  await cdp.detach();
  await page.waitForTimeout(120);
}
const visibleButtons = (page, selector) => page.evaluate(s => [...document.querySelectorAll(s)].filter(el => el.checkVisibility()).map(el => {
  const r = el.getBoundingClientRect();
  return { name: el.getAttribute('aria-label') || el.textContent.trim(), x: r.x, y: r.y, right: r.right, bottom: r.bottom, cy: r.y + r.height / 2 };
}), selector);
const optionsState = page => page.evaluate(() => {
  const p = document.querySelector('#options'), strip = document.querySelector('#optTabs');
  const secs = [...p.querySelectorAll(':scope > section')].filter(s => s.checkVisibility());
  return {
    tabs: [...strip.children].map(b => b.textContent), selected: [...strip.children].filter(b => b.getAttribute('aria-selected') === 'true').map(b => b.textContent),
    sections: secs.map(s => s.querySelector('h3').textContent), pop: p.getBoundingClientRect().toJSON(), strip: strip.getBoundingClientRect().toJSON(),
    onTop: !!document.elementFromPoint(strip.getBoundingClientRect().x + 20, strip.getBoundingClientRect().y + 20)?.closest('#optTabs'), scrollTop: p.scrollTop, viewport: innerHeight,
  };
});
const tabButton = text => `#optTabs button:text-is("${text}")`;
const panels = page => page.evaluate(() => ({
  contents: document.querySelector('#tocPanel').checkVisibility(), minimap: document.querySelector('#mapPanel').checkVisibility(),
  allPages: document.querySelector('#grid').checkVisibility(), search: document.querySelector('#searchBox').checkVisibility(), options: document.querySelector('#options').checkVisibility(),
}));
const menus = page => page.evaluate(() => ({ top: document.querySelector('#tocBtn').checkVisibility(), views: document.querySelector('.dock-ctl').checkVisibility(), tools: document.querySelector('#optsBtn').checkVisibility(), slider: document.querySelector('#ticks').checkVisibility() }));
const MENUS_SHOWN = { top: true, views: true, tools: true, slider: true }, MENUS_TUCKED = { top: false, views: false, tools: false, slider: true };
const NONE_OPEN = { contents: false, minimap: false, allPages: false, search: false, options: false };
const mapPages = page => page.evaluate(() => [...document.querySelectorAll('.map-page')].filter(el => el.checkVisibility()).map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; }));
// Waits for the minimap's column to stop gliding and says whether it did.
async function settled(page) {
  let was = (await mapPages(page))[0].y, is;
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(300); is = (await mapPages(page))[0].y; if (is === was) return true; was = is; }
  return false;
}
const iconFit = (page, selector) => page.evaluate(s => [...document.querySelectorAll(s)].filter(el => el.checkVisibility()).map(el => {
  const b = el.getBoundingClientRect(), i = el.querySelector('svg').getBoundingClientRect();
  return { id: el.id, width: i.width, height: i.height, offCentreX: +(i.x + i.width / 2 - (b.x + b.width / 2)).toFixed(3), offCentreY: +(i.y + i.height / 2 - (b.y + b.height / 2)).toFixed(3), wholeX: Number.isInteger(i.x), wholeY: Number.isInteger(i.y) };
}), selector);

module.exports = [
  {
    id: 'top-bar-groups', engines: ['chromium', 'firefox', 'webkit'],
    commit: '417e681 6ada616',
    what: 'at 390 wide the top bar is one row: the contents controls and All pages left, Search, Listen, Full screen, Theme and Minimap right',
    async run({ page, assert }) {
      const buttons = await visibleButtons(page, '#top button');
      const left = buttons.filter(b => b.x < 195).map(b => b.name), right = buttons.filter(b => b.x >= 195).map(b => b.name);
      assert.deepEqual(left, ['Show contents panel', 'Contents', 'Topics', 'All pages'], 'the left group holds the contents panel controls and All pages');
      // WebKit, like Safari on an iPhone, has no element full screen, so the reader leaves that button out
      const fullScreen = await page.evaluate(() => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled));
      assert.deepEqual(right, ['Search', 'Listen', ...(fullScreen ? ['Full screen'] : []), 'Theme is Auto. Switch to Light.', 'Minimap'], 'Search, Listen, Full screen where the browser has it, and Theme sit right, beside the Minimap toggle');
      assert.deepEqual([...new Set(buttons.map(b => Math.round(b.cy)))], [25], 'every top control sits on one row');
      assert.equal(buttons[0].x, 16, 'the left group starts at the left gutter');
      assert.equal(buttons[buttons.length - 1].right, 374, 'the right group ends at the right gutter');
      const gaps = buttons.slice(1).map((b, i) => Math.round(b.x - buttons[i].right));
      assert.equal(gaps.filter(g => g > 8).length, 1, `one wide gap splits the groups, gaps ${gaps}`);
      assert(gaps[3] > 40, `the gap falls between All pages and Search, gaps ${gaps}`);
    },
  },
  {
    id: 'options-tabs',
    commit: '417e681 26bdcb5 d1f9a22 9478c87',
    what: 'Options on a phone has tabs All, Look & Pages, Listen & Scroll, Panels at its foot; each tab shows exactly its sections',
    async run({ page, assert, touch }) {
      await tapOn(page, touch, '#optsBtn');
      await exists(page, assert, '#optTabs', 'Options has a tab strip');
      let s = await optionsState(page);
      assert.deepEqual(s.tabs, ['All', 'Look & Pages', 'Listen & Scroll', 'Panels'], 'the tabs are named after their groups');
      assert.deepEqual(s.selected, ['All'], 'All is chosen at first');
      assert.deepEqual(s.sections, ['Look', 'Pages', 'Listen', 'Scroll', 'Panels'], 'All shows every section');
      assert(Math.abs(s.strip.bottom - s.pop.bottom) <= 1.5, `the tab strip sits at the foot of Options (strip ${s.strip.bottom}, popover ${s.pop.bottom})`);
      const expected = { 'Look & Pages': ['Look', 'Pages'], 'Listen & Scroll': ['Listen', 'Scroll'], Panels: ['Panels'], All: ['Look', 'Pages', 'Listen', 'Scroll', 'Panels'] };
      for (const [tab, sections] of Object.entries(expected)) {
        await tapOn(page, touch, tabButton(tab));
        s = await optionsState(page);
        assert.deepEqual(s.selected, [tab], `tapping ${tab} chooses it`);
        assert.deepEqual(s.sections, sections, `${tab} shows exactly its sections`);
        assert(Math.abs(s.strip.bottom - s.pop.bottom) <= 1.5 && s.onTop, `${tab}: the tabs stay at the foot of Options, drawn over its sections`);
      }
    },
  },
  {
    id: 'options-tabs-stay-in-view',
    commit: 'd1f9a22',
    what: 'scrolling the long All tab by finger leaves the tab strip in view at the foot of Options',
    async run({ page, assert, touch }) {
      await tapOn(page, touch, '#optsBtn');
      await exists(page, assert, '#optTabs', 'Options has a tab strip');
      const before = await optionsState(page);
      assert.deepEqual(before.selected, ['All'], 'All is chosen');
      await touch.swipe([60, before.strip.top - 40], [60, before.pop.top + 60], { steps: 12, ms: 300 });
      await page.waitForTimeout(400);
      const after = await optionsState(page);
      assert(after.scrollTop > 150, `the finger scrolled Options (scrollTop ${after.scrollTop})`);
      assert.deepEqual([after.strip.top, after.strip.bottom], [before.strip.top, before.strip.bottom], 'the tab strip has not moved');
      assert(after.strip.top >= after.pop.top && after.strip.bottom <= after.pop.bottom && after.strip.bottom <= after.viewport, 'the tab strip lies inside Options and the viewport');
      assert(after.onTop, 'the tab strip is drawn over the scrolled sections, not under them');
    },
  },
  {
    id: 'options-tab-kept',
    commit: '9478c87',
    what: 'the tab last chosen is the one Options opens on, after closing it and after a reload',
    async run({ page, assert, touch, kit }) {
      await tapOn(page, touch, '#optsBtn');
      await exists(page, assert, '#optTabs', 'Options has a tab strip');
      await tapOn(page, touch, tabButton('Listen & Scroll'));
      await tapOn(page, touch, '#optsBtn');
      assert.equal(await shown(page, '#options'), false, 'the Options button closes Options');
      await tapOn(page, touch, '#optsBtn');
      let s = await optionsState(page);
      assert.deepEqual([s.selected, s.sections], [['Listen & Scroll'], ['Listen', 'Scroll']], 'Options reopens on Listen & Scroll');
      await page.reload();
      await kit.ready(page);
      await tapOn(page, touch, '#optsBtn');
      s = await optionsState(page);
      assert.deepEqual([s.selected, s.sections], [['Listen & Scroll'], ['Listen', 'Scroll']], 'after a reload Options still opens on Listen & Scroll');
    },
  },
  {
    id: 'listen-row',
    commit: '417e681 41ca6e5 9bd421e',
    what: 'Listen adds a row under the top bar with five steps, each acting on the speech, and Stop ends Listen',
    async run({ page, assert, touch }) {
      const stageTop = (await page.locator('#stage').boundingBox()).y;
      await startListen(page, touch, assert);
      await exists(page, assert, '#tray .tray-listen', 'the top bar has a row for Listen');
      const steps = await visibleButtons(page, '.tray-listen button');
      assert.deepEqual(steps.map(b => b.name), ['Previous paragraph', 'Previous sentence', 'Stop listening', 'Next sentence', 'Next paragraph'], 'the Listen row holds its five steps in order');
      const listenBtn = await page.locator('#listenBtn').boundingBox();
      assert.equal(new Set(steps.map(b => Math.round(b.cy))).size, 1, 'the steps sit on one row');
      assert(steps[0].y >= listenBtn.y + listenBtn.height, 'the row lies under the top bar\'s controls');
      assert((await page.locator('#stage').boundingBox()).y >= steps[0].bottom && stageTop < steps[0].bottom, 'the page area moves down to make room for the row');
      const expect = [['#rowSentNext', 'Pages,Piled'], ['#rowSentNext', 'A reader that keeps what you are reading in the middle of the screen.'], ['#rowSentPrev', 'Pages,Piled'], ['#rowParaNext', 'Chapter 1. Why pages.'], ['#rowParaPrev', 'A paged-reading prototype']];
      for (const [i, [id, text]] of expect.entries()) {
        await tapOn(page, touch, id);
        assert.equal(await lastSaid(page, assert, i + 2), text, `${id} speaks the right sentence`);
      }
      await tapOn(page, touch, '#rowStop');
      const after = await page.evaluate(() => ({ speaking: window.testSpeech.current !== null, pressed: document.querySelector('#listenBtn').getAttribute('aria-pressed'), label: document.querySelector('#listenBtn').textContent.trim(), row: document.querySelector('#tray').checkVisibility() }));
      assert.deepEqual(after, { speaking: false, pressed: 'false', label: 'Listen', row: false }, 'Stop ends Listen and the row goes');
    },
  },
  {
    id: 'listen-search-row',
    commit: '689272a a8e4e6c',
    what: 'the search chip shares the Listen row: either alone sits centred, both together split, chip left and steps right',
    async run({ page, assert, touch }) {
      await exists(page, assert, '#tray', 'the top bar has a row for Listen and search');
      await tapOn(page, touch, '#searchBtn');
      await page.keyboard.type('pile');
      await until(page, () => document.querySelector('#results li'));
      await page.keyboard.press('Enter');
      await until(page, () => document.querySelector('#chip').checkVisibility());
      const geo = () => page.evaluate(() => {
        const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return { cx: +(b.x + b.width / 2).toFixed(1), cy: Math.round(b.y + b.height / 2), x: b.x, right: b.right, shown: document.querySelector(s).checkVisibility() }; };
        return { tray: r('#tray'), chip: r('#chip'), steps: r('.tray-listen'), chipText: document.querySelector('#chipQ').textContent };
      });
      let g = await geo();
      assert.deepEqual([g.chip.shown, g.steps.shown, g.chipText], [true, false, '“pile”  19 matches'], 'the chip shows alone after a search');
      assert(await page.evaluate(() => !!document.querySelector('#tray #chip')), 'the chip sits in the row under the top bar');
      assert(Math.abs(g.chip.cx - g.tray.cx) <= 0.5, `the chip alone sits centred (chip ${g.chip.cx}, row ${g.tray.cx})`);
      await tapOn(page, touch, '#listenBtn');
      await until(page, () => window.testSpeech.history.length > 0);
      g = await geo();
      assert.deepEqual([g.chip.shown, g.steps.shown], [true, true], 'chip and steps both show');
      assert.equal(g.chip.cy, g.steps.cy, 'chip and steps share one row');
      assert(g.chip.right < g.tray.cx && g.steps.x > g.tray.cx, `the chip sits left and Listen's steps right (chip ${g.chip.x}-${g.chip.right}, steps from ${g.steps.x})`);
      await tapOn(page, touch, '#chipClear');
      await until(page, () => !document.querySelector('#chip').checkVisibility());
      g = await geo();
      assert.deepEqual([g.chip.shown, g.steps.shown], [false, true], 'clearing the highlights leaves the steps alone');
      assert(Math.abs(g.steps.cx - g.tray.cx) <= 0.5, `Listen's steps alone sit centred (steps ${g.steps.cx}, row ${g.tray.cx})`);
    },
  },
  {
    id: 'zen-z', engines: ['chromium', 'firefox', 'webkit'],
    commit: '01b28a3',
    what: 'z hides the menus and keeps the page slider; z again brings them back',
    async run({ page, assert }) {
      assert.deepEqual(await menus(page), MENUS_SHOWN);
      await page.locator('#desk').focus();
      await page.keyboard.press('z');
      assert.deepEqual(await menus(page), MENUS_TUCKED, 'z hides the top bar and the dock controls, not the slider');
      await page.keyboard.press('z');
      assert.deepEqual(await menus(page), MENUS_SHOWN, 'z again brings the menus back');
    },
  },
  {
    id: 'zen-strip',
    commit: '41ca6e5 9bd421e',
    what: 'a tap on the strip at the top of the page tucks the menus and leaves a faint handle; a tap again brings them back',
    async run({ page, assert, touch }) {
      await exists(page, assert, '#menuStrip', 'the top of the page has a strip that tucks the menus');
      const handle = () => page.evaluate(() => {
        const el = document.querySelector('#menuStrip'), a = getComputedStyle(el, '::after');
        return { label: el.getAttribute('aria-label'), pressed: el.getAttribute('aria-pressed'), handle: a.content === 'none' ? null : { width: a.width, height: a.height, opacity: a.opacity } };
      });
      assert.deepEqual(await handle(), { label: 'Hide the menus', pressed: 'false', handle: null }, 'no handle while the menus show');
      await tapOn(page, touch, '#menuStrip');
      assert.deepEqual(await menus(page), MENUS_TUCKED, 'the strip tucks the top bar and the dock controls, not the slider');
      assert.deepEqual(await handle(), { label: 'Show the menus', pressed: 'true', handle: { width: '24px', height: '3px', opacity: '0.25' } }, 'a faint handle shows where the menus went');
      await tapOn(page, touch, '#menuStrip');
      assert.deepEqual(await menus(page), MENUS_SHOWN, 'a tap again brings the menus back');
      assert.deepEqual(await handle(), { label: 'Hide the menus', pressed: 'false', handle: null }, 'and the handle goes');
    },
  },
  {
    id: 'zen-swipes',
    commit: '5bb2988 6ad2255',
    what: 'a swipe down on the bottom bar tucks, up brings back, a swipe up on the top bar tucks, a drag on the slider only scrubs',
    async run({ page, assert, touch }) {
      const views = await page.locator('.dock-ctl').boundingBox(), tools = await page.locator('.dock-tools').boundingBox();
      const gapX = (views.x + views.width + tools.x) / 2;
      await touch.swipe([gapX, views.y + 4], [gapX, views.y + 40]);
      assert.deepEqual(await menus(page), MENUS_TUCKED, 'a swipe down on the bottom bar tucks the menus');
      const dock = await page.locator('#dock').boundingBox();
      await touch.swipe([12, dock.y + dock.height / 2], [12, dock.y - 40]);
      assert.deepEqual(await menus(page), MENUS_SHOWN, 'a swipe up on the bottom bar brings them back');
      const search = await page.locator('#searchBtn').boundingBox();
      await touch.swipe([search.x - 30, 40], [search.x - 30, 4]);
      assert.deepEqual(await menus(page), MENUS_TUCKED, 'a swipe up on the top bar tucks them');
      await tapOn(page, touch, '#menuStrip');
      assert.deepEqual(await menus(page), MENUS_SHOWN, 'the strip brings them back');
      const t = await page.locator('#ticks').boundingBox();
      await touch.swipe([t.x + 0.5 * t.width, t.y + t.height / 2], [t.x + 0.5 * t.width - 20, t.y + t.height / 2 + 45]);
      assert.deepEqual(await menus(page), MENUS_SHOWN, 'a downward drag on the slider leaves the menus alone');
      assert.equal(await pageNum(page), '8', 'the drag on the slider scrubs to page 8');
    },
  },
  {
    id: 'zen-keeps-listen-row',
    commit: '01b28a3',
    what: 'in Zen the Listen row, and the search chip, stay under a hidden top bar and keep working',
    async run({ page, assert, touch }) {
      await exists(page, assert, '#tray', 'the top bar has a row for Listen');
      await startListen(page, touch, assert);
      await page.locator('#desk').focus();
      await page.keyboard.press('z');
      const row = () => page.evaluate(() => ({ topControls: document.querySelector('#tocBtn').checkVisibility(), steps: [...document.querySelectorAll('.tray-listen button')].filter(b => b.checkVisibility()).length, chip: document.querySelector('#chip').checkVisibility(), views: document.querySelector('.dock-ctl').checkVisibility() }));
      assert.deepEqual(await row(), { topControls: false, steps: 5, chip: false, views: false }, 'Zen hides the menus and keeps the Listen row');
      await tapOn(page, touch, '#rowSentNext');
      assert.equal(await lastSaid(page, assert, 2), 'Pages,Piled', 'Next sentence works in Zen');
      await tapOn(page, touch, '#rowStop');
      assert.deepEqual(await row(), { topControls: false, steps: 0, chip: false, views: false }, 'Stop in Zen takes the row away and the menus stay hidden');
      await page.keyboard.press('/');
      await page.keyboard.type('pile');
      await until(page, () => document.querySelector('#results li'));
      await page.keyboard.press('Enter');
      await until(page, () => document.querySelector('#chip').checkVisibility());
      assert.deepEqual(await row(), { topControls: false, steps: 0, chip: true, views: false }, 'a search\'s chip shows in Zen');
    },
  },
  {
    id: 'slider-sides',
    commit: '6ada616 9478c87 a45e0c1',
    what: 'left of the slider peeks at Contents or Topics, whichever was chosen last, and puts it away; right of it opens and closes All pages',
    async run({ page, assert, touch }) {
      const panelText = () => page.evaluate(() => { const p = document.querySelector('#tocPanel'); return p.checkVisibility() ? p.innerText.split('\n').slice(0, 3).join(' | ') : null; });
      await tapOn(page, touch, '#statL');
      assert.deepEqual(await panels(page), { ...NONE_OPEN, contents: true }, 'a tap left of the slider peeks at the contents panel and opens nothing else');
      assert.equal(await panelText(), 'Cover | 1 | 1', 'the peek shows Contents');
      await tapOn(page, touch, '#statL');
      assert.deepEqual(await panels(page), NONE_OPEN, 'a tap there again puts the peek away');
      await tapOn(page, touch, '#ctlToc .seg button[data-value="1"]');
      assert.equal(await panelText(), 'Cover | 1 | Pages give text a place', 'choosing Topics shows Topics');
      await tapOn(page, touch, '#statL');
      assert.equal(await panelText(), null, 'left of the slider puts it away');
      await tapOn(page, touch, '#statL');
      assert.equal(await panelText(), 'Cover | 1 | Pages give text a place', 'the next peek shows Topics, the one chosen last');
      await tapOn(page, touch, '#statL');
      await tapOn(page, touch, '#statR');
      assert.deepEqual(await panels(page), { ...NONE_OPEN, allPages: true }, 'a tap right of the slider opens All pages');
      await tapOn(page, touch, '#statR');
      await until(page, () => document.querySelector('#grid').hidden);
      assert.deepEqual(await panels(page), NONE_OPEN, 'a tap there again closes All pages');
    },
  },
  {
    id: 'edge-tap-peeks',
    commit: '1f55e14 efe5c07',
    what: 'a tap at the left or right edge of the page area peeks at the panel on that side; a tap on the page puts it away and does nothing else',
    async run({ page, assert, touch }) {
      const stage = await page.locator('#stage').boundingBox();
      await touch.tap(5, stage.y + stage.height / 2);
      assert.deepEqual(await panels(page), { ...NONE_OPEN, contents: true }, 'a tap at the left edge peeks at the contents panel');
      await touch.tap(335, stage.y + stage.height * 0.6);
      assert.deepEqual(await panels(page), NONE_OPEN, 'a tap on the page puts the peek away');
      assert.deepEqual([await pageNum(page), await menus(page)], ['1', MENUS_SHOWN], 'that tap leaves the page and the bars as they were');
      await touch.tap(stage.width - 5, stage.y + stage.height / 2);
      assert.deepEqual(await panels(page), { ...NONE_OPEN, minimap: true }, 'a tap at the right edge peeks at the minimap');
      await touch.tap(100, stage.y + stage.height * 0.6);
      assert.deepEqual(await panels(page), NONE_OPEN, 'a tap on the page puts that peek away too');
    },
  },
  {
    id: 'edge-swapped-peeks',
    commit: '1f55e14',
    settings: { swap: 1 },
    what: 'with Contents on the right, the left edge peeks at the minimap and the right edge at Contents',
    async run({ page, assert, touch }) {
      const stage = await page.locator('#stage').boundingBox();
      await touch.tap(5, stage.y + stage.height / 2);
      assert.deepEqual(await panels(page), { ...NONE_OPEN, minimap: true }, 'the left edge peeks at the minimap');
      assert((await page.locator('#mapPanel').boundingBox()).x <= 0.5, 'the minimap lies at the left edge');
      await touch.tap(195, stage.y + stage.height * 0.6);
      await touch.tap(stage.width - 5, stage.y + stage.height / 2);
      assert.deepEqual(await panels(page), { ...NONE_OPEN, contents: true }, 'the right edge peeks at Contents');
      const toc = await page.locator('#tocPanel').boundingBox();
      assert(Math.abs(toc.x + toc.width - stage.width) <= 0.5, 'Contents lies at the right edge');
    },
  },
  {
    id: 'page-tap-ends-peek',
    commit: 'efe5c07',
    what: 'with a peek showing, a tap on a link in the page only puts the peek away; the same tap without a peek follows the link',
    async run({ page, assert, touch }) {
      await tapOn(page, touch, '#next');
      assert.equal(await pageNum(page), '2', 'the contents page is showing');
      const link = await page.locator('#desk .pagedjs_page.is-current a[href="#scroll"]').boundingBox();
      const stage = await page.locator('#stage').boundingBox();
      await touch.tap(stage.width - 5, stage.y + stage.height / 2);
      assert.deepEqual(await panels(page), { ...NONE_OPEN, minimap: true }, 'a tap at the right edge peeks at the minimap');
      assert((await page.locator('#mapPanel').boundingBox()).x > link.x + 40, 'the link lies clear of the peek');
      await stampedTap(page, link.x + 30, link.y + link.height / 2);
      await page.waitForTimeout(300);
      assert.deepEqual(await panels(page), NONE_OPEN, 'the tap puts the peek away and opens nothing');
      assert.deepEqual([await pageNum(page), await menus(page)], ['2', MENUS_SHOWN], 'the page stays on 2 and the bars as they were');
      await stampedTap(page, link.x + 30, link.y + link.height / 2);
      await until(page, () => document.querySelector('#pageNum').value !== '2');
      assert.equal(await pageNum(page), '8', 'without a peek the same tap follows the link to Scroll on page 8');
    },
  },
  {
    id: 'panel-swipe-away',
    commit: '1f55e14',
    what: 'a sideways swipe toward its edge puts away a floating panel or a peek; a swipe the other way leaves it',
    async run({ page, assert, touch }) {
      await tapOn(page, touch, '#tocBtn');
      assert.deepEqual(await panels(page), { ...NONE_OPEN, contents: true }, 'the contents button floats the panel');
      await touch.swipe([100, 300], [240, 300]);
      assert.deepEqual(await panels(page), { ...NONE_OPEN, contents: true }, 'a swipe toward the middle leaves it');
      await touch.swipe([240, 300], [80, 300]);
      assert.deepEqual(await panels(page), NONE_OPEN, 'a swipe left puts the contents panel away');
      // Chrome sends no click for a tap that lands within about 120 ms of a swipe's end, so pause as a finger would
      await page.waitForTimeout(400);
      await tapOn(page, touch, '#mapBtn');
      assert.deepEqual(await panels(page), { ...NONE_OPEN, minimap: true }, 'the minimap button floats the minimap');
      await touch.swipe([280, 300], [385, 300]);
      assert.deepEqual(await panels(page), NONE_OPEN, 'a swipe right puts the minimap away');
      const stage = await page.locator('#stage').boundingBox();
      await page.waitForTimeout(400);
      await touch.tap(5, stage.y + stage.height / 2);
      assert.deepEqual(await panels(page), { ...NONE_OPEN, contents: true }, 'the left edge peeks at Contents');
      await touch.swipe([240, 300], [80, 300]);
      assert.deepEqual(await panels(page), NONE_OPEN, 'a swipe left puts the peek away');
      assert.equal(await pageNum(page), '1', 'no swipe turned the page');
    },
  },
  {
    id: 'minimap-swipe-moves-nothing',
    commit: '1f55e14',
    what: 'a sideways swipe on the minimap puts it away and does not move the book',
    async run({ page, assert, touch }) {
      await tapOn(page, touch, '#mapBtn');
      const map = await page.locator('#map').boundingBox();
      await touch.swipe([map.x + 20, map.y + 250], [map.x + map.width + 10, map.y + 252]);
      assert.equal(await pageNum(page), '1', 'the swipe left the book on page 1');
      assert.deepEqual(await panels(page), NONE_OPEN, 'the swipe put the minimap away');
    },
  },
  {
    id: 'minimap-pages',
    commit: '5bb2988',
    what: 'in the page views the minimap is a column of little pages, one per page; plain text keeps the text column',
    async run({ page, assert, touch }) {
      await tapOn(page, touch, '#mapBtn');
      const map = await page.locator('#map').boundingBox(), little = await mapPages(page);
      assert.equal(little.length, 22, 'the minimap shows 22 little pages, one per page');
      assert.equal(await page.locator('#unitTotal').textContent(), '/ 22', 'the book has 22 pages');
      assert(little.every(p => p.x === map.x && p.width === map.width), 'each little page fills the minimap\'s width, in one column');
      const gaps = little.slice(1).map((p, i) => Math.round(p.y - little[i].bottom));
      assert.deepEqual([...new Set(gaps)], [6], 'the little pages stand 6px apart, top to bottom');
      assert(Math.abs(little[0].height / little[0].width - 210 / 148) < 0.02, 'a little page has the A5 page\'s shape');
      await tapOn(page, touch, '#mapBtn');
      await tapOn(page, touch, '.dock-ctl button[data-value="text"]');
      await tapOn(page, touch, '#mapBtn');
      assert.deepEqual([(await mapPages(page)).length, await shown(page, '#mapInner')], [0, true], 'in plain text the minimap draws the text, not pages');
    },
  },
  {
    id: 'minimap-touch',
    commit: '6ad2255',
    what: 'a finger scrolls the minimap without moving the book, and a tap on a little page goes to it',
    async run({ page, assert, touch }) {
      await tapOn(page, touch, '#mapBtn');
      const map = await page.locator('#map').boundingBox(), before = await mapPages(page);
      await touch.swipe([map.x + map.width / 2, map.y + map.height - 40], [map.x + map.width / 2, map.y + map.height - 240], { steps: 20, ms: 600 });
      assert.equal(await pageNum(page), '1', 'scrolling the minimap does not move the book');
      const after = await mapPages(page);
      assert(before.length > 0, 'the minimap shows little pages');
      assert(before[0].y - after[0].y >= 199, `the column moved up with the finger (${before[0].y} to ${after[0].y})`);
      assert(await settled(page), 'the column comes to rest');
      const y = map.y + 100, under = (await mapPages(page)).findIndex(p => p.y <= y && p.bottom > y);
      assert(under >= 1, `a later page lies under the finger (${under})`);
      await touch.tap(map.x + map.width / 2, y);
      await until(page, n => document.querySelector('#pageNum').value === n, String(under + 1));
      assert.equal(await pageNum(page), String(under + 1), 'a tap goes to the little page under the finger');
    },
  },
  {
    id: 'minimap-flick',
    commit: '4395781',
    what: 'a flick on the minimap keeps the column gliding after the finger lifts, then it stops',
    async run({ page, assert, touch }) {
      await tapOn(page, touch, '#mapBtn');
      const map = await page.locator('#map').boundingBox();
      await flick(page, [map.x + map.width / 2, map.y + map.height - 40], [map.x + map.width / 2, map.y + map.height - 160]);
      assert.equal(await pageNum(page), '1', 'a flick on the minimap does not move the book');
      assert((await mapPages(page)).length > 0, 'the minimap shows little pages');
      // The reader times a flick by when its handlers run, so a starved renderer can lose one; three tries.
      const glides = [];
      for (let i = 0; i < 3 && !glides.some(g => g > 30); i++) {
        await flick(page, [map.x + map.width / 2, map.y + map.height - 40], [map.x + map.width / 2, map.y + map.height - 160]);
        const lifted = (await mapPages(page))[0].y;
        await page.waitForTimeout(500);
        glides.push(Math.round(lifted - (await mapPages(page))[0].y));
      }
      assert(glides.some(g => g > 30), `the column glides on after the flick (glided ${glides} px)`);
      assert(await settled(page), 'and comes to a stop');
      assert.equal(await pageNum(page), '1', 'the flick does not move the book');
    },
  },
  {
    id: 'peek-full-strength-in-focus',
    commit: 'a1a972b',
    what: 'in focus mode a peek shows at full strength while a panel opened on purpose fades',
    async run({ page, assert, touch }) {
      const opacity = async sel => { await page.waitForTimeout(450); return page.evaluate(s => getComputedStyle(document.querySelector(s)).opacity, sel); };
      await tapOn(page, touch, '#focusBtn');
      assert.equal(await page.getAttribute('#focusBtn', 'aria-pressed'), 'true', 'focus mode is on');
      await tapOn(page, touch, '#tocBtn');
      assert.equal(await opacity('#tocPanel'), '0.3', 'a panel opened with its button fades in focus mode');
      await tapOn(page, touch, '#tocBtn');
      await tapOn(page, touch, '#statL');
      assert.deepEqual(await panels(page), { ...NONE_OPEN, contents: true }, 'left of the slider peeks at Contents');
      assert.equal(await opacity('#tocPanel'), '1', 'the peek shows at full strength');
    },
  },
  {
    id: 'page-word-for-readers',
    commit: '4395781',
    profile: kit => kit.landscape('chromium'),
    what: 'the bottom bar draws no word Page beside the page box, and the box keeps Page as its name',
    async run({ page, assert }) {
      assert.equal(await page.getByRole('textbox', { name: 'Page', exact: true }).count(), 1, 'the page box is named Page');
      const label = await page.locator('#unitLabel').boundingBox(), box = await page.locator('#pageNum').boundingBox();
      assert(box && box.width > 20, 'the page box shows');
      assert.deepEqual([label.width, label.height], [1, 1], 'the word Page takes no room on screen');
      const drawn = await page.evaluate(() => { const el = document.querySelector('#unitLabel'), r = el.getBoundingClientRect(); return document.elementsFromPoint(r.x + 0.5, r.y + 0.5).includes(el); });
      assert.equal(drawn, false, 'what is left of the word is clipped away');
    },
  },
  {
    id: 'listen-row-icons',
    commit: '313ce28',
    what: 'the Listen row\'s icons are 12px and sit centred on whole pixels',
    async run({ page, assert, touch }) {
      await startListen(page, touch, assert);
      const fit = await iconFit(page, '.tray-listen .step');
      assert.equal(fit.length, 5, 'the Listen row shows five steps');
      for (const f of fit) assert.deepEqual(f, { id: f.id, width: 12, height: 12, offCentreX: 0, offCentreY: 0, wholeX: true, wholeY: true }, `${f.id}: a 12px icon, centred, on whole pixels`);
    },
  },
  {
    id: 'listen-back-centred',
    commit: '2af2a8a',
    what: 'when Listen is left behind its row adds a back step with its icon centred, and the step brings the page back',
    async run({ page, assert, touch }) {
      await startListen(page, touch, assert);
      await exists(page, assert, '#rowBack', 'the Listen row has a back step');
      assert.equal(await shown(page, '#rowBack'), false, 'no back step while the page follows Listen');
      for (let i = 0; i < 3; i++) await tapOn(page, touch, '#next');
      await until(page, () => document.querySelector('#rowBack').checkVisibility());
      assert.equal(await pageNum(page), '4', 'the reader turned to page 4');
      assert.equal(await shown(page, '#rowBack'), true, 'moving away from Listen shows the back step');
      const [fit] = await iconFit(page, '#rowBack');
      assert.deepEqual(fit, { id: 'rowBack', width: 12, height: 12, offCentreX: 0, offCentreY: 0, wholeX: true, wholeY: true }, 'the back step\'s icon is centred, on whole pixels');
      await tapOn(page, touch, '#rowBack');
      await until(page, () => document.querySelector('#pageNum').value === '1');
      assert.deepEqual([await pageNum(page), await shown(page, '#rowBack')], ['1', false], 'the back step returns to Listen\'s page and goes');
    },
  },
  {
    id: 'dock-icons',
    commit: 'efe5c07',
    what: 'Expand, Focus and Options draw 16px icons centred on whole pixels',
    async run({ page, assert }) {
      const fit = await iconFit(page, '#expandBtn, #focusBtn, #optsBtn');
      assert.deepEqual(fit.map(f => f.id), ['expandBtn', 'focusBtn', 'optsBtn'], 'the dock shows Expand, Focus and Options');
      for (const f of fit) assert.deepEqual(f, { id: f.id, width: 16, height: 16, offCentreX: 0, offCentreY: 0, wholeX: true, wholeY: true }, `${f.id}: a 16px icon, centred, on whole pixels`);
    },
  },
  {
    id: 'listen-row-step-size',
    commit: '9bd421e 313ce28',
    what: 'the Listen row\'s steps are 28px boxes, as the owner approved them in the studio and as the row\'s rule now says',
    async run({ page, assert, touch }) {
      await startListen(page, touch, assert);
      const sizes = await page.evaluate(() => [...document.querySelectorAll('.tray-listen .step')].filter(e => e.checkVisibility()).map(e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
      assert.deepEqual(sizes, Array(5).fill([28, 28]), 'each Listen step is a 28px box');
    },
  },
  {
    id: 'grid-spreads-end', engines: ['chromium', 'firefox', 'webkit'],
    commit: '9164fc6',
    what: 'in All pages opened from facing pages, End goes to the last page and Home to the first',
    settings: { facing: 1 },
    async run({ page, assert }) {
      await page.locator('#desk').focus();
      await page.keyboard.press('t');
      await page.waitForSelector('#app.grid-on');
      assert(await page.locator('#gridList.spreads, .grid.spreads').count(), 'All pages shows spreads');
      const at = () => page.evaluate(() => { const t = [...document.querySelectorAll('#gridList .thumb')]; return [t.indexOf(document.activeElement), t.length]; });
      await page.keyboard.press('End');
      const [last, n] = await at();
      assert.equal(last, n - 1, `End goes to the last of ${n} pages`);
      await page.keyboard.press('Home');
      assert.equal((await at())[0], 0, 'Home goes to the first page');
    },
  },
  {
    id: 'peek-focus-holds',
    commit: '6ada616 a8e4e6c',
    what: 'a peek stays while focus is inside it, and the wait starts again when focus leaves',
    settings: { toc: 0 },
    profile: () => ({ viewport: { width: 1280, height: 800 } }),
    async run({ page, assert }) {
      await page.locator('#statL').click();
      await until(page, () => document.querySelector('#tocPanel.peeking'));
      assert(await page.evaluate(() => !!document.querySelector('#tocPanel.peeking')), 'a click left of the slider peeks the contents panel');
      await page.locator('#tocList a, #tocList button').first().focus();
      await page.mouse.move(640, 400);
      await page.waitForTimeout(8600);
      assert.equal((await panels(page)).contents, true, 'focused, the peek is still there after its 8 second wait');
      await page.locator('#desk').focus();
      await page.waitForTimeout(8600);
      assert.equal((await panels(page)).contents, false, 'with focus gone, the peek goes after its wait');
    },
  },
];
