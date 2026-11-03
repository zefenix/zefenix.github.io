// Opening your own book: Markdown files and a folder through the Library's pickers, a docs page handed over by the
// bookmarklet, and a whole site gathered by the bookmarklet with some of its pages blocked.
// A missing control is the evidence on the released build, so each is asserted before it is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DOCS = 'http://docs.test';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const WIDTHS = { phone: (kit, engine) => kit.phone(engine, 390), desktop: kit => kit.desktop() };

function fixture(evidence, files) {
  fs.mkdirSync(path.join(evidence, 'fixtures'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(evidence, 'fixtures', 'open-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

// The Library: its button beside the book's name, or on a phone, Options then Library.
async function openLibrary(page) {
  if (await page.locator('#libBtn').isVisible()) await page.locator('#libBtn').click();
  else {
    assert(await page.locator('#booksFromOpts').count(), 'Options holds a Library button');
    await page.locator('#optsBtn').click();
    await page.locator('#booksFromOpts').click();
  }
  await page.waitForSelector('#books:not([hidden])');
}

async function pick(page, button, files) {
  assert(await page.locator(button).count(), `the Library offers ${button}`);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 40000 }), page.locator(button).click()]);
  await chooser.setFiles(files);
}

async function opened(page, other) {
  await page.waitForURL(u => /^\?opened=[0-9a-f]{12}$/.test(u.search) && u.search !== other, { timeout: 30000 });
  await page.waitForSelector('#app:not(.loading)', { timeout: 120000 });
  return page.evaluate(() => ({
    search: location.search,
    title: document.title,
    kicker: document.querySelector('#desk .cover .kicker')?.textContent ?? null,
    cover: document.querySelector('#desk .cover h1')?.textContent ?? null,
    chapters: [...document.querySelectorAll('#desk h2')].map(h => h.textContent),
    text: [...document.querySelectorAll('#desk .pagedjs_page')].map(p => p.textContent).join(' ').replace(/\s+/g, ' '),
  }));
}

// Where each sentence sits in the book's pages, or -1 when it is not there.
const places = (text, sentences) => sentences.map(s => text.indexOf(s));
const inOrder = list => list.every((at, i) => at >= 0 && (i === 0 || at > list[i - 1]));

const snap = (page, evidence, id, engine, site) => page.screenshot({ path: path.join(evidence, `${id}-${engine}-${site}.png`) }).catch(() => {});

/* ---------- the docs site, on its own origin ---------- */

const html = (title, h1, para, alt) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${alt ? `<link rel="alternate" type="text/markdown" href="${alt}">` : ''}<meta property="og:site_name" content="Trail Docs"></head>
<body><nav>Menu</nav><main><h1>${h1}</h1><p>${para}</p></main><footer>© 2026 Trail Docs</footer></body></html>`;
const SITE = {
  '/guide/start': { type: 'text/html', body: html('Start · Trail Docs', 'Starting the trail', 'Only the HTML page says this.', '/raw/start-page.md') },
  '/raw/start-page.md': { type: 'text/markdown', body: '# Starting the trail\n\nThe Markdown alternate says hello.\n\n## Packing\n\nBring water and a map.\n' },
  '/guide/install': { type: 'text/html', body: html('Install', 'Installing the trail', 'Install from the HTML.') },
  '/guide/install.md': { type: 'text/markdown', body: '# Installing the trail\n\nInstalling needs boots.\n' },
  '/guide/configure': { type: 'text/html', body: html('Configure', 'Configuring the trail', 'Configure from the HTML.') },
  '/guide/configure.md': { type: 'text/markdown', body: '# Configuring the trail\n\nConfigure the compass before leaving.\n' },
  '/guide/faq': { type: 'text/html', body: html('FAQ', 'Questions on the trail', 'Questions from the HTML.') },
  '/guide/faq.md': { type: 'text/markdown', body: '# Questions on the trail\n\nBears are rare here.\n' },
};
const LLMS = { '/llms.txt': { type: 'text/plain', body: `# Trail Docs Handbook\n\n## Guide\n${[['Start', 'start'], ['Install', 'install'], ['Configure', 'configure'], ['FAQ', 'faq']].map(([t, p]) => `- [${t}](${DOCS}/guide/${p})`).join('\n')}\n` } };

