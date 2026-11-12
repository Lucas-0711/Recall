#!/usr/bin/env node
/* Unit tests for the pure parts of index.html (parsers + scheduler).
   Run:  node tests/run.js
   The code under test is cut straight out of index.html, so there is no build step to drift. */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cut = (from, to) => { const i = html.indexOf(from), j = html.indexOf(to, i); assert(i >= 0 && j > i, 'marker missing: ' + from); return html.slice(i, j); };

const DAY = 86400000, MIN = 60000;
const dayNum = (ts = Date.now()) => Math.floor((ts - 4 * 3600000) / DAY); // 4 am rollover, UTC for determinism
const S = { conf: { learnSteps: [1, 10], relearnSteps: [10], maxIvl: 36500, retention: 0.9 } };

const parsers = new Function(cut('/* ---------- CSV / TXT ---------- */', "if (typeof module !== 'undefined')") + '; return { parseDelimited };')();
const sched = new Function('S', 'dayNum', 'DAY', 'MIN', cut('/* ---------------- scheduler (FSRS-6', 'function fmtIvl(') + '; return { FSRS, memState, fuzz, schedule };')(S, dayNum, DAY, MIN);
const tmpl = new Function('esc', cut('/* Character-level comparison', 'const CARD_BASE_CSS') + '; return { typeCompare };')(s => String(s));
const { FSRS, memState, fuzz, schedule } = sched, { parseDelimited } = parsers;

let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; } };
const near = (a, b, eps, msg) => assert(Math.abs(a - b) <= eps, `${msg}: got ${a}, want ${b}`);

/* ---- FSRS-6 memory model, checked against ts-fsrs 6.0.0 (default weights) ----
   rows: [days since last review, grade, stability, difficulty, interval@90%, interval@80%] */
const REF = [
  [[0, 3, 2.3065, 2.11810397, 2, 8], [0, 3, 2.3065, 2.11121424, 2, 8], [2, 3, 10.97104786, 2.1043314, 11, 36], [6, 2, 24.36562295, 4.74371562, 24, 81], [10, 1, 1.96416933, 8.25752343, 2, 7], [0, 3, 1.97412617, 8.24449428, 2, 7], [1, 4, 4.88155817, 7.64311445, 5, 16]],
  [[0, 1, 0.212, 6.4133, 1, 1], [0, 1, 0.08335672, 8.80630447, 1, 1], [0, 3, 0.10314065, 8.79272653, 1, 1], [1, 3, 0.69525471, 8.77916217, 1, 2], [3, 4, 4.61710493, 8.35644342, 5, 15], [30, 3, 19.06758476, 8.34331535, 19, 63]],
  [[0, 4, 8.2956, 1, 8, 28], [8, 3, 38.90515015, 1, 39, 129], [25, 3, 120.64925688, 1, 121, 400], [80, 1, 4.24782745, 7.02698957, 4, 14], [1, 3, 6.43852568, 7.01519095, 6, 21], [400, 2, 39.87616336, 8.00377303, 40, 132]],
];
REF.forEach((seq, k) => test('FSRS matches reference, sequence ' + k, () => {
  let m = null;
  seq.forEach(([t, g, s, d, i90, i80], i) => {
    m = FSRS.step(m, t, g);
    near(m.s, s, 1e-4, `seq ${k} step ${i} stability`);
    near(m.d, d, 1e-4, `seq ${k} step ${i} difficulty`);
    assert.strictEqual(Math.max(1, Math.round(FSRS.interval(m.s, 0.9))), i90, `seq ${k} step ${i} interval@90`);
    assert.strictEqual(Math.max(1, Math.round(FSRS.interval(m.s, 0.8))), i80, `seq ${k} step ${i} interval@80`);
  });
}));
test('retrievability is 90% after one stability', () => near(FSRS.retr(10, 10), 0.9, 1e-9, 'R(S,S)'));

