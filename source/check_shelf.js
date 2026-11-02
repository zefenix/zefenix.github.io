#!/usr/bin/env node
// The shelf's feature tests: each file in source/shelf_tests runs as its own child process per engine, with a HOME
// and TMPDIR of its own and a time limit, and its output kept in the evidence folder. A test×engine marked in FAULTS
// shows a reader fault: it is expected to fail through a failed assertion until the reader is fixed.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const kit = require('./browser_kit');

const TESTS = ['backfwd', 'dial', 'dockfit', 'findmore', 'gngp', 'hideshelf', 'keyspage', 'libclick', 'libkeys', 'listenparts', 'outlinefind', 'readouts', 'searchkeys', 'striprest', 'swipeup', 'trace', 'zen'];
const ENGINES = ['chromium', 'webkit', 'firefox'];
// These time key pairs by the events' own stamps (g n within 500 ms, c c within 300 ms). With other browsers of this
// run beside them the pairs split on this machine, so they run one at a time after the rest.
const ALONE = new Set(['gngp', 'findmore']);
// 'test engine': 'the reader fault, in one line'. None is known on f69acf9 or d89c52f.
const FAULTS = {
};

const { options, positional } = kit.parseArgs();
const [target] = positional;
if (!target) throw new Error('Usage: node source/check_shelf.js SITE_DIRECTORY [--engines=chromium,webkit,firefox] [--jobs=N] [--only=name,name] [--limit=SECONDS] [--evidence=DIRECTORY]');
const site = fs.realpathSync(target);
const engines = options.engines ? options.engines.split(',') : ENGINES;
const only = options.only ? options.only.split(',') : TESTS;
for (const e of engines) if (!ENGINES.includes(e)) throw new Error(`No engine named ${e}`);
for (const t of only) if (!TESTS.includes(t)) throw new Error(`No test named ${t}`);
for (const key of Object.keys(FAULTS)) { const [t, e] = key.split(' '); if (!TESTS.includes(t) || !ENGINES.includes(e)) throw new Error(`FAULTS names no test×engine: ${key}`); }
// Measured on this 12-core machine at a load average of 23 to 45 from other suites: 1 job cannot finish inside an
// hour (the children's own times add up to 4,500 s); 2 jobs took 2,213 s and 3 took 1,533 s, and in both only the
// key-pair tests (now ALONE) and one WebKit step racing the reader's own relayout (now waited for) failed.
const jobs = Number(options.jobs) || 3;
const limit = 1000 * (Number(options.limit) || 900);
const evidence = path.resolve(options.evidence || '.evidence/shelf');
fs.mkdirSync(evidence, { recursive: true });
if (engines.includes('webkit')) kit.checkWebkit();

const scratch = fs.mkdtempSync(path.join(evidence, 'homes-'));
const ours = () => kit.browserProcesses().filter(({ pid }) => {
  try { return fs.readFileSync(`/proc/${pid}/environ`, 'utf8').includes(`HOME=${scratch}/`); } catch { return false; }
});

function runOne({ test, engine }) {
  const home = fs.mkdtempSync(path.join(scratch, `${test}-${engine}-`));
  fs.mkdirSync(path.join(home, 'tmp'));
  const env = { ...process.env, HOME: home, TMPDIR: path.join(home, 'tmp'), XDG_CACHE_HOME: path.join(home, 'cache'), XDG_CONFIG_HOME: path.join(home, 'config'),
    MOZ_DISABLE_CONTENT_SANDBOX: '1', MOZ_DISABLE_GMP_SANDBOX: '1', MOZ_DISABLE_RDD_SANDBOX: '1', MOZ_DISABLE_SOCKET_PROCESS_SANDBOX: '1' };
  const started = Date.now();
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, 'shelf_tests', `${test}.js`), site, engine], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', timedOut = false;
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    // SIGTERM first, so Playwright closes its browsers; SIGKILL if it will not go
    const term = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 10000).unref(); }, limit);
    child.on('close', code => {
      clearTimeout(term);
      const ms = Date.now() - started;
      fs.writeFileSync(path.join(evidence, `${test}.${engine}.log`), `${out}${timedOut ? `\nTIMEOUT after ${limit / 1000}s\n` : ''}exit ${code}\n`);
      fs.rmSync(home, { recursive: true, force: true });
      const failed = out.split('\n').filter(l => /^FAIL |^CRASH/.test(l));
      resolve({ test, engine, ok: code === 0 && !timedOut, assertion: !timedOut && failed.length > 0 && !/^CRASH|^Node\.js v\d/m.test(out), ms, error: timedOut ? `timed out after ${limit / 1000}s` : failed.join(' | ').slice(0, 2000) || out.trim().split('\n').slice(-6).join(' | ') });
    });
  });
}

(async () => {
  const before = kit.browserProcesses().length;
  const runs = only.flatMap(test => engines.map(engine => ({ test, engine })));
  const started = Date.now();
  const report = async run => {
    const r = await runOne(run);
    const fault = FAULTS[`${r.test} ${r.engine}`];
    r.status = fault && !r.ok && r.assertion ? 'FAULT' : r.ok ? 'PASS' : 'FAIL';
    console.log(`${r.status} ${r.engine} ${r.test} (${(r.ms / 1000).toFixed(1)}s)${r.ok ? '' : `: ${r.error}`}${r.status === 'FAULT' ? ` [${fault}]` : ''}`);
    return r;
  };
  const all = [...await kit.pool(runs.filter(r => !ALONE.has(r.test)), jobs, report), ...await kit.pool(runs.filter(r => ALONE.has(r.test)), 1, report)];
  const left = ours();
  for (const { pid } of left) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  fs.rmSync(scratch, { recursive: true, force: true });
  const after = kit.browserProcesses().length;
  const problems = [];
  for (const r of all) {
    const fault = FAULTS[`${r.test} ${r.engine}`];
    // a fault shows only through a failed assertion; a timeout or a crash is a broken run, not the evidence
    if (fault && r.ok) problems.push(`${r.engine} ${r.test} passes: the fault is fixed, so drop its mark in FAULTS`);
    else if (r.status === 'FAIL') problems.push(`${r.engine} ${r.test} failed${fault ? ' without a failed assertion, so it shows nothing about the fault' : ''}`);
  }
  if (left.length) problems.push(`${left.length} browser processes of this run were left open, and were killed`);
  const count = s => all.filter(r => r.status === s).length;
  const summary = { pass: count('PASS'), fail: count('FAIL'), faults: all.filter(r => r.status === 'FAULT').map(r => `${r.test} ${r.engine}`), jobs, seconds: Math.round((Date.now() - started) / 1000), browserProcesses: { before, after, leftByThisRun: left.length }, results: all };
  fs.writeFileSync(path.join(evidence, 'shelf-results.json'), JSON.stringify(summary, null, 2));
  console.log(`${summary.pass} pass, ${summary.fail} fail, ${summary.faults.length} reader faults shown, ${summary.seconds}s with ${jobs} jobs; browser processes before ${before}, after ${after} (this run left ${left.length})`);
  for (const p of problems) console.error(`PROBLEM ${p}`);
  process.exitCode = problems.length ? 1 : 0;
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
