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

const NAMES = ["Teal", "Rose"];

const lobbyEl = document.getElementById("lobby");
const gameView = document.getElementById("gameView");
const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const roomMeta = document.getElementById("roomMeta");
const winModal = document.getElementById("winModal");
const winText = document.getElementById("winText");
const lobbyErr = document.getElementById("lobbyErr");
const btnCopy = document.getElementById("btnCopy");

let playMode = "lobby";
let game = createGame();
let ghostWall = null;
let seat = -1;
let roomCode = "";
/** @type {WebSocket|null} */
let socket = null;
let seats = { 0: false, 1: false, spectators: 0 };

function showLobby() {
  playMode = "lobby";
  lobbyEl.hidden = false;
  gameView.hidden = true;
  winModal.hidden = true;
  disconnect();
  history.replaceState(null, "", "/");
}

function showGame() {
  lobbyEl.hidden = true;
  gameView.hidden = false;
}

function disconnect() {
  if (socket) {
    socket.onclose = null;
    socket.onmessage = null;
    socket.close();
    socket = null;
  }
}

function setLobbyError(msg) {
  if (!msg) {
    lobbyErr.hidden = true;
    lobbyErr.textContent = "";
    return;
  }
  lobbyErr.hidden = false;
  lobbyErr.textContent = msg;
}

function canAct() {
  if (game.winner !== null) return false;
  if (playMode === "local") return true;
  if (playMode === "online") return seat === game.current;
  return false;
}

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
  const styles = getComputedStyle(boardEl);
  const gapPx = parseFloat(styles.gap);
  const cell = boardEl.querySelector(".tile");
  const tilePx = cell.getBoundingClientRect().width;
  const thick = Math.max(3, gapPx * 0.4);

  if (wall.orient === "h") {
    const y = (wall.r + 1) * tilePx + wall.r * gapPx + gapPx / 2;
    const x = wall.c * (tilePx + gapPx);
    return {
      left: x,
      top: y - thick / 2,
      width: tilePx * 2 + gapPx,
      height: thick,
    };
  }
  const x = (wall.c + 1) * tilePx + wall.c * gapPx + gapPx / 2;
  const y = wall.r * (tilePx + gapPx);
  return {
    left: x - thick / 2,
    top: y,
    width: thick,
    height: tilePx * 2 + gapPx,
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
    boardEl.appendChild(pawn);
  }
}

function applyState(state) {
  game = {
    ...game,
    pawns: state.pawns,
    walls: state.walls,
    wallsLeft: state.wallsLeft,
    current: state.current,
    winner: state.winner,
    history: game.history || [],
  };
}

