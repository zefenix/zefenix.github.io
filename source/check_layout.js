#!/usr/bin/env node
// Layout sweep of the reader's phone states across engines and widths: sideways scroll, cut-off, covered,
// off-screen and unreachable controls, and each visible control's sampled hit square (hit_square.js).
const fs = require('node:fs');
const path = require('node:path');
const kit = require('./browser_kit');
const { hitSquare } = require('./hit_square');

const { options, positional } = kit.parseArgs();
const [site] = positional;
const USAGE = 'Usage: node source/check_layout.js BUILD [--engines=chromium,webkit,firefox] [--widths=320,390,landscape] [--tap-rule=report|44] [--jobs=8] [--states=name,name] [--evidence=DIR] [--strict]';
if (!site) throw new Error(USAGE);
const tapRule = options['tap-rule'] || 'report';
if (!['report', '44'].includes(tapRule)) throw new Error(`--tap-rule must be report or 44. ${USAGE}`);
const jobs = Number(options.jobs) || 8;
const evidence = path.resolve(options.evidence || '.evidence/layout');
fs.mkdirSync(evidence, { recursive: true });

const steps = (from, to, by) => Array.from({ length: Math.floor((to - from) / by) + 1 }, (_, i) => from + i * by);
const MATRIX = {
  chromium: [...new Set([...steps(320, 540, 10), 360, 384, 390, 393, 402, 412, 414, 440, 522])].sort((a, b) => a - b).concat('landscape'),
  webkit: [390, 393, 402, 440],
  firefox: [360, 412, 522],
};
const engines = options.engines ? options.engines.split(',') : Object.keys(MATRIX);
for (const e of engines) if (!MATRIX[e]) throw new Error(`Unknown engine ${e}. ${USAGE}`);
const widthsFor = engine => options.widths ? options.widths.split(',').map(w => w === 'landscape' ? w : Number(w)) : MATRIX[engine];

const app = page => page.evaluate(() => {
  const a = document.querySelector('#app'), shown = s => !!document.querySelector(s)?.checkVisibility();
  return { view: a.dataset.view, tucked: a.classList.contains('tucked'), listening: a.classList.contains('listening'), grid: a.classList.contains('grid-on'),
    options: shown('#options'), search: shown('#searchBox'), chip: shown('#chip'), chipInRow: !!document.querySelector('#tray > #chip'), toc: shown('#tocPanel'),
    peek: document.querySelector('#tocPanel').classList.contains('peeking'), top: shown('#top'), slider: shown('#ticks'), listenRow: shown('.tray-listen'),
    tab: document.querySelector('#optTabs [aria-selected="true"]')?.textContent || null,
    sections: [...document.querySelectorAll('#options > section')].filter(s => s.checkVisibility()).map(s => s.querySelector('h3').textContent) };
});
const OPENING = { view: 'paged', tucked: false, listening: false, grid: false, options: false, search: false, chip: false, toc: false, peek: false, top: true, slider: true, listenRow: false };
function expect(actual, wanted, what) {
  const wrong = Object.entries(wanted).filter(([k, v]) => JSON.stringify(actual[k]) !== JSON.stringify(v));
  if (wrong.length) throw new Error(`${what}: ${wrong.map(([k, v]) => `${k} is ${JSON.stringify(actual[k])}, expected ${JSON.stringify(v)}`).join('; ')}`);
}

// The menus and panels animate and the stage refits after rows come and go; wait until nothing moves.
async function settle(page) {
  const snapshot = () => page.evaluate(() => JSON.stringify([document.querySelector('#app').className, document.querySelector('#stage').getBoundingClientRect().height,
    ...[...document.querySelectorAll('.toc-pane, .popover, .view-grid, .view-scroll, .view-paged')].map(e => e.scrollTop)]));
  let last = null;
  for (let i = 0; i < 40; i++) {
    await kit.frames(page); await page.waitForTimeout(60);
    const now = await snapshot();
    if (now === last) break;
    last = now;
  }
  await page.waitForSelector('#app:not(.loading)', { timeout: 120000 });   // a stage that changes height repaginates
  await page.waitForFunction(() => document.querySelector('#toast').hidden, null, { timeout: 6000 }).catch(() => {});
}

