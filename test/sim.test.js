// Run with: npm test  (Node's built-in test runner, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const { N, MAX_TURNS, INV, TEMPLATES, recognise, newBattle, stepBattle, makeCpuPlan, buildSchedule } = require('../sim.js');

/* Build an 8x8 grid from [x, y, shape] cells in board coordinates (Blue owns y >= 4, Orange y < 4). */
function gridOf(blue = [], orange = []) {
  const g = Array.from({ length: N }, () => Array(N).fill(null));
  blue.forEach(([x, y, s]) => { g[y][x] = { s, o: 0 }; });
  orange.forEach(([x, y, s]) => { g[y][x] = { s, o: 1 }; });
  return g;
}
const typesOf = (units, o) => units.filter(u => u.o === o).map(u => u.t + (u.rider ? '*' : '')).sort();

/* ---------- formations ---------- */
test('four squares in a block form one castle', () => {
  const us = recognise(gridOf([[3, 4, 'sq'], [4, 4, 'sq'], [3, 5, 'sq'], [4, 5, 'sq']]));
  assert.deepEqual(typesOf(us, 0), ['cst']);
  assert.equal(us[0].cells.length, 4);
});

test('two squares in a column are a truck, in a row a wall, and a lone square a buggy', () => {
  assert.deepEqual(typesOf(recognise(gridOf([[1, 5, 'sq'], [1, 6, 'sq']])), 0), ['trk']);
  assert.deepEqual(typesOf(recognise(gridOf([[1, 5, 'sq'], [2, 5, 'sq']])), 0), ['wal']);
  assert.deepEqual(typesOf(recognise(gridOf([[1, 5, 'sq']])), 0), ['bug']);
});

test('a buggy takes at most 2 touching triangles as riders; the rest are infantry', () => {
  const us = recognise(gridOf([[3, 5, 'sq'], [2, 5, 'tri'], [4, 5, 'tri'], [3, 6, 'tri']]));
  assert.deepEqual(typesOf(us, 0), ['bug', 'inf', 'inf*', 'inf*']);
  assert.equal(us.find(u => u.t === 'bug').riders, 2);
});

test('a circle touching a castle (diagonals included) is a tower; a lone circle is a turret', () => {
  const castle = [[3, 4, 'sq'], [4, 4, 'sq'], [3, 5, 'sq'], [4, 5, 'sq']];
  assert.deepEqual(typesOf(recognise(gridOf([...castle, [2, 3, 'cir']])), 0), ['cst', 'twr']);
  assert.deepEqual(typesOf(recognise(gridOf([...castle, [0, 7, 'cir']])), 0), ['cst', 'tur']);
});

test('formations are recognised for Orange too, from its own point of view', () => {
  const us = recognise(gridOf([], [[3, 2, 'sq'], [3, 1, 'sq']]));
  assert.deepEqual(typesOf(us, 1), ['trk']);
});

/* ---------- schedule and CPU ---------- */
test('schedule: Blue places 1, then 2 at a time each; 12 blocks per side', () => {
  const sched = buildSchedule();
  assert.deepEqual(sched[0], [0, 1]);
  assert.deepEqual(sched[1], [1, 2]);
  const total = [0, 0];
  sched.forEach(([p, n]) => { total[p] += n; });
  assert.deepEqual(total, [12, 12]);
  sched.slice(1).forEach(([, n]) => assert.ok(n <= 2));
  sched.forEach(([p], i) => { if (i) assert.notEqual(p, sched[i - 1][0]); });
});

test('every CPU template uses exactly the inventory, on distinct cells, in Orange\'s half', () => {
  for (const t of TEMPLATES) {
    const count = { sq: 0, tri: 0, cir: 0 };
    t.forEach(([, , s]) => count[s]++);
    assert.deepEqual(count, INV);
    assert.equal(new Set(t.map(([x, y]) => x + ',' + y)).size, t.length);
    t.forEach(([x, y]) => assert.ok(x >= 0 && x < N && y >= 0 && y < N / 2));
  }
});

test('makeCpuPlan (mirrored or not) stays on the board and in Orange\'s half', () => {
  for (let i = 0; i < 50; i++) makeCpuPlan().forEach(({ x, y }) => assert.ok(x >= 0 && x < N && y >= 0 && y < N / 2));
});

/* ---------- battle rules ---------- */
test('killing a loaded buggy scores damage, +5 per kill and +5 per rider lost with it', () => {
  const blue = [[3, 5, 'sq'], [2, 5, 'tri'], [4, 5, 'tri']];
  const orange = [[3, 2, 'tri'], [0, 5, 'tri'], [6, 5, 'tri']]; // three infantry, each with a clear line to the buggy
  const B = newBattle(gridOf(blue, orange));
  const fx = stepBattle(B);
  assert.equal(B.score[1].d, 3);
  assert.equal(B.score[1].kills, 3); // buggy + 2 riders
  assert.equal(B.score[1].k, 15);
  assert.ok(fx.lines.some(l => /buggy and 2 riders destroyed/.test(l)));
  assert.ok(B.over);
  assert.match(B.why, /Orange wiped out|Blue wiped out/);
});

test('a loaded buggy at the board edge unloads its riders, and logs it once', () => {
  const B = newBattle(gridOf([[3, 0, 'sq'], [2, 0, 'tri'], [4, 0, 'tri']]));
  const fx = stepBattle(B);
  assert.equal(fx.lines.filter(l => /unloads/.test(l)).length, 1);
  assert.equal(fx.fresh.length, 2);
  assert.equal(B.units.find(u => u.t === 'bug').riders, 0);
  assert.equal(B.units.filter(u => u.t === 'inf').length, 2);
});

test('two units that want the same empty cell both wait', () => {
  // Blue truck's front is (3,5)->(3,4); Orange truck's front is (3,3)->(3,4). Same target, so neither moves.
  const B = newBattle(gridOf([[3, 5, 'sq'], [3, 6, 'sq']], [[3, 2, 'sq'], [3, 3, 'sq']]));
  const cells = () => JSON.stringify(B.units.map(u => u.cells));
  const before = cells();
  stepBattle(B);
  assert.equal(cells(), before);
  assert.equal(B.idle, 1);
});

/* ---------- whole battles ---------- */
const flip = t => t.map(([x, y, s]) => [x, N - 1 - y, s]); // an Orange template, mirrored into Blue's half
function playout(blueT, orangeT) {
  const B = newBattle(gridOf(flip(blueT), orangeT));
  while (!B.over) stepBattle(B);
  return B;
}

test('every template pairing finishes within the turn limit with sane scores', () => {
  for (const a of TEMPLATES) for (const b of TEMPLATES) {
    const B = playout(a, b);
    assert.ok(B.over && B.turn <= MAX_TURNS && B.turn > 0);
    B.score.forEach(s => assert.ok(s.d >= 0 && s.k === s.kills * 5));
  }
});

test('the battle is deterministic: the same layouts always give the same result', () => {
  const run = () => { const B = playout(TEMPLATES[0], TEMPLATES[1]); return JSON.stringify([B.turn, B.score, B.why]); };
  assert.equal(run(), run());
});
