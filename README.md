# Shapefront

A turn-based shape-army battler. Build an army from squares, triangles and circles, then watch it fight. No luck involved: the battle is fully deterministic, so the same two layouts always produce the same result.

Open `index.html` in a browser. No build step, no dependencies.

## How a game runs

1. Each side gets **5 squares, 4 triangles and 3 circles** to place on its own half of an 8×8 grid (Blue bottom, Orange top).
2. Blue places 1 block, then each side places 2 at a time. Placements are visible to both sides.
3. Shapes join into units by how they touch (see below).
4. Each battle turn, everything fires at once, then everything moves at once. Two units heading for the same cell both wait.
5. Score is **1 point per damage, +5 per kill**. Riders lost with their buggy count as kills.
6. The battle ends after 20 turns, when a side is wiped out, or after 3 turns with nothing happening.

Battles open paused at 1× speed: use **Step** to advance one turn at a time, or **Play**. Your chosen speed carries over between games.

## Units

| Unit | Formation | HP | Behaviour |
|---|---|---|---|
| Infantry | one triangle | 2 | Shoots 1 damage up to 3 cells in a straight line (front, then sides, then back). Walks forward when nothing is in range. |
| Buggy | one lone square | 3 | Takes up to 2 touching triangles as riders. Drives 4 cells, then spends a turn dropping them off. Empty, it keeps driving and rams for 1. |
| Truck | two squares in a column | 6 | Drives forward and rams whatever blocks it for 2. |
| Wall | two squares in a row | 6 | Holds still and soaks up fire. |
| Castle | four squares in a block | 10 | Holds still. Circles touching it become towers. |
| Turret | one lone circle | 2 | 1 damage on the closest enemy within 2 cells, diagonals included. |
| Tower | a circle touching a castle (diagonals count) | 4 | 2 damage, range 3, fires forward and sideways only. |

Squares are grouped in priority order: castles first, then trucks, then walls, then buggies.

## Project layout

- `index.html`: page markup
- `style.css`: theme (light and dark) and layout
- `sim.js`: the rules engine: formation recognition, the battle step, CPU templates and the placement schedule. No DOM access, so it runs in the browser and in Node.
- `app.js`: placement flow, battle playback, rendering and events
- `test/sim.test.js`: tests for the rules engine

## Tests

```
npm test
```

Uses Node's built-in test runner (Node 20+), no install needed.
