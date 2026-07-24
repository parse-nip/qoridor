import {
  createGame,
  getLegalMoves,
  isValidWallPlacement,
  applyMove,
  applyWall,
  undo,
  BOARD_SIZE,
  WALL_GRID,
} from "./game.js";

const boardEl = document.getElementById("board");
const overlayEl = document.getElementById("overlay");
const hintEl = document.getElementById("hint");
const winModal = document.getElementById("winModal");
const winText = document.getElementById("winText");

const NAMES = ["Cyan", "Pink"];

let game = createGame();
let mode = "move"; // 'move' | 'wall'
let wallOrient = "h";
let ghostWall = null;
let legalMoves = [];

function tileCenter(r, c) {
  const tile = boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
  if (!tile) return { x: 0, y: 0 };
  const br = boardEl.getBoundingClientRect();
  const tr = tile.getBoundingClientRect();
  return {
    x: tr.left - br.left + tr.width / 2,
    y: tr.top - br.top + tr.height / 2,
  };
}

function wallGeometry(wall) {
  const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gap"));
  const tileSize = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--tile-size")
  );
  // Convert CSS values that may be like "9px" — getComputedStyle returns used px on board
  const styles = getComputedStyle(boardEl);
  const gapPx = parseFloat(styles.gap) || gap;
  const cell = boardEl.querySelector(".tile");
  const tilePx = cell ? cell.getBoundingClientRect().width : tileSize;
  const thick = Math.max(3, gapPx * 0.42);

  if (wall.orient === "h") {
    const y = (wall.r + 1) * tilePx + wall.r * gapPx + gapPx / 2;
    const x = wall.c * (tilePx + gapPx);
    const width = tilePx * 2 + gapPx;
    return {
      left: x,
      top: y - thick / 2,
      width,
      height: thick,
    };
  }
  const x = (wall.c + 1) * tilePx + wall.c * gapPx + gapPx / 2;
  const y = wall.r * (tilePx + gapPx);
  const height = tilePx * 2 + gapPx;
  return {
    left: x - thick / 2,
    top: y,
    width: thick,
    height,
  };
}

function buildBoard() {
  boardEl.innerHTML = "";
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "tile";
      tile.dataset.r = String(r);
      tile.dataset.c = String(c);
      tile.setAttribute("role", "gridcell");
      tile.setAttribute("aria-label", `Square ${r + 1},${c + 1}`);
      if (r === 0) tile.classList.add("goal-p0");
      if (r === BOARD_SIZE - 1) tile.classList.add("goal-p1");
      tile.addEventListener("click", () => onTileClick(r, c));
      boardEl.appendChild(tile);
    }
  }

  for (let p = 0; p < 2; p++) {
    const pawn = document.createElement("div");
    pawn.className = `pawn p${p}`;
    pawn.id = `pawn${p}`;
    pawn.setAttribute("aria-hidden", "true");
    boardEl.appendChild(pawn);
  }
}

function renderPawns() {
  for (let p = 0; p < 2; p++) {
    const pawn = document.getElementById(`pawn${p}`);
    const { r, c } = game.pawns[p];
    const { x, y } = tileCenter(r, c);
    const size = pawn.offsetWidth || 30;
    pawn.style.left = `${x - size / 2}px`;
    pawn.style.top = `${y - size / 2}px`;
    pawn.classList.toggle("active", game.current === p && game.winner === null);
  }
}

function clearWallEls() {
  boardEl.querySelectorAll(".wall").forEach((el) => el.remove());
}

function renderWalls() {
  clearWallEls();
  for (const w of game.walls) {
    const el = document.createElement("div");
    el.className = `wall ${w.orient} owner-${w.owner}`;
    const g = wallGeometry(w);
    Object.assign(el.style, {
      left: `${g.left}px`,
      top: `${g.top}px`,
      width: `${g.width}px`,
      height: `${g.height}px`,
    });
    boardEl.appendChild(el);
  }

  if (ghostWall) {
    const el = document.createElement("div");
    const valid = isValidWallPlacement(game, {
      ...ghostWall,
      owner: game.current,
    });
    el.className = `wall ${ghostWall.orient} owner-${game.current} ghost${valid ? "" : " invalid"}`;
    const g = wallGeometry(ghostWall);
    Object.assign(el.style, {
      left: `${g.left}px`,
      top: `${g.top}px`,
      width: `${g.width}px`,
      height: `${g.height}px`,
    });
    boardEl.appendChild(el);
  }
}

