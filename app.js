/* Shapefront UI: placement flow, battle playback, rendering and events. Game rules live in sim.js. */
(() => {
'use strict';
const { N, MAX_TURNS, INV, TEAM, TYPES, recognise, newBattle, stepBattle, makeCpuPlan, buildSchedule } = window.Shapefront;
const SPEEDS = [900, 480, 220];
const $ = s => document.querySelector(s);
const board = $('#board'), unitsEl = $('#units'), fxEl = $('#fx'), floatsEl = $('#floats');

let GEN = 0, S = null;

/* ---------- shapes ---------- */
function shapeSvg(s, extra = '') {
  const body = s === 'sq' ? '<rect class="shp" x="18" y="18" width="64" height="64" rx="7"/>'
    : s === 'tri' ? '<polygon class="shp" points="50,14 87,82 13,82"/>'
    : '<circle class="shp" cx="50" cy="50" r="31"/>';
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${body}${extra}</svg>`;
}

function newGame(mode) {
  clearTimeout(S && S.timer);
  S = { mode: mode || (S && S.mode) || 'cpu', grid: Array.from({ length: N }, () => Array(N).fill(null)),
    inv: [{ ...INV }, { ...INV }], sched: buildSchedule(), step: 0, placed: [], sel: 'sq', phase: 'place',
    battle: null, cpuPlan: null, cpuIdx: 0, speed: S ? S.speed : 0, playing: false, gen: ++GEN, msg: '' };
  if (S.mode === 'cpu') S.cpuPlan = makeCpuPlan();
  render(); maybeCpu();
}
const cur = () => S.sched[S.step];
const isHumanTurn = () => S.phase === 'place' && cur() && !(S.mode === 'cpu' && cur()[0] === 1);
const inHalf = (p, y) => (p === 0 ? y >= N / 2 : y < N / 2);

function flash(msg) { S.msg = msg; renderStatus(); clearTimeout(S.msgT); S.msgT = setTimeout(() => { S.msg = ''; renderStatus(); }, 1800); }

function placeAt(x, y) {
  if (!isHumanTurn()) return;
  const [p, c] = cur(), g = S.grid[y][x];
  const mine = S.placed.findIndex(q => q[0] === x && q[1] === y);
  if (mine >= 0) { S.inv[p][g.s]++; S.grid[y][x] = null; S.placed.splice(mine, 1); render(); return; }
  if (!inHalf(p, y)) return flash(`Place on ${TEAM[p]}'s half (${p === 0 ? 'bottom' : 'top'}).`);
  if (g) return flash('That cell is taken.');
  if (S.placed.length >= c) return flash('Placed enough this turn. Tap Done, or tap a piece to take it back.');
  if (S.inv[p][S.sel] <= 0) return;
  S.grid[y][x] = { s: S.sel, o: p }; S.inv[p][S.sel]--; S.placed.push([x, y]);
  if (S.inv[p][S.sel] <= 0) { const nx = ['sq', 'tri', 'cir'].find(s => S.inv[p][s] > 0); if (nx) S.sel = nx; }
  render();
}
function undo() {
  if (!isHumanTurn() || !S.placed.length) return;
  const [x, y] = S.placed.pop(), g = S.grid[y][x]; S.inv[g.o][g.s]++; S.sel = g.s; S.grid[y][x] = null; render();
}
function advance() {
  S.step++; S.placed = [];
  if (S.step >= S.sched.length) S.phase = 'ready';
  else { const p = cur()[0]; if (S.inv[p][S.sel] <= 0) S.sel = ['sq', 'tri', 'cir'].find(s => S.inv[p][s] > 0) || 'sq'; }
  render(); maybeCpu();
}
function maybeCpu() {
  if (S.phase !== 'place' || !cur() || S.mode !== 'cpu' || cur()[0] !== 1) return;
  const g = S.gen;
  const next = () => {
    if (g !== S.gen || S.phase !== 'place') return;
    if (S.placed.length >= cur()[1]) { setTimeout(() => { if (g === S.gen) advance(); }, 250); return; }
    const b = S.cpuPlan[S.cpuIdx++]; S.grid[b.y][b.x] = { s: b.s, o: 1 }; S.inv[1][b.s]--; S.placed.push([b.x, b.y]);
    render(); setTimeout(next, 380);
  };
  setTimeout(next, 420);
}

function startBattle() {
  clearTimeout(S.timer);
  S.phase = 'battle';
  S.battle = newBattle(S.grid);
  unitsEl.innerHTML = ''; fxEl.innerHTML = ''; floatsEl.innerHTML = ''; $('#result').hidden = true;
  $('#log').textContent = 'Turn 0: armies deployed. Press Step or Play.';
  render(); S.playing = false; renderPlay(); // opens paused: Step through, or press Play
}
function tick() {
  if (S.phase !== 'battle' || !S.playing || S.battle.over) return;
  doStep();
  if (!S.battle.over) S.timer = setTimeout(tick, SPEEDS[S.speed]);
}
function doStep() {
  const B = S.battle; if (B.over) return;
  const fx = stepBattle(B);
  const bits = [];
  if (fx.summary.shots) bits.push(`${fx.summary.shots} shot${fx.summary.shots > 1 ? 's' : ''}`);
  if (fx.summary.rams) bits.push(`${fx.summary.rams} ram${fx.summary.rams > 1 ? 's' : ''}`);
  $('#log').textContent = `Turn ${B.turn}: ${[...bits, ...fx.lines].join(', ') || 'units advance'}.`;
  render(fx);
  if (B.over) { S.playing = false; renderPlay(); showResult(); }
}
function skipToEnd() {
  const B = S.battle; clearTimeout(S.timer);
  while (!B.over) stepBattle(B);
  S.playing = false; unitsEl.innerHTML = ''; fxEl.innerHTML = '';
  $('#log').textContent = `Skipped to turn ${B.turn}.`;
  render(); renderPlay(); showResult();
}
function showResult() {
  const B = S.battle, t = B.score.map(s => s.d + s.k), w = t[0] === t[1] ? -1 : t[0] > t[1] ? 0 : 1;
  const r = $('#result');
  r.innerHTML = `<div class="card">
    <h2 class="${w < 0 ? '' : 'w' + w}">${w < 0 ? 'Draw' : TEAM[w] + ' wins'}</h2>
    <div class="big">${t[0]} – ${t[1]}</div>
    <div class="det">${B.why}<br>Blue ${B.score[0].d} dmg + ${B.score[0].kills} kills · Orange ${B.score[1].d} dmg + ${B.score[1].kills} kills</div>
    <div class="row"><button id="r-replay">Replay battle</button><button id="r-new" class="go">New game</button></div></div>`;
  r.hidden = false;
  $('#r-replay').onclick = startBattle; $('#r-new').onclick = () => newGame();
}

/* ---------- rendering ---------- */
const DEG = { '0,-1': 0, '1,0': 90, '0,1': 180, '-1,0': 270 };
function unitEl(u) {
  const xs = u.cells.map(c => c[0]), ys = u.cells.map(c => c[1]);
  const mx = Math.min(...xs), my = Math.min(...ys), w = Math.max(...xs) - mx + 1, h = Math.max(...ys) - my + 1;
  const el = document.createElement('div');
  el.className = `unit o${u.o} t-${u.t}${u.cells.length > 1 ? ' multi' : ''}${u.rider ? ' rider' : ''}`;
  el.dataset.id = u.id; el.dataset.w = w; el.dataset.h = h;
  let html = '<div class="frame"></div>';
  for (const c of u.cells) {
    html += `<div class="blk" style="left:${(c[0] - mx) / w * 100}%;top:${(c[1] - my) / h * 100}%;width:${100 / w}%;height:${100 / h}%">${shapeSvg(TYPES[u.t].shape, u.t === 'twr' ? '<circle class="ring" cx="50" cy="50" r="44"/>' : '')}</div>`;
  }
  html += `<span class="tag">${u.rider ? 'RIDE' : TYPES[u.t].code}</span><span class="pips"></span><div class="hp"><i></i></div>`;
  el.innerHTML = html;
  el.style.width = w * 12.5 + '%'; el.style.height = h * 12.5 + '%';
  return el;
}
function updateEl(el, u) {
  el.style.left = Math.min(...u.cells.map(c => c[0])) * 12.5 + '%';
  el.style.top = Math.min(...u.cells.map(c => c[1])) * 12.5 + '%';
  el.querySelector('.hp i').style.width = Math.max(0, u.hp / u.max * 100) + '%';
  el.querySelector('.pips').textContent = u.t === 'bug' && u.riders ? '▲'.repeat(u.riders) : '';
  if (u.t === 'inf') el.querySelector('.blk svg').style.transform = `rotate(${DEG[u.face.join(',')] ?? 0}deg)`;
}

function render(fx) {
  board.style.setProperty('--dur', Math.min(SPEEDS[S.speed] * 0.6, 360) + 'ms');
  const ph = S.phase, c = cur();
  board.dataset.active = ph === 'place' && c ? (isHumanTurn() ? c[0] : '') : '';
  board.classList.toggle('battle', ph === 'battle');

  // units
  let units;
  if (ph === 'battle') {
    units = S.battle.units;
    const live = new Map(units.map(u => [u.id, u]));
    unitsEl.querySelectorAll('.unit').forEach(el => {
      if (!live.has(el.dataset.id) && !el.classList.contains('dead')) { el.classList.add('dead'); setTimeout(() => el.remove(), 420); }
    });
    for (const u of units) {
      let el = unitsEl.querySelector(`[data-id="${u.id}"]`);
      if (!el) { el = unitEl(u); if (fx && fx.fresh.includes(u.id)) el.classList.add('fresh'); unitsEl.appendChild(el); }
      updateEl(el, u);
    }
    if (fx) drawFx(fx);
  } else {
    units = recognise(S.grid);
    unitsEl.innerHTML = '';
    for (const u of units) { const el = unitEl(u); unitsEl.appendChild(el); updateEl(el, u); }
    const last = S.placed[S.placed.length - 1];
    if (last) { const el = [...unitsEl.children].find((e, i) => units[i].cells.some(q => q[0] === last[0] && q[1] === last[1])); if (el) el.classList.add('fresh'); }
  }

  // scores
  for (const o of [0, 1]) {
    const side = $('#side' + o);
    if (ph === 'battle') {
      const sc = S.battle.score[o]; $('#s' + o).textContent = sc.d + sc.k;
      $('#b' + o).textContent = `${sc.d} dmg · ${sc.kills} kill${sc.kills === 1 ? '' : 's'} (+${sc.k})`;
      const other = S.battle.score[1 - o]; side.classList.toggle('lead', sc.d + sc.k > other.d + other.k);
    } else {
      const left = S.inv[o].sq + S.inv[o].tri + S.inv[o].cir; $('#s' + o).textContent = left;
      $('#b' + o).textContent = `block${left === 1 ? '' : 's'} left${S.mode === 'cpu' && o === 1 ? ' · CPU' : ''}`;
      side.classList.remove('lead');
    }
  }

  // controls
  $('#place-ctl').hidden = ph === 'battle';
  $('#battle-ctl').hidden = ph !== 'battle';
  if (ph !== 'battle') {
    const p = c ? c[0] : 0, human = isHumanTurn();
    $('#place-ctl').dataset.turn = p;
    $('#tray').innerHTML = ['sq', 'tri', 'cir'].map(s =>
      `<button class="shape-btn" data-s="${s}" aria-pressed="${S.sel === s && human}" aria-label="${{ sq: 'Square', tri: 'Triangle', cir: 'Circle' }[s]}, ${S.inv[p][s]} left" ${!human || S.inv[p][s] <= 0 ? 'disabled' : ''}>${shapeSvg(s)}<span class="n">${S.inv[p][s]}</span></button>`).join('');
    $('#tray').hidden = ph === 'ready';
    $('#undo').hidden = $('#done').hidden = ph === 'ready';
    $('#undo').disabled = !human || !S.placed.length;
    $('#done').disabled = !human || !c || S.placed.length < c[1];
    $('#fight').hidden = ph !== 'ready';
    $('#result').hidden = true;
    if (ph === 'place') $('#log').textContent = '';
  } else {
    $('#turn').textContent = `Turn ${S.battle.turn} / ${MAX_TURNS}`;
  }
  renderStatus(); renderRoster(units);
}
function renderStatus() {
  const st = $('#status'), c = cur();
  if (S.msg) { st.textContent = S.msg; return; }
  if (S.phase === 'place' && c) {
    const [p, n] = c, left = n - S.placed.length;
    if (!isHumanTurn()) st.innerHTML = `<span class="who1">Orange</span> is placing…`;
    else st.innerHTML = left > 0 ? `<span class="who${p}">${TEAM[p]}</span>: place ${left} more block${left > 1 ? 's' : ''} on your half.`
      : `<span class="who${p}">${TEAM[p]}</span>: tap Done to hand over.`;
  } else if (S.phase === 'ready') st.textContent = 'Both armies are set. Tap Fight.';
  else if (S.phase === 'battle') st.textContent = S.battle.over ? 'Battle over.' : S.playing ? 'Battle running…' : 'Paused.';
}
function renderRoster(units) {
  const rows = [0, 1].map(o => {
    const counts = new Map();
    for (const u of units) {
      if (u.o !== o || u.rider) continue;
      const label = u.t === 'bug' && u.riders ? `Buggy +${u.riders} rider${u.riders > 1 ? 's' : ''}` : TYPES[u.t].name;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    const txt = [...counts].map(([l, n]) => n > 1 ? `${l} ×${n}` : l).join(', ') || 'Nothing yet';
    return `<div class="r${o}"><b>${TEAM[o]}</b>${txt}</div>`;
  });
  $('#roster').innerHTML = rows.join('');
}
function drawFx(fx) {
  fxEl.innerHTML = fx.shots.map(s => `<line class="shot o${s.o}s" x1="${s.from[0]}" y1="${s.from[1]}" x2="${s.to[0]}" y2="${s.to[1]}"/><circle class="imp o${s.o}s" cx="${s.to[0]}" cy="${s.to[1]}" r=".13"/>`).join('')
    + fx.rams.map(s => `<line class="ram o${s.o}s" x1="${s.from[0]}" y1="${s.from[1]}" x2="${(s.from[0] + s.to[0]) / 2}" y2="${(s.from[1] + s.to[1]) / 2}"/>`).join('');
  for (const h of fx.hits) {
    const el = unitsEl.querySelector(`[data-id="${h.id}"]`);
    if (el) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
    const f = document.createElement('div'); const killed = fx.dead.includes(h.id);
    f.className = 'float' + (killed ? ' kill' : ''); f.textContent = killed ? `−${h.d} KO` : `−${h.d}`;
    f.style.left = h.at[0] * 12.5 + '%'; f.style.top = h.at[1] * 12.5 + '%';
    floatsEl.appendChild(f); setTimeout(() => f.remove(), 750);
  }
}
function renderPlay() {
  $('#play').textContent = S.playing ? 'Pause' : 'Play';
  $('#play').disabled = $('#stepb').disabled = $('#skip').disabled = !S.battle || S.battle.over;
  document.querySelectorAll('[data-sp]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.sp === S.speed));
  renderStatus();
}

/* ---------- field manual ---------- */
const MANUAL = [
  ['inf', ['T'], 'Shoots 1 damage up to 3 cells in a straight line, front first, then sides, then back. Walks forward when nothing is in range.'],
  ['bug', ['TST'], 'Picks up to 2 triangles touching its sides or front as riders. Drives 4 cells, then spends a turn dropping them off. Empty, it keeps driving and rams for 1.'],
  ['trk', ['S', 'S'], 'Two squares in a column. Drives forward and rams whatever blocks it for 2.'],
  ['wal', ['SS'], 'Two squares in a row. Holds still and soaks up fire.'],
  ['cst', ['SS', 'SS'], 'Four squares in a block. Holds still. Circles touching it become towers.'],
  ['tur', ['C'], 'A lone circle. Hits 1 damage on the closest enemy within 2 cells, diagonals included.'],
  ['twr', ['SS.', 'SSC'], 'A circle touching a castle, diagonals included. 2 damage, range 3, fires forward and sideways only.'],
];
$('#ulist').innerHTML = MANUAL.map(([t, rows, txt]) => {
  const cols = Math.max(...rows.map(r => r.length));
  const cells = rows.map(r => r.padEnd(cols, '.').split('').map(ch => `<span>${ch === '.' ? '' : shapeSvg({ S: 'sq', T: 'tri', C: 'cir' }[ch], t === 'twr' && ch === 'C' ? '<circle class="ring" cx="50" cy="50" r="44"/>' : '')}</span>`).join('')).join('');
  return `<li><div class="mini" style="grid-template-columns:repeat(${cols},17px)">${cells}</div><div><strong>${TYPES[t].name}</strong><span class="code">${TYPES[t].code} · ${TYPES[t].hp} HP</span><p>${txt}</p></div></li>`;
}).join('');

/* ---------- events ---------- */
board.addEventListener('click', e => {
  const r = board.getBoundingClientRect();
  const x = Math.min(N - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * N)));
  const y = Math.min(N - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * N)));
  if (S.phase === 'place') placeAt(x, y);
});
$('#tray').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b && !b.disabled) { S.sel = b.dataset.s; render(); } });
$('#undo').onclick = undo;
$('#done').onclick = () => { if (isHumanTurn() && S.placed.length >= cur()[1]) advance(); };
$('#fight').onclick = startBattle;
$('#play').onclick = () => { if (!S.battle || S.battle.over) return; S.playing = !S.playing; renderPlay(); clearTimeout(S.timer); if (S.playing) S.timer = setTimeout(tick, 120); };
$('#stepb').onclick = () => { if (!S.battle || S.battle.over) return; S.playing = false; clearTimeout(S.timer); doStep(); renderPlay(); };
$('#skip').onclick = () => { if (S.battle && !S.battle.over) skipToEnd(); };
document.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { S.speed = +b.dataset.sp; board.style.setProperty('--dur', Math.min(SPEEDS[S.speed] * 0.6, 360) + 'ms'); renderPlay(); });
const setMode = m => { $('#m-cpu').setAttribute('aria-pressed', m === 'cpu'); $('#m-2p').setAttribute('aria-pressed', m === '2p'); newGame(m); };
$('#m-cpu').onclick = () => setMode('cpu');
$('#m-2p').onclick = () => setMode('2p');
$('#new').onclick = () => newGame();
document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea')) return;
  if (e.key === '1') S.sel = 'sq'; else if (e.key === '2') S.sel = 'tri'; else if (e.key === '3') S.sel = 'cir';
  else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) { undo(); return; } else return;
  if (S.phase === 'place') render();
});

/* ---------- boot, keeping a half-built layout across live updates ---------- */
try { window.claude?.hot?.snapshot?.(() => ({ mode: S.mode, grid: S.grid, inv: S.inv, step: S.step, placed: S.placed, sel: S.sel, cpuPlan: S.cpuPlan, cpuIdx: S.cpuIdx, phase: S.phase === 'battle' ? 'ready' : S.phase })); } catch (e) {}
function start(d) {
  if (d && d.grid && d.inv) {
    newGame(d.mode);
    Object.assign(S, { grid: d.grid, inv: d.inv, step: d.step, placed: d.placed || [], sel: d.sel || 'sq', cpuPlan: d.cpuPlan || S.cpuPlan, cpuIdx: d.cpuIdx || 0, phase: d.phase || 'place' });
    $('#m-cpu').setAttribute('aria-pressed', S.mode === 'cpu'); $('#m-2p').setAttribute('aria-pressed', S.mode === '2p');
    render(); maybeCpu();
  } else newGame('cpu');
}
window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
})();