const ALL = ['Look', 'Pages', 'Listen', 'Scroll', 'Panels'];
const openOptions = tab => async page => {
  if (!(await page.locator('#options').isVisible())) await page.locator('#optsBtn').click();
  await page.getByRole('tab', { name: tab, exact: true }).click();
};
const search = async page => {
  await page.locator('#searchBtn').click();
  await page.locator('#q').fill('page');
  await page.waitForFunction(() => document.querySelector('#results').children.length > 0);
  await page.locator('#q').press('Enter');
};
const listen = async page => {
  await page.locator('#listenBtn').click();
  await page.waitForFunction(() => window.testSpeech.current);
};
// A peek comes from a tap just left of the slider, or at the reading area's left edge when that spot is empty.
const peek = async page => {
  const stat = await kit.box(page, '#statL');
  if (stat.width >= 4) await page.locator('#statL').click();
  else { const stage = await kit.box(page, '#stage'); await page.mouse.click(stage.x + 6, stage.cy); }
  await page.waitForFunction(() => document.querySelector('#tocPanel').classList.contains('peeking'));
  const panel = await kit.box(page, '#tocPanel');
  await page.mouse.move(panel.cx, panel.y + 4);   // pointing at a peek keeps it, past its 8 s wait
};
const STATES = [
  { name: 'opening', enter: async () => {}, want: OPENING },
  { name: 'options-all', enter: openOptions('All'), want: { options: true, tab: 'All', sections: ALL } },
  { name: 'options-look-pages', enter: openOptions('Look & Pages'), want: { options: true, tab: 'Look & Pages', sections: ['Look', 'Pages'] } },
  { name: 'options-listen-scroll', enter: openOptions('Listen & Scroll'), want: { options: true, tab: 'Listen & Scroll', sections: ['Listen', 'Scroll'] } },
  { name: 'options-panels', enter: openOptions('Panels'), want: { options: true, tab: 'Panels', sections: ['Panels'] } },
  { name: 'contents', enter: page => page.locator('#tocBtn').click(), want: { toc: true, peek: false } },
  { name: 'search-chip', enter: search, want: { search: false, chip: true, chipInRow: true, top: true } },
  { name: 'listen', enter: listen, want: { listening: true, listenRow: true } },
  { name: 'listen-search', enter: async page => { await listen(page); await search(page); }, want: { listening: true, listenRow: true, chip: true, chipInRow: true, search: false } },
  { name: 'all-pages', enter: page => page.locator('#thumbsBtn').click(), want: { grid: true } },
  { name: 'plain-text', enter: page => page.locator('#dock [data-setting="mode"] [data-value="text"]').click(), want: { view: 'scroll' } },
  { name: 'scrolled-pages', enter: page => page.locator('#dock [data-setting="mode"] [data-value="pages"]').click(), want: { view: 'linear' } },
  { name: 'zen', enter: page => page.locator('#menuStrip').click(), want: { tucked: true, top: false, slider: true } },
  { name: 'peek', enter: peek, want: { toc: true, peek: true } },
].filter(s => !options.states || options.states.split(',').includes(s.name));

async function backToOpening(page) {
  for (let i = 0; i < 6; i++) {
    const s = await app(page);
    if (s.tucked) await page.locator('#menuStrip').click();
    else if (s.options || s.search || s.grid || s.listening || s.chip || s.toc) await page.keyboard.press('Escape');
    else if (s.view !== 'paged') await page.locator('#dock [data-setting="mode"] [data-value="single"]').click();
    else break;
    await settle(page);
  }
  expect(await app(page), OPENING, 'back at the opening state');
}

