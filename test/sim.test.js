// Run with: npm test  (Node's built-in test runner, no dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const { W, H, HALF, inHalf, MAX_TURNS, INV, INV_TOTAL, DEFENCE, TEMPLATES, recognise, canMount, newBattle, stepBattle, makeCpuPlan, buildSchedule } = require('../sim.js');

/* Build an empty-board grid from [x, y, shape] cells in board coordinates (Blue owns the bottom HALF rows, Orange the top). A 4th element 'm' on a circle mounts it on the square already there. */
function gridOf(blue = [], orange = []) {
  const g = Array.from({ length: H }, () => Array(W).fill(null));
  const put = o => ([x, y, s, m]) => { if (m) g[y][x].m = true; else g[y][x] = { s, o }; }; // [x, y, 'cir', 'm'] = circle on top of the square at x,y
  blue.forEach(put(0));
  orange.forEach(put(1));
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

test('a circle on its own cell is a mine, even right next to a castle', () => {
  const castle = [[3, 4, 'sq'], [4, 4, 'sq'], [3, 5, 'sq'], [4, 5, 'sq']];
  assert.deepEqual(typesOf(recognise(gridOf([...castle, [2, 3, 'cir']])), 0), ['cst', 'mine']);
  assert.deepEqual(typesOf(recognise(gridOf([...castle, [0, 7, 'cir']])), 0), ['cst', 'mine']);
});

test('a circle on top of a lone square makes a turret; the square is no longer a buggy', () => {
  const us = recognise(gridOf([[3, 5, 'sq'], [3, 5, 'cir', 'm']]));
  assert.deepEqual(typesOf(us, 0), ['tur']);
  assert.equal(us[0].hp, 3);
});

test('a turret is never absorbed into a truck or wall by neighbouring squares', () => {
  const us = recognise(gridOf([[3, 5, 'sq'], [3, 5, 'cir', 'm'], [4, 5, 'sq'], [3, 6, 'sq']]));
  assert.deepEqual(typesOf(us, 0), ['bug', 'bug', 'tur']);
});

test('a circle on top of a castle square is a tower mounted on the castle, not a unit of its own', () => {
  const us = recognise(gridOf([[3, 4, 'sq'], [4, 4, 'sq'], [3, 5, 'sq'], [4, 5, 'sq'], [3, 4, 'cir', 'm']]));
  assert.deepEqual(typesOf(us, 0), ['cst']);
  assert.deepEqual(us[0].mounts.map(m => m.cell), [[3, 4]]);
});

test('canMount: castle squares and lone squares only, once each', () => {
  const g = gridOf([[3, 4, 'sq'], [4, 4, 'sq'], [3, 5, 'sq'], [4, 5, 'sq'], [0, 7, 'sq'], [6, 6, 'sq'], [7, 6, 'sq'], [6, 7, 'cir'], [1, 7, 'tri']]);
  assert.ok(canMount(g, 3, 4), 'castle square');
  assert.ok(canMount(g, 0, 7), 'lone square');
  assert.ok(!canMount(g, 6, 6), 'wall square');
  assert.ok(!canMount(g, 6, 7), 'a circle');
  assert.ok(!canMount(g, 1, 7), 'a triangle');
  assert.ok(!canMount(g, 2, 2), 'empty cell');
  g[4][3].m = true;
  assert.ok(!canMount(g, 3, 4), 'already carrying a circle');
});

test('formations are recognised for Orange too, from its own point of view', () => {
  const us = recognise(gridOf([], [[3, 2, 'sq'], [3, 1, 'sq']]));
  assert.deepEqual(typesOf(us, 1), ['trk']);
});

test('the board is 8 wide and 10 tall: each side owns its own 5 rows and nobody owns neither', () => {
  assert.equal(W, 8);
  assert.equal(H, 10);
  const rows = o => Array.from({ length: H }, (_, y) => y).filter(y => inHalf(o, y));
  assert.deepEqual(rows(0), [5, 6, 7, 8, 9]);
  assert.deepEqual(rows(1), [0, 1, 2, 3, 4]);
});

/* ---------- schedule and CPU ---------- */
test('schedule: Blue places 1, then 2 at a time each; every block per side', () => {
  const sched = buildSchedule();
  assert.deepEqual(sched[0], [0, 1]);
  assert.deepEqual(sched[1], [1, 2]);
  const total = [0, 0];
  sched.forEach(([p, n]) => { total[p] += n; });
  assert.deepEqual(total, [INV_TOTAL, INV_TOTAL]);
  sched.slice(1).forEach(([, n]) => assert.ok(n <= 2));
  sched.forEach(([p], i) => { if (i) assert.notEqual(p, sched[i - 1][0]); });
});

test('every CPU template uses exactly the inventory, with mounts landing on its own squares, in Orange\'s half', () => {
  for (const t of TEMPLATES) {
    const count = { sq: 0, tri: 0, cir: 0 };
    t.forEach(([, , s]) => count[s]++);
    assert.deepEqual(count, INV);
    const placed = t.filter(e => !e[3]);
    assert.equal(new Set(placed.map(([x, y]) => x + ',' + y)).size, placed.length);
    t.filter(e => e[3]).forEach(([x, y], i) => {
      assert.ok(t.some(([sx, sy, ss], j) => ss === 'sq' && sx === x && sy === y && j < t.findIndex(e => e[0] === x && e[1] === y && e[3])), 'mount needs its square placed first');
    });
    t.forEach(([x, y]) => assert.ok(x >= 0 && x < W && y >= 0 && y < HALF));
  }
});

test('every template builds the units it was designed around (castle towers, turrets, mines)', () => {
  const kinds = t => { const g = gridOf([], t); return recognise(g).filter(u => u.o === 1).map(u => u.t + (u.mounts ? 'x' + u.mounts.length : '')); };
  assert.ok(kinds(TEMPLATES[0]).includes('cstx2'));
  for (const t of TEMPLATES.slice(1, 4)) assert.ok(kinds(t).includes('tur'));
  assert.ok(kinds(TEMPLATES[4]).includes('pln'));
  TEMPLATES.slice(0, 4).forEach(tp => assert.ok(!kinds(tp).includes('pln'), 'only the plane template should form a plane'));
  for (const t of TEMPLATES) assert.ok(kinds(t).includes('mine'));
});

test('makeCpuPlan (mirrored or not) stays on the board and in Orange\'s half', () => {
  for (let i = 0; i < 50; i++) makeCpuPlan().forEach(({ x, y, m }) => { assert.ok(x >= 0 && x < W && y >= 0 && y < HALF); assert.equal(typeof m, 'boolean'); });
});

/* ---------- battle rules ---------- */
test('killing a loaded buggy scores damage, +5 per kill and +5 per rider lost with it', () => {
  // A buggy has 3 HP and takes half damage, so it needs 6 raw damage in one turn: Orange's castle brings two
  // 2-damage towers (front corners, 3 cells out) and three infantry each have a clear line. 2+2+1+1+1 = 7 raw = 3.5 taken.
  const blue = [[3, 4, 'sq'], [2, 4, 'tri'], [4, 4, 'tri']];
  const orange = [[3, 0, 'sq'], [4, 0, 'sq'], [3, 1, 'sq'], [4, 1, 'sq'], [3, 1, 'cir', 'm'], [4, 1, 'cir', 'm'], [3, 2, 'tri'], [0, 4, 'tri'], [6, 4, 'tri']];
  const B = newBattle(gridOf(blue, orange));
  const fx = stepBattle(B);
  assert.equal(B.score[1].d, 3); // only the 3 HP it had
  assert.equal(B.score[1].kills, 3); // buggy + 2 riders
  assert.equal(B.score[1].k, 15);
  assert.ok(fx.lines.some(l => /buggy and 2 riders destroyed/.test(l)));
});

test('a loaded buggy at the board edge unloads its riders, and logs it once', () => {
  const B = newBattle(gridOf([[3, 0, 'sq'], [2, 0, 'tri'], [4, 0, 'tri']]));
  const fx = stepBattle(B);
  assert.equal(fx.lines.filter(l => /unloads/.test(l)).length, 1);
  assert.equal(fx.fresh.length, 2);
  assert.equal(B.units.find(u => u.t === 'bug').riders, 0);
  assert.equal(B.units.filter(u => u.t === 'inf').length, 2);
});

test('two enemy vehicles facing each other across a one-cell gap collide instead of waiting for ever', () => {
  // Blue truck's front is (3,5)->(3,4); Orange truck's front is (3,3)->(3,4). Same target cell, so neither moves in, but each hits the other.
  const B = newBattle(gridOf([[3, 5, 'sq'], [3, 6, 'sq']], [[3, 2, 'sq'], [3, 3, 'sq']]));
  const cells = () => JSON.stringify(B.units.map(u => u.cells));
  const before = cells();
  stepBattle(B);
  assert.equal(cells(), before);
  assert.equal(B.idle, 0);
  B.units.forEach(u => assert.ok(u.hp < u.max));
});

test('infantry blocked head-on by a friendly wall sidestep, then advance', () => {
  // Wall at (3,4),(4,4) is directly ahead of the infantry at (3,5). No enemies, so it only walks.
  const B = newBattle(gridOf([[3, 5, 'tri'], [3, 4, 'sq'], [4, 4, 'sq']]));
  const inf = B.units.find(u => u.t === 'inf');
  stepBattle(B);
  assert.deepEqual(inf.cells[0], [2, 5], 'steps left, the side that clears the way forward');
  stepBattle(B);
  assert.deepEqual(inf.cells[0], [2, 4], 'then walks forward past the wall');
});

test('infantry that can go forward do not sidestep', () => {
  const B = newBattle(gridOf([[3, 5, 'tri']]));
  const inf = B.units[0];
  stepBattle(B);
  assert.deepEqual(inf.cells[0], [3, 4]);
});

test('two blocked infantry that sidestep into the same cell both wait', () => {
  // Two infantry, each blocked head-on by a wall, whose best sidestep is the same cell (2,5): neither moves.
  const B = newBattle(gridOf([[1, 5, 'tri'], [3, 5, 'tri'], [1, 4, 'sq'], [3, 4, 'sq'], [0, 4, 'sq'], [4, 4, 'sq']]));
  const infs = B.units.filter(u => u.t === 'inf');
  const before = infs.map(u => u.cells[0].join());
  stepBattle(B);
  assert.deepEqual(infs.map(u => u.cells[0].join()), before, 'both wanted (2,5), so both wait');
});

test('castles take 0.8x damage, trucks, buggies and turrets half, walls full', () => {
  // One Orange infantry at (3,2) has a clear line down column 3 to a Blue unit 3 cells away. One shot = 1 damage before defence.
  const hpAfterOneShot = blue => {
    const B = newBattle(gridOf(blue, [[3, 2, 'tri']]));
    const target = B.units.find(u => u.o === 0 && u.cells.some(c => c[0] === 3 && c[1] === 5));
    stepBattle(B);
    return [target.t, Math.round((target.max - target.hp) * 100) / 100, B.score[1].d];
  };
  assert.deepEqual(hpAfterOneShot([[3, 5, 'sq'], [4, 5, 'sq'], [3, 6, 'sq'], [4, 6, 'sq']]), ['cst', 0.8, 0.8]);
  assert.deepEqual(hpAfterOneShot([[3, 5, 'sq'], [3, 6, 'sq']]), ['trk', 0.5, 0.5]);
  assert.deepEqual(hpAfterOneShot([[3, 5, 'sq']]), ['bug', 0.5, 0.5]);
  assert.deepEqual(hpAfterOneShot([[3, 5, 'sq'], [3, 5, 'cir', 'm']]), ['tur', 0.5, 0.5]);
  assert.deepEqual(hpAfterOneShot([[3, 5, 'sq'], [4, 5, 'sq']]), ['wal', 1, 1]);
  assert.deepEqual(Object.keys(DEFENCE).sort(), ['bug', 'cst', 'trk', 'tur']);
});

test('a castle under a lone infantry\'s fire falls on the 13th shot, scoring 10 damage + 5 for the kill', () => {
  const B = newBattle(gridOf([[3, 5, 'sq'], [4, 5, 'sq'], [3, 6, 'sq'], [4, 6, 'sq']], [[3, 2, 'tri']]));
  while (!B.over) stepBattle(B);
  assert.equal(B.turn, 13); // 12 shots leave 0.4 HP; the 13th finishes it
  assert.equal(B.score[1].d, 10);
  assert.equal(B.score[1].kills, 1);
  assert.equal(B.score[1].k, 5);
});

test('a snapshot taken before a turn replays that turn identically (what Step back relies on)', () => {
  const B = newBattle(gridOf([[3, 5, 'sq'], [2, 5, 'tri'], [4, 5, 'tri'], [3, 4, 'cir']], [[1, 5, 'tri'], [5, 5, 'tri'], [3, 7, 'tri']]));
  stepBattle(B);
  const snap = structuredClone(B);
  stepBattle(B); stepBattle(B);
  const replay = structuredClone(snap);
  stepBattle(replay); stepBattle(replay);
  const shape = b => JSON.stringify([b.turn, b.score, b.idle, b.units.map(u => [u.t, u.o, u.cells, u.hp, u.riders])]);
  assert.equal(shape(replay), shape(B));
});

/* ---------- towers, turrets and mines in battle ---------- */
const CASTLE = [[3, 5, 'sq'], [4, 5, 'sq'], [3, 6, 'sq'], [4, 6, 'sq']];

test('a tower fires from the castle corner it is mounted on: a front corner reaches an enemy 3 cells out', () => {
  // Orange infantry at (3,2) is 3 cells from the front-left corner (3,5): in the tower's range 3, and it dies in one 2-damage hit.
  const B = newBattle(gridOf([...CASTLE, [3, 5, 'cir', 'm']], [[3, 2, 'tri']]));
  stepBattle(B);
  assert.equal(B.score[0].d, 2);
  assert.equal(B.score[0].kills, 1);
});

test('a tower on a back corner is 1 cell further from the front, so it cannot reach the same enemy', () => {
  const B = newBattle(gridOf([...CASTLE, [3, 6, 'cir', 'm']], [[3, 2, 'tri']]));
  stepBattle(B);
  assert.equal(B.score[0].d, 0);
  assert.ok(B.score[1].d > 0, 'the infantry still shoots the castle');
});

test('towers are lost with the castle, and each counts as a kill', () => {
  const B = newBattle(gridOf([...CASTLE, [3, 6, 'cir', 'm']], [[3, 2, 'tri']])); // out of the back tower\'s reach
  while (!B.over) stepBattle(B);
  assert.equal(B.turn, 13);
  assert.equal(B.score[1].d, 10);
  assert.equal(B.score[1].kills, 2); // castle + 1 tower
  assert.equal(B.score[1].k, 10);
});

test('a turret (circle on a lone square) is stationary and fires 2 damage up to 4 cells', () => {
  const turretGrid = (ey) => gridOf([[3, 5, 'sq'], [3, 5, 'cir', 'm']], [[3, ey, 'tri']]);
  // 2 cells away: a 2-damage shot kills the 2 HP infantry outright.
  let B = newBattle(turretGrid(3));
  const turret = B.units.find(u => u.t === 'tur');
  stepBattle(B);
  assert.ok(!B.units.some(u => u.o === 1));
  assert.deepEqual(turret.cells[0], [3, 5]);
  // 4 cells away is still in range (and beyond the infantry's own range of 3, so it cannot answer).
  B = newBattle(turretGrid(1));
  stepBattle(B);
  assert.ok(!B.units.some(u => u.o === 1));
  // 5 cells away is out of range.
  B = newBattle(turretGrid(0));
  const far = B.units.find(u => u.o === 1);
  stepBattle(B);
  assert.equal(far.hp, far.max);
});

test('a mine hits the first enemy unit to move onto it for 4, ignoring toughness, and is used up', () => {
  // Orange truck (6 HP, x2 tough) drives down column 3 onto Blue\'s mine at (3,3).
  const B = newBattle(gridOf([[3, 3, 'cir']], [[3, 1, 'sq'], [3, 2, 'sq']]));
  const truck = B.units.find(u => u.t === 'trk');
  const fx = stepBattle(B);
  assert.equal(B.mines.length, 0);
  assert.equal(truck.hp, 2); // 6 - 4: a normal hit would have been halved
  assert.equal(B.score[0].d, 4);
  assert.ok(fx.lines.some(l => /mine detonates/.test(l)));
});

test('mines cannot be shot, do not block movement, and ignore their owner\'s units', () => {
  const shot = newBattle(gridOf([[3, 4, 'cir']], [[3, 2, 'tri']]));
  stepBattle(shot);
  assert.equal(shot.mines.length, 1);
  assert.equal(shot.score[1].d, 0);
  const own = newBattle(gridOf([[3, 4, 'cir'], [3, 5, 'sq'], [3, 6, 'sq']]));
  stepBattle(own); // Blue\'s own truck drives over Blue\'s own mine
  assert.equal(own.mines.length, 1);
  assert.deepEqual(own.units[0].cells.map(c => c.join()).sort(), ['3,3', '3,4']); // 2 cells a turn, straight over the mine
});

test('a side with only mines left counts as wiped out', () => {
  const B = newBattle(gridOf([[0, 7, 'cir']], [[3, 2, 'tri']]));
  stepBattle(B);
  assert.ok(B.over);
  assert.match(B.why, /wiped out/);
});

/* ---------- vehicle movement ---------- */
const cellsOf = u => u.cells.map(c => c.join()).sort();
const ORANGE_WALL = [[0, 0, 'sq'], [1, 0, 'sq']]; // parked far away so the battle carries on

test('trucks and buggies move 2 cells a turn; infantry move 1', () => {
  const B = newBattle(gridOf([[3, 6, 'sq'], [3, 7, 'sq'], [6, 7, 'sq'], [0, 7, 'tri']], ORANGE_WALL));
  stepBattle(B);
  assert.deepEqual(cellsOf(B.units.find(u => u.t === 'trk')), ['3,4', '3,5']);
  assert.deepEqual(cellsOf(B.units.find(u => u.t === 'bug')), ['6,5']);
  assert.deepEqual(cellsOf(B.units.find(u => u.t === 'inf')), ['0,6']);
});

test('a truck swerves round a friendly obstacle and carries on forward', () => {
  // Blue wall at (3,3),(4,3) is straight ahead. The truck drives 1 cell, swerves left (the side that clears the way), then next turn runs on.
  const B = newBattle(gridOf([[3, 5, 'sq'], [3, 6, 'sq'], [3, 3, 'sq'], [4, 3, 'sq']], ORANGE_WALL));
  const truck = B.units.find(u => u.t === 'trk');
  stepBattle(B);
  assert.deepEqual(cellsOf(truck), ['2,4', '2,5']);
  stepBattle(B);
  assert.deepEqual(cellsOf(truck), ['2,2', '2,3']);
});

test('a truck rams at most once a turn, even at double speed', () => {
  // Turn 1: drives 1 cell, then rams on the second sub-step. Turn 2: rams straight away and must not ram a second time.
  const B = newBattle(gridOf([[3, 5, 'sq'], [3, 6, 'sq']], [[3, 3, 'sq'], [4, 3, 'sq']]));
  const wall = B.units.find(u => u.o === 1);
  stepBattle(B);
  assert.equal(wall.hp, 4);
  stepBattle(B);
  assert.equal(wall.hp, 2);
});

test('a mine catches a fast vehicle that passes over it mid-turn', () => {
  // The buggy drives (3,6) -> (3,5) -> (3,4). Orange\'s mine at (3,5) is under it after the first cell only.
  const B = newBattle(gridOf([[3, 6, 'sq']], [[3, 5, 'cir'], ...ORANGE_WALL]));
  stepBattle(B);
  assert.ok(!B.units.some(u => u.t === 'bug'), 'buggy destroyed (4 damage vs 3 HP)');
  assert.equal(B.mines.length, 0);
  assert.equal(B.score[1].d, 3);
  assert.equal(B.score[1].kills, 1);
});

/* ---------- whole battles ---------- */
const flip = t => t.map(([x, y, s]) => [x, H - 1 - y, s]); // an Orange template, mirrored into Blue's half
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

test('infantry with nothing in range step towards the nearest enemy along the longer gap, sideways or backwards', () => {
  // Orange's lone infantry is at (7,6): 6 columns across but only 1 row down from Blue's infantry at (1,5), so Blue walks sideways.
  let B = newBattle(gridOf([[1, 5, 'tri']], [[7, 6, 'tri']]));
  stepBattle(B);
  assert.deepEqual(B.units.find(u => u.o === 0).cells[0], [2, 5]);
  // An enemy behind (row 9) with the longer gap in y: Blue walks backwards.
  B = newBattle(gridOf([[1, 3, 'tri']], [[2, 9, 'tri']]));
  stepBattle(B);
  assert.deepEqual(B.units.find(u => u.o === 0).cells[0], [1, 4]);
});

test('infantry boxed in by their own wall detour sideways round it while hunting', () => {
  // Enemy infantry straight ahead at (3,0), too far to shoot; the Blue wall at (3,5),(4,5) blocks the only shortening step.
  const B = newBattle(gridOf([[3, 6, 'tri'], [3, 5, 'sq'], [4, 5, 'sq']], [[3, 0, 'tri']]));
  const inf = B.units.find(u => u.o === 0 && u.t === 'inf');
  stepBattle(B);
  assert.deepEqual(inf.cells[0], [2, 6]); // detours left first, and keeps going that way until the line is clear
  stepBattle(B);
  assert.deepEqual(inf.cells[0], [2, 5]); // line is clear again, so it resumes the approach
});

/* ---------- planes ---------- */
// A Blue plane: centre (3,8), wings (2,8) and (4,8), tail (3,9), nose triangle (3,7).
const bluePlane = [[3, 8, 'sq'], [2, 8, 'sq'], [4, 8, 'sq'], [3, 9, 'sq'], [3, 7, 'tri']];

test('a plane is four squares in a cross with a triangle nose in front, for either side', () => {
  const blue = recognise(gridOf(bluePlane));
  assert.deepEqual(typesOf(blue, 0), ['pln']);
  assert.equal(blue.find(u => u.t === 'pln').cells.length, 5);
  // Orange's plane points down the board: centre (4,2), wings (3,2) and (5,2), tail (4,1), nose (4,3).
  assert.deepEqual(typesOf(recognise(gridOf([], [[4, 2, 'sq'], [3, 2, 'sq'], [5, 2, 'sq'], [4, 1, 'sq'], [4, 3, 'tri']])), 1), ['pln']);
  // Nose at the back instead of the front is just a buggy and its pieces, not a plane.
  assert.ok(!typesOf(recognise(gridOf([[3, 8, 'sq'], [2, 8, 'sq'], [4, 8, 'sq'], [3, 7, 'sq'], [3, 9, 'tri']])), 0).includes('pln'));
});

test('a plane flies 4 cells a turn over enemy units, bombing each one it passes once', () => {
  // Orange wall at (3,4),(4,4). Centre (3,8) -> (3,4); the nose reaches (3,4) on the third cell, so the wall takes one 2-damage bomb.
  const B = newBattle(gridOf(bluePlane, [[3, 4, 'sq'], [4, 4, 'sq']]));
  const plane = B.units.find(u => u.t === 'pln'), wall = B.units.find(u => u.t === 'wal');
  stepBattle(B);
  assert.deepEqual(plane.cells[0], [3, 4]);
  assert.equal(wall.hp, wall.max - 2);
  assert.equal(plane.hp, plane.max);
});

test('planes never block, ram or set off mines', () => {
  const B = newBattle(gridOf(bluePlane, [[3, 0, 'sq'], [3, 6, 'cir']]));
  stepBattle(B);
  assert.equal(B.mines.length, 1);
  assert.equal(B.units.find(u => u.t === 'pln').hp, B.units.find(u => u.t === 'pln').max);
});

test('infantry can shoot a plane overhead, and a plane bombs infantry to death', () => {
  // Plane centre (3,4), nose (3,3). Orange infantry at (3,1) fires 1 first (range 2), then the plane flies in and bombs it for 2.
  const B = newBattle(gridOf([[3, 4, 'sq'], [2, 4, 'sq'], [4, 4, 'sq'], [3, 5, 'sq'], [3, 3, 'tri']], [[3, 1, 'tri']]));
  const plane = B.units.find(u => u.t === 'pln');
  stepBattle(B);
  assert.equal(plane.hp, plane.max - 1);
  assert.ok(!B.units.some(u => u.o === 1));
  assert.equal(B.score[0].kills, 1);
});

test('a turret needs one turn to reload after each shot', () => {
  // Orange castle (10 HP, 0.8x damage) 3 cells from the turret: the turret's 2-damage shots land on turns 1 and 3 only.
  const B = newBattle(gridOf([[3, 5, 'sq'], [3, 5, 'cir', 'm']], [[3, 1, 'sq'], [4, 1, 'sq'], [3, 2, 'sq'], [4, 2, 'sq']]));
  const castle = B.units.find(u => u.t === 'cst');
  const hp = [];
  for (let i = 0; i < 3; i++) { stepBattle(B); hp.push(castle.hp); }
  assert.equal(hp[0], 8.4);  // 2 damage / 1.25 defence = 1.6 taken
  assert.equal(hp[1], 8.4);  // reloading: no shot
  assert.equal(hp[2], 6.8);  // fires again
});
