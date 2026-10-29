# Shapefront

A turn-based shape-army battler. Build an army from squares, triangles and circles, then watch it fight. No luck involved: the battle is fully deterministic, so the same two layouts always produce the same result.

Open `index.html` in a browser. No build step, no dependencies.

## How a game runs

1. Each side gets **7 squares, 10 triangles and 3 circles** to place on its own half of an 8×10 grid (8 wide, 10 tall): Blue the bottom 5 rows, Orange the top 5.
2. Blue places 1 block, then each side places 2 at a time. Placements are visible to both sides.
3. Shapes join into units by how they touch (see below).
4. Each battle turn, everything fires at once, then everything moves at once. Two units heading for the same cell both wait.
5. Score is **1 point per damage, +5 per kill**. Riders lost with their buggy count as kills.
6. The battle ends after 20 turns, when a side is wiped out, or after 3 turns with nothing happening.

Battles open paused at 1× speed: use **Step** to advance one turn at a time, **Step back** to rewind one, or **Play**. Your chosen speed carries over between games.

## Units

| Unit | Formation | HP | Behaviour |
|---|---|---|---|
| Infantry | one triangle | 2 | Shoots 1 damage up to 3 cells in a straight line (front, then sides, then back). When nothing is in range it walks 1 cell a turn towards the nearest enemy unit (the longer gap first), waiting if friends block both ways. |
| Buggy | one lone square | 3 | Takes up to 2 touching triangles as riders. Drives 2 cells a turn, swerving round friendly obstacles. After 4 cells it spends a turn dropping its riders. Empty, it keeps driving and rams for 1. Takes half damage. |
| Truck | two squares in a column | 6 | Drives 2 cells a turn, swerving round friendly obstacles, and rams whatever blocks it for 2 (once a turn). Takes half damage. |
| Wall | two squares in a row | 6 | Holds still and soaks up fire. |
| Plane | four squares in a cross, a triangle nose in front | 4 | Flies 4 cells a turn **over** everything (it never blocks, rams or sets off mines), heading for the nearest enemy and bombing each unit under it for 2, once a turn per unit (armour applies). Infantry, turrets and towers can shoot it. |
| Castle | four squares in a block | 10 | Holds still. Takes 0.8× damage. Fires any towers mounted on it. |
| Turret | a lone square with a circle on top | 3 | Stationary. 2 damage on the closest enemy within 4 cells, diagonals included, then reloads for a turn (so it fires every other turn at best). Takes half damage. |
| Tower | a circle on top of a built castle's square | none | Fires 2 damage, range 3, forward and sideways, from the corner it sits on, so front corners reach furthest. Shares the castle's HP and is lost with it; each tower lost counts as a kill. |
| Mine | a circle on its own cell | none | Buried: it can't be shot and doesn't block anyone. The first enemy unit to move onto it takes 4 damage (ignoring toughness) and the mine is used up. |

**Putting a circle on a square:** pick a circle, then tap one of your squares that is either a lone square or part of a built castle. A circle placed anywhere else is a mine. A circle on top of a lone square makes it a turret, and neighbouring squares can't absorb it into a truck or wall.

Squares are grouped in priority order: castles first, then turrets, trucks, walls, and finally buggies.

Castles, trucks, buggies and turrets are **tough**: castles take 0.8× damage (×1.25 defence) and the rest take half (×2), from every hit (shots and rams). The multipliers live in the `DEFENCE` table in `sim.js`. Damage can therefore be fractional, and score counts the HP actually removed.

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