// Runs in the page. Controls follow the rig's measure.js selector, plus the slider's two tap ends.
// The profile's viewport is the screen: a phone page that overflows sideways widens innerWidth to fit it.
function measure({ sampler, overlays, screen }) {
  const hitSquare = eval(`(${sampler})`);
  const identify = el => el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].join('.') : ''}`;
  const text = el => [...el.childNodes].map(n => n.textContent.trim()).filter(Boolean).join(' ');
  const name = el => (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || text(el) || el.getAttribute('title') || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();
  const role = el => el.getAttribute('role') || { BUTTON: 'button', A: 'link', SELECT: 'combobox', TEXTAREA: 'textbox' }[el.tagName] || (el.tagName === 'INPUT' ? (el.type === 'range' ? 'slider' : 'textbox') : 'generic');
  const owner = el => { const s = el.parentElement?.closest('[data-setting]'); if (s) return `[${s.dataset.setting}]`; const p = el.parentElement?.closest('[id]'); return p ? `#${p.id}` : ''; };
  const own = (el, x, y) => { const hit = x >= 0 && y >= 0 && x < screen.width && y < screen.height ? document.elementFromPoint(x, y) : null; return { hit, ok: !!hit && (hit === el || el.contains(hit)) }; };
  const box = r => ({ x: +r.left.toFixed(2), y: +r.top.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) });
  const T = .5;
  const inside = (r, c) => r.left >= c.left - T && r.top >= c.top - T && r.right <= c.right + T && r.bottom <= c.bottom + T;
  const viewport = { left: 0, top: 0, right: screen.width, bottom: screen.height };
  const scrollsX = (p, s) => /auto|scroll/.test(s.overflowX) && p.scrollWidth > p.clientWidth;
  const scrollsY = (p, s) => /auto|scroll/.test(s.overflowY) && p.scrollHeight > p.clientHeight;
  const clientRect = p => { const q = p.getBoundingClientRect(), left = q.left + p.clientLeft, top = q.top + p.clientTop; return { left, top, right: left + p.clientWidth, bottom: top + p.clientHeight }; };
  // Ancestors that clip this element: only its containing-block chain, so a positioned popover escapes its static parents.
  function clippers(el) {
    const out = [];
    let pos = getComputedStyle(el).position;
    for (let p = el.parentElement; p && pos !== 'fixed'; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (pos === 'absolute' && s.position === 'static' && s.transform === 'none' && s.contain === 'none') continue;
      if (p !== document.body && p !== document.documentElement && (s.overflowX !== 'visible' || s.overflowY !== 'visible')) out.push({ p, s });
      pos = s.position;
    }
    return out;
  }
  const t0 = performance.now(), doc = document.scrollingElement;
  const sideways = [...document.querySelectorAll('body *')].flatMap(e => {
    const s = getComputedStyle(e);
    return /auto|scroll/.test(s.overflowX) && e.scrollWidth > e.clientWidth && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ? [{ container: identify(e), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }] : [];
  });
  const t1 = performance.now(), seen = new Map();
  const els = [...document.querySelectorAll('button,input,select,textarea,[role="slider"],.bar a,.panel a,[role="dialog"] a,#statL,#statR')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  });
  const geometry = el => {
    const r = el.getBoundingClientRect();
    let clip = viewport, scroller = null, cutBy = null, needsScroll = false;
    for (const { p, s } of clippers(el)) {
      const c = clientRect(p), x = scrollsX(p, s), y = scrollsY(p, s);
      const outX = r.left < c.left - T || r.right > c.right + T, outY = r.top < c.top - T || r.bottom > c.bottom + T;
      if (!scroller && ((outX && !x) || (outY && !y))) cutBy = cutBy || { p, by: Math.max(c.left - r.left, r.right - c.right, c.top - r.top, r.bottom - c.bottom) };
      else if (outX || outY) needsScroll = true;
      if ((x || y) && !scroller) scroller = p;
      clip = { left: Math.max(clip.left, c.left), top: Math.max(clip.top, c.top), right: Math.min(clip.right, c.right), bottom: Math.min(clip.bottom, c.bottom) };
    }
    const visible = Math.min(r.right, clip.right) > Math.max(r.left, clip.left) && Math.min(r.bottom, clip.bottom) > Math.max(r.top, clip.top);
    return { r, scroller, cutBy, needsScroll, visible, centre: own(el, r.left + r.width / 2, r.top + r.height / 2) };
  };
  const sample = (record, el) => {
    const ts = performance.now(), hs = hitSquare(el);
    record.ms = performance.now() - ts;
    Object.assign(record, { hitSquareSide: hs.lowerBound, hitSquareUpperBound: hs.upperBound, hitSquare44: hs.contract44, hitSquare: hs });
  };
  const faults = [];
  if (doc.scrollWidth > screen.width) faults.push({ kind: 'sideways', control: null, detail: `document scrollWidth ${doc.scrollWidth} > ${screen.width}` });
  for (const s of sideways) faults.push({ kind: 'sideways', control: null, detail: `${s.container} scrollWidth ${s.scrollWidth} > ${s.clientWidth}` });
  const controls = els.map(el => {
    const n = name(el), base = el.id ? `#${el.id}` : `${owner(el)} ${n}`.trim(), count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    const g = geometry(el), key = count > 1 ? `${base} (${count})` : base;
    const record = { key, id: el.id || null, name: n, role: role(el), disabled: el.matches(':disabled'), box: box(g.r), width: +g.r.width.toFixed(2), height: +g.r.height.toFixed(2),
      hitSquareSide: null, hitSquareUpperBound: null, hitSquare44: null, hitSquare: null, reach: null };
    const fault = (kind, detail) => { faults.push({ kind, control: key, detail }); record.reach = kind; if (g.visible) sample(record, el); };
    const overlay = g.centre.hit?.closest(overlays);
    if (getComputedStyle(el).pointerEvents === 'none') { record.reach = record.hitSquare44 = 'inert'; return record; }
    if (g.cutBy) { fault('cut-off', `${identify(g.cutBy.p)} clips ${g.cutBy.by.toFixed(1)}px of ${JSON.stringify(record.box)}`); return record; }
    if (!g.centre.ok && overlay && !overlay.contains(el)) { record.reach = `under ${identify(overlay)}`; record.hitSquare44 = 'under overlay'; return record; }
    if (!g.needsScroll && inside(g.r, viewport) && g.centre.ok) { record.reach = 'in view'; sample(record, el); return record; }
    if (!g.needsScroll && inside(g.r, viewport) && !(g.scroller && g.scroller.contains(g.centre.hit))) { fault('covered', `centre hits ${g.centre.hit ? identify(g.centre.hit) : 'nothing'}`); return record; }
    if (!g.scroller) { fault('outside-viewport', `${JSON.stringify(record.box)} in ${screen.width}x${screen.height}`); return record; }
    // Scrolling its container must bring it fully into view with its centre hitting itself; it is sampled there.
    const sc = g.scroller, top = sc.scrollTop, left = sc.scrollLeft, q = clientRect(sc);
    sc.scrollTop += g.r.top + g.r.height / 2 - (q.top + q.bottom) / 2;
    sc.scrollLeft += g.r.left + g.r.width / 2 - (q.left + q.right) / 2;
    const h = geometry(el), ok = !h.cutBy && !h.needsScroll && inside(h.r, viewport) && h.centre.ok;
    if (ok) { record.reach = `scroll ${identify(sc)}`; sample(record, el); }
    sc.scrollTop = top; sc.scrollLeft = left;
    if (!ok) fault('unreachable', `scrolling ${identify(sc)} leaves it at ${JSON.stringify(box(h.r))}${h.centre.ok ? '' : `, centre hits ${h.centre.hit ? identify(h.centre.hit) : 'nothing'}`}`);
    return record;
  });
  return { innerWidth, innerHeight, faults, controls, timing: { sideways: t1 - t0, controls: performance.now() - t1, sampling: controls.reduce((a, c) => a + (c.ms || 0), 0) } };
}
const OVERLAYS = '#options, #searchBox, #tocPanel, #mapPanel, #grid';

