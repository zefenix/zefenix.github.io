// What every shelf test shares: the site and engine from argv, Playwright from PLAYWRIGHT_CORE, and the build
// folder served at http://pp.test/pages-piled/ with every other request aborted.
// Usage: node source/shelf_tests/NAME.js SITE_DIRECTORY [chromium|webkit|firefox]
const path = require('node:path'), fs = require('node:fs');
const pw = require(path.join(process.env.PLAYWRIGHT_CORE, 'index.js'));

const site = process.argv[2], engine = process.argv[3] || 'chromium';
if (!site) throw new Error('Usage: node source/shelf_tests/NAME.js SITE_DIRECTORY [chromium|webkit|firefox]');
const TYPES = { '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

// the sandbox this runs in has no room for Chromium's own sandbox; the other engines ignore the option
const launch = () => pw[engine].launch({ chromiumSandbox: false });
const route = ctx => ctx.route('**/*', r => {
  const u = new URL(r.request().url());
  if (u.host !== 'pp.test') return r.abort();
  let f = path.join(site, decodeURIComponent(u.pathname).replace(/^\/pages-piled\//, '') || 'index.html');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(site, 'index.html');
  return r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || 'text/html' });
});

// The reader has set its pages, and the browser draws again: on a busy machine WebKit can go tens of seconds
// after loading before its next frame, and input sent before then lands on a page that has not moved yet.
const loaded = async p => {
  await p.waitForFunction(() => !document.querySelector('.app').classList.contains('loading'), null, { timeout: 120000 });
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
};

// On a busy machine a page's move can start late, so a step that moves the pages also waits for them to stop.
const settled = p => p.waitForFunction(() => [...document.querySelectorAll('#desk .pagedjs_page')].every(x => !x.getAnimations().some(a => a.playState === 'running')), null, { timeout: 10000 }).catch(() => {});

module.exports = { site, engine, launch, route, loaded, settled };
