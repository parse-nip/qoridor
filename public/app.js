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

const NAMES = ["Cyan", "Pink"];

const lobbyEl = document.getElementById("lobby");
const gameView = document.getElementById("gameView");
const boardEl = document.getElementById("board");
const overlayEl = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const roomMeta = document.getElementById("roomMeta");
const winModal = document.getElementById("winModal");
const winText = document.getElementById("winText");
const lobbyErr = document.getElementById("lobbyErr");
const btnCopy = document.getElementById("btnCopy");

/** @type {'lobby'|'local'|'online'} */
let playMode = "lobby";
let game = createGame();
let mode = "move";
let wallOrient = "h";
let ghostWall = null;
let seat = -1; // online seat
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
  overlayEl.classList.toggle("wall-mode", mode === "wall" && canAct());
  document.getElementById("btnModeMove").dataset.on = String(mode === "move");
  document.getElementById("btnModeWall").dataset.on = String(mode === "wall");

  document.getElementById("side0").classList.toggle("on", game.current === 0 && !game.winner);
  document.getElementById("side1").classList.toggle("on", game.current === 1 && !game.winner);
  document.getElementById("walls0").textContent = String(game.wallsLeft[0]);
  document.getElementById("walls1").textContent = String(game.wallsLeft[1]);

  // Move targets
  boardEl.querySelectorAll(".tile").forEach((t) => {
    t.classList.remove("move-target", "for-p0", "for-p1");
  });
  if (mode === "move" && canAct()) {
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
  if (ghostWall && mode === "wall" && canAct()) {
    const valid = isValidWallPlacement(game, { ...ghostWall, owner: game.current });
    const el = document.createElement("div");
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
    winText.style.color = game.winner === 0 ? "var(--cyan)" : "var(--pink)";
    winModal.hidden = false;
  } else {
    winModal.hidden = true;
  }
}

function pointerToWall(clientX, clientY) {
  const rect = boardEl.getBoundingClientRect();
  const styles = getComputedStyle(boardEl);
  const gapPx = parseFloat(styles.gap);
  const cell = boardEl.querySelector(".tile");
  const tilePx = cell.getBoundingClientRect().width;
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  let orient = wallOrient;
  if (!window.__wallOrientLocked) {
    const modY = y % (tilePx + gapPx);
    const modX = x % (tilePx + gapPx);
    const inH = modY > tilePx * 0.85;
    const inV = modX > tilePx * 0.85;
    if (inH && !inV) orient = "h";
    else if (inV && !inH) orient = "v";
    wallOrient = orient;
  }

  if (orient === "h") {
    let r = Math.round((y - tilePx) / (tilePx + gapPx));
    let c = Math.round(x / (tilePx + gapPx) - 0.5);
    r = Math.max(0, Math.min(WALL_GRID - 1, r));
    c = Math.max(0, Math.min(WALL_GRID - 1, c));
    return { r, c, orient: "h" };
  }
  let c = Math.round((x - tilePx) / (tilePx + gapPx));
  let r = Math.round(y / (tilePx + gapPx) - 0.5);
  r = Math.max(0, Math.min(WALL_GRID - 1, r));
  c = Math.max(0, Math.min(WALL_GRID - 1, c));
  return { r, c, orient: "v" };
}

function sendAction(payload) {
  if (playMode === "online" && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

function onTileClick(r, c) {
  if (mode !== "move" || !canAct()) return;
  if (sendAction({ type: "move", r, c })) return;
  const res = applyMove(game, { r, c });
  if (!res.ok) return;
  game = res.game;
  ghostWall = null;
  render();
}

function placeWall(wall) {
  if (!canAct()) return;
  if (sendAction({ type: "wall", r: wall.r, c: wall.c, orient: wall.orient })) {
    mode = "move";
    ghostWall = null;
    return;
  }
  const res = applyWall(game, wall);
  if (!res.ok) {
    statusEl.textContent =
      game.wallsLeft[game.current] <= 0
        ? "No walls left — move instead"
        : "Illegal wall";
    return;
  }
  game = res.game;
  ghostWall = null;
  mode = "move";
  render();
}

function setMode(next) {
  if (next === "wall" && game.wallsLeft[game.current] <= 0) {
    mode = "move";
    statusEl.textContent = "No walls left — move instead";
  } else {
    mode = next;
    if (next === "wall") window.__wallOrientLocked = false;
  }
  ghostWall = null;
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
  mode = "move";
  ghostWall = null;
  render();
}

function startLocal() {
  disconnect();
  playMode = "local";
  seat = -1;
  roomCode = "";
  game = createGame();
  mode = "move";
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
    if (msg.event === "wall" || msg.event === "move") mode = "move";
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
document.getElementById("btnModeMove").addEventListener("click", () => setMode("move"));
document.getElementById("btnModeWall").addEventListener("click", () => setMode("wall"));
document.getElementById("btnRotate").addEventListener("click", () => {
  window.__wallOrientLocked = true;
  wallOrient = wallOrient === "h" ? "v" : "h";
  if (ghostWall) ghostWall = { ...ghostWall, orient: wallOrient };
  render();
});
document.getElementById("btnUndo").addEventListener("click", doUndo);
document.getElementById("btnNew").addEventListener("click", doReset);
document.getElementById("btnPlayAgain").addEventListener("click", doReset);
document.getElementById("btnCopy").addEventListener("click", copyLink);
document.getElementById("joinCode").addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom();
});

overlayEl.addEventListener("pointermove", (e) => {
  if (mode !== "wall" || !canAct()) return;
  ghostWall = pointerToWall(e.clientX, e.clientY);
  render();
});
overlayEl.addEventListener("pointerleave", () => {
  ghostWall = null;
  render();
});
overlayEl.addEventListener("click", (e) => {
  if (mode !== "wall" || !canAct()) return;
  placeWall(pointerToWall(e.clientX, e.clientY));
});

window.addEventListener("keydown", (e) => {
  if (gameView.hidden) return;
  if (e.key === "r" || e.key === "R") {
    window.__wallOrientLocked = true;
    wallOrient = wallOrient === "h" ? "v" : "h";
    if (ghostWall) ghostWall = { ...ghostWall, orient: wallOrient };
    render();
  } else if (e.key === "m" || e.key === "M") setMode("move");
  else if (e.key === "w" || e.key === "W") setMode("wall");
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