async function sweepProfile(browser, engine, width) {
  const profile = width === 'landscape' ? kit.landscape(engine) : kit.phone(engine, width);
  const label = width === 'landscape' ? `landscape ${profile.viewport.width}x${profile.viewport.height}` : String(width);
  const records = [];
  let page = null, loadError = null;
  // A loaded machine can miss the kit's 15 s page load; the context left behind closes with the browser.
  for (let attempt = 0; attempt < 3 && !page; attempt++) page = await kit.openReader(browser, site, profile).catch(error => { loadError = error; return null; });
  if (!page) return [{ engine, width: label, state: 'load', viewport: profile.viewport, faults: [{ kind: 'state', control: null, detail: `reader did not load: ${loadError.message.split('\n')[0]}` }], controls: [] }];
  try {
    await settle(page);
    for (const state of STATES) {
      const record = { engine, width: label, state: state.name, viewport: profile.viewport, faults: [], controls: [] }, t0 = Date.now();
      records.push(record);
      // Reaching a state can time out on a loaded machine; it gets one more try from a fresh load. A layout
      // fault is never retried.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await backToOpening(page);
          await state.enter(page);
          await settle(page);
          expect(await app(page), state.want, `${state.name} reached`);
          record.enterMs = Date.now() - t0;
          record.attempts = attempt;
          const m = await page.evaluate(measure, { sampler: hitSquare.toString(), overlays: OVERLAYS, screen: profile.viewport });
          expect(await app(page), state.want, `${state.name} held while measuring`);
          Object.assign(record, m);
          break;
        } catch (error) {
          const waiting = error.message.match(/waiting for (.*)/);
          if (attempt === 2) record.faults.push({ kind: 'state', control: null, detail: `${error.message.split('\n')[0]}${waiting ? ` (${waiting[1]})` : ''}` });
          await page.reload().then(() => kit.ready(page)).then(() => settle(page)).catch(() => {});
        }
      }
      record.ms = Date.now() - t0;
      if (record.faults.length) await page.screenshot({ path: path.join(evidence, `${engine}-${label.replace(/\W+/g, '-')}-${state.name}.png`) }).catch(() => {});
    }
    for (const message of page.errors) records[0].faults.push({ kind: 'page-error', control: null, detail: message });
  } finally { await page.context().close().catch(() => {}); }
  return records;
}