function renderMoveTargets() {
  boardEl.querySelectorAll(".tile").forEach((t) => {
    t.classList.remove("move-target", "for-p0", "for-p1");
  });
  if (mode !== "move" || game.winner !== null) return;
  legalMoves = getLegalMoves(game);
  for (const m of legalMoves) {
    const tile = boardEl.querySelector(`[data-r="${m.r}"][data-c="${m.c}"]`);
    if (!tile) continue;
    tile.classList.add("move-target", `for-p${game.current}`);
  }
}

function renderPips(player) {
  const el = document.getElementById(`pips${player}`);
  el.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    const pip = document.createElement("i");
    if (i < game.wallsLeft[player]) pip.classList.add("on");
    el.appendChild(pip);
  }
  document.getElementById(`walls${player}`).textContent = String(
    game.wallsLeft[player]
  );
}

function renderPanels() {
  for (let p = 0; p < 2; p++) {
    const panel = document.querySelector(`.panel-p${p}`);
    const turn = document.getElementById(`turn${p}`);
    const isActive = game.winner === null && game.current === p;
    panel.classList.toggle("active", isActive);
    if (game.winner !== null) {
      turn.textContent = game.winner === p ? "Winner" : "—";
    } else {
      turn.textContent = isActive ? "Your turn" : "Waiting";
    }
    renderPips(p);
  }
}

function renderHint() {
  if (game.winner !== null) {
    hintEl.textContent = `${NAMES[game.winner]} reached the far line.`;
    return;
  }
  if (mode === "move") {
    hintEl.innerHTML =
      "Tap a glowing square to move. Switch to <strong>Wall</strong> to block a path.";
  } else {
    hintEl.innerHTML = `Aim a ${wallOrient === "h" ? "horizontal" : "vertical"} wall in the gutters. <kbd>R</kbd> rotates · click places.`;
  }
}

function renderWin() {
  if (game.winner === null) {
    winModal.hidden = true;
    return;
  }
  winText.textContent = `${NAMES[game.winner]} wins`;
  winText.style.color = game.winner === 0 ? "var(--cyan)" : "var(--pink)";
  winModal.hidden = false;
}

function render() {
  overlayEl.classList.toggle("wall-mode", mode === "wall" && game.winner === null);
  document.getElementById("btnModeMove").dataset.active = String(mode === "move");
  document.getElementById("btnModeWall").dataset.active = String(mode === "wall");
  renderPanels();
  renderMoveTargets();
  renderWalls();
  renderPawns();
  renderHint();
  renderWin();
}

function onTileClick(r, c) {
  if (mode !== "move" || game.winner !== null) return;
  const res = applyMove(game, { r, c });
  if (!res.ok) return;
  game = res.game;
  ghostWall = null;
  render();
}

function setMode(next) {
  if (next === "wall" && game.wallsLeft[game.current] <= 0) {
    hintEl.textContent = "No walls left — you must move.";
    mode = "move";
  } else {
    mode = next;
  }
  ghostWall = null;
  if (next === "wall") window.__wallOrientLocked = false;
  render();
}