// Routes added after the kit's win, so the docs origin answers here; a blocked path fails as a network error.
async function serveDocs(context, pages, blocked = []) {
  const fetched = [];
  await context.route(u => u.origin === DOCS, route => {
    const p = new URL(route.request().url()).pathname;
    fetched.push(p);
    if (blocked.some(b => p.startsWith(b))) return route.abort('blockedbyclient');
    const hit = pages[p];
    return route.fulfill(hit ? { status: 200, contentType: hit.type, body: hit.body } : { status: 404, contentType: 'text/plain', body: 'Not found' });
  });
  return fetched;
}

// The bookmarklet as the reader offers it, clicked on the docs page as from a bookmarks bar; its popup is the reader.
async function bookmarklet(page) {
  assert(await page.locator('#bmLink').count(), 'the Library offers the bookmarklet');
  const href = await page.locator('#bmLink').getAttribute('href');
  assert.match(href, /^javascript:/, 'the bookmarklet is a javascript: link');
  assert(decodeURIComponent(href.slice('javascript:'.length)).includes('const R = "http://pages-piled.test/"'), 'the bookmarklet opens this reader');
  const docs = await page.context().newPage();
  docs.errors = [];
  docs.on('pageerror', e => docs.errors.push(e.message));
  await docs.goto(`${DOCS}/guide/start`);
  await docs.evaluate(href => { const a = Object.assign(document.createElement('a'), { id: 'pp-bookmark', href, textContent: 'Read in Pages, Piled' }); document.body.prepend(a); }, href);
  // the bookmarklet alerts when the browser blocks its new tab
  const dialogs = [];
  docs.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  const [popup] = await Promise.all([docs.waitForEvent('popup', { timeout: 40000 }), docs.locator('#pp-bookmark').click()]).catch(error => {
    if (dialogs.length) assert.fail(`the bookmarklet opened no reader: ${dialogs.join(' | ')}`);
    throw error;
  });
  popup.errors = [];
  popup.on('pageerror', e => popup.errors.push(e.message));
  assert.match(popup.url(), /^http:\/\/pages-piled\.test\/\?from=bookmarklet$/, 'the bookmarklet opens the reader at ?from=bookmarklet');
  return { docs, popup };
}

// The reader's whole-site message is set just before it leaves for the new book, so every text it shows is kept here.
const recordMessages = () => {
  if (location.origin !== 'http://pages-piled.test') return;
  new MutationObserver(() => {
    const m = document.querySelector('#booksNow .msg');
    if (!m) return;
    const seen = JSON.parse(sessionStorage.getItem('open-msgs') || '[]');
    if (seen.at(-1)?.text !== m.textContent) { seen.push({ text: m.textContent, at: Date.now() }); sessionStorage.setItem('open-msgs', JSON.stringify(seen)); }
  }).observe(document, { childList: true, subtree: true, characterData: true });
};

// The bookmarklet on the start page, then the popup's Library reads the whole site with Install and FAQ blocked.
async function wholeSiteBlocked(page) {
  await page.context().addInitScript(recordMessages);
  const fetched = await serveDocs(page.context(), { ...SITE, ...LLMS }, ['/guide/install', '/guide/faq']);
  const { docs, popup } = await bookmarklet(page);
  const first = await opened(popup);
  assert.deepEqual(first.chapters, ['Starting the trail', 'Packing'], 'the bookmarklet first opens the one page, a chapter for each ## heading');
  await openLibrary(popup);
  const whole = popup.locator('#booksNow button', { hasText: 'Read the whole site as a book' });
  assert(await whole.count(), `the Library offers the whole site: ${await popup.locator('#booksNow').textContent()}`);
  await whole.click();
  const book = await opened(popup, first.search);
  const messages = await popup.evaluate(() => ({ seen: JSON.parse(sessionStorage.getItem('open-msgs') || '[]'), arrived: Math.round(performance.timeOrigin) }));
  return { docs, popup, fetched, book, messages };
}

