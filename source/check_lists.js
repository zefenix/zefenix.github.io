#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const load = process.env.PLAYWRIGHT_CORE
  ? createRequire(path.resolve(process.env.PLAYWRIGHT_CORE, 'index.js')) : require;
const playwright = load(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
if (!target) throw new Error('Usage: node source/check_lists.js SITE_DIRECTORY_OR_URL [--lists-only] [--addenda-only] [--names-only] [--tools-only] [--listen-only] [--header-only] [--desktop-only] [--baseline=SITE_DIRECTORY] [--browsers=firefox,chromium] [--evidence=DIRECTORY] [--strict]');
const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const evidence = option('evidence', '.evidence/lists');
fs.mkdirSync(evidence, { recursive: true });
const url = /^https?:/.test(target) ? new URL(target).href
  : pathToFileURL(path.join(path.resolve(target), 'index.html')).href;
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); console.error(`FAIL ${message}`); } };
// Reader faults this check finds and the reader has not fixed yet print as known faults and fail only with --strict, so
// the rest of the run still checks the reader; each also has a test in source/phone_tests_faults.js. None is open now.
const KNOWN = {
};
const knownSeen = new Map();
const known = (ok, id, message) => {
  if (ok) return;
  if (args.includes('--strict')) return check(false, `${KNOWN[id]}: ${message}`);
  knownSeen.set(id, (knownSeen.get(id) || 0) + 1);
  console.log(`KNOWN FAULT ${id} ${message}`);
};

async function marker(page, item, reference) {
  const clip = await page.evaluate(({ item, reference }) => {
    const li = document.querySelectorAll('#markerProbe ol')[item.list].children[item.index];
    const rect = li.getBoundingClientRect(), style = getComputedStyle(li), marker = getComputedStyle(li, '::marker');
    let x = rect.x, y = rect.y;
    if (reference !== null) {
      document.querySelector('#markerReference')?.remove();
      const ol = document.createElement('ol');
      const wrapper = document.createElement('div');
      wrapper.id = 'markerReference';
      wrapper.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:var(--paper);';
      ol.start = reference;
      ol.style.cssText = `position:fixed;left:${x}px;top:${y}px;margin:0;padding:0;width:300px;z-index:2147483647;background:var(--paper);`;
      for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-numeric', 'font-feature-settings', 'font-variation-settings', 'line-height', 'letter-spacing', 'list-style-type', 'list-style-position', 'color']) ol.style.setProperty(property, style.getPropertyValue(property));
      const ref = document.createElement('li');
      ref.textContent = 'Reference';
      ref.style.cssText = `margin:0;padding-left:${style.paddingLeft};`;
      ol.append(ref);
      const css = document.createElement('style');
      css.textContent = `#markerReference li::marker { color: ${marker.color}; font: ${marker.font}; }`;
      ol.append(css);
      wrapper.append(ol);
      document.body.append(wrapper);
      const rr = ref.getBoundingClientRect();
      x = rr.x; y = rr.y;
    }
    return { x: Math.floor(x) - 42, y: Math.floor(y), width: 41, height: Math.ceil(parseFloat(style.lineHeight)) };
  }, { item, reference });
  const png = await page.screenshot({ clip });
  await page.evaluate(() => document.querySelector('#markerReference')?.remove());
  return page.evaluate(async data => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
    const ink = [];
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const contrast = Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]);
      if (contrast > 100) ink.push([x, y]);
    }
    if (!ink.length) return '';
    const left = Math.min(...ink.map(p => p[0])), top = Math.min(...ink.map(p => p[1]));
    return ink.map(([x, y]) => `${x - left},${y - top}`).join(';');
  }, png.toString('base64'));
}

async function readLists(page, browserName) {
  const lists = await page.evaluate(() => {
    const originals = [...document.querySelector('#book').content.querySelectorAll('ol')];
    const rendered = [...document.querySelectorAll('#desk ol')];
    const refs = [...new Set(rendered.map(o => o.dataset.ref))];
    return originals.map((o, i) => ({ name: o.id || o.className || `ol-${i + 1}`, start: o.start,
      count: o.children.length, ref: refs[i], numbered: getComputedStyle(rendered.find(r => r.dataset.ref === refs[i])).listStyleType !== 'none' }));
  });
  console.log(`${browserName} book reversed ordered lists ${await page.locator('#book').evaluate(book => book.content.querySelectorAll('ol[reversed]').length)}`);
  assert(await page.locator('#desk ol[data-split-from]').count(), 'Book must contain a split ordered list');
  for (const list of lists) {
    const fragments = await page.locator(`#desk ol[data-ref="${list.ref}"]`).evaluateAll(nodes => nodes.map(o => ({ page: +o.closest('.pagedjs_page').dataset.pageNumber, count: o.children.length, refs: [...o.children].map(li => li.dataset.ref) })));
    if (!list.numbered) { console.log(`${browserName} ${list.name} pages ${fragments.map(f => f.page).join(',')} unnumbered`); continue; }
    let expected = list.start;
    const ordinals = new Map();
    for (const fragment of fragments) {
      await page.evaluate(number => {
        document.querySelector('#markerProbe')?.remove();
        const probe = document.createElement('div'); probe.id = 'markerProbe';
        probe.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:var(--paper);overflow:hidden;';
        const clone = document.querySelector(`#desk .pagedjs_page[data-page-number="${number}"]`).cloneNode(true);
        clone.style.cssText = 'position:relative!important;left:0;top:0;margin:0!important;transform:none!important;zoom:1!important;opacity:1!important;';
        probe.append(clone); document.body.append(probe);
      }, fragment.page);
      const listIndex = await page.evaluate(ref => [...document.querySelectorAll('#markerProbe ol')].findIndex(o => o.dataset.ref === ref), list.ref);
      const numbers = [];
      for (let i = 0; i < fragment.count; i++) {
        const ref = fragment.refs[i];
        if (!ordinals.has(ref)) ordinals.set(ref, expected++);
        const want = ordinals.get(ref);
        const item = { list: listIndex, index: i };
        const actual = await marker(page, item, null);
        const matches = [];
        for (let number = Math.min(1, list.start); number <= Math.max(9, list.start + list.count - 1); number++) {
          if (actual && actual === await marker(page, item, number)) matches.push(number);
        }
        check(matches.length === 1, `${browserName} ${list.name} page ${fragment.page} item ${i + 1} has ${matches.length} pixel matches`);
        numbers.push(matches.length === 1 ? matches[0] : '?');
        check(matches[0] === want, `${browserName} ${list.name} page ${fragment.page} item ${i + 1} marker ${matches[0]} expected ${want}`);
      }
      console.log(`${browserName} ${list.name} page ${fragment.page} markers ${numbers.join(',')}`);
    }
    assert.equal(ordinals.size, list.count, 'Every source list item is checked, including split continuations');
    await page.evaluate(() => document.querySelector('#markerProbe')?.remove());
  }
}

async function calibration(page, browserName) {
  await page.evaluate(async () => {
    const host = document.createElement('div'); host.id = 'calibration'; document.body.append(host);
    const fragment = document.createDocumentFragment(), article = document.createElement('article');
    article.className = 'bk';
    article.innerHTML = '<ol id="screen-parts" start="3"><li>First control item.</li><li>Second control item.</li><li>Third control item.</li></ol>';
    fragment.append(article);
    const previewer = new Paged.Previewer();
    await previewer.preview(fragment, [{ [location.href]: document.querySelector('#book-css').textContent }], host);
    window.markerCalibration = previewer;
    const probe = document.createElement('div'); probe.id = 'markerProbe';
    probe.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:var(--paper);overflow:hidden;';
    probe.append(host.querySelector('.pagedjs_page'));
    document.body.append(probe);
  });
  assert.equal(await page.locator('#markerProbe ol[data-split-from]').count(), 0, 'Calibration list is unsplit by Paged.js');
  const numbers = [];
  for (let index = 0; index < 3; index++) {
    const item = { list: 0, index };
    const actual = await marker(page, item, null), reference = await marker(page, item, index + 3);
    assert(actual, 'Calibration marker has ink');
    assert.equal(actual, reference, `${browserName} unsplit calibration marker ${index + 3} matches reference pixels exactly`);
    numbers.push(index + 3);
  }
  const font = await page.locator('#markerProbe li').first().evaluate(li => ({ size: getComputedStyle(li).fontSize, color: getComputedStyle(li, '::marker').color }));
  console.log(`${browserName} unsplit Paged.js calibration markers ${numbers.join(',')} exact pixel match, font ${font.size}, color ${font.color}`);
  await page.evaluate(() => { document.querySelector('#markerProbe').remove(); document.querySelector('#calibration').remove(); window.markerCalibration.polisher.destroy(); delete window.markerCalibration; });
}