function pointerToWall(clientX, clientY, lockOrient = wallOrient) {
  const rect = boardEl.getBoundingClientRect();
  const styles = getComputedStyle(boardEl);
  const gapPx = parseFloat(styles.gap);
  const cell = boardEl.querySelector(".tile");
  const tilePx = cell.getBoundingClientRect().width;
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  // Distance into nearest gutter — auto-pick orientation when unlocked
  let orient = lockOrient;
  if (!window.__wallOrientLocked) {
    const modY = y % (tilePx + gapPx);
    const modX = x % (tilePx + gapPx);
    const distHGutter = Math.abs(modY - tilePx - gapPx / 2);
    const distVGutter = Math.abs(modX - tilePx - gapPx / 2);
    // Prefer the closer gutter type when clearly inside a gap
    const inH = modY > tilePx * 0.85;
    const inV = modX > tilePx * 0.85;
    if (inH && !inV) orient = "h";
    else if (inV && !inH) orient = "v";
    else if (inH && inV) orient = distHGutter <= distVGutter ? "h" : "v";
    wallOrient = orient;
  }

  if (orient === "h") {
    const approxRow = (y - tilePx) / (tilePx + gapPx);
    let r = Math.round(approxRow);
    r = Math.max(0, Math.min(WALL_GRID - 1, r));
    const approxCol = x / (tilePx + gapPx) - 0.5;
    let c = Math.round(approxCol);
    c = Math.max(0, Math.min(WALL_GRID - 1, c));
    return { r, c, orient: "h" };
  }
  const approxCol = (x - tilePx) / (tilePx + gapPx);
  let c = Math.round(approxCol);
  c = Math.max(0, Math.min(WALL_GRID - 1, c));
  const approxRow = y / (tilePx + gapPx) - 0.5;
  let r = Math.round(approxRow);
  r = Math.max(0, Math.min(WALL_GRID - 1, r));
  return { r, c, orient: "v" };
}

function onOverlayMove(e) {
  if (mode !== "wall" || game.winner !== null) return;
  if (game.wallsLeft[game.current] <= 0) {
    ghostWall = null;
    renderWalls();
    return;
  }
  ghostWall = pointerToWall(e.clientX, e.clientY);
  renderWalls();
}

function onOverlayLeave() {
  ghostWall = null;
  renderWalls();
}

function onOverlayClick(e) {
  if (mode !== "wall" || game.winner !== null) return;
  const wall = pointerToWall(e.clientX, e.clientY);
  const res = applyWall(game, wall);
  if (!res.ok) {
    hintEl.textContent =
      game.wallsLeft[game.current] <= 0
        ? "No walls left — you must move."
        : "That wall is illegal (overlap or would trap a player).";
    return;
  }
  game = res.game;
  ghostWall = null;
  mode = "move";
  render();
}

function newGame() {
  game = createGame();
  mode = "move";
  wallOrient = "h";
  ghostWall = null;
  render();
}

document.getElementById("btnModeMove").addEventListener("click", () => setMode("move"));
document.getElementById("btnModeWall").addEventListener("click", () => setMode("wall"));
document.getElementById("btnRotate").addEventListener("click", () => {
  window.__wallOrientLocked = true;
  wallOrient = wallOrient === "h" ? "v" : "h";
  if (ghostWall) ghostWall = { ...ghostWall, orient: wallOrient };
  render();
});
document.getElementById("btnUndo").addEventListener("click", () => {
  const res = undo(game);
  if (res.ok) {
    game = res.game;
    ghostWall = null;
    render();
  }
});
document.getElementById("btnNew").addEventListener("click", newGame);
document.getElementById("btnPlayAgain").addEventListener("click", newGame);

overlayEl.addEventListener("pointermove", onOverlayMove);
overlayEl.addEventListener("pointerleave", onOverlayLeave);
overlayEl.addEventListener("click", onOverlayClick);

window.addEventListener("keydown", (e) => {
  if (e.key === "r" || e.key === "R") {
    window.__wallOrientLocked = true;
    wallOrient = wallOrient === "h" ? "v" : "h";
    if (ghostWall) ghostWall = { ...ghostWall, orient: wallOrient };
    render();
  } else if (e.key === "m" || e.key === "M") {
    setMode("move");
  } else if (e.key === "w" || e.key === "W") {
    window.__wallOrientLocked = false;
    setMode("wall");
  } else if ((e.key === "z" || e.key === "Z") && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    const res = undo(game);
    if (res.ok) {
      game = res.game;
      ghostWall = null;
      render();
    }
  }
});

// Double-click rotate unlocks auto-orient again
document.getElementById("btnRotate").addEventListener("dblclick", () => {
  window.__wallOrientLocked = false;
});

window.addEventListener("resize", () => {
  renderWalls();
  renderPawns();
});

buildBoard();
// Wait a frame so layout/fonts settle for pawn positioning
requestAnimationFrame(() => {
  render();
  requestAnimationFrame(render);
});
