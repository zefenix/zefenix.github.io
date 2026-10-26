#!/usr/bin/env node
// Feature tests for the phone design and text round since a1a0610. Each test runs in a fresh context on the
// candidate build and, with --baseline, on the released build, where it is expected to fail. A test marked
// `fault` shows a reader fault: it is expected to fail on the candidate until the reader is fixed.
const fs = require('node:fs');
const path = require('node:path');
const kit = require('./browser_kit');

const { options, positional } = kit.parseArgs();
const MODULES = { bars: './phone_tests_bars', reading: './phone_tests_reading', faults: './phone_tests_faults' };
const TESTS = (options.module ? options.module.split(',') : Object.keys(MODULES)).flatMap(m => require(MODULES[m]));
const [target] = positional;
if (!target) throw new Error('Usage: node source/check_phone.js SITE_DIRECTORY [--baseline=SITE_DIRECTORY] [--module=bars,reading,faults] [--only=id,id] [--jobs=4] [--evidence=DIRECTORY]');
const only = options.only ? new Set(options.only.split(',')) : null;
const jobs = Number(options.jobs) || 4;
const evidence = path.resolve(options.evidence || '.evidence/phone');
fs.mkdirSync(evidence, { recursive: true });

const ids = new Set();
for (const t of TESTS) { if (ids.has(t.id)) throw new Error(`Duplicate test id ${t.id}`); ids.add(t.id); }
const selected = TESTS.filter(t => !only || only.has(t.id));
if (only) for (const id of only) if (!ids.has(id)) throw new Error(`No test named ${id}`);

async function runSite(name, site) {
  const engines = [...new Set(selected.flatMap(t => t.engines || ['chromium']))];
  const results = [];
  for (const engine of engines) {
    const browser = await kit.launch(engine);
    try {
      const mine = selected.filter(t => (t.engines || ['chromium']).includes(engine));
      results.push(...await kit.pool(mine, jobs, async test => {
        const started = Date.now();
        let page;
        try {
          const profile = test.profile ? test.profile(kit, engine) : kit.phone(engine, 390);
          page = await kit.openReader(browser, site, profile, { settings: test.settings, storage: test.storage });
          await test.run({ page, engine, kit, assert: kit.assert, site: name, evidence, touch: engine === 'chromium' ? await kit.touchscreen(page) : null });
          kit.assert.deepEqual(page.errors, [], 'No page errors');
          return { id: test.id, engine, site: name, ok: true, ms: Date.now() - started };
        } catch (error) {
          return { id: test.id, engine, site: name, ok: false, assertion: error.code === 'ERR_ASSERTION', ms: Date.now() - started, error: error.message.split('\n').slice(0, 20).join(' | ') };
        } finally { if (page) await page.context().close().catch(() => {}); }
      }));
    } finally { await browser.close(); }
  }
  return results;
}

(async () => {
  const before = kit.browserProcesses().length;
  const sites = [['head', target], ...(options.baseline ? [['baseline', options.baseline]] : [])];
  const all = [];
  try { for (const [name, site] of sites) all.push(...await runSite(name, site)); }
  finally { await kit.closeAll(); }
  const after = kit.browserProcesses().length;
  const problems = [];
  for (const r of all) {
    const test = TESTS.find(t => t.id === r.id);
    // a fault, and a baseline's missing feature, show only through a failed assertion; a timeout or a script error is a broken run, not the evidence
    const expected = test.fault ? r.site !== 'head' || (!r.ok && r.assertion) : r.site === 'head' ? r.ok : (!r.ok && r.assertion) || (r.ok && !!test.baselineMayPass);
    console.log(`${test.fault && r.site === 'head' && !r.ok && r.assertion ? 'FAULT' : r.ok ? 'PASS' : 'FAIL'} ${r.site} ${r.engine} ${r.id} (${(r.ms / 1000).toFixed(1)}s)${r.ok ? '' : `: ${r.error}`}`);
    if (!expected) problems.push(`${r.site} ${r.engine} ${r.id} ${test.fault ? 'passes: the fault is fixed, so drop its fault mark' : r.ok ? 'passed but should fail on the baseline' : r.site === 'baseline' ? 'failed without a failed assertion, so it shows nothing about the baseline' : 'failed'}`);
  }
  const isFault = r => !!TESTS.find(t => t.id === r.id).fault;
  const count = (site, ok) => all.filter(r => r.site === site && r.ok === ok && !(site === 'head' && isFault(r))).length;
  const faults = all.filter(r => r.site === 'head' && isFault(r) && !r.ok).map(r => r.id);
  const summary = { head: { pass: count('head', true), fail: count('head', false), faults }, ...(options.baseline ? { baseline: { pass: count('baseline', true), fail: count('baseline', false) } } : {}), browserProcesses: { before, after }, results: all };
  fs.writeFileSync(path.join(evidence, 'phone-results.json'), JSON.stringify(summary, null, 2));
  console.log(`head ${summary.head.pass} pass, ${summary.head.fail} fail, ${faults.length} reader faults shown${summary.baseline ? `; baseline ${summary.baseline.pass} pass, ${summary.baseline.fail} fail` : ''}; browser processes before ${before}, after ${after}`);
  for (const p of problems) console.error(`PROBLEM ${p}`);
  if (after > before) problems.push(`${after - before} browser processes left open`);
  process.exitCode = problems.length ? 1 : 0;
})().catch(async error => { console.error(error.stack || error.message); await kit.closeAll(); process.exitCode = 1; });
