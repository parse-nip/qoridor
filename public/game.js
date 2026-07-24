/**
 * Quoridor — pure rules engine (2 players)
 *
 * Board: 9×9. Rows 0..8 top→bottom, cols 0..8 left→right.
 * Player 0 (teal): starts (8,4), goal = any square on row 0
 * Player 1 (pink): starts (0,4), goal = any square on row 8
 *
 * Walls sit on the 8×8 intersection grid:
 *   horizontal at (r,c): blocks between rows r↔r+1 across cols c and c+1
 *   vertical   at (r,c): blocks between cols c↔c+1 across rows r and r+1
 */

export const BOARD_SIZE = 9;
export const WALL_GRID = 8;
export const WALLS_PER_PLAYER = 10;

export const DIRS = [
  { dr: -1, dc: 0 }, // N
  { dr: 1, dc: 0 }, // S
  { dr: 0, dc: -1 }, // W
  { dr: 0, dc: 1 }, // E
];

export function createGame() {
  return {
    pawns: [
      { r: 8, c: 4 },
      { r: 0, c: 4 },
    ],
    walls: [], // { r, c, orient: 'h'|'v', owner: 0|1 }
    wallsLeft: [WALLS_PER_PLAYER, WALLS_PER_PLAYER],
    current: 0,
    winner: null,
    history: [],
  };
}

export function cloneGame(g) {
  return {
    pawns: g.pawns.map((p) => ({ ...p })),
    walls: g.walls.map((w) => ({ ...w })),
    wallsLeft: [...g.wallsLeft],
    current: g.current,
    winner: g.winner,
    history: g.history.map((h) => structuredClone(h)),
  };
}

