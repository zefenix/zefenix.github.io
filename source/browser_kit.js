// Shared by the phone feature tests and the layout sweep: Playwright from PLAYWRIGHT_CORE, browsers that always
// close, an offline HTTP origin served from a build folder, the silent speech stub and real touch input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const load = process.env.PLAYWRIGHT_CORE ? createRequire(path.resolve(process.env.PLAYWRIGHT_CORE, 'index.js')) : require;
const playwright = load(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const ORIGIN = 'http://pages-piled.test';
const SETTINGS_KEY = 'piled4:settings';
const WEBKIT_PACKAGES = ['libevent-2.1-7t64', 'libgstreamer-plugins-base1.0-0', 'libgstreamer-gl1.0-0', 'libgstreamer-plugins-bad1.0-0', 'libharfbuzz-icu0', 'libmanette-0.2-0', 'libenchant-2-2', 'libhyphen0'];
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function parseArgs(argv = process.argv.slice(2)) {
  const options = {}, positional = [];
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) options[m[1]] = m[2] ?? true; else positional.push(a);
  }
  return { options, positional };
}

// Every browser process Playwright starts runs an executable from its browsers folder.
function browserProcesses() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/ms-playwright/'].filter(Boolean);
  return fs.readdirSync('/proc').filter(p => /^\d+$/.test(p)).flatMap(pid => {
    try {
      const exe = fs.readlinkSync(`/proc/${pid}/exe`);
      return roots.some(r => exe.includes(r)) ? [{ pid: +pid, exe }] : [];
    } catch { return []; }
  });
}

function checkWebkit() {
  const missing = WEBKIT_PACKAGES.filter(name => {
    try { return execFileSync('dpkg-query', ['-W', '-f=${Status}', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) !== 'install ok installed'; }
    catch { return true; }
  });
  if (missing.length) throw new Error(`WebKit refused: these packages must report 'install ok installed': ${missing.join(', ')}`);
}

// Browsers get a fresh HOME and TMPDIR of their own: Firefox cannot make its profile in the sandbox's shared temp folder.
const open = new Set();
let scratchRoot = null;
function scratch() {
  if (!scratchRoot) {
    fs.mkdirSync(path.resolve('.evidence'), { recursive: true });
    scratchRoot = fs.mkdtempSync(path.join(path.resolve('.evidence'), 'browsers-'));
    process.env.TMPDIR = path.join(scratchRoot, 'tmp');
    fs.mkdirSync(process.env.TMPDIR);
  }
  return scratchRoot;
}
async function launch(engine) {
  if (engine === 'webkit') checkWebkit();
  const home = fs.mkdtempSync(path.join(scratch(), `${engine}-`));
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: path.join(home, 'cache'), XDG_CONFIG_HOME: path.join(home, 'config'), TMPDIR: os.tmpdir(),
    MOZ_DISABLE_CONTENT_SANDBOX: '1', MOZ_DISABLE_GMP_SANDBOX: '1', MOZ_DISABLE_RDD_SANDBOX: '1', MOZ_DISABLE_GPU_SANDBOX: '1', MOZ_DISABLE_SOCKET_PROCESS_SANDBOX: '1' };
  const browser = await playwright[engine].launch({ env, chromiumSandbox: false, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  open.add(browser);
  browser.on('disconnected', () => open.delete(browser));
  return browser;
}
async function closeAll() {
  await Promise.all([...open].map(b => b.close().catch(() => {})));
  if (scratchRoot) fs.rmSync(scratchRoot, { recursive: true, force: true });
  scratchRoot = null;
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { closeAll().finally(() => process.exit(130)); });

// Viewport heights are the screen less the browser's own bars, as the rig's phone profiles record them.
const PHONE_HEIGHTS = { 360: 640, 384: 640, 390: 651, 393: 659, 402: 681, 412: 732, 414: 715, 440: 760 };
function phone(engine, width, height = PHONE_HEIGHTS[width] || Math.round(width * 1.67)) {
  const profile = { viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  if (engine === 'firefox') delete profile.isMobile;
  return profile;
}
const landscape = engine => ({ ...phone(engine, 844, 390), viewport: { width: 844, height: 390 } });
const desktop = () => ({ viewport: { width: 1440, height: 900 } });

const speechStub = () => {
  const speech = { current: null, history: [], speaking: true, pending: false, getVoices: () => [], addEventListener() {},
    speak(utterance) { this.current = utterance; this.history.push(utterance.text); },
    cancel() { this.current = null; },
    finish() { const utterance = this.current; this.current = null; utterance.onend(); } };
  window.testSpeech = speech;
  Object.defineProperty(window, 'speechSynthesis', { value: speech });
};

// The page is served from a private HTTP origin out of the build folder; every other request is aborted, so
// Google Fonts and jsDelivr never load and the fallback fonts are used.
async function openReader(browser, site, profile, { settings, storage } = {}) {
  const root = fs.realpathSync(site), engine = browser.browserType().name();
  const context = await browser.newContext({ ...profile, reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block', ...(engine === 'chromium' ? {} : { proxy: { server: 'http://127.0.0.1:9' } }) });
  context.setDefaultTimeout(15000);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === ORIGIN) {
      try {
        const file = fs.realpathSync(path.join(root, decodeURIComponent(url.pathname)));
        if (file.startsWith(root + path.sep) && fs.statSync(file).isFile()) return route.fulfill({ body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
      } catch {}
    }
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(speechStub);
  if (settings || storage) await context.addInitScript(({ key, settings, storage }) => {
    if (sessionStorage.getItem('kit-seeded')) return;
    sessionStorage.setItem('kit-seeded', '1');
    if (settings) localStorage.setItem(key, JSON.stringify(settings));
    for (const [k, v] of Object.entries(storage || {})) localStorage.setItem(k, v);
  }, { key: SETTINGS_KEY, settings, storage });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  await page.goto(`${ORIGIN}/index.html`);
  await ready(page);
  return page;
}
async function ready(page) {
  await page.waitForSelector('#app:not(.loading)', { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  await frames(page);
}
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

// Real touch through the DevTools protocol, so the reader gets touch pointers that can take pointer capture.
// Chromium only; tests that need it say so.
async function touchscreen(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 })) });
  return {
    async tap(x, y) { await send('touchStart', [[x, y]]); await page.waitForTimeout(40); await send('touchEnd', []); await page.waitForTimeout(80); await frames(page); },
    async swipe([x0, y0], [x1, y1], { steps = 10, ms = 160 } = {}) {
      await send('touchStart', [[x0, y0]]);
      for (let i = 1; i <= steps; i++) { await page.waitForTimeout(ms / steps); await send('touchMove', [[x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps]]); }
      await send('touchEnd', []);
      await page.waitForTimeout(80); await frames(page);
    },
  };
}

const box = (page, selector) => page.locator(selector).first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
const settings = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), SETTINGS_KEY);

// Runs tasks with at most `jobs` at a time and keeps their order in the results.
async function pool(items, jobs, run) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await run(items[i], i); }
  }));
  return results;
}

module.exports = { assert, playwright, ORIGIN, SETTINGS_KEY, parseArgs, browserProcesses, checkWebkit, launch, closeAll, phone, landscape, desktop, openReader, ready, frames, touchscreen, box, settings, pool };
