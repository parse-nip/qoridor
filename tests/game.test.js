import { describe, it, expect } from "vitest";
import {
  createGame,
  getLegalMoves,
  applyMove,
  applyWall,
  isValidWallPlacement,
  isBlocked,
  hasPathToGoal,
  wallsOverlap,
} from "../public/game.js";

describe("Quoridor basics", () => {
  it("starts with pawns on center baselines and 10 walls each", () => {
    const g = createGame();
    expect(g.pawns[0]).toEqual({ r: 8, c: 4 });
    expect(g.pawns[1]).toEqual({ r: 0, c: 4 });
    expect(g.wallsLeft).toEqual([10, 10]);
    expect(g.current).toBe(0);
  });

  it("allows orthogonal moves and not through empty board diagonally", () => {
    const g = createGame();
    const moves = getLegalMoves(g, 0);
    expect(moves).toEqual(
      expect.arrayContaining([
        { r: 7, c: 4 },
        { r: 8, c: 3 },
        { r: 8, c: 5 },
      ])
    );
    expect(moves).not.toEqual(
      expect.arrayContaining([{ r: 7, c: 3 }])
    );
    expect(moves.find((m) => m.r === 9)).toBeUndefined();
  });

  it("blocks movement with a horizontal wall", () => {
    const g = createGame();
    // Wall between row 7 and 8 across cols 4-5
    g.walls.push({ r: 7, c: 4, orient: "h", owner: 0 });
    expect(isBlocked(g.walls, 8, 4, -1, 0)).toBe(true);
    const moves = getLegalMoves(g, 0);
    expect(moves.find((m) => m.r === 7 && m.c === 4)).toBeUndefined();
  });
});

describe("jumps", () => {
  it("allows straight jump over adjacent opponent", () => {
    const g = createGame();
    g.pawns[0] = { r: 4, c: 4 };
    g.pawns[1] = { r: 3, c: 4 };
    const moves = getLegalMoves(g, 0);
    expect(moves).toEqual(expect.arrayContaining([{ r: 2, c: 4 }]));
  });

  it("allows lateral jump when straight is blocked by wall", () => {
    const g = createGame();
    g.pawns[0] = { r: 4, c: 4 };
    g.pawns[1] = { r: 3, c: 4 };
    // wall behind pink (north of pink)
    g.walls.push({ r: 2, c: 4, orient: "h", owner: 1 });
    const moves = getLegalMoves(g, 0);
    expect(moves.find((m) => m.r === 2 && m.c === 4)).toBeUndefined();
    expect(moves).toEqual(
      expect.arrayContaining([
        { r: 3, c: 3 },
        { r: 3, c: 5 },
      ])
    );
  });

  it("allows lateral jump at board edge", () => {
    const g = createGame();
    g.pawns[0] = { r: 1, c: 4 };
    g.pawns[1] = { r: 0, c: 4 };
    const moves = getLegalMoves(g, 0);
    expect(moves.find((m) => m.r === -1)).toBeUndefined();
    expect(moves).toEqual(
      expect.arrayContaining([
        { r: 0, c: 3 },
        { r: 0, c: 5 },
      ])
    );
  });
});

describe("walls", () => {
  it("rejects overlapping and crossing walls", () => {
    const a = { r: 3, c: 3, orient: "h" };
    const b = { r: 3, c: 4, orient: "h" };
    const cross = { r: 3, c: 3, orient: "v" };
    expect(wallsOverlap(a, b)).toBe(true);
    expect(wallsOverlap(a, cross)).toBe(true);
    expect(wallsOverlap(a, { r: 5, c: 5, orient: "h" })).toBe(false);
  });

  it("detects when a pawn is fully caged from its goal", () => {
    const g = createGame();
    g.pawns[0] = { r: 4, c: 4 };
    // Valid non-crossing cage around (4,4)
    g.walls = [
      { r: 3, c: 3, orient: "h", owner: 1 }, // north
      { r: 4, c: 4, orient: "h", owner: 1 }, // south
      { r: 4, c: 3, orient: "v", owner: 1 }, // west
      { r: 3, c: 4, orient: "v", owner: 1 }, // east
    ];
    expect(hasPathToGoal(g, 0)).toBe(false);
    expect(hasPathToGoal(g, 1)).toBe(true);
  });

  it("accepts a normal wall and switches turn", () => {
    const g = createGame();
    const res = applyWall(g, { r: 3, c: 3, orient: "h" });
    expect(res.ok).toBe(true);
    expect(res.game.walls).toHaveLength(1);
    expect(res.game.wallsLeft[0]).toBe(9);
    expect(res.game.current).toBe(1);
  });

  it("rejects a wall that would finish a cage", () => {
    let g = createGame();
    g.pawns[0] = { r: 4, c: 4 };
    const first = [
      { r: 3, c: 3, orient: "h" },
      { r: 4, c: 4, orient: "h" },
      { r: 4, c: 3, orient: "v" },
    ];
    for (const w of first) {
      const res = applyWall(g, w);
      expect(res.ok).toBe(true);
      g = res.game;
      g.current = 0;
    }
    expect(isValidWallPlacement(g, { r: 3, c: 4, orient: "v", owner: 0 })).toBe(
      false
    );
  });
});

describe("win condition", () => {
  it("declares winner when teal reaches top row", () => {
    const g = createGame();
    g.pawns[0] = { r: 1, c: 4 };
    g.pawns[1] = { r: 5, c: 0 };
    const res = applyMove(g, { r: 0, c: 4 });
    expect(res.ok).toBe(true);
    expect(res.game.winner).toBe(0);
  });
});