async function controls(page, browserName, width, touch) {
  const button = page.locator('#thumbsBtn');
  await button.waitFor();
  assert(await button.isEnabled(), 'Thumbnails enabled after pagination');
  assert.equal(await button.getAttribute('title'), 'All pages (t)');
  assert.equal(await button.getAttribute('aria-label'), 'All pages');
  const state = async open => {
    assert.equal(await button.getAttribute('aria-pressed'), String(open));
    await page.waitForFunction(open => document.querySelector('#app').classList.contains('grid-on') === open, open);
    await page.waitForFunction(open => { const grid = document.querySelector('#grid'); return open ? !grid.hidden && getComputedStyle(grid).opacity === '1' : grid.hidden; }, open);
    assert.equal(await page.locator('#grid').isVisible(), open);
  };
  const tap = () => touch ? button.tap() : button.click();
  await state(false);
  for (const action of [tap, () => button.press('Enter'), () => button.press('Space')]) {
    await action(); await state(true); await action(); await state(false);
    await action(); await state(true); await page.keyboard.press('Escape'); await state(false);
  }
  await page.locator('#desk').focus(); await page.keyboard.press('t'); await state(true);
  await page.keyboard.press('t'); await state(false);
  await tap(); await state(true); await page.locator('#grid .thumb').first().click(); await state(false);
  await tap(); await state(true); await page.locator('#grid').click({ position: { x: 2, y: 2 } }); await state(false);
  if (await page.locator('#zoomStrip').isVisible()) { await page.locator('#zoomStrip').click(); await state(true); await page.keyboard.press('Escape'); await state(false); }
  const layout = await button.evaluate(b => {
    const r = b.getBoundingClientRect();
    return { inBar: r.left >= 0 && r.right <= innerWidth && r.top >= 0, next: document.querySelector('#ctlToc .seg').nextElementSibling === b && b.previousElementSibling.getBoundingClientRect().right <= r.left && document.querySelector('#tocBtn').getBoundingClientRect().right <= b.previousElementSibling.getBoundingClientRect().left,
      overlaps: [...document.querySelectorAll('#top button')].some(o => { if (o === b || !o.checkVisibility()) return false; const q = o.getBoundingClientRect(); return Math.min(r.right, q.right) > Math.max(r.left, q.left) && Math.min(r.bottom, q.bottom) > Math.max(r.top, q.top); }) };
  });
  assert(layout.inBar && layout.next && !layout.overlaps, `Thumbnails layout ${JSON.stringify(layout)}`);
  const stem = `${browserName}-${width}${touch ? '-touch' : ''}`;
  await page.screenshot({ path: path.join(evidence, `${stem}-top.png`) });
  await tap(); await state(true);
  await page.screenshot({ path: path.join(evidence, `${stem}-grid.png`) });
  for (const number of [14, 15]) {
    await page.getByRole('button', { name: new RegExp(`^Page ${number}(,|$)`) }).click(); await state(false);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(evidence, `${stem}-page-${number}.png`) });
    if (number === 14) { await tap(); await state(true); }
  }
  console.log(`${stem} button click/tap, Enter, Space, t, Esc, page pick, empty space, zoom strip, layout PASS`);
  if (width === 1440 && !touch) {
    for (const mode of ['single', 'facing', 'pages', 'text']) {
      await page.locator(`.seg[data-setting="mode"] button[data-value="${mode}"]`).click(); await state(false);
      assert(await button.isEnabled(), `Thumbnails enabled in ${mode}`);
      await tap(); await state(true); await page.keyboard.press('Escape'); await state(false);
    }
    await page.locator('.seg[data-setting="mode"] button[data-value="single"]').click();
    await page.locator('#optsBtn').click();
    await page.locator('.seg[data-setting="swap"] button[data-value="1"]').click();
    assert(await button.evaluate(b => b.parentElement.parentElement.id === 'topR' && b.previousElementSibling.matches('.seg') && b.previousElementSibling.getBoundingClientRect().right <= b.getBoundingClientRect().left), 'Thumbnails follows Contents/Topics to the right');
    await page.locator('.seg[data-setting="swap"] button[data-value="0"]').click();
    assert(await button.evaluate(b => b.parentElement.parentElement.id === 'topL' && b.previousElementSibling.matches('.seg') && b.previousElementSibling.getBoundingClientRect().right <= b.getBoundingClientRect().left), 'Thumbnails follows Contents/Topics to the left');
    await page.locator('#paperSel').selectOption('pocket');
    await page.waitForSelector('#app.loading');
    assert(await button.isDisabled(), 'Thumbnails disabled during repagination'); await state(false);
    await page.waitForSelector('#app:not(.loading)');
    assert(await button.isEnabled(), 'Thumbnails enabled after repagination');
    await page.locator('#paperSel').selectOption('a5');
    await page.waitForSelector('#app:not(.loading)');
    assert(await button.isEnabled(), 'Thumbnails enabled after restoring page size');
    await page.keyboard.press('Escape');
    console.log(`${browserName} all four views, swapped panels, loading-disabled, restored-enabled PASS`);
  }
}