// Each test makes a book from scratch, so on a loaded machine its steps get more than the kit's 15 seconds.
const variants = (base, make) => Object.keys(WIDTHS).map(width => {
  const test = make(width);
  return { ...test, id: `${base}-${width}`, engines: ['chromium', 'firefox', 'webkit'], profile: WIDTHS[width],
    run: args => { args.page.context().setDefaultTimeout(40000); return test.run(args); } };
});

module.exports = [
  ...variants('open-summary-alone', width => ({
    what: `at ${width} width, a SUMMARY.md picked alone opens as a book of its own text`,
    async run({ page, evidence, assert }) {
      const dir = fixture(evidence, { 'SUMMARY.md': '# Summary\n\n- [One](one.md)\n\nThe list of a book whose chapters stayed behind.\n' });
      try {
        await openLibrary(page);
        await pick(page, '#pickFiles', [path.join(dir, 'SUMMARY.md')]);
        const book = await opened(page);
        assert.deepEqual(book.chapters, ['Summary'], 'the summary is the one chapter');
        assert(book.text.includes('The list of a book whose chapters stayed behind.'), 'its text is set in pages');
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    },
  })),
  ...variants('open-files', width => ({
    what: `at ${width} width, Markdown files picked in the Library open as a book: README first, the rest by name, dotfiles and pictures left out`,
    async run({ page, engine, evidence, site, assert }) {
      const dir = fixture(evidence, {
        'README.md': '# Field Notes\n\nThe readme opens the book.\n',
        'chapter-2.md': '# Second Thoughts\n\nThe second chapter follows the readme.\n',
        'chapter-10.md': 'Tenth notes come last, after the second.\n',
        '.draft.md': '# Draft\n\nThis draft stays hidden.\n',
        'cover.png': PNG,
      });
      try {
        await openLibrary(page);
        await pick(page, '#pickFiles', ['chapter-10.md', '.draft.md', 'cover.png', 'README.md', 'chapter-2.md'].map(f => path.join(dir, f)));
        const book = await opened(page);
        await snap(page, evidence, `open-files-${width}`, engine, site);
        assert.deepEqual({ title: book.title, kicker: book.kicker, cover: book.cover, chapters: book.chapters },
          { title: '3 files · Pages, Piled', kicker: 'From your files', cover: '3 files', chapters: ['Field Notes', 'Second Thoughts', 'chapter-10'] }, 'the book is named for its three files, README first');
        const at = places(book.text, ['The readme opens the book.', 'The second chapter follows the readme.', 'Tenth notes come last, after the second.']);
        assert(inOrder(at), `each file's text is set in pages, in order: ${at}`);
        assert(!book.text.includes('This draft stays hidden.'), 'the dotfile is left out');
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    },
  })),
  ...variants('open-folder', width => ({
    what: `at ${width} width, a folder picked in the Library opens under its name, in its SUMMARY.md's order and titles`,
    async run({ page, engine, evidence, site, assert }) {
      const dir = fixture(evidence, {
        'garden-guide/README.md': 'Start here, with the garden.\n',
        'garden-guide/SUMMARY.md': '# Summary\n\n- [Welcome](README.md)\n- [Watering](water.md)\n- [Soil and beds](beds/soil.md)\n',
        'garden-guide/water.md': 'Water the beds at dawn.\n',
        'garden-guide/beds/soil.md': 'Soil wants compost each spring.\n',
        'garden-guide/.notes/secret.md': 'A hidden note stays out.\n',
        'garden-guide/photo.png': PNG,
      });
      try {
        await openLibrary(page);
        await pick(page, '#pickFolder', path.join(dir, 'garden-guide'));
        const book = await opened(page);
        await snap(page, evidence, `open-folder-${width}`, engine, site);
        assert.deepEqual({ title: book.title, cover: book.cover, chapters: book.chapters },
          { title: 'garden-guide · Pages, Piled', cover: 'garden-guide', chapters: ['Welcome', 'Watering', 'Soil and beds'] }, 'the book takes the folder name and SUMMARY.md sets its order and titles');
        const at = places(book.text, ['Start here, with the garden.', 'Water the beds at dawn.', 'Soil wants compost each spring.']);
        assert(inOrder(at), `each listed file's text is set in pages, in SUMMARY.md's order: ${at}`);
        assert(!book.text.includes('A hidden note stays out.') && !book.text.includes('[Watering]'), 'the dot folder and SUMMARY.md itself are not chapters');
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    },
  })),
  ...variants('open-bookmarklet', width => ({
    what: `at ${width} width, the bookmarklet clicked on a docs page opens it in the reader from its Markdown alternate`,
    async run({ page, engine, evidence, site, assert }) {
      const fetched = await serveDocs(page.context(), SITE);
      const { docs, popup } = await bookmarklet(page);
      const book = await opened(popup);
      await snap(popup, evidence, `open-bookmarklet-${width}`, engine, site);
      assert.deepEqual({ title: book.title, kicker: book.kicker, cover: book.cover, chapters: book.chapters },
        { title: 'Starting the trail · Pages, Piled', kicker: 'Trail Docs', cover: 'Starting the trail', chapters: ['Starting the trail', 'Packing'] },
        "the book is the page, named by its heading and its site, a chapter for each of its Markdown's ## headings");
      assert(book.text.includes('The Markdown alternate says hello.') && book.text.includes('Bring water and a map.'), `the page's Markdown alternate is set in pages: ${book.text.slice(0, 300)}`);
      assert(!book.text.includes('Only the HTML page says this.'), 'the HTML is not used when the Markdown alternate is there');
      assert(fetched.includes('/raw/start-page.md'), `the bookmarklet fetched the alternate: ${fetched}`);
      assert.deepEqual([docs.errors, popup.errors], [[], []], 'no page errors on the docs page or the reader');
    },
  })),
  ...variants('open-site-blocked', width => ({
    what: `at ${width} width, the whole site read through the bookmarklet with two pages blocked says so and opens with the rest`,
    async run({ page, engine, evidence, site, assert }) {
      const { docs, popup, fetched, book, messages } = await wholeSiteBlocked(page);
      await snap(popup, evidence, `open-site-blocked-${width}`, engine, site);
      assert(fetched.includes('/guide/install.md') && fetched.includes('/guide/faq'), `the blocked pages were asked for: ${fetched}`);
      assert(messages.seen.some(m => m.text === 'Setting the first part; 2 pages couldn’t be read…'), `the reader says two pages couldn't be read: ${JSON.stringify(messages.seen)}`);
      assert.deepEqual({ title: book.title, cover: book.cover, chapters: book.chapters },
        { title: 'Trail Docs Handbook · Pages, Piled', cover: 'Trail Docs Handbook', chapters: ['Starting the trail', 'Configuring the trail'] }, 'the site opens as a book of the pages that could be read');
      assert(inOrder(places(book.text, ['The Markdown alternate says hello.', 'Configure the compass before leaving.'])), 'the pages read are set in pages, in the index order');
      assert(!book.text.includes('Installing needs boots.') && !book.text.includes('Bears are rare here.'), 'the blocked pages are not in the book');
      assert.deepEqual([docs.errors, popup.errors], [[], []], 'no page errors on the docs page or the reader');
    },
  })),
  ...variants('fault-open-site-missing', width => ({
    what: `at ${width} width, after the whole site opens without two blocked pages, the reader still says two pages couldn't be read`,
    async run({ page, engine, evidence, site, assert }) {
      const { popup, messages } = await wholeSiteBlocked(page);
      const told = await popup.waitForFunction(() => /2 pages couldn’t be read/.test(document.body.innerText), null, { timeout: 4000 }).then(() => true, () => false);
      await snap(popup, evidence, `fault-open-site-missing-${width}`, engine, site);
      assert(told, 'the opened book says 2 pages couldn’t be read');
    },
  })),
];
