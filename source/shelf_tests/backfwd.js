// r and R: back and forward through the jumps, as a browser's Back and Forward.
const path = require('path'), fs = require('fs');
const { site, engine, launch, route, loaded } = require('./common');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  — got ' + JSON.stringify(got)}`); };
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await route(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://pp.test/pages-piled/');
  await loaded(p);
  const pg = () => p.evaluate(() => +document.getElementById('pageNum').value);
  const k = async (key, ms = 500) => { await p.keyboard.press(key); await p.waitForTimeout(ms); };
  const goto = async n => { await p.fill('#pageNum', String(n)); await p.keyboard.press('Enter'); await p.waitForTimeout(600); };
  await goto(5); await goto(10); await goto(15);
  ok('three jumps: at 15', await pg() === 15, await pg());
  await k('r'); ok('r: back to 10', await pg() === 10, await pg());
  await k('r'); ok('r: back to 5', await pg() === 5, await pg());
  await k('R'); ok('R: forward to 10', await pg() === 10, await pg());
  await k('R'); ok('R: forward to 15', await pg() === 15, await pg());
  await k('R'); ok('R with nothing ahead stays', await pg() === 15, await pg());
  await k('r'); await k('r'); await goto(20);
  await k('R'); ok('a new jump drops the places ahead', await pg() === 20, await pg());
  await k('r'); ok('r from 20: back to 5', await pg() === 5, await pg());
  console.log(`${fails ? fails + ' FAILED' : 'all passed'} · page errors: ${errs.join(' | ') || 'none'}`);
  await b.close();
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.log('CRASH', String(e.stack || e).slice(0, 600)); process.exit(1); });