async function headerSweep(host, browserName) {
  const widths = [320, 340, 360, 375, 380, 381, 390, 414, 420, 421, 430, 520, 521, 600, 601, 860, 960, 961, 1024, 1440];
  const samples = [];
  for (const state of [{ name: 'default' }, { name: 'reading', reading: true }, { name: 'chip', chip: true }, { name: 'combined', chip: true, reading: true }, { name: 'swapped', chip: true, reading: true, swap: true }, { name: 'no-fullscreen', chip: true, reading: true, swap: true, fullscreen: false }]) {
    const context = await host.context().browser().newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' });
    try {
      if (state.fullscreen === false) await context.addInitScript(() => {
        Object.defineProperty(document, 'fullscreenEnabled', { get: () => false });
        Object.defineProperty(document, 'webkitFullscreenEnabled', { get: () => false });
      });
      const page = await bookPage(context);
      if (state.fullscreen === false) assert.equal(await page.locator('#fsBtn').isVisible(), false, 'Unsupported fullscreen is absent');
      if (state.chip) {
        await page.locator('#searchBtn').click(); await page.locator('#q').fill('page'); await page.locator('#q').press('Enter');
        assert(await page.locator('#chip').isVisible(), 'Retained search chip is visible');
        assert.equal(await page.locator('#chip button:visible').count(), 4, 'All retained-search controls remain available');
      }
      if (state.reading) { await page.locator('#listenBtn').click(); await page.waitForFunction(() => window.testSpeech.current); }
      if (state.swap) {
        await page.locator('#optsBtn').click(); await page.locator('.seg[data-setting="swap"] button[data-value="1"]').click(); await page.keyboard.press('Escape');
      }
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(100);
        const controls = await page.evaluate(() => {
          const top = document.querySelector('#top'), thumbs = document.querySelector('#thumbsBtn'), segment = thumbs.previousElementSibling;
          const fs = document.querySelector('#fsBtn'), theme = document.querySelector('#themeBtn');
          const tr = thumbs.getBoundingClientRect(), fr = fs.getBoundingClientRect(), rr = theme.getBoundingClientRect();
          if (!segment.matches('.seg') || segment.getBoundingClientRect().right > tr.left) throw new Error(`${innerWidth} All pages order`);
          if (!theme.checkVisibility() || fs.nextElementSibling !== theme || (fs.checkVisibility() && (rr.left < fr.right || Math.abs(rr.top - fr.top) >= 1))) throw new Error(`${innerWidth} Theme must follow Full screen`);
          const controls = [...top.querySelectorAll('button')].filter(e => e.checkVisibility()).map((e, i) => {
            e.dataset.centerProbe = String(i);
            const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button');
            return { id: e.id || e.getAttribute('aria-label'), probe: i, x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, ownCenter: hit === e, least: e.closest('#tray #chip') ? 24 : 28, inRow: !!e.closest('#tray') };
          });
          for (const r of controls) if ((!r.ownCenter && r.right <= innerWidth) || r.width < r.least || r.height < r.least || r.x < 0 || r.y < 0 || r.bottom > top.offsetHeight) throw new Error(`${innerWidth} bad top control ${JSON.stringify(r)}`);
          const overlaps = controls.flatMap((r, i) => controls.slice(i + 1).filter(q => Math.min(r.right, q.right) - Math.max(r.x, q.x) > .5 && Math.min(r.bottom, q.bottom) - Math.max(r.y, q.y) > .5).map(q => [r.id, q.id]));
          if (overlaps.length) throw new Error(`${innerWidth} top overlaps ${JSON.stringify(overlaps)}`);
          return { controls, overflow: top.scrollWidth - top.clientWidth };
        }).then(({ controls, overflow }) => {
          const flag = check;
          for (const c of controls.filter(c => c.right > width)) flag(false, `${state.name} ${width} ${c.id} ends at ${c.right}`);
          flag(overflow <= 0, `${state.name} ${width} top bar overflows by ${overflow}`);
          return controls.filter(c => c.right <= width);
        });
        if ([320, 360, 390].includes(width)) {
          for (const control of controls) {
            await page.evaluate(() => {
              window.testCenterHit = null;
              document.addEventListener('click', event => {
                window.testCenterHit = event.target.closest('button')?.dataset.centerProbe;
                event.preventDefault(); event.stopImmediatePropagation();
              }, { capture: true, once: true });
            });
            await page.mouse.click(control.x + control.width / 2, control.y + control.height / 2);
            assert.equal(await page.evaluate(() => window.testCenterHit), String(control.probe), `${state.name} ${width} native centre click reaches ${control.id}`);
          }
        }
        const center = controls.find(c => c.id === 'thumbsBtn');
        await page.mouse.click(center.x + center.width / 2, center.y + center.height / 2);
        assert.equal(await page.locator('#thumbsBtn').getAttribute('aria-pressed'), 'true', `${state.name} ${width} centre click opens All pages`);
        await page.waitForSelector('#app.grid-on');
        await page.locator('#thumbsBtn').click();
        assert.equal(await page.locator('#thumbsBtn').getAttribute('aria-pressed'), 'false');
        if ([320, 360, 390, 1440].includes(width)) await page.locator('#top').screenshot({ path: path.join(evidence, `${browserName}-${width}-header-${state.name}.png`) });
        samples.push({ state: state.name, width, controls });
      }
      console.log(`${browserName} header ${state.name} sampled widths ${widths.join(',')}, centre hits, native centre clicks, 28px (24px wide in the phone row's search chip), overlap, viewport and order PASS`);
    } finally { await context.close(); }
  }
  fs.writeFileSync(path.join(evidence, `${browserName}-header-sweep.json`), JSON.stringify(samples, null, 2));
}

async function desktopHeader(host, browserName) {
  const baseline = option('baseline', '');
  const heights = new Map(), samples = [];
  const sites = baseline ? [{ name: 'baseline', address: pathToFileURL(path.join(path.resolve(baseline), 'index.html')).href }, { name: 'candidate', address: url }] : [{ name: 'candidate', address: url }];
  for (const site of sites) for (const combined of [false, true]) {
    const context = await host.context().browser().newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' });
    try {
      const page = await bookPage(context, site.address);
      await page.locator('.seg[data-setting="mode"] button[data-value="single"]').click();
      if (combined) {
        await page.locator('#searchBtn').click(); await page.locator('#q').fill('page');
        await page.waitForFunction(() => document.querySelector('#results .result'));
        await page.locator('#q').press('Enter');
        await page.locator('#listenBtn').click(); await page.waitForFunction(() => window.testSpeech.current);
      }
      const longest = await page.locator('.toc-item .t').evaluateAll(nodes => nodes.map(n => n.textContent).sort((a, b) => b.length - a.length)[0]);
      const total = await page.locator('#desk .pagedjs_page').count();
      for (const width of [961, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        let screenshot = false;
        for (let number = 1; number <= total; number++) {
          if (combined) {
            await page.locator('#listenBtn').click();
            assert.equal(await page.locator('#listenBtn').getAttribute('aria-pressed'), 'false');
            await page.locator('#listenBtn').click();
            await page.waitForFunction(() => window.testSpeech.current);
          }
          await page.locator('#pageNum').fill(String(number)); await page.locator('#pageNum').press('Enter');
          await page.waitForFunction(number => document.querySelector('#pageNum').value === String(number) && document.querySelector(`#desk .pagedjs_page[data-page-number="${number}"]`).classList.contains('is-current'), number).catch(async error => {
            error.message += ` requested ${site.name} ${width} page ${number}, combined=${combined}; observed ${JSON.stringify(await page.evaluate(() => ({ page: document.querySelector('#pageNum').value, current: [...document.querySelectorAll('#desk .is-current')].map(p => p.dataset.pageNumber), reading: document.querySelector('#listenBtn').getAttribute('aria-pressed'), speech: window.testSpeech.current?.text })))}`;
            throw error;
          });
          // Listen stays where it reads by default; after 350 ms it decides whether to show its back button in the bar.
          if (combined) await page.waitForTimeout(450);
          const row = await page.evaluate(() => {
            const top = document.querySelector('#top'), r = top.getBoundingClientRect(), title = top.querySelector('.top-mid').getBoundingClientRect();
            return { observedPage: document.querySelector('#pageNum').value, currentPages: [...document.querySelectorAll('#desk .is-current')].map(p => p.dataset.pageNumber), titleBounds: { x: title.x, y: title.y, right: title.right, bottom: title.bottom }, height: r.height, title: document.querySelector('.top-mid .chap').textContent, reading: document.querySelector('#listenBtn').getAttribute('aria-pressed'), chip: !document.querySelector('#chip').hidden,
              controls: [...top.querySelectorAll('button')].filter(e => e.checkVisibility()).map((e, i) => {
                e.dataset.desktopProbe = String(i);
                const b = e.getBoundingClientRect();
                return { id: e.id || e.getAttribute('aria-label'), probe: String(i), x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom, hit: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('button') === e };
              }) };
          });
          assert.equal(row.observedPage, String(number), 'Requested page is current at header measurement');
          assert(row.currentPages.includes(String(number)));
          const key = `${width}-${combined}`;
          if (site.name === 'baseline') {
            if (heights.has(key)) assert.equal(row.height, heights.get(key), 'Baseline bar height stays constant on every page');
            heights.set(key, row.height);
          }
          else {
            assert.equal(row.height, heights.get(key) ?? (combined ? 51 : 49), `${browserName} ${width} page ${number} ${combined ? 'combined' : 'default'} matches baseline bar height`);
            if (combined) { assert.equal(row.reading, 'true'); assert(row.chip, 'Search chip remains visible while reading'); }
            const center = row.controls[0].y + row.controls[0].height / 2;
            for (const c of row.controls) {
              const t = row.titleBounds;
              assert(Math.min(t.right, c.right) - Math.max(t.x, c.x) <= .5 || Math.min(t.bottom, c.bottom) - Math.max(t.y, c.y) <= .5, `Desktop title stays clear of ${c.id}: ${JSON.stringify({ title: t, control: c })}`);
              assert(c.hit && c.x >= 0 && c.y >= 0 && c.bottom <= row.height && Math.abs(c.y + c.height / 2 - center) < 1, `One desktop row with reachable ${c.id}: ${JSON.stringify(c)}`);
              assert(c.right <= width, `${c.id} ends inside the window: ${JSON.stringify(c)}`);
            }
            await page.evaluate(count => {
              window.testDesktopHits = [];
              const capture = event => {
                window.testDesktopHits.push({ probe: event.target.closest('button')?.dataset.desktopProbe, page: document.querySelector('#pageNum').value });
                event.preventDefault(); event.stopImmediatePropagation();
                if (window.testDesktopHits.length === count) document.removeEventListener('click', capture, true);
              };
              document.addEventListener('click', capture, true);
            }, row.controls.length);
            for (const c of row.controls) await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
            row.clickPages = await page.evaluate(() => [...new Set(window.testDesktopHits.map(hit => hit.page))]);
            // Listen turns pages while reading, so only the quiet state pins every click to the requested page.
            if (!combined) assert.deepEqual(row.clickPages, [String(number)], 'Every native centre click occurs on the requested page');
            assert.deepEqual(await page.evaluate(() => window.testDesktopHits.map(hit => hit.probe)), row.controls.map(c => c.probe), `${width} page ${number} every native centre click reaches its control`);
            if (!screenshot && row.title === longest && [961, 1024, 1440].includes(width)) {
              await page.locator('#top').screenshot({ path: path.join(evidence, `${browserName}-${width}-desktop-${combined ? 'combined' : 'default'}.png`) });
              assert.equal(await page.locator('.top-mid .chap').textContent(), longest, 'Screenshot retains the longest actual chapter title');
              assert.equal(await page.locator('#pageNum').inputValue(), String(number), 'Screenshot retains its requested page');
              screenshot = true;
            }
          }
          samples.push({ site: site.name, combined, width, page: number, ...row });
        }
        if (site.name === 'candidate' && width !== 1280) assert(screenshot, `Longest chapter screenshot saved: ${longest}`);
        console.log(`${browserName} desktop ${site.name} ${width} ${combined ? 'combined' : 'default'} all ${total} pages height ${[...new Set(samples.filter(s => s.site === site.name && s.width === width && s.combined === combined).map(s => s.height))]} PASS${site.name === 'candidate' ? ', all controls native centre clicks' : ''}`);
      }
      if (site.name === 'candidate') for (const width of [900, 960]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [id, name] of [['searchBtn', 'Search'], ['mapBtn', 'Minimap']]) {
          assert.equal(await page.getByRole('button', { name, exact: true }).getAttribute('id'), id, `${width} accessible name ${name}`);
        }
        console.log(`${browserName} ${width} accessible names Search, Minimap PASS`);
      }
    } finally { await context.close(); }
  }
  fs.writeFileSync(path.join(evidence, `${browserName}-desktop.json`), JSON.stringify(samples, null, 2));
}