/* ---- card scheduling ---- */
const T0 = Date.UTC(2026, 0, 10, 12);
const fresh = () => ({ id: 1700000000000, nid: 1, did: 1, ord: 0, type: 0, queue: 0, due: 0, ivl: 0, reps: 0, lapses: 0, step: 0 });
test('new card walks the learning steps, then graduates', () => {
  let c = schedule(fresh(), 3, T0);
  assert.deepStrictEqual([c.type, c.step, c.due - T0], [1, 1, 10 * MIN]);
  c = schedule(c, 3, T0 + 10 * MIN);
  assert.strictEqual(c.type, 2); assert(c.ivl >= 1 && c.ivl <= 4, 'graduating interval ' + c.ivl);
  assert(c.s > 0 && c.d >= 1 && c.last === T0 + 10 * MIN && !('ease' in c));
});
test('Again on a new card restarts at the first step; Easy graduates at once', () => {
  const a = schedule(fresh(), 1, T0); assert.deepStrictEqual([a.type, a.step, a.due - T0], [1, 0, MIN]);
  const e = schedule(fresh(), 4, T0); assert.strictEqual(e.type, 2); assert(e.ivl >= 6, 'easy interval ' + e.ivl);
});
test('review: intervals are ordered Hard < Good < Easy and a lapse relearns', () => {
  const c = { ...fresh(), type: 2, ivl: 10, s: 10, d: 5, last: T0 - 10 * DAY, due: T0, reps: 5 };
  const [a, h, g, e] = [1, 2, 3, 4].map(x => schedule(c, x, T0));
  assert(h.ivl < g.ivl && g.ivl < e.ivl, `${h.ivl} ${g.ivl} ${e.ivl}`);
  assert(g.ivl > 10, 'Good should grow the interval');
  assert.deepStrictEqual([a.type, a.lapses, a.due - T0], [3, 1, 10 * MIN]);
  assert(a.s < c.s, 'stability drops after a lapse');
  const back = schedule(a, 3, T0 + 10 * MIN); assert.strictEqual(back.type, 2); assert(back.ivl < 10);
});
test('higher desired retention gives shorter intervals; max interval is respected', () => {
  const c = { ...fresh(), type: 2, ivl: 50, s: 50, d: 5, last: T0 - 50 * DAY, due: T0, reps: 5 };
  const at = r => { S.conf.retention = r; return schedule(c, 3, T0).ivl; };
  const lo = at(0.8), hi = at(0.95); S.conf.retention = 0.9;
  assert(hi < lo, `${hi} !< ${lo}`);
  S.conf.maxIvl = 30; assert(schedule(c, 4, T0).ivl <= 30); S.conf.maxIvl = 36500;
});
test('old SM-2 cards convert: stability ≈ interval, difficulty in range', () => {
  const m = memState({ type: 2, ivl: 20, ease: 2.5 });
  near(m.s, 20, 1e-9, 'stability'); assert(m.d >= 1 && m.d <= 10);
  assert(memState({ type: 2, ivl: 20, ease: 1.3 }).d > m.d, 'low ease = harder');
  assert.strictEqual(memState({ type: 0 }), null);
  const n2 = schedule({ ...fresh(), type: 2, ivl: 20, ease: 2.5, due: T0, reps: 3 }, 3, T0);
  assert(n2.ivl > 20 && n2.s > 20);
});
test('fuzz stays near the interval, is deterministic, and never shortens below elapsed+1', () => {
  for (let i = 1; i < 400; i++) for (const seed of [1, 7, 12345]) {
    const f = fuzz(i, seed, 0);
    assert(f >= 1 && Math.abs(f - i) <= 2 + i * 0.16, `fuzz(${i})=${f}`);
    assert.strictEqual(f, fuzz(i, seed, 0));
  }
  assert(fuzz(10, 3, 9) >= 10);
});

/* ---- text import ---- */
test('plain CSV: front, back, tags; quoted newlines and commas', () => {
  const r = parseDelimited('a,b,t1 t2\n"x, y","line1\nline2"\n');
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual([r[0].front, r[0].back, r[0].tags], ['a', 'b', 't1 t2']);
  assert.deepStrictEqual(r[1].flds, ['x, y', 'line1\nline2']);
});
test('Anki headers: separator, html:false, notetype/deck/tags columns', () => {
  const r = parseDelimited('#separator:tab\n#html:false\n#notetype column:1\n#deck column:2\n#tags column:5\nCloze\tBio::Cells\t{{c1::a}} < b\textra\tx y\n');
  assert.deepStrictEqual(r[0], { flds: ['{{c1::a}} &lt; b', 'extra'], front: '{{c1::a}} &lt; b', back: 'extra', tags: 'x y', deck: 'Bio::Cells', notetype: 'Cloze' });
});
test('a "#" line after the header block is data, not a comment', () => {
  const r = parseDelimited('#separator:comma\na,b\n#1 rule,answer\n');
  assert.strictEqual(r[1].front, '#1 rule');
});

/* ---- typed-answer diff ---- */
test('typed answer comparison', () => {
  assert(/✓/.test(tmpl.typeCompare(' Paris ', 'paris')));
  const d = tmpl.typeCompare('Pariz', 'Paris');
  assert(/class="bad">z</.test(d) && /class="miss">s</.test(d) && /class="ok">P</.test(d));
});

console.log(process.exitCode ? 'some tests failed' : `${n} tests passed`);