// A control present at the widest portrait width but gone at a narrower one is unreachable there, unless the
// reader puts another control in its place.
const REPLACED = { '#pageNum': { below: 521, why: 'hidden at 520px and below by design; the page slider and the chapter and page beside it stay' } };
// Faults this sweep found in the reader, each with a failing test in source/phone_tests_faults.js. They print as
// known faults and fail the run only with --strict, so a width passes when nothing else is wrong.
const KNOWN = [
  { id: 'code-scroll', about: 'in plain text the code block scrolls sideways inside its own box, as it did at a1a0610; the page itself does not',
    match: f => f.state === 'plain-text' && f.kind === 'sideways' && /^pre scrollWidth/.test(f.detail) },
];
const knownOf = f => KNOWN.find(k => k.match(f))?.id || null;
function missingControls(records) {
  const portrait = records.filter(r => !r.width.startsWith('landscape'));
  for (const engine of new Set(portrait.map(r => r.engine))) {
    const mine = portrait.filter(r => r.engine === engine), widest = Math.max(...mine.map(r => Number(r.width)));
    for (const ref of mine.filter(r => Number(r.width) === widest && r.controls.length)) {
      for (const r of mine.filter(r => r.state === ref.state && r !== ref && r.controls.length)) {
        const keys = new Set(r.controls.map(c => c.key));
        for (const c of ref.controls) if (!keys.has(c.key) && !(Number(r.width) < REPLACED[c.key]?.below)) r.faults.push({ kind: 'missing', control: c.key, detail: `shown at ${widest}, not rendered at ${r.width}` });
      }
    }
  }
}