async function readerTools(page, browserName, width) {
  const theme = page.locator('#themeBtn');
  const themeState = async (value, current, next, paper) => {
    assert.equal(await theme.getAttribute('data-theme'), value);
    const label = `Theme is ${current}. Switch to ${next}.`;
    assert.equal(await theme.getAttribute('aria-label'), label);
    assert.equal(await theme.getAttribute('title'), label);
    assert.deepEqual(await page.locator('#themeBtn [data-theme-icon]').evaluateAll(nodes => nodes.filter(n => getComputedStyle(n).display !== 'none').map(n => n.dataset.themeIcon)), [value], 'Exactly the current theme icon appears');
    assert.equal(await page.locator('.seg[data-setting="theme"] button[aria-pressed="true"]').getAttribute('data-value'), value, 'Options agrees with the dock');
    assert.equal(await page.locator('html').getAttribute('data-theme'), value === 'system' ? null : value, 'Root follows the saved theme');
    assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--paper').trim()), paper, 'Visible paper follows the theme');
  };
  await themeState('system', 'Auto', 'Light', '#fcfcfa');
  await page.locator('#dock').screenshot({ path: path.join(evidence, `${browserName}-${width}-bottom-system.png`) });
  await page.locator('#top').screenshot({ path: path.join(evidence, `${browserName}-${width}-top-system.png`) });
  for (const [value, current, next, paper] of [['light', 'Light', 'Dark', '#fcfcfa'], ['dark', 'Dark', 'Auto', '#24292d'], ['system', 'Auto', 'Light', '#fcfcfa']]) {
    await theme.click();
    await themeState(value, current, next, paper);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('piled4:settings')).theme), value, 'Theme choice is saved');
    await page.locator('#dock').screenshot({ path: path.join(evidence, `${browserName}-${width}-bottom-${value}.png`) });
    await page.locator('#top').screenshot({ path: path.join(evidence, `${browserName}-${width}-top-${value}.png`) });
    await page.reload(); await page.waitForSelector('#app:not(.loading)', { timeout: 120000 });
    await themeState(value, current, next, paper);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await themeState('system', 'Auto', 'Light', '#24292d');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('#optsBtn').click();
  await page.locator('.seg[data-setting="theme"] button[data-value="dark"]').click();
  await themeState('dark', 'Dark', 'Auto', '#24292d');
  await page.locator('.seg[data-setting="theme"] button[data-value="system"]').click();
  await themeState('system', 'Auto', 'Light', '#fcfcfa');
  await page.keyboard.press('Escape');
  await theme.press('Enter'); await themeState('light', 'Light', 'Dark', '#fcfcfa');
  await page.emulateMedia({ colorScheme: 'dark' });
  await themeState('light', 'Light', 'Dark', '#fcfcfa');
  await theme.press('Space'); await themeState('dark', 'Dark', 'Auto', '#24292d');
  await page.emulateMedia({ colorScheme: 'light' });
  await theme.click(); await themeState('system', 'Auto', 'Light', '#fcfcfa');
  const focus = page.locator('#focusBtn');
  await focus.click(); await page.mouse.move(width / 2, 400);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#top')).opacity === '0.3');
  assert.equal(await focus.getAttribute('aria-pressed'), 'true', 'Focus still fades the bars');
  await page.keyboard.press('Escape');
  assert.equal(await focus.getAttribute('aria-pressed'), 'false');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#top')).opacity === '1');
  const layouts = [];
  for (const viewport of width === 390 ? [360, 380, 381, 390] : [1440]) {
    await page.setViewportSize({ width: viewport, height: viewport < 500 ? 844 : 900 });
    await page.waitForTimeout(300);
    const layout = await page.evaluate(() => {
      const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const dock = document.querySelector('#dock');
      const buttons = [...dock.querySelectorAll('button')].filter(e => e.checkVisibility());
      const controls = buttons.map(e => ({ id: e.id || `${e.parentElement.dataset.setting}-${e.dataset.value}`, ...rect(e) }));
      return { width: innerWidth, rows: new Set([...dock.children].map(e => { const r = e.getBoundingClientRect(); return Math.round(r.y + r.height / 2); })).size,
        height: dock.getBoundingClientRect().height, overflow: dock.scrollWidth > dock.clientWidth,
        themeVisible: document.querySelector('#themeBtn').checkVisibility(), controls,
        overlaps: controls.flatMap((r, i) => controls.slice(i + 1).filter(q => Math.min(r.right, q.right) - Math.max(r.x, q.x) > .5 && Math.min(r.bottom, q.bottom) - Math.max(r.y, q.y) > .5).map(q => [r.id, q.id])) };
    });
    assert.equal(layout.rows, viewport === 1440 ? 1 : 2, 'Dock keeps one row on a computer and two on a phone');
    assert.equal(layout.height, viewport === 1440 ? 60 : 100, 'Dock height, with the chapter and page beside the slider 40 pixels tall to tap');
    assert.equal(layout.overflow, false, 'Dock does not overflow');
    assert.equal(layout.themeVisible, true, 'Theme remains visible in the top bar');
    assert.deepEqual(layout.overlaps, [], 'Dock controls do not overlap');
    for (const control of layout.controls) {
      assert(control.x >= 0 && control.right <= viewport && control.y >= 0 && control.bottom <= (viewport < 500 ? 844 : 900), `${control.id} remains in viewport at ${viewport}`);
      const segmented = control.id.startsWith('mode-') || control.id.startsWith('arrange-');
      assert.equal(control.width, segmented ? viewport === 1440 ? 38 : viewport <= 380 ? 28 : 32 : 32, `${control.id} retains baseline width at ${viewport}`);
      assert.equal(control.height, segmented ? 26 : 32, `${control.id} retains baseline height at ${viewport}`);
    }
    layouts.push(layout);
  }
  fs.writeFileSync(path.join(evidence, `${browserName}-${width}-dock-layout.json`), JSON.stringify(layouts, null, 2));
  console.log(`${browserName}-${width} theme system/light/dark/system, Options, reload, device preference, keyboard, Focus PASS`);
  console.log(`${browserName}-${width} dock sizes/rows, viewport/overlap PASS ${JSON.stringify(layouts.map(({ width, rows, height, overflow, themeVisible, overlaps }) => ({ width, rows, height, overflow, themeVisible, overlaps })))}`);
}

