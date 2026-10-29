/*
 * Shapefront simulation: formation recognition, the deterministic battle engine, the CPU's
 * build templates and the placement schedule. No DOM access, so it runs in the browser
 * (as a classic script exposing `Shapefront`) and under Node (`require`) for tests.
 */
(function (root) {
'use strict';

const W = 8, H = 10, KILL = 5, MAX_TURNS = 20, BUGGY_RUN = 4, IDLE_END = 3;
const INV = { sq: 7, tri: 10, cir: 3 }; // extra squares and triangles (was 5/4/3) so armies have enough force to engage across the 9x9 board
const INV_TOTAL = INV.sq + INV.tri + INV.cir;
const TEAM = ['Blue', 'Orange'];
const TYPES = {
  inf: { name: 'Infantry', code: 'INF', hp: 2, shape: 'tri' },
  bug: { name: 'Buggy',    code: 'BUG', hp: 3, shape: 'sq' },
  trk: { name: 'Truck',    code: 'TRK', hp: 6, shape: 'sq' },
  wal: { name: 'Wall',     code: 'WAL', hp: 6, shape: 'sq' },
  cst: { name: 'Castle',   code: 'CST', hp: 10, shape: 'sq' },
  tur: { name: 'Turret',   code: 'TUR', hp: 3, shape: 'sq' },  // a lone square with a circle mounted on top
  pln: { name: 'Plane',    code: 'PLN', hp: 4, shape: 'sq' },  // four squares in a cross with a triangle nose; flies over everything
  mine:{ name: 'Mine',     code: 'MINE', hp: 1, shape: 'cir' }, // a lone circle: buried, so never a target
  twr: { name: 'Tower',    code: 'TWR', hp: 0, shape: 'cir' }, // never a unit: a circle mounted on a castle square, with no HP of its own
};
// Defence multiplier: a unit with DEFENCE 2 takes half damage (1.25 takes 0.8x) from every hit (shots and rams). Unlisted types take full damage.
const DEFENCE = { cst: 1.25, trk: 2, bug: 2, tur: 2 };
const TURRET_COOLDOWN = 1; // turns a turret must wait after firing, so it shoots every other turn at best
const PLANE_SPEED = 4, BOMB_DMG = 2; // a plane flies 4 cells a turn and bombs each enemy unit it passes over for 2 (defence applies)
const MINE_DMG = 4; // a mine's blast ignores DEFENCE
const round2 = n => Math.round(n * 100) / 100; // damage can now be fractional; keep it tidy
const SPEED = { inf: 1, trk: 2, bug: 2 }, MAX_SPEED = 2; // cells moved per turn; faster units take more movement sub-steps
const DMG = { inf: 1, tur: 2, twr: 2 }, RANGE = { inf: 3, tur: 4, twr: 3 }, RAM = { trk: 2, bug: 1 };

const key = c => c[0] + ',' + c[1];
const inB = c => c[0] >= 0 && c[1] >= 0 && c[0] < W && c[1] < H;
const fwd = o => (o === 0 ? -1 : 1);
const HALF = Math.floor(H / 2); // rows each side may place on; with an odd H the middle row would belong to nobody
const inHalf = (o, y) => (o === 0 ? y >= H - HALF : y < HALF); // Blue (0) owns the bottom rows, Orange (1) the top rows
const toL = (o, x, y) => (o === 0 ? [x, y] : [W - 1 - x, H - 1 - y]); // involution: local <-> board
const dirsFor = o => { const f = fwd(o), l = o === 0 ? -1 : 1; return [[0, f], [l, 0], [-l, 0], [0, -f]]; }; // front, left, right, back
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

let UID = 0;

/* ---------- formation recognition ---------- */
function mk(o, t, cells) {
  return { id: 'u' + (++UID), o, t, cells: cells.map(c => [c.x ?? c[0], c.y ?? c[1]]), hp: TYPES[t].hp, max: TYPES[t].hp, riders: 0, moves: 0, face: [0, fwd(o)], air: t === 'pln' };
}
function recognise(grid) {
  const out = [];
  for (const o of [0, 1]) {
    const used = new Set();
    const at = (lx, ly) => { if (lx < 0 || ly < 0 || lx >= W || ly >= H) return null; const [x, y] = toL(o, lx, ly); const g = grid[y][x]; return g && g.o === o ? { x, y, s: g.s } : null; };
    const free = (lx, ly, s) => { const c = at(lx, ly); return c && c.s === s && !used.has(c.x + ',' + c.y) ? c : null; };
    const take = cs => cs.forEach(c => used.add(c.x + ',' + c.y));
    const scan = fn => { for (let ly = H - 1; ly >= 0; ly--) for (let lx = 0; lx < W; lx++) fn(lx, ly); };
    const buggies = [];
    // Plane: a cross of four squares (centre, left, right, tail) with a triangle as the nose in front. Claimed before anything else,
    // in the owner's own orientation (nose towards the enemy). Cell order: centre, left, right, tail, nose.
    scan((lx, ly) => {
      const cs = [free(lx, ly, 'sq'), free(lx - 1, ly, 'sq'), free(lx + 1, ly, 'sq'), free(lx, ly + 1, 'sq'), free(lx, ly - 1, 'tri')];
      if (cs.every(Boolean)) { take(cs); out.push(mk(o, 'pln', cs)); }
    });
    scan((lx, ly) => { const cs = [free(lx, ly, 'sq'), free(lx + 1, ly, 'sq'), free(lx, ly - 1, 'sq'), free(lx + 1, ly - 1, 'sq')];
      if (cs.every(Boolean)) {
        take(cs); const u = mk(o, 'cst', cs);
        u.mounts = cs.filter(c => grid[c.y][c.x].m).map(c => ({ cell: [c.x, c.y] })); // circles mounted on this castle's squares
        out.push(u);
      } });
    scan((lx, ly) => { const a = free(lx, ly, 'sq'); if (a && grid[a.y][a.x].m) { take([a]); const u = mk(o, 'tur', [a]); u.mounted = true; out.push(u); } });
    scan((lx, ly) => { const a = free(lx, ly, 'sq'), b = free(lx, ly - 1, 'sq'); if (a && b) { take([a, b]); out.push(mk(o, 'trk', [b, a])); } });
    scan((lx, ly) => { const a = free(lx, ly, 'sq'), b = free(lx + 1, ly, 'sq'); if (a && b) { take([a, b]); out.push(mk(o, 'wal', [a, b])); } });
    scan((lx, ly) => { const a = free(lx, ly, 'sq'); if (a) { take([a]); const u = mk(o, 'bug', [a]); u.l = [lx, ly]; buggies.push(u); out.push(u); } });
    scan((lx, ly) => { const c = free(lx, ly, 'cir'); if (c) { take([c]); out.push(mk(o, 'mine', [c])); } }); // a circle on its own cell is a mine
    for (const b of buggies) for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      if (b.riders >= 2) break; const c = free(b.l[0] + dx, b.l[1] + dy, 'tri');
      if (c) { take([c]); b.riders++; const r = mk(o, 'inf', [c]); r.rider = true; out.push(r); }
    }
    scan((lx, ly) => { const c = free(lx, ly, 'tri'); if (c) { take([c]); out.push(mk(o, 'inf', [c])); } });
  }
  return out;
}

/* ---------- battle simulation (deterministic) ---------- */
const occMap = us => { const m = new Map(); us.forEach(u => { if (!u.air) u.cells.forEach(c => m.set(key(c), u)); }); return m; }; // planes fly: they never block, ram or trigger mines
const airMap = us => { const m = new Map(); us.forEach(u => { if (u.air) u.cells.forEach(c => m.set(key(c), u)); }); return m; };
const centre = c => [c[0] + 0.5, c[1] + 0.5];
const unitCentre = u => { let x = 0, y = 0; u.cells.forEach(c => { x += c[0]; y += c[1]; }); return [x / u.cells.length + 0.5, y / u.cells.length + 0.5]; };
const frontTargets = u => { const own = new Set(u.cells.map(key)); return u.cells.map(([x, y]) => [x, y + fwd(u.o)]).filter(c => !own.has(key(c))); };
const nearestCell = (u, ref) => u.cells.reduce((b, c) => (Math.abs(c[0] - ref[0]) + Math.abs(c[1] - ref[1]) < Math.abs(b[0] - ref[0]) + Math.abs(b[1] - ref[1]) ? c : b));

/* s is a shooter: { t: type, o: owner, cell: where it fires from }. A mounted tower fires from its castle corner. */
function pickTarget(s, units, occ) {
  const [x, y] = s.cell;
  if (s.t === 'inf') {
    let best = null;
    const air = airMap(units); // a plane overhead can be shot, but a ground unit in the same cell is hit first
    dirsFor(s.o).forEach(dir => {
      for (let d = 1; d <= RANGE.inf; d++) {
        const c = [x + dir[0] * d, y + dir[1] * d]; if (!inB(c)) break;
        const v = occ.get(key(c)) || air.get(key(c));
        if (v) { if (v.o !== s.o && (!best || d < best.d)) best = { u: v, cell: c, d, dir }; break; }
      }
    });
    return best;
  }
  const R = RANGE[s.t]; let best = null, bk = null;
  for (const v of units) {
    if (v.o === s.o) continue;
    for (const c of v.cells) {
      const dx = c[0] - x, dy = c[1] - y, ch = Math.max(Math.abs(dx), Math.abs(dy));
      if (ch > R) continue;
      if (s.t === 'twr' && dy * fwd(s.o) < 0) continue; // towers don't fire backwards
      const [lx, ly] = toL(s.o, c[0], c[1]);
      const k = [ch, Math.abs(dx) + Math.abs(dy), v.hp, ly, lx];
      if (!bk || cmp(k, bk) < 0) { bk = k; best = { u: v, cell: c }; }
    }
  }
  return best;
}
function applyDamage(B, map, fx, pierce = false) {
  let any = false;
  for (const [id, d] of map) {
    const u = B.units.find(v => v.id === id); if (!u) continue;
    const taken = pierce ? d : round2(d / (DEFENCE[u.t] || 1)), real = Math.min(taken, u.hp);
    u.hp = round2(u.hp - taken); B.score[1 - u.o].d = round2(B.score[1 - u.o].d + real); any = true;
    fx.hits.push({ id, d: real, at: unitCentre(u) });
    if (u.hp <= 0) {
      // riders and mounted towers are lost with their buggy / castle, and each counts as a kill
      const towers = (u.mounts || []).length, n = 1 + (u.riders || 0) + towers;
      B.score[1 - u.o].k += KILL * n; B.score[1 - u.o].kills += n;
      const lost = [u.riders && `${u.riders} rider${u.riders > 1 ? 's' : ''}`, towers && `${towers} tower${towers > 1 ? 's' : ''}`].filter(Boolean).join(' and ');
      fx.dead.push(u.id); fx.lines.push(`${TEAM[u.o]} ${TYPES[u.t].name.toLowerCase()}${lost ? ' and ' + lost : ''} destroyed`);
    }
  }
  B.units = B.units.filter(u => u.hp > 0);
  return any;
}

function stepBattle(B) {
  const fx = { shots: [], rams: [], booms: [], hits: [], dead: [], fresh: [], lines: [] };
  B.turn++;
  let occ = occMap(B.units);
  // 1. everything fires simultaneously
  const dmg = new Map(), shot = new Set();
  const shooters = [];
  for (const u of B.units) {
    if (u.cool > 0) u.cool--; // a turret that fired last turn is still reloading: it sits this turn out
    else if (DMG[u.t]) shooters.push({ u, t: u.t, o: u.o, cell: u.cells[0] });
    (u.mounts || []).forEach(m => shooters.push({ u, t: 'twr', o: u.o, cell: m.cell })); // castles fire their towers from the mounted corner
  }
  for (const s of shooters) {
    const u = s.u, tg = pickTarget(s, B.units, occ);
    if (!tg) { if (s.t === 'inf') u.face = [0, fwd(u.o)]; continue; }
    shot.add(u.id); if (s.t === 'inf') u.face = tg.dir;
    if (s.t === 'tur') u.cool = TURRET_COOLDOWN;
    dmg.set(tg.u.id, (dmg.get(tg.u.id) || 0) + DMG[s.t]);
    fx.shots.push({ o: u.o, from: centre(s.cell), to: centre(tg.cell) });
  }
  let active = applyDamage(B, dmg, fx);
  occ = occMap(B.units);
  // 2. everything moves simultaneously. Movement runs in sub-steps: infantry take one, trucks and buggies take up to SPEED (two).
  const ramD = new Map(), unloadQ = [], done = new Set(); // done: finished moving this turn (rammed, blocked by the edge, or unloading)
  for (let sub = 0; sub < MAX_SPEED; sub++) {
    const intents = [], hunters = [];
    for (const u of B.units) {
      if (done.has(u) || sub >= (SPEED[u.t] || 0)) continue;
      if (u.t === 'inf') {
        if (shot.has(u.id)) continue; // infantry that fired this turn hold their ground
        // With an enemy on the board, infantry hunt it; the plain forward march (with its sidestep) is only for an empty battlefield.
        if (B.units.some(v => v.o !== u.o && !v.air)) hunters.push(u); else intents.push(u);
        continue;
      }
      const loaded = u.t === 'bug' && u.riders > 0;
      if (loaded && u.moves >= BUGGY_RUN) { unloadQ.push(u); done.add(u); continue; }
      const tc = frontTargets(u);
      if (tc.some(c => !inB(c))) { if (loaded) unloadQ.push(u); done.add(u); continue; }
      const enemy = tc.map(c => occ.get(key(c))).find(v => v && v.o !== u.o);
      if (enemy) {
        done.add(u); // a vehicle rams at most once a turn, however fast it is
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
    // Two fronts claiming the same cell: friendly units simply wait, but a vehicle that meets an enemy claiming its cell collides with it,
    // otherwise two vehicles facing each other across a one-cell gap would wait for ever. Collisions are decided before anyone is removed, so both sides hit.
    const contested = [...want].filter(([, tc]) => tc.some(c => claims.get(key(c)) > 1));
    for (const [u, tc] of contested) {
      if (!RAM[u.t]) continue;
      const mine = new Set(tc.map(key));
      const foe = contested.map(([v]) => v).find(v => v.o !== u.o && frontTargets(v).some(c => mine.has(key(c))));
      if (!foe) continue;
      done.add(u);
      if (u.t === 'bug' && u.riders > 0) { unloadQ.push(u); continue; }
      ramD.set(foe.id, (ramD.get(foe.id) || 0) + RAM[u.t]);
      fx.rams.push({ o: u.o, from: centre(u.cells[0]), to: centre(foe.cells[0]) });
    }
    for (const [u] of contested) want.delete(u);
    let progress = true;
    while (progress) {
      progress = false;
      for (const [u, tc] of want) {
        if (tc.every(c => !occ.has(key(c)))) {
          u.cells.forEach(c => occ.delete(key(c)));
          u.cells = u.cells.map(([x, y]) => [x, y + fwd(u.o)]);
          u.cells.forEach(c => occ.set(key(c), u));
          if (u.t === 'bug') u.moves++;
          u.slide = 0;
          want.delete(u); progress = true; active = true;
        }
      }
    }
    // Anything still blocked head-on (by a friendly unit that isn't moving) swerves one cell sideways instead of waiting.
    // Decided after the forward moves, from the settled board. Two units picking the same cell both wait.
    const swerves = new Map(), swerveClaims = new Map();
    for (const [u] of want) {
      const [, lx, rx] = dirsFor(u.o).map(d => d[0]);
      const open = cs => cs.every(c => inB(c) && !occ.has(key(c)));
      const options = [lx, rx].map(dx => {
        const to = u.cells.map(([x, y]) => [x + dx, y]);
        return { dx, to, gains: open(frontTargets({ cells: to, o: u.o })) };
      }).filter(o => open(o.to));
      // Prefer a side that leaves the way forward clear, then keep swerving the way it already was, then left.
      options.sort((a, b) => (b.gains - a.gains) || ((b.dx === u.slide) - (a.dx === u.slide)));
      if (!options.length) continue;
      swerves.set(u, options[0]); options[0].to.forEach(c => swerveClaims.set(key(c), (swerveClaims.get(key(c)) || 0) + 1));
    }
    for (const [u, o] of swerves) {
      if (o.to.some(c => swerveClaims.get(key(c)) > 1)) continue;
      u.cells.forEach(c => occ.delete(key(c))); u.cells = o.to; u.cells.forEach(c => occ.set(key(c), u));
      if (u.t === 'bug') u.moves++;
      u.slide = o.dx; active = true;
    }
    // Hunters: each infantry steps one cell towards its nearest enemy (Manhattan distance, ties to the earliest unit), along whichever
    // axes shorten the gap, preferring the longer gap, then forward. Moves are resolved one unit at a time on the settled board, so
    // two hunters after the same cell cannot both take it; a hunter whose shortening steps are all blocked simply waits.
    for (const u of hunters) {
      const [ux, uy] = u.cells[0];
      let best = null, bestD = Infinity;
      for (const v of B.units) {
        if (v.o === u.o || v.air) continue; // infantry can't reach a plane, so they never chase one
        for (const [vx, vy] of v.cells) { const d = Math.abs(vx - ux) + Math.abs(vy - uy); if (d < bestD) { bestD = d; best = [vx, vy]; } }
      }
      const gapX = best[0] - ux, gapY = best[1] - uy;
      const steps = [[0, Math.sign(gapY)], [Math.sign(gapX), 0]].filter(([dx, dy]) => dx || dy)
        .sort((a, b) => (Math.abs(b[0] ? gapX : gapY) - Math.abs(a[0] ? gapX : gapY)) || ((b[1] === fwd(u.o)) - (a[1] === fwd(u.o))));
      const free = ([dx, dy]) => { const c = [ux + dx, uy + dy]; return inB(c) && !occ.has(key(c)); };
      let step = steps.find(free), around = false;
      if (!step) {
        // Boxed in (a wall or friend in the way): go round it, sideways across the main line of approach, keeping the direction
        // of the last detour (u.slide: -1/+1 along the cross axis) before trying the other way.
        const alongY = steps[0][0] === 0; // main line is vertical, so detour sideways in x (and vice versa)
        const dirs = [u.slide || -1, -(u.slide || -1)].map(d => (alongY ? [d, 0] : [0, d]));
        step = dirs.find(free); around = true;
        if (step) u.slide = alongY ? step[0] : step[1];
      }
      if (!step) continue;
      occ.delete(key(u.cells[0])); u.cells = [[ux + step[0], uy + step[1]]]; occ.set(key(u.cells[0]), u);
      u.face = step; if (!around) u.slide = 0; active = true;
    }
    // mines go off under any enemy unit that has just moved onto them (checked every sub-step, so fast vehicles can't skip over one); the blast ignores toughness
    const mineD = new Map();
    B.mines = B.mines.filter(m => {
      const v = occ.get(key(m.cells[0]));
      if (!v || v.o === m.o) return true;
      mineD.set(v.id, (mineD.get(v.id) || 0) + MINE_DMG);
      fx.booms.push({ o: m.o, at: centre(m.cells[0]) }); fx.dead.push(m.id); fx.lines.push(`${TEAM[m.o]} mine detonates`);
      return false;
    });
    if (applyDamage(B, mineD, fx, true)) { active = true; occ = occMap(B.units); }
  }
  // Planes fly last, over everything: up to PLANE_SPEED cells towards the nearest enemy ground unit (the longer gap first, whole
  // footprint kept on the board), bombing every enemy unit under the footprint after each cell. Each plane bombs a given unit once a turn.
  const bombD = new Map();
  for (const p of B.units.filter(v => v.air)) {
    const bombed = new Set();
    for (let step = 0; step <= PLANE_SPEED; step++) {
      if (step > 0) {
        const [px, py] = p.cells[0];
        let best = null, bestD = Infinity;
        for (const v of B.units) {
          if (v.o === p.o || v.air) continue;
          for (const [vx, vy] of v.cells) { const d = Math.abs(vx - px) + Math.abs(vy - py); if (d < bestD) { bestD = d; best = [vx, vy]; } }
        }
        if (best && bestD > 0) {
          const gx = best[0] - px, gy = best[1] - py;
          const moves = [[0, Math.sign(gy)], [Math.sign(gx), 0]].filter(([dx, dy]) => dx || dy)
            .sort((a, b) => (Math.abs(b[0] ? gx : gy) - Math.abs(a[0] ? gx : gy)) || (a[0] - b[0]));
          const mv = moves.find(([dx, dy]) => p.cells.every(c => inB([c[0] + dx, c[1] + dy])));
          if (mv) { p.cells = p.cells.map(([x, y]) => [x + mv[0], y + mv[1]]); active = true; }
        }
      }
      for (const v of B.units) {
        if (v.o === p.o || v.air || bombed.has(v.id)) continue;
        const under = v.cells.find(vc => p.cells.some(pc => pc[0] === vc[0] && pc[1] === vc[1]));
        if (!under) continue;
        bombed.add(v.id); bombD.set(v.id, (bombD.get(v.id) || 0) + BOMB_DMG);
        fx.booms.push({ o: p.o, at: centre(under) }); fx.lines.push(`${TEAM[p.o]} plane bombs ${TYPES[v.t].name.toLowerCase()}`);
      }
    }
  }
  if (applyDamage(B, bombD, fx)) active = true;
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
  const all = recognise(grid).filter(u => !u.rider);
  return { units: all.filter(u => u.t !== 'mine'), mines: all.filter(u => u.t === 'mine'), turn: 0, score: [{ d: 0, k: 0, kills: 0 }, { d: 0, k: 0, kills: 0 }], idle: 0, over: false, why: '' };
}

/* A circle can be put on top of a square that is part of a built castle (a tower) or a lone square (a turret),
   if that square isn't already carrying one. The mounted circle is stored on the grid cell as g.m. */
function canMount(grid, x, y) {
  const g = grid[y] && grid[y][x];
  if (!g || g.s !== 'sq' || g.m) return false;
  return recognise(grid).some(u => (u.t === 'cst' || u.t === 'bug') && u.o === g.o && u.cells.some(c => c[0] === x && c[1] === y));
}

/* ---------- CPU opponent (picks a build, then places it 2 at a time) ---------- */
// Templates are drawn for the 8-column board and Orange's top 4 rows (the 5th row is left free as a buffer).
// Entries are [x, y, shape]; a 4th element 'm' means a circle mounted on the castle square already at that cell.
const TEMPLATES = [
  [[3,0,'sq'],[4,0,'sq'],[3,1,'sq'],[4,1,'sq'],[3,1,'cir','m'],[4,1,'cir','m'],[1,2,'sq'],[1,3,'tri'],[0,2,'tri'],[2,3,'tri'],[5,3,'tri'],[6,1,'cir'],[6,2,'sq'],[6,3,'sq'],[7,3,'tri'],[4,3,'tri'],[2,2,'tri'],[5,2,'tri'],[2,1,'tri'],[5,1,'tri']],
  [[1,3,'sq'],[1,2,'sq'],[6,3,'sq'],[6,2,'sq'],[3,3,'sq'],[2,3,'tri'],[4,3,'tri'],[0,1,'cir'],[7,1,'cir'],[3,1,'tri'],[5,1,'tri'],[3,3,'cir','m'],[3,2,'sq'],[2,2,'tri'],[4,2,'tri'],[7,3,'sq'],[2,1,'tri'],[4,1,'tri'],[3,0,'tri'],[4,0,'tri']],
  [[2,3,'sq'],[3,3,'sq'],[4,3,'sq'],[5,3,'sq'],[2,2,'cir'],[5,2,'cir'],[0,2,'sq'],[0,3,'tri'],[1,1,'tri'],[6,1,'tri'],[7,2,'tri'],[0,2,'cir','m'],[3,1,'sq'],[4,1,'sq'],[3,2,'tri'],[4,2,'tri'],[3,0,'tri'],[4,0,'tri'],[2,1,'tri'],[5,1,'tri']],
  [[3,1,'sq'],[3,2,'sq'],[2,2,'sq'],[2,3,'tri'],[1,2,'tri'],[5,2,'sq'],[5,3,'tri'],[6,2,'tri'],[4,0,'sq'],[1,0,'cir'],[6,0,'cir'],[4,0,'cir','m'],[0,3,'sq'],[7,3,'sq'],[4,3,'tri'],[3,3,'tri'],[4,1,'tri'],[2,1,'tri'],[5,1,'tri'],[3,0,'tri']],
  [[3,2,'sq'],[2,2,'sq'],[4,2,'sq'],[3,1,'sq'],[3,3,'tri'],[0,2,'sq'],[0,3,'sq'],[7,3,'sq'],[7,2,'tri'],[6,3,'tri'],[1,3,'tri'],[5,3,'tri'],[4,3,'tri'],[2,3,'tri'],[1,1,'tri'],[5,1,'tri'],[6,1,'tri'],[2,0,'cir'],[5,0,'cir'],[0,1,'cir']], // a plane in the centre
];
function makeCpuPlan() {
  const t = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)], m = Math.random() < 0.5;
  return t.map(([x, y, s, mount]) => ({ x: m ? W - 1 - x : x, y, s, m: !!mount }));
}

/* ---------- game flow ---------- */
function buildSchedule() {
  const rem = [INV_TOTAL, INV_TOTAL], s = []; let p = 0, first = true;
  while (rem[0] + rem[1] > 0) { const c = Math.min(first ? 1 : 2, rem[p]); first = false; if (c > 0) { s.push([p, c]); rem[p] -= c; } p = 1 - p; }
  return s;
}

const api = { W, H, HALF, inHalf, KILL, MAX_TURNS, BUGGY_RUN, IDLE_END, INV, INV_TOTAL, TEAM, TYPES, DMG, RANGE, RAM, DEFENCE, MINE_DMG, TURRET_COOLDOWN, PLANE_SPEED, BOMB_DMG, SPEED, TEMPLATES,
  recognise, canMount, newBattle, stepBattle, makeCpuPlan, buildSchedule };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.Shapefront = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