export function inBounds(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function wallKey(r, c, orient) {
  return `${orient}:${r},${c}`;
}

export function wallSet(walls) {
  const set = new Set();
  for (const w of walls) set.add(wallKey(w.r, w.c, w.orient));
  return set;
}

/** Is movement from (r,c) one step in direction blocked by a wall? */
export function isBlocked(walls, r, c, dr, dc) {
  const set = walls instanceof Set ? walls : wallSet(walls);
  if (dr === -1 && dc === 0) {
    // moving north: horizontal wall above between r-1 and r
    return (
      set.has(wallKey(r - 1, c, "h")) ||
      (c > 0 && set.has(wallKey(r - 1, c - 1, "h")))
    );
  }
  if (dr === 1 && dc === 0) {
    // moving south
    return (
      set.has(wallKey(r, c, "h")) || (c > 0 && set.has(wallKey(r, c - 1, "h")))
    );
  }
  if (dr === 0 && dc === -1) {
    // moving west
    return (
      set.has(wallKey(r, c - 1, "v")) ||
      (r > 0 && set.has(wallKey(r - 1, c - 1, "v")))
    );
  }
  if (dr === 0 && dc === 1) {
    // moving east
    return (
      set.has(wallKey(r, c, "v")) || (r > 0 && set.has(wallKey(r - 1, c, "v")))
    );
  }
  return true;
}

function pawnAt(pawns, r, c) {
  for (let i = 0; i < pawns.length; i++) {
    if (pawns[i].r === r && pawns[i].c === c) return i;
  }
  return -1;
}

/**
 * Legal pawn destinations for the current player (or given player).
 */
export function getLegalMoves(game, player = game.current) {
  if (game.winner !== null) return [];
  const me = game.pawns[player];
  const walls = wallSet(game.walls);
  const moves = [];
  const seen = new Set();

  const add = (r, c) => {
    if (!inBounds(r, c)) return;
    if (pawnAt(game.pawns, r, c) !== -1) return;
    const k = `${r},${c}`;
    if (seen.has(k)) return;
    seen.add(k);
    moves.push({ r, c });
  };

  for (const { dr, dc } of DIRS) {
    const nr = me.r + dr;
    const nc = me.c + dc;
    if (!inBounds(nr, nc)) continue;
    if (isBlocked(walls, me.r, me.c, dr, dc)) continue;

    const other = pawnAt(game.pawns, nr, nc);
    if (other === -1) {
      add(nr, nc);
      continue;
    }

    // Face-to-face: try straight jump
    const jr = nr + dr;
    const jc = nc + dc;
    const straightOpen =
      inBounds(jr, jc) &&
      !isBlocked(walls, nr, nc, dr, dc) &&
      pawnAt(game.pawns, jr, jc) === -1;

    if (straightOpen) {
      add(jr, jc);
    } else {
      // Lateral (diagonal) jumps around the opponent
      // Perpendicular directions
      const sides =
        dr !== 0
          ? [
              { dr: 0, dc: -1 },
              { dr: 0, dc: 1 },
            ]
          : [
              { dr: -1, dc: 0 },
              { dr: 1, dc: 0 },
            ];
      for (const s of sides) {
        const sr = nr + s.dr;
        const sc = nc + s.dc;
        // Must be able to step from opponent square to side, and side empty
        if (!inBounds(sr, sc)) continue;
        if (isBlocked(walls, nr, nc, s.dr, s.dc)) continue;
        if (pawnAt(game.pawns, sr, sc) !== -1) continue;
        add(sr, sc);
      }
    }
  }

  return moves;
}

/** BFS: can player reach their goal row? */
export function hasPathToGoal(game, player, extraWall = null) {
  const walls = [...game.walls];
  if (extraWall) walls.push(extraWall);
  const wset = wallSet(walls);
  const start = game.pawns[player];
  const goalRow = player === 0 ? 0 : BOARD_SIZE - 1;

  const q = [{ r: start.r, c: start.c }];
  const seen = new Set([`${start.r},${start.c}`]);

  while (q.length) {
    const { r, c } = q.shift();
    if (r === goalRow) return true;
    for (const { dr, dc } of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      if (isBlocked(wset, r, c, dr, dc)) continue;
      const k = `${nr},${nc}`;
      if (seen.has(k)) continue;
      // Pawns don't block path existence for fence legality
      seen.add(k);
      q.push({ r: nr, c: nc });
    }
  }
  return false;
}

export function wallsOverlap(a, b) {
  if (a.orient === b.orient) {
    if (a.orient === "h") {
      // same row, overlapping columns
      return a.r === b.r && Math.abs(a.c - b.c) <= 1;
    }
    return a.c === b.c && Math.abs(a.r - b.r) <= 1;
  }
  // Crossing at same intersection
  return a.r === b.r && a.c === b.c;
}

export function isValidWallPlacement(game, wall) {
  const { r, c, orient } = wall;
  if (r < 0 || r >= WALL_GRID || c < 0 || c >= WALL_GRID) return false;
  if (orient !== "h" && orient !== "v") return false;
  if (game.wallsLeft[game.current] <= 0) return false;
  if (game.winner !== null) return false;

  for (const existing of game.walls) {
    if (wallsOverlap(wall, existing)) return false;
  }

  // Both players must retain a path
  if (!hasPathToGoal(game, 0, wall)) return false;
  if (!hasPathToGoal(game, 1, wall)) return false;
  return true;
}

export function getLegalWalls(game) {
  if (game.winner !== null || game.wallsLeft[game.current] <= 0) return [];
  const legal = [];
  for (let r = 0; r < WALL_GRID; r++) {
    for (let c = 0; c < WALL_GRID; c++) {
      for (const orient of ["h", "v"]) {
        const wall = { r, c, orient, owner: game.current };
        if (isValidWallPlacement(game, wall)) legal.push(wall);
      }
    }
  }
  return legal;
}

function checkWinner(game) {
  if (game.pawns[0].r === 0) return 0;
  if (game.pawns[1].r === BOARD_SIZE - 1) return 1;
  return null;
}

export function applyMove(game, dest) {
  if (game.winner !== null) return { ok: false, error: "Game over" };
  const legal = getLegalMoves(game);
  if (!legal.some((m) => m.r === dest.r && m.c === dest.c)) {
    return { ok: false, error: "Illegal move" };
  }
  const next = cloneGame(game);
  next.history.push({
    type: "move",
    player: next.current,
    from: { ...next.pawns[next.current] },
    to: { ...dest },
  });
  next.pawns[next.current] = { r: dest.r, c: dest.c };
  next.winner = checkWinner(next);
  if (next.winner === null) next.current = 1 - next.current;
  return { ok: true, game: next };
}

export function applyWall(game, wall) {
  if (game.winner !== null) return { ok: false, error: "Game over" };
  const placement = { ...wall, owner: game.current };
  if (!isValidWallPlacement(game, placement)) {
    return { ok: false, error: "Illegal wall" };
  }
  const next = cloneGame(game);
  next.history.push({ type: "wall", player: next.current, wall: placement });
  next.walls.push(placement);
  next.wallsLeft[next.current] -= 1;
  next.current = 1 - next.current;
  return { ok: true, game: next };
}

export function undo(game) {
  if (!game.history.length) return { ok: false, error: "Nothing to undo" };
  // Rebuild from scratch for simplicity & correctness
  let g = createGame();
  const hist = game.history.slice(0, -1);
  for (const action of hist) {
    if (action.type === "move") {
      const res = applyMove(g, action.to);
      if (!res.ok) return { ok: false, error: "Corrupt history" };
      g = res.game;
    } else {
      const res = applyWall(g, action.wall);
      if (!res.ok) return { ok: false, error: "Corrupt history" };
      g = res.game;
    }
  }
  return { ok: true, game: g };
}