async function scrollEntry(page, browserName, width) {
  const mode = name => page.locator(`.seg[data-setting="mode"] button[data-value="${name}"]`);
  const expectMode = async (name, view) => {
    assert.equal(await mode(name).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#app').getAttribute('data-view'), view);
  };
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('piled4:settings')) || {};
    Object.assign(saved, { view: 'paged', facing: 0, scrollStyle: 'text' });
    localStorage.setItem('piled4:settings', JSON.stringify(saved));
    location.hash = 'fig-scroll';
  });
  await page.reload(); await page.waitForSelector('#app:not(.loading)');
  await expectMode('single', 'paged');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('piled4:settings')).scrollStyle), 'text');
  await page.locator('#desk').focus(); await page.keyboard.press('s');
  await expectMode('pages', 'linear');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(evidence, `${browserName}-${width}-scroll-s.png`) });
  await page.locator('#desk #fig-scroll').screenshot({ path: path.join(evidence, `${browserName}-${width}-figure-4.png`) });
  await page.keyboard.press('v'); await expectMode('text', 'scroll');
  await page.keyboard.press('v'); await expectMode('pages', 'linear');
  await page.keyboard.press('v'); await expectMode('text', 'scroll');
  await page.reload(); await page.waitForSelector('#app:not(.loading)');
  await expectMode('text', 'scroll');
  await page.locator('#scroller').focus(); await page.keyboard.press('s'); await expectMode('single', 'paged');
  await page.keyboard.press('s'); await expectMode('pages', 'linear');
  await mode('text').click(); await expectMode('text', 'scroll');
  await page.keyboard.press('s'); await expectMode('single', 'paged');
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('piled4:settings')) || {};
    Object.assign(saved, { facing: 1, scrollStyle: 'text' });
    localStorage.setItem('piled4:settings', JSON.stringify(saved));
  });
  await page.reload(); await page.waitForSelector('#app:not(.loading)');
  await expectMode('facing', 'paged');
  await page.locator('#desk').focus(); await page.keyboard.press('s'); await expectMode('pages', 'linear');
  await page.keyboard.press('s'); await expectMode('facing', 'paged');
  await mode('single').click();
  console.log(`${browserName}-${width} saved settings.scrollStyle=text: s from single/facing -> pages; v -> text -> pages; reload in Scroll/Text -> Text; s -> paged -> pages; explicit Text control PASS`);
}