(async () => {
  const started = Date.now();
  const before = kit.browserProcesses().length;
  console.log(`browser processes before: ${before}`);
  const records = [];
  try {
    const swept = await Promise.all(engines.map(async engine => {
      const t0 = Date.now(), browser = await kit.launch(engine);
      try { return (await kit.pool(widthsFor(engine), jobs, w => sweepProfile(browser, engine, w))).flat(); }
      finally { await browser.close(); console.log(`${engine} swept ${widthsFor(engine).length} widths in ${((Date.now() - t0) / 1000).toFixed(1)}s`); }
    }));
    records.push(...swept.flat());
  } finally { await kit.closeAll(); }
  missingControls(records);
  if (tapRule === '44') for (const r of records) for (const c of r.controls) if (c.hitSquare44 === 'below') r.faults.push({ kind: 'tap-44', control: c.key, detail: `hit square ${c.hitSquareSide} (bound ${c.hitSquareUpperBound})` });
  const after = kit.browserProcesses().length;
  const seconds = (Date.now() - started) / 1000;
  const strict = !!options.strict;
  const all = records.flatMap(r => r.faults.map(f => ({ engine: r.engine, width: r.width, state: r.state, ...f }))).map(f => ({ ...f, known: knownOf(f) }));
  const failures = all.filter(f => strict || !f.known), known = all.filter(f => f.known);
  fs.writeFileSync(path.join(evidence, 'layout.json'), JSON.stringify({ site: path.resolve(site), tapRule, strict, engines, exceptions: REPLACED, known: KNOWN.map(({ id, about }) => ({ id, about })), knownFaults: known, states: STATES.map(s => s.name), browserProcesses: { before, after }, seconds, failures, records }, null, 2));
  for (const engine of engines) {
    const mine = records.filter(r => r.engine === engine), widths = [...new Set(mine.map(r => r.width))];
    const passed = widths.filter(w => !failures.some(f => f.engine === engine && f.width === w));
    console.log(`\n${engine}: ${passed.length}/${widths.length} widths passed, ${failures.filter(f => f.engine === engine).length} failures`);
    for (const k of KNOWN) {
      const at = [...new Set(known.filter(f => f.engine === engine && f.known === k.id).map(f => f.width))];
      if (at.length && !strict) console.log(`  KNOWN FAULT ${k.id} at ${at.join(', ')}: ${k.about}`);
    }
    for (const f of failures.filter(f => f.engine === engine)) console.log(`  FAIL ${f.width} ${f.state} ${f.kind}${f.control ? ` ${f.control}` : ''}: ${f.detail}`);
    for (const w of widths) {
      const below = new Map();
      for (const r of mine.filter(r => r.width === w)) for (const c of r.controls) if (c.hitSquare44 === 'below') below.set(c.key, Math.max(below.get(c.key) || 0, c.hitSquareSide));
      const uncertain = new Set(mine.filter(r => r.width === w).flatMap(r => r.controls.filter(c => c.hitSquare44 === 'uncertain').map(c => c.key)));
      console.log(`  ${w}: below 44 (${below.size}) ${[...below].map(([k, s]) => `${k} ${s}`).join(', ') || 'none'}${uncertain.size ? `; uncertain ${[...uncertain].join(', ')}` : ''}`);
    }
  }
  console.log(`\nbrowser processes before ${before}, after ${after}; run time ${seconds.toFixed(1)}s; evidence ${path.join(evidence, 'layout.json')}`);
  if (after > before) console.error(`${after - before} browser processes left open`);
  process.exitCode = failures.length || after > before ? 1 : 0;
})().catch(async error => { console.error(error.stack || error.message); await kit.closeAll(); process.exitCode = 1; });
