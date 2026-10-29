/*
 * Shapefront simulation: formation recognition, the deterministic battle engine, the CPU's
 * build templates and the placement schedule. No DOM access, so it runs in the browser
 * (as a classic script exposing `Shapefront`) and under Node (`require`) for tests.
 */
(function (root) {
'use strict';

const N = 8, KILL = 5, MAX_TURNS = 20, BUGGY_RUN = 4, IDLE_END = 3;
const INV = { sq: 5, tri: 4, cir: 3 };
const TEAM = ['Blue', 'Orange'];
const TYPES = {
  inf: { name: 'Infantry', code: 'INF', hp: 2, shape: 'tri' },
  bug: { name: 'Buggy',    code: 'BUG', hp: 3, shape: 'sq' },
  trk: { name: 'Truck',    code: 'TRK', hp: 6, shape: 'sq' },
  wal: { name: 'Wall',     code: 'WAL', hp: 6, shape: 'sq' },
  cst: { name: 'Castle',   code: 'CST', hp: 10, shape: 'sq' },
  tur: { name: 'Turret',   code: 'TUR', hp: 2, shape: 'cir' },
  twr: { name: 'Tower',    code: 'TWR', hp: 4, shape: 'cir' },
};
const DMG = { inf: 1, tur: 1, twr: 2 }, RANGE = { inf: 3, tur: 2, twr: 3 }, RAM = { trk: 2, bug: 1 };

const key = c => c[0] + ',' + c[1];
const inB = c => c[0] >= 0 && c[1] >= 0 && c[0] < N && c[1] < N;
const fwd = o => (o === 0 ? -1 : 1);
const toL = (o, x, y) => (o === 0 ? [x, y] : [N - 1 - x, N - 1 - y]); // involution: local <-> board
const dirsFor = o => { const f = fwd(o), l = o === 0 ? -1 : 1; return [[0, f], [l, 0], [-l, 0], [0, -f]]; }; // front, left, right, back
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

let UID = 0;

/* ---------- formation recognition ---------- */
function mk(o, t, cells) {
  return { id: 'u' + (++UID), o, t, cells: cells.map(c => [c.x ?? c[0], c.y ?? c[1]]), hp: TYPES[t].hp, max: TYPES[t].hp, riders: 0, moves: 0, face: [0, fwd(o)] };
}
function recognise(grid) {
  const out = [];
  for (const o of [0, 1]) {
    const used = new Set();
    const at = (lx, ly) => { if (lx < 0 || ly < 0 || lx >= N || ly >= N) return null; const [x, y] = toL(o, lx, ly); const g = grid[y][x]; return g && g.o === o ? { x, y, s: g.s } : null; };
    const free = (lx, ly, s) => { const c = at(lx, ly); return c && c.s === s && !used.has(c.x + ',' + c.y) ? c : null; };
    const take = cs => cs.forEach(c => used.add(c.x + ',' + c.y));
    const scan = fn => { for (let ly = N - 1; ly >= 0; ly--) for (let lx = 0; lx < N; lx++) fn(lx, ly); };
    const castleCells = new Set(), buggies = [];
    scan((lx, ly) => { const cs = [free(lx, ly, 'sq'), free(lx + 1, ly, 'sq'), free(lx, ly - 1, 'sq'), free(lx + 1, ly - 1, 'sq')];
      if (cs.every(Boolean)) { take(cs); cs.forEach(c => castleCells.add(c.x + ',' + c.y)); out.push(mk(o, 'cst', cs)); } });
    scan((lx, ly) => { const a = free(lx, ly, 'sq'), b = free(lx, ly - 1, 'sq'); if (a && b) { take([a, b]); out.push(mk(o, 'trk', [b, a])); } });
    scan((lx, ly) => { const a = free(lx, ly, 'sq'), b = free(lx + 1, ly, 'sq'); if (a && b) { take([a, b]); out.push(mk(o, 'wal', [a, b])); } });
    scan((lx, ly) => { const a = free(lx, ly, 'sq'); if (a) { take([a]); const u = mk(o, 'bug', [a]); u.l = [lx, ly]; buggies.push(u); out.push(u); } });
    scan((lx, ly) => { const c = free(lx, ly, 'cir'); if (!c) return; take([c]);
      let tower = false; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (castleCells.has((c.x + dx) + ',' + (c.y + dy))) tower = true;
      out.push(mk(o, tower ? 'twr' : 'tur', [c])); });
    for (const b of buggies) for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      if (b.riders >= 2) break; const c = free(b.l[0] + dx, b.l[1] + dy, 'tri');
      if (c) { take([c]); b.riders++; const r = mk(o, 'inf', [c]); r.rider = true; out.push(r); }
    }
    scan((lx, ly) => { const c = free(lx, ly, 'tri'); if (c) { take([c]); out.push(mk(o, 'inf', [c])); } });
  }
  return out;
}

/* ---------- battle simulation (deterministic) ---------- */
const occMap = us => { const m = new Map(); us.forEach(u => u.cells.forEach(c => m.set(key(c), u))); return m; };
const centre = c => [c[0] + 0.5, c[1] + 0.5];
const unitCentre = u => { let x = 0, y = 0; u.cells.forEach(c => { x += c[0]; y += c[1]; }); return [x / u.cells.length + 0.5, y / u.cells.length + 0.5]; };
const frontTargets = u => { const own = new Set(u.cells.map(key)); return u.cells.map(([x, y]) => [x, y + fwd(u.o)]).filter(c => !own.has(key(c))); };
const nearestCell = (u, ref) => u.cells.reduce((b, c) => (Math.abs(c[0] - ref[0]) + Math.abs(c[1] - ref[1]) < Math.abs(b[0] - ref[0]) + Math.abs(b[1] - ref[1]) ? c : b));

function pickTarget(u, units, occ) {
  const [x, y] = u.cells[0];
  if (u.t === 'inf') {
    let best = null;
    dirsFor(u.o).forEach(dir => {
      for (let d = 1; d <= RANGE.inf; d++) {
        const c = [x + dir[0] * d, y + dir[1] * d]; if (!inB(c)) break;
        const v = occ.get(key(c));
        if (v) { if (v.o !== u.o && (!best || d < best.d)) best = { u: v, cell: c, d, dir }; break; }
      }
    });
    return best;
  }
  const R = RANGE[u.t]; let best = null, bk = null;
  for (const v of units) {
    if (v.o === u.o) continue;
    for (const c of v.cells) {
      const dx = c[0] - x, dy = c[1] - y, ch = Math.max(Math.abs(dx), Math.abs(dy));
      if (ch > R) continue;
      if (u.t === 'twr' && dy * fwd(u.o) < 0) continue; // towers don't fire backwards
      const [lx, ly] = toL(u.o, c[0], c[1]);
      const k = [ch, Math.abs(dx) + Math.abs(dy), v.hp, ly, lx];
      if (!bk || cmp(k, bk) < 0) { bk = k; best = { u: v, cell: c }; }
    }
  }
  return best;
}

function applyDamage(B, map, fx) {
  let any = false;
  for (const [id, d] of map) {
    const u = B.units.find(v => v.id === id); if (!u) continue;
    const real = Math.min(d, u.hp); u.hp -= d; B.score[1 - u.o].d += real; any = true;
    fx.hits.push({ id, d: real, at: unitCentre(u) });
    if (u.hp <= 0) { const n = 1 + (u.riders || 0); B.score[1 - u.o].k += KILL * n; B.score[1 - u.o].kills += n;
      fx.dead.push(u.id); fx.lines.push(`${TEAM[u.o]} ${TYPES[u.t].name.toLowerCase()}${u.riders ? ` and ${u.riders} rider${u.riders > 1 ? 's' : ''}` : ''} destroyed`); }
  }
  B.units = B.units.filter(u => u.hp > 0);
  return any;
}

function stepBattle(B) {
  const fx = { shots: [], rams: [], hits: [], dead: [], fresh: [], lines: [] };
  B.turn++;
  let occ = occMap(B.units);
  // 1. everything fires simultaneously
  const dmg = new Map(), shot = new Set();
  for (const u of B.units) {
    if (!DMG[u.t]) continue;
    const tg = pickTarget(u, B.units, occ);
    if (!tg) { if (u.t === 'inf') u.face = [0, fwd(u.o)]; continue; }
    shot.add(u.id); if (u.t === 'inf') u.face = tg.dir;
    dmg.set(tg.u.id, (dmg.get(tg.u.id) || 0) + DMG[u.t]);
    fx.shots.push({ o: u.o, from: centre(u.cells[0]), to: centre(tg.cell) });
  }
  let active = applyDamage(B, dmg, fx);
  occ = occMap(B.units);
  // 2. everything moves simultaneously
  const intents = [], ramD = new Map(), unloadQ = [];
  for (const u of B.units) {
    if (u.t === 'inf') { if (!shot.has(u.id)) intents.push(u); continue; }
    if (u.t !== 'trk' && u.t !== 'bug') continue;
    const loaded = u.t === 'bug' && u.riders > 0;
    if (loaded && u.moves >= BUGGY_RUN) { unloadQ.push(u); continue; }
    const tc = frontTargets(u);
    if (tc.some(c => !inB(c))) { if (loaded) unloadQ.push(u); continue; }
    const enemy = tc.map(c => occ.get(key(c))).find(v => v && v.o !== u.o);
    if (enemy) {
      if (loaded) { unloadQ.push(u); continue; }
      ramD.set(enemy.id, (ramD.get(enemy.id) || 0) + RAM[u.t]);
      const f = tc[0]; fx.rams.push({ o: u.o, from: centre([f[0], f[1] - fwd(u.o)]), to: centre(nearestCell(enemy, f)) });
      continue;
    }
    intents.push(u);
  }
  const want = new Map(), claims = new Map();
  for (const u of intents) {
    const tc = frontTargets(u);
    if (tc.some(c => !inB(c))) continue;
    if (tc.some(c => { const v = occ.get(key(c)); return v && v.o !== u.o; })) continue;
    want.set(u, tc); tc.forEach(c => claims.set(key(c), (claims.get(key(c)) || 0) + 1));
  }
  for (const [u, tc] of want) if (tc.some(c => claims.get(key(c)) > 1)) want.delete(u);
  let progress = true;
  while (progress) {
    progress = false;
    for (const [u, tc] of want) {
      if (tc.every(c => !occ.has(key(c)))) {
        u.cells.forEach(c => occ.delete(key(c)));
        u.cells = u.cells.map(([x, y]) => [x, y + fwd(u.o)]);
        u.cells.forEach(c => occ.set(key(c), u));
        if (u.t === 'bug') u.moves++;
        want.delete(u); progress = true; active = true;
      }
    }
  }
  if (applyDamage(B, ramD, fx)) active = true;
  occ = occMap(B.units);
  // 3. buggies drop riders (takes the buggy's turn; riders act next turn)
  for (const b of unloadQ) {
    if (!B.units.includes(b)) continue;
    const [bx, by] = b.cells[0];
    let dropped = 0;
    for (const [dx, dy] of dirsFor(b.o)) {
      if (b.riders <= 0) break;
      const c = [bx + dx, by + dy];
      if (inB(c) && !occ.has(key(c))) { const n = mk(b.o, 'inf', [c]); B.units.push(n); occ.set(key(c), n); b.riders--; dropped++; fx.fresh.push(n.id); active = true; }
    }
    if (dropped) fx.lines.push(`${TEAM[b.o]} buggy unloads`);
  }
  B.idle = active ? 0 : B.idle + 1;
  const alive = [0, 1].map(o => B.units.some(u => u.o === o));
  if (B.turn >= MAX_TURNS || B.idle >= IDLE_END || !alive[0] || !alive[1]) {
    B.over = true;
    B.why = !alive[0] || !alive[1] ? `${TEAM[alive[0] ? 1 : 0]} wiped out` : B.idle >= IDLE_END ? 'Stalemate: nothing happened for 3 turns' : `${MAX_TURNS} turns played`;
  }
  fx.summary = { shots: fx.shots.length, rams: fx.rams.length };
  return fx;
}

/* Fresh battle state from a placement grid. Riders ride inside their buggy, so they aren't units of their own. */
function newBattle(grid) {
  const units = recognise(grid).filter(u => !u.rider);
  return { units, turn: 0, score: [{ d: 0, k: 0, kills: 0 }, { d: 0, k: 0, kills: 0 }], idle: 0, over: false, why: '' };
}

/* ---------- CPU opponent (picks a build, then places it 2 at a time) ---------- */
const TEMPLATES = [
  [[3,0,'sq'],[4,0,'sq'],[3,1,'sq'],[4,1,'sq'],[2,2,'cir'],[5,2,'cir'],[1,2,'sq'],[1,3,'tri'],[0,2,'tri'],[2,3,'tri'],[5,3,'tri'],[6,1,'cir']],
  [[1,3,'sq'],[1,2,'sq'],[6,3,'sq'],[6,2,'sq'],[3,3,'sq'],[2,3,'tri'],[4,3,'tri'],[0,1,'cir'],[7,1,'cir'],[3,1,'tri'],[5,1,'tri'],[4,1,'cir']],
  [[2,3,'sq'],[3,3,'sq'],[4,3,'sq'],[5,3,'sq'],[2,2,'cir'],[5,2,'cir'],[0,2,'sq'],[0,3,'tri'],[3,1,'cir'],[1,1,'tri'],[6,1,'tri'],[7,2,'tri']],
  [[3,1,'sq'],[3,2,'sq'],[2,2,'sq'],[2,3,'tri'],[1,2,'tri'],[5,2,'sq'],[5,3,'tri'],[6,2,'tri'],[4,0,'sq'],[1,0,'cir'],[6,0,'cir'],[4,1,'cir']],
];
function makeCpuPlan() {
  const t = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)], m = Math.random() < 0.5;
  return t.map(([x, y, s]) => ({ x: m ? N - 1 - x : x, y, s }));
}

/* ---------- game flow ---------- */
function buildSchedule() {
  const rem = [12, 12], s = []; let p = 0, first = true;
  while (rem[0] + rem[1] > 0) { const c = Math.min(first ? 1 : 2, rem[p]); first = false; if (c > 0) { s.push([p, c]); rem[p] -= c; } p = 1 - p; }
  return s;
}

const api = { N, KILL, MAX_TURNS, BUGGY_RUN, IDLE_END, INV, TEAM, TYPES, DMG, RANGE, RAM, TEMPLATES,
  recognise, newBattle, stepBattle, makeCpuPlan, buildSchedule };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.Shapefront = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