async function listenParagraphs(page, browserName, width) {
  await page.evaluate(() => {
    window.testBraceEvents = [];
    window.addEventListener('keydown', event => {
      if ('(){}[]'.includes(event.key)) window.testBraceEvents.push({ key: event.key, prevented: event.defaultPrevented });
    });
  });
  await page.locator('#desk').focus();
  for (const key of '(){}[]') await page.keyboard.press(key);
  assert.deepEqual(await page.evaluate(() => window.testBraceEvents.map(e => e.prevented)), Array(6).fill(false), 'Inactive Listen does not swallow navigation punctuation');
  await page.locator('#thumbsBtn').click();
  await page.waitForSelector('#app.grid-on');
  for (const key of '(){}[]') await page.keyboard.press(key);
  assert.deepEqual(await page.evaluate(() => window.testBraceEvents.slice(-6).map(e => e.prevented)), Array(6).fill(false), 'Grid does not swallow navigation punctuation');
  await page.keyboard.press('Escape'); await page.waitForSelector('#grid', { state: 'hidden' });
  const startAt = async (selector, phrase = '') => {
    if (await page.locator('#listenBtn').getAttribute('aria-pressed') === 'true') await page.keyboard.press('Escape');
    const target = page.locator(`#desk ${selector}`).first();
    const number = await target.evaluate(el => +el.closest('.pagedjs_page').dataset.pageNumber);
    await page.locator('#thumbsBtn').click(); await page.waitForSelector('#app.grid-on');
    await page.getByRole('button', { name: new RegExp(`^Page ${number}(,|$)`) }).click();
    await page.waitForSelector('#grid', { state: 'hidden' });
    await page.locator('#desk').focus();
    await target.evaluate((el, phrase) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let text;
      while ((text = walker.nextNode())) if (text.textContent.trim() && (!phrase || text.textContent.includes(phrase))) break;
      const from = phrase ? text.textContent.indexOf(phrase) : 0;
      const range = document.createRange(); range.setStart(text, from); range.setEnd(text, from + 1);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, phrase);
    await page.keyboard.press('a');
    return number;
  };
  const observations = [];
  const spoken = async (expected, label, utterance = expected) => {
    await page.waitForFunction(expected => {
      const range = [...(CSS.highlights.get('speak') || [])][0];
      return range?.toString().replace(/\s+/g, ' ').trim() === expected;
    }, expected).catch(async error => {
      const actual = await page.evaluate(() => ({ highlights: [...(CSS.highlights.get('speak') || [])].map(r => r.toString()), utterance: window.testSpeech.current?.text, reading: document.querySelector('#listenBtn').getAttribute('aria-pressed'), history: window.testSpeech.history.slice(-4) }));
      throw new Error(`${label}: ${error.message}; actual ${JSON.stringify(actual)}`);
    });
    const result = await page.evaluate(() => {
      const ranges = [...CSS.highlights.get('speak')];
      const el = ranges[1]?.startContainer.parentElement;
      return { highlight: ranges[0].toString().replace(/\s+/g, ' ').trim(), utterance: window.testSpeech.current.text,
        reading: document.querySelector('#listenBtn').getAttribute('aria-pressed'),
        page: el ? +el.closest('.pagedjs_page').dataset.pageNumber : null,
        current: +document.querySelector('#desk .is-current').dataset.pageNumber,
        visible: [...document.querySelectorAll('#desk .is-current')].map(el => +el.dataset.pageNumber) };
    });
    assert.equal(result.utterance, utterance, `${label} speaks the highlighted sentence`);
    assert.equal(result.reading, 'true', 'Listen continues after paragraph navigation');
    const follows = result.visible.includes(result.page), message = `${label} follows highlighted speech onto its page ${JSON.stringify(result)}`;
    assert(follows, message);
    observations.push({ label, ...result });
    console.log(`${browserName}-${width} Listen ${label} PASS`);
  };
  const first = 'A scrolling page has no bottom you can feel, and its text never stays still long enough to become a place.';
  const next = 'Pages also give reading edges: somewhere to stop, a sense of how much is left, and a number that means the same words to everyone. paged.js brings real pages to ordinary HTML in the browser; this reader is about showing them on a screen.';
  const number = await startAt('#why-place', 'A page does.');
  await spoken('A page does.', 'start mid-paragraph');
  await page.keyboard.press('}'); await spoken(next, '} next paragraph first sentence');
  await page.keyboard.press(')'); await spoken('Turn them with the arrow keys, or vim-style with h j k l.', ') next sentence');
  await page.keyboard.press('{'); await spoken(next, '{ current paragraph first sentence');
  await page.keyboard.press('{'); await spoken(first, 'second { previous paragraph first sentence');
  await page.evaluate(() => window.testSpeech.finish()); await spoken('A page does.', 'speech end advances automatically');
  await page.keyboard.press('}'); await spoken(next, '} next paragraph again');
  await page.keyboard.press('}'); await spoken('One page, two piles', '} chapter start follows page turn', 'Chapter 2. One page, two piles.');
  assert.notEqual(observations.at(-1).page, number, 'Paragraph navigation crosses to another page');
  await page.evaluate(() => window.testSpeech.finish());
  await spoken('Two facing pages copy print, but on a monitor they put the empty gutter in the middle of the screen and push each page off to one side.', 'speech continues after paragraph page turn');
  await page.screenshot({ path: path.join(evidence, `${browserName}-${width}-listen-paragraph.png`) });
  await startAt('#screen-parts > li', 'Each panel’s button');
  await spoken('Each panel’s button sits above its panel.', 'list item second sentence');
  await page.keyboard.press('}'); await spoken('Contents. c switches between contents and topics; C shows or hides the panel.', '} next list item');
  await page.keyboard.press('{'); await spoken('Top bar: title and chapter in the middle; the contents button, Contents/Topics control and All pages button in that order on the left; search, Listen, full screen, Theme and the minimap button on the right.', '{ previous list item start');
  assert((await page.evaluate(() => window.testBraceEvents.filter(e => e.prevented))).length >= 5, 'Active Listen handles braces');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#listenBtn').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('{'); await page.keyboard.press('}');
  assert.deepEqual(await page.evaluate(() => window.testBraceEvents.slice(-2).map(e => e.prevented)), [false, false], 'Stopped Listen leaves braces alone');
  await startAt('#why-place', 'A page does.');
  await spoken('A page does.', 'sentence key setup');
  await page.keyboard.press(')');
  await spoken('Once you turn it, its words stay put, so you remember that a sentence sat near the top, just after the figure, and you can find it again by that shape.', ') advances a sentence');
  await page.keyboard.press('('); await spoken('A page does.', '( returns a sentence');
  const historySize = () => page.evaluate(() => window.testSpeech.history.length);
  const unchanged = async (action, label, delay = 120) => {
    const before = await historySize();
    await action(); await page.waitForTimeout(delay);
    assert.equal(await historySize(), before, label);
    await spoken('A page does.', label);
  };
  const disarm = () => page.keyboard.press('Shift');
  await unchanged(() => page.keyboard.press(']'), 'single ] does not act after its wait', 550);
  await disarm();
  await unchanged(async () => { await page.keyboard.press(']'); await page.keyboard.press('['); }, '] then [ disarms');
  await unchanged(async () => { await page.keyboard.press('['); await page.keyboard.press(']'); }, '[ then ] disarms');
  await unchanged(async () => { await page.keyboard.press(']'); await page.keyboard.press('x'); await page.keyboard.press(']'); }, 'ordinary key disarms');
  await disarm();
  await unchanged(async () => { await page.keyboard.press(']'); await page.keyboard.press('Shift'); await page.keyboard.press(']'); }, 'modifier key disarms');
  await disarm();
  const beforeGrid = await historySize();
  await page.keyboard.press(']'); await page.keyboard.press('t');
  await page.waitForSelector('#app.grid-on');
  for (const key of '(){}[]') await page.keyboard.press(key);
  assert.deepEqual(await page.evaluate(() => window.testBraceEvents.slice(-6).map(e => e.prevented)), Array(6).fill(false), 'Active Listen leaves grid punctuation alone');
  assert.equal(await historySize(), beforeGrid, 'Grid punctuation does not change speech');
  await page.keyboard.press('Escape'); await page.waitForSelector('#grid', { state: 'hidden' });
  await unchanged(() => page.keyboard.press(']'), 'grid transition disarms the page pair');
  await disarm();
  await page.keyboard.press(']'); await page.keyboard.press('/');
  await page.locator('#q').fill('noSuchBracket');
  for (const key of '()[]') await page.locator('#q').press(key);
  assert.equal(await page.locator('#q').inputValue(), 'noSuchBracket()[]', 'Search receives navigation punctuation while Listen is active');
  await page.locator('#q').press('Control+[');
  assert.equal(await page.locator('#listenBtn').getAttribute('aria-pressed'), 'true', 'Ctrl+[ closes search before stopping Listen');
  await page.locator('#desk').focus();
  await unchanged(() => page.keyboard.press(']'), 'typing and Ctrl+[ disarm the page pair');
  await disarm();
  await page.keyboard.press(']'); await page.keyboard.press('Control+[');
  assert.equal(await page.locator('#listenBtn').getAttribute('aria-pressed'), 'false', 'Ctrl+[ stops Listen as Escape');
  await page.keyboard.press('a'); await spoken('Why pages', 'Listen resumes at the search return page', 'Chapter 1. Why pages.');
  const afterEscape = await historySize();
  await page.keyboard.press(']'); await page.waitForTimeout(120);
  assert.equal(await historySize(), afterEscape, 'Ctrl+[ leaves no armed page pair after a restart');
  await disarm();
  await startAt('#why-place', 'A page does.'); await spoken('A page does.', 'timing setup');
  const timedPair = async elapsed => page.evaluate(elapsed => {
    const now = performance.now.bind(performance), base = now();
    let at = base;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => at });
    try {
      document.querySelector('#desk').dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
      at += elapsed;
      document.querySelector('#desk').dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
    } finally { Object.defineProperty(performance, 'now', { configurable: true, value: now }); }
  }, elapsed);
  await unchanged(() => timedPair(501), '501 ms bracket pair does not act');
  await disarm(); await timedPair(500);
  await spoken('One page, two piles', '500 ms ]] starts the next page', 'Chapter 2. One page, two piles.');
  await page.keyboard.press('['); await page.keyboard.press('[');
  await spoken('Why pages', '[[ starts the previous page', 'Chapter 1. Why pages.');
  await startAt('#why-place', 'A page does.'); await spoken('A page does.', 'rapid page pairs setup');
  const rapidBefore = await historySize();
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) document.querySelector('#desk').dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
  });
  const rapidSentence = browserName === 'firefox'
    ? 'The pile owes something to the Xbox 360, which launched in 2005 with a dashboard of blades: tall panels stacked at the side of the screen that slid across like the tabs of a ring binder, while the one you had open stayed in front.'
    : 'Facing pages are here too, for documents designed as spreads and for anyone who likes a book lying open.';
  await spoken(rapidSentence, 'rapid page pairs keep one final utterance');
  await page.waitForTimeout(150);
  assert.equal(await historySize(), rapidBefore + 1, 'Rapid page pairs cancel older delayed speech');
  assert.equal(await page.locator('#desk .is-current').getAttribute('data-page-number'), '5', 'Two rapid page pairs advance two physical pages');
  await page.keyboard.press('f');
  await startAt('#why-place', 'A page does.'); await spoken('A page does.', 'facing setup');
  await page.keyboard.press(']'); await page.keyboard.press(']');
  await page.waitForFunction(() => window.testSpeech.current?.text === 'Chapter 2. One page, two piles.');
  const facing = await page.evaluate(() => {
    const range = [...CSS.highlights.get('speak')][1];
    return { text: window.testSpeech.current.text, page: +range.startContainer.parentElement.closest('.pagedjs_page').dataset.pageNumber,
      visible: [...document.querySelectorAll('#desk .is-current')].map(el => +el.dataset.pageNumber) };
  });
  assert.equal(facing.page, number + 1, 'Facing ]] advances one physical page');
  assert(facing.visible.includes(facing.page), 'Facing speech stays on a visible page');
  await page.keyboard.press('f');
  await startAt('#why', 'Why pages'); await spoken('Why pages', 'skip empty page setup', 'Chapter 1. Why pages.');
  await page.keyboard.press('['); await page.keyboard.press('[');
  await page.waitForFunction(() => [...CSS.highlights.get('speak')][1]?.startContainer.parentElement.closest('.pagedjs_page').dataset.pageNumber === '1');
  const firstSpeech = await page.evaluate(() => window.testSpeech.current.text);
  const beforeFirst = await historySize();
  await page.keyboard.press('['); await page.keyboard.press('['); await page.waitForTimeout(120);
  assert.equal(await historySize(), beforeFirst, '[[ stays at the first sentence page');
  assert.equal(await page.evaluate(() => window.testSpeech.current.text), firstSpeech);
  await page.keyboard.press(']'); await page.keyboard.press(']');
  await spoken('Why pages', ']] skips contents page with no spoken starts', 'Chapter 1. Why pages.');
  await page.keyboard.press('Escape');
  await startAt('#why-place', 'A page does.'); await spoken('A page does.', 'reflow setup on a middle page');
  await page.locator('#optsBtn').click(); await page.locator('#paperSel').selectOption('a4');
  await page.waitForSelector('#app:not(.loading)'); await page.keyboard.press('Escape');
  await page.locator('#desk').focus(); await page.keyboard.press(']'); await page.keyboard.press(']');
  await spoken('One page, two piles', ']] uses current page mapping after A4 reflow', 'Chapter 2. One page, two piles.');
  await page.keyboard.press('Escape');
  await page.locator('#optsBtn').click(); await page.locator('#paperSel').selectOption('a5');
  await page.waitForSelector('#app:not(.loading)'); await page.keyboard.press('Escape');
  await startAt('.colophon', 'Set in Literata');
  await spoken('Set in Literata, by TypeTogether.', 'colophon first line');
  await page.keyboard.press(')'); await spoken('Paginated in the browser by paged.js.', 'colophon second line');
  await page.keyboard.press(')'); await spoken('Made with Claude and Codex.', 'colophon third line');
  await page.keyboard.press(')'); await spoken('Imagined by zefenix.', 'last line reached by )');
  const beforeLast = await historySize();
  await page.keyboard.press(']'); await page.keyboard.press(']'); await page.waitForTimeout(120);
  assert.equal(await historySize(), beforeLast, ']] stays at the last sentence page');
  await page.keyboard.press('Escape');
  console.log(`${browserName}-${width} Listen page keys, timing, cancellation, empty page, facing and ends PASS ${JSON.stringify(facing)}`);
  console.log(`${browserName}-${width} Listen silent speech stub, real highlights and page following PASS ${JSON.stringify(observations)}`);
}