function render() {
  document.getElementById("side0").classList.toggle("on", game.current === 0 && !game.winner);
  document.getElementById("side1").classList.toggle("on", game.current === 1 && !game.winner);
  document.getElementById("walls0").textContent = String(game.wallsLeft[0]);
  document.getElementById("walls1").textContent = String(game.wallsLeft[1]);

  // Move targets — always when you can act
  boardEl.querySelectorAll(".tile").forEach((t) => {
    t.classList.remove("move-target", "for-p0", "for-p1");
  });
  if (canAct()) {
    for (const m of getLegalMoves(game)) {
      const tile = boardEl.querySelector(`[data-r="${m.r}"][data-c="${m.c}"]`);
      if (tile) tile.classList.add("move-target", `for-p${game.current}`);
    }
  }

  // Walls
  boardEl.querySelectorAll(".wall").forEach((el) => el.remove());
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

  // Ghost only for viable placements
  if (ghostWall && canAct() && game.wallsLeft[game.current] > 0) {
    const valid = isValidWallPlacement(game, {
      ...ghostWall,
      owner: game.current,
    });
    if (valid) {
      const el = document.createElement("div");
      el.className = `wall ${ghostWall.orient} owner-${game.current} ghost`;
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

  // Pawns
  for (let p = 0; p < 2; p++) {
    const pawn = document.getElementById(`pawn${p}`);
    const { r, c } = game.pawns[p];
    const { x, y } = tileCenter(r, c);
    const size = pawn.offsetWidth || 28;
    pawn.style.left = `${x - size / 2}px`;
    pawn.style.top = `${y - size / 2}px`;
  }

  // Status
  if (game.winner !== null) {
    statusEl.innerHTML = `<strong>${NAMES[game.winner]}</strong> wins`;
  } else if (playMode === "online") {
    const waiting =
      (!seats[0] || !seats[1]) &&
      `<span> · waiting for opponent</span>`;
    if (seat === game.current) {
      statusEl.innerHTML = `<span class="you ${seat === 1 ? "pink" : ""}">Your turn</span> · ${NAMES[game.current]} · ${game.wallsLeft[game.current]} walls${waiting || ""}`;
    } else if (seat === -1) {
      statusEl.innerHTML = `Spectating · <strong>${NAMES[game.current]}</strong> to move`;
    } else {
      statusEl.innerHTML = `Waiting · <strong>${NAMES[game.current]}</strong> to move${waiting || ""}`;
    }
  } else {
    statusEl.innerHTML = `<strong>${NAMES[game.current]}</strong> to move · ${game.wallsLeft[game.current]} walls`;
  }

  if (playMode === "online" && roomCode) {
    roomMeta.textContent = roomCode;
    btnCopy.hidden = false;
  } else {
    roomMeta.textContent = playMode === "local" ? "Local" : "";
    btnCopy.hidden = true;
  }

  if (game.winner !== null) {
    winText.textContent = `${NAMES[game.winner]} wins`;
    winText.style.color = game.winner === 0 ? "var(--a)" : "var(--b)";
    winModal.hidden = false;
  } else {
    winModal.hidden = true;
  }
}

/** @returns {{ inGutter: boolean, wall: {r:number,c:number,orient:'h'|'v'}|null }} */
function pointerInfo(clientX, clientY) {
  const rect = boardEl.getBoundingClientRect();
  const styles = getComputedStyle(boardEl);
  const gapPx = parseFloat(styles.gap);
  const cell = boardEl.querySelector(".tile");
  const tilePx = cell.getBoundingClientRect().width;
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  if (x < -2 || y < -2 || x > rect.width + 2 || y > rect.height + 2) {
    return { inGutter: false, wall: null };
  }

  const stride = tilePx + gapPx;
  const modX = ((x % stride) + stride) % stride;
  const modY = ((y % stride) + stride) % stride;
  // Expand hit zone into the tile edges so gutters are easy to aim
  const slop = Math.max(6, gapPx * 0.9);
  const inHGutter = modY >= tilePx - slop && modY <= tilePx + gapPx + slop;
  const inVGutter = modX >= tilePx - slop && modX <= tilePx + gapPx + slop;

  if (!inHGutter && !inVGutter) {
    return { inGutter: false, wall: null };
  }

  let orient;
  if (inHGutter && !inVGutter) orient = "h";
  else if (inVGutter && !inHGutter) orient = "v";
  else {
    const distH = Math.abs(modY - tilePx - gapPx / 2);
    const distV = Math.abs(modX - tilePx - gapPx / 2);
    orient = distH <= distV ? "h" : "v";
  }

  if (orient === "h") {
    let r = Math.round((y - tilePx) / stride);
    let c = Math.round(x / stride - 0.5);
    r = Math.max(0, Math.min(WALL_GRID - 1, r));
    c = Math.max(0, Math.min(WALL_GRID - 1, c));
    return { inGutter: true, wall: { r, c, orient: "h" } };
  }

  let c = Math.round((x - tilePx) / stride);
  let r = Math.round(y / stride - 0.5);
  r = Math.max(0, Math.min(WALL_GRID - 1, r));
  c = Math.max(0, Math.min(WALL_GRID - 1, c));
  return { inGutter: true, wall: { r, c, orient: "v" } };
}

function sendAction(payload) {
  if (playMode === "online" && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

function onTileClick(r, c) {
  if (!canAct()) return;
  // Prefer placing a visible viable ghost wall over moving
  if (
    ghostWall &&
    isValidWallPlacement(game, { ...ghostWall, owner: game.current })
  ) {
    placeWall(ghostWall);
    return;
  }
  if (sendAction({ type: "move", r, c })) return;
  const res = applyMove(game, { r, c });
  if (!res.ok) return;
  game = res.game;
  ghostWall = null;
  render();
}

function placeWall(wall) {
  if (!canAct()) return;
  if (!isValidWallPlacement(game, { ...wall, owner: game.current })) return;
  if (sendAction({ type: "wall", r: wall.r, c: wall.c, orient: wall.orient })) {
    ghostWall = null;
    return;
  }
  const res = applyWall(game, wall);
  if (!res.ok) return;
  game = res.game;
  ghostWall = null;
  render();
}

function updateGhost(clientX, clientY) {
  if (!canAct() || game.wallsLeft[game.current] <= 0) {
    if (ghostWall) {
      ghostWall = null;
      render();
    }
    return;
  }
  const info = pointerInfo(clientX, clientY);
  const next =
    info.inGutter &&
    info.wall &&
    isValidWallPlacement(game, { ...info.wall, owner: game.current })
      ? info.wall
      : null;

  const same =
    (!next && !ghostWall) ||
    (next &&
      ghostWall &&
      next.r === ghostWall.r &&
      next.c === ghostWall.c &&
      next.orient === ghostWall.orient);
  if (same) return;
  ghostWall = next;
  render();
}

function doUndo() {
  if (playMode === "online") {
    sendAction({ type: "undo" });
    return;
  }
  const res = undo(game);
  if (res.ok) {
    game = res.game;
    ghostWall = null;
    render();
  }
}

function doReset() {
  if (playMode === "online") {
    sendAction({ type: "reset" });
    return;
  }
  game = createGame();
  ghostWall = null;
  render();
}

function startLocal() {
  disconnect();
  playMode = "local";
  seat = -1;
  roomCode = "";
  game = createGame();
  ghostWall = null;
  showGame();
  render();
}

function wsUrl(code) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/api/room/${code}/ws`;
}

function onSocketMessage(ev) {
  let msg;
  try {
    msg = JSON.parse(ev.data);
  } catch {
    return;
  }

  if (msg.type === "welcome") return;

  if (msg.type === "state") {
    applyState(msg.state);
    if (msg.seats) seats = msg.seats;
    ghostWall = null;
    if (msg.event === "wall" || msg.event === "move") ghostWall = null;
    render();
    return;
  }

  if (msg.type === "seats") {
    seats = msg.seats;
    render();
    return;
  }

  if (msg.type === "error") {
    statusEl.textContent = msg.error;
  }
}

function connectOnce(code) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(code));
    let settled = false;

    const timer = setTimeout(() => {
      fail("Connection timed out");
    }, 10000);

    const fail = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error(reason));
    };

    ws.addEventListener("message", (ev) => {
      if (settled) {
        onSocketMessage(ev);
        return;
      }

      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.type !== "welcome") return;

      settled = true;
      clearTimeout(timer);
      socket = ws;
      seat = msg.seat;
      if (msg.state) applyState(msg.state);
      if (msg.seats) seats = msg.seats;
      playMode = "online";
      roomCode = code;
      history.replaceState(null, "", `/?room=${code}`);
      showGame();
      render();
      resolve({ seat, code, ws });
    });

    ws.addEventListener("close", (ev) => {
      if (!settled) {
        const hint =
          ev.code === 1006
            ? "WebSocket blocked or failed — try again, or disable VPN/adblock"
            : `Closed before welcome (${ev.code})`;
        fail(hint);
        return;
      }
      if (playMode === "online" && socket === ws) {
        statusEl.textContent = "Disconnected — use Leave, then rejoin";
      }
    });

    ws.addEventListener("error", () => {
      setTimeout(() => {
        if (!settled) fail("Could not open WebSocket — try again");
      }, 400);
    });
  });
}

async function connectRoom(code, { attempts = 3 } = {}) {
  const normalized = String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (normalized.length < 4 || normalized.length > 8) {
    throw new Error("Enter a valid room code");
  }

  disconnect();
  roomCode = normalized;
  setLobbyError("Connecting…");

  try {
    const pre = await fetch(`/api/room/${normalized}`, { cache: "no-store" });
    if (!pre.ok) {
      const text = await pre.text();
      throw new Error(text || `Room preflight failed (${pre.status})`);
    }
  } catch (err) {
    console.warn("preflight", err);
  }

  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await connectOnce(normalized);
      setLobbyError("");
      return result;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr || new Error("Could not connect");
}

async function createRoom() {
  setLobbyError("Creating room…");
  try {
    const res = await fetch("/api/new", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not create room");
    const data = await res.json();
    if (!data.code) throw new Error("Server did not return a room code");
    await connectRoom(data.code);
  } catch (e) {
    setLobbyError(e.message || "Failed to create room");
  }
}

async function joinRoom() {
  setLobbyError("");
  const code = document.getElementById("joinCode").value.trim();
  try {
    await connectRoom(code);
  } catch (e) {
    setLobbyError(e.message || "Failed to join");
  }
}

async function copyLink() {
  const url = `${location.origin}/?room=${roomCode}`;
  try {
    await navigator.clipboard.writeText(url);
    statusEl.textContent = "Link copied";
    setTimeout(() => render(), 1200);
  } catch {
    statusEl.textContent = url;
  }
}

// Events
document.getElementById("btnCreate").addEventListener("click", createRoom);
document.getElementById("btnJoin").addEventListener("click", joinRoom);
document.getElementById("btnLocal").addEventListener("click", startLocal);
document.getElementById("btnLeave").addEventListener("click", showLobby);
document.getElementById("btnUndo").addEventListener("click", doUndo);
document.getElementById("btnNew").addEventListener("click", doReset);
document.getElementById("btnPlayAgain").addEventListener("click", doReset);
document.getElementById("btnCopy").addEventListener("click", copyLink);
document.getElementById("joinCode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom();
});

const boardFrame = document.querySelector(".board-frame");

boardFrame.addEventListener("pointermove", (e) => {
  updateGhost(e.clientX, e.clientY);
});

boardFrame.addEventListener("pointerleave", () => {
  if (!ghostWall) return;
  ghostWall = null;
  render();
});

boardFrame.addEventListener("click", (e) => {
  if (e.target.closest(".tile")) return; // tile click handles move / ghost place
  const info = pointerInfo(e.clientX, e.clientY);
  if (
    info.inGutter &&
    info.wall &&
    canAct() &&
    isValidWallPlacement(game, { ...info.wall, owner: game.current })
  ) {
    placeWall(info.wall);
  }
});

window.addEventListener("resize", () => render());

buildBoard();

// Deep link ?room=CODE
const params = new URLSearchParams(location.search);
const deep = params.get("room");
if (deep) {
  connectRoom(deep).catch((e) => {
    showLobby();
    setLobbyError(e.message || "Could not join room");
  });
} else {
  showLobby();
}