async function chapterNames(page, browserName, width) {
  const mode = name => page.locator(`.seg[data-setting="mode"] button[data-value="${name}"]`);
  await mode('single').click();
  assert.equal(await page.locator('#ticks').getAttribute('aria-label'), 'Page slider');
  const status = page.locator('.stat[data-where]');
  assert.equal(await status.getAttribute('title'), 'Peek at the contents');
  assert.equal(await page.locator('#statR').getAttribute('title'), 'All pages');
  const absolute = async number => {
    await page.locator('#thumbsBtn').click(); await page.waitForSelector('#app.grid-on');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#grid')).opacity === '1');
    await page.getByRole('button', { name: new RegExp(`^Page ${number}(,|$)`) }).click();
    await page.waitForSelector('#grid', { state: 'hidden' });
  };
  const expect = async (name, number) => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(({ name, number }) => !window.testReaderScrolling.has(document.querySelector('#app').dataset.view === 'scroll' ? 'scroller' : 'desk') && !document.querySelector('#app').classList.contains('loading') && !document.querySelector('#desk').classList.contains('no-anim') && document.fonts.status === 'loaded' && document.querySelector('.stat[data-where]').textContent === name && document.querySelector('#pageNum').value === String(number), { name, number }).catch(async error => {
      error.message += ` expected ${name}, p${number}; observed ${JSON.stringify(await page.evaluate(() => ({ status: document.querySelector('.stat[data-where]').textContent, page: document.querySelector('#pageNum').value, scrolling: [...window.testReaderScrolling], desk: document.querySelector('#desk').className, view: document.querySelector('#app').dataset.view })))}`;
      throw error;
    });
    assert.deepEqual(await page.evaluate(() => ({ name: document.querySelector('.stat[data-where]').textContent, number: document.querySelector('#pageNum').value })), { name, number: String(number) }, 'Settled chapter status and absolute page agree');
  };
  const map = async () => page.locator('#desk').evaluate(desk => [...desk.querySelectorAll('h2[data-n]')].map(h => ({ chapter: +h.dataset.n, title: h.textContent.trim(), first: +h.closest('.pagedjs_page').dataset.pageNumber })));
  const chapters = await map(), total = await page.locator('#desk .pagedjs_page').count();
  assert.equal(chapters.length, 12); assert(!chapters.some(c => c.chapter === 0));
  assert.deepEqual(chapters.find(c => c.chapter === 7), { chapter: 7, title: 'Topics', first: 14 }, 'Topics is chapter 7');
  assert.equal(chapters.find(c => c.chapter === 4).first, 8, 'A5 chapter 4 starts on absolute page 8');
  assert.equal(chapters.find(c => c.chapter === 3).first, 6, 'A5 figure status c3.2 means absolute page 7');
  const front = await page.locator('#book').evaluate(book => [...book.content.querySelector('.bk').children].slice(0, 2).map(el => el.dataset.label));
  assert.deepEqual(front, ['Cover', 'Contents']);
  const figure = await page.locator('#book').evaluate(book => [...book.content.querySelectorAll('#fig-screen .d-s')].map(el => el.textContent));
  assert.deepEqual(figure, ['c3.2', '48%', '16', '/ 22'], 'Figure 6 shows the bar as the reader draws it');
  await absolute(1); await expect('c0.1', 1);
  await absolute(2); await expect('c0.2', 2);
  await absolute(8); await expect('c4.1', 8);
  await absolute(9); await expect('c4.2', 9);
  await page.screenshot({ path: path.join(evidence, `${browserName}-${width}-status.png`) });
  const search = async query => {
    if (!await page.locator('#searchBox').isVisible()) await page.locator('#searchBtn').click();
    if (await page.locator('#q').inputValue() === query) await page.locator('#q').fill('');
    await page.evaluate(query => {
      window.testSearchRendered = false;
      const observer = new MutationObserver(() => {
        if (document.querySelector('#q').value !== query) return;
        window.testSearchRendered = true; observer.disconnect();
      });
      observer.observe(document.querySelector('#results'), { childList: true });
    }, query);
    await page.locator('#q').fill(query);
    await page.waitForFunction(() => window.testSearchRendered);
    return page.locator('#results .jump');
  };
  for (const query of ['c4.2', 'ch4.2', 'chapter 4.2', 'ch. 4.2']) {
    const jumps = await search(query);
    assert.equal(await jumps.count(), 1, `${query} offers the relative page`);
    assert.equal(await jumps.locator('.r-meta').textContent(), 'c4.2 · p9');
    await page.locator('#q').press('Enter'); await expect('c4.2', 9);
  }
  await search('c4.2');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(evidence, `${browserName}-${width}-search-c4.2.png`) });
  await page.locator('#q').press('Enter');
  for (const query of ['8', 'p8']) {
    const jumps = await search(query);
    assert(await jumps.locator('.r-snip').filter({ hasText: /^Page 8/ }).count(), `${query} offers absolute page 8`);
    await page.locator('#q').press('Enter'); await expect('c4.1', 8);
  }
  for (const query of ['c4p8', 'c4 p8', 'p8 c4']) {
    const jumps = await search(query);
    assert.equal(await jumps.count(), 0, `${query} is ordinary text search with no page jump`);
  }
  let jumps = await search('c4');
  assert.deepEqual(await jumps.locator('.r-meta').allTextContents(), ['Go to chapter', 'c4.1 · p8', 'c4.2 · p9', 'c4.3 · p10']);
  for (const query of ['c4.4', 'c4.0', 'c4.999']) {
    jumps = await search(query);
    assert.equal(await jumps.count(), 1);
    assert.equal(await jumps.locator('.r-meta').textContent(), 'Go to chapter');
    await page.locator('#q').press('Enter'); await expect('c4.1', 8);
  }
  for (const [query, number, name] of [['c0.1', 1, 'c0.1'], ['c0.2', 2, 'c0.2']]) {
    await search(query); await page.locator('#q').press('Enter'); await expect(name, number);
  }
  await mode('facing').click(); await absolute(2); await expect('c0.2–c1.1', 2);
  await absolute(8); await expect('c4.1–2', 8);
  assert.equal(await page.locator('#unitExtra').textContent(), '–9');
  await absolute(10); await expect('c4.3–c5.1', 10);
  await mode('single').click();
  const last = chapters.at(-1);
  await absolute(total); await expect(`c${last.chapter}.${total - last.first + 1}`, total);
  const tail = await page.locator('#book').evaluate(book => { const blocks = [...book.content.querySelector('.bk').children], i = blocks.findLastIndex(el => el.matches('h2')); return blocks.slice(i + 1).map(el => ({tag:el.tagName,id:el.id,class:el.className})); });
  await absolute(8);
  await page.locator('#optsBtn').click(); await page.locator('#paperSel').selectOption('a4');
  await page.waitForSelector('#app:not(.loading)');
  const reflowed = await map(), from = reflowed.find(c => c.chapter === 4).first;
  const moved = reflowed.find(c => c.first !== chapters.find(old => old.chapter === c.chapter).first);
  assert(moved, 'A4 moves an actual chapter boundary');
  await page.keyboard.press('Escape');
  await absolute(from); await expect('c4.1', from);
  await absolute(from + 1); await expect('c4.2', from + 1);
  jumps = await search('c4.2');
  assert.equal(await jumps.locator('.r-meta').textContent(), `c4.2 · p${from + 1}`);
  await page.locator('#q').press('Enter'); await expect('c4.2', from + 1);
  await absolute(moved.first); await expect(`c${moved.chapter}.1`, moved.first);
  const oldFirst = chapters.find(c => c.chapter === moved.chapter).first;
  await absolute(oldFirst);
  assert.notEqual(await status.textContent(), `c${moved.chapter}.1`, 'Same absolute page gets a new chapter-relative name after reflow');
  await page.locator('#optsBtn').click(); await page.locator('#paperSel').selectOption('a5');
  await page.waitForSelector('#app:not(.loading)'); await page.keyboard.press('Escape');
  await absolute(9); await expect('c4.2', 9);
  for (const name of ['pages', 'text']) {
    await mode(name).click(); await search('c4.2'); await page.locator('#q').press('Enter'); await expect('c4.2', 9);
  }
  const textLine = () => page.locator('#scroller').evaluate(scroller => scroller.scrollTop + scroller.clientHeight / 2 - document.querySelector('#article').offsetTop);
  const line = await textLine();
  for (const action of [() => page.locator('#searchBtn').click(), () => page.locator('#q').press('Enter')]) {
    await action();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const moved = await textLine() - line;
    assert(Math.abs(moved) <= 1, `${browserName}-${width} Settled Text reading line survives search chip header resize; it moved ${moved} px`);
    await expect('c4.2', 9);
  }
  await mode('single').click();
  console.log(`${browserName}-${width} chapter status/search aliases/absolute/text/facing/reflow PASS ${JSON.stringify({ chapters, total, front, figure, tail, a4Chapter4: from, moved })}`);
}

async function bookPage(context, address = url) {
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  page.on('pageerror', error => check(false, `page error: ${error.message}`));
  await page.addInitScript(() => {
    window.testReaderScrolling = new Set();
    document.addEventListener('DOMContentLoaded', () => {
      for (const id of ['desk', 'scroller']) {
        const reader = document.getElementById(id);
        reader.addEventListener('scroll', () => window.testReaderScrolling.add(id));
        reader.addEventListener('scrollend', () => window.testReaderScrolling.delete(id));
      }
    });
    const speech = { current: null, history: [], speaking: true, pending: false,
      getVoices: () => [], addEventListener() {},
      speak(utterance) { this.current = utterance; this.history.push(utterance.text); },
      cancel() { this.current = null; },
      finish() { const utterance = this.current; this.current = null; utterance.onend(); } };
    window.testSpeech = speech;
    Object.defineProperty(window, 'speechSynthesis', { value: speech });
  });
  await page.route('**/*', route => {
    const request = new URL(route.request().url());
    const allowed = request.protocol === 'file:' || (request.origin === new URL(address).origin && request.pathname.startsWith(new URL('.', address).pathname));
    return allowed ? route.continue() : route.abort();
  });
  await page.goto(address);
  await page.waitForSelector('#app:not(.loading)', { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// Browsers get a HOME and TMPDIR of their own, and Firefox runs without its own sandboxes: inside an agent's
// sandbox it cannot make its profile in the shared temp folder, and its content processes crash.
const home = fs.mkdtempSync(path.join(path.resolve(evidence), 'home-'));
process.env.TMPDIR = home;
const browserEnv = { ...process.env, HOME: home, MOZ_DISABLE_CONTENT_SANDBOX: '1', MOZ_DISABLE_GMP_SANDBOX: '1', MOZ_DISABLE_RDD_SANDBOX: '1', MOZ_DISABLE_GPU_SANDBOX: '1', MOZ_DISABLE_SOCKET_PROCESS_SANDBOX: '1' };

(async () => {
  const { browserProcesses } = require('./browser_kit');
  const processesBefore = browserProcesses().length;
  for (const browserName of option('browsers', 'firefox,chromium').split(',')) {
    const browser = await playwright[browserName].launch({ env: browserEnv });
    try {
      console.log(`${browserName} ${browser.version()}`);
      for (const width of args.includes('--lists-only') || args.includes('--header-only') || args.includes('--desktop-only') ? [1440] : [1440, 390]) {
        for (const touch of browserName === 'chromium' && !args.includes('--lists-only') && !args.includes('--addenda-only') && !args.includes('--names-only') && !args.includes('--tools-only') && !args.includes('--listen-only') && !args.includes('--header-only') && !args.includes('--desktop-only') ? [false, true] : [false]) {
          const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: touch, reducedMotion: 'reduce', colorScheme: 'light' });
          try {
            const page = await bookPage(context);
            if (args.includes('--header-only')) { await headerSweep(page, browserName); await desktopHeader(page, browserName); continue; }
            if (args.includes('--desktop-only')) { await desktopHeader(page, browserName); continue; }
            if (args.includes('--listen-only')) { await listenParagraphs(page, browserName, width); continue; }
            if (width === 1440 && !touch && !['--lists-only', '--addenda-only', '--names-only', '--tools-only'].some(flag => args.includes(flag))) { await headerSweep(page, browserName); await desktopHeader(page, browserName); }
            if (!args.includes('--lists-only') && !touch && !args.includes('--addenda-only') && !args.includes('--names-only')) await readerTools(page, browserName, width);
            if (args.includes('--tools-only')) continue;
            if (width === 1440 && !touch && !args.includes('--addenda-only') && !args.includes('--names-only')) { await readLists(page, browserName); await calibration(page, browserName); }
            if (!args.includes('--lists-only') && !args.includes('--addenda-only') && !args.includes('--names-only')) await controls(page, browserName, width, touch);
            if (!args.includes('--lists-only') && !touch && !args.includes('--names-only')) { await scrollEntry(page, browserName, width); await listenParagraphs(page, browserName, width); }
            if (!args.includes('--lists-only') && !touch) await chapterNames(page, browserName, width);
          } finally { await context.close(); }
        }
      }
    } catch (error) { check(false, `${browserName} ${error.message}\n${error.stack || ''}`); }
    finally { await browser.close(); }
  }
  fs.rmSync(home, { recursive: true, force: true });
  const processesAfter = browserProcesses().length;
  console.log(`browser processes before ${processesBefore}, after ${processesAfter}`);
  check(processesAfter <= processesBefore, `${processesAfter - processesBefore} browser processes left open`);
  for (const [id, times] of knownSeen) console.log(`KNOWN FAULT ${id} seen ${times} times: ${KNOWN[id]}`);
  assert.equal(failures.length, 0, `${failures.length} failures`);
  console.log(args.includes('--tools-only') ? 'PASS tools subset' : args.includes('--listen-only') ? 'PASS Listen subset' : args.includes('--header-only') ? 'PASS header subset' : args.includes('--desktop-only') ? 'PASS desktop subset' : `PASS all list markers${args.includes('--lists-only') ? '' : ' and requested controls'}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
