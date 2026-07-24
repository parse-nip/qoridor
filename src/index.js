import { DurableObject } from "cloudflare:workers";
import {
  createGame,
  applyMove,
  applyWall,
  undo,
} from "../public/game.js";

/**
 * One Durable Object per room code.
 * Seats: 0 = cyan, 1 = pink. Extra connections are spectators.
 */
export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.game = null;
  }

  async ensureLoaded() {
    if (this.game) return;
    const stored = await this.ctx.storage.get("game");
    this.game = stored || createGame();
  }

  async persist() {
    await this.ctx.storage.put("game", this.game);
  }

  async fetch(request) {
    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    await this.ensureLoaded();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    const url = new URL(request.url);
    const seat = this.assignSeat(server);
    server.serializeAttachment({
      seat,
      id: crypto.randomUUID(),
      room: url.searchParams.get("room") || "",
    });

    this.send(server, {
      type: "welcome",
      seat,
      room: url.searchParams.get("room") || "",
      state: this.publicState(),
      seats: this.seatSnapshot(),
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  assignSeat(ws) {
    const taken = new Set();
    for (const sock of this.ctx.getWebSockets()) {
      if (sock === ws) continue;
      const att = sock.deserializeAttachment();
      if (att && (att.seat === 0 || att.seat === 1)) taken.add(att.seat);
    }
    if (!taken.has(0)) return 0;
    if (!taken.has(1)) return 1;
    return -1;
  }

  seatSnapshot() {
    const seats = { 0: false, 1: false, spectators: 0 };
    for (const sock of this.ctx.getWebSockets()) {
      const att = sock.deserializeAttachment() || {};
      if (att.seat === 0) seats[0] = true;
      else if (att.seat === 1) seats[1] = true;
      else seats.spectators += 1;
    }
    return seats;
  }

  publicState() {
    return {
      pawns: this.game.pawns,
      walls: this.game.walls,
      wallsLeft: this.game.wallsLeft,
      current: this.game.current,
      winner: this.game.winner,
    };
  }

  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const sock of this.ctx.getWebSockets()) {
      try {
        sock.send(data);
      } catch {
        /* ignore */
      }
    }
  }

  async webSocketMessage(ws, message) {
    await this.ensureLoaded();
    let msg;
    try {
      msg = JSON.parse(
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message)
      );
    } catch {
      return;
    }

    const att = ws.deserializeAttachment() || { seat: -1 };
    const seat = att.seat;

    if (msg.type === "ping") {
      this.send(ws, { type: "pong" });
      return;
    }

    if (msg.type === "sync") {
      this.send(ws, {
        type: "state",
        state: this.publicState(),
        seats: this.seatSnapshot(),
      });
      return;
    }

    if (msg.type === "reset") {
      if (seat !== 0 && seat !== 1) return;
      this.game = createGame();
      await this.persist();
      this.broadcast({
        type: "state",
        state: this.publicState(),
        seats: this.seatSnapshot(),
        event: "reset",
      });
      return;
    }

    if (msg.type === "undo") {
      if (seat !== 0 && seat !== 1) return;
      const res = undo(this.game);
      if (!res.ok) {
        this.send(ws, { type: "error", error: res.error });
        return;
      }
      this.game = res.game;
      await this.persist();
      this.broadcast({
        type: "state",
        state: this.publicState(),
        seats: this.seatSnapshot(),
        event: "undo",
      });
      return;
    }

    if (this.game.winner !== null) {
      this.send(ws, { type: "error", error: "Game over" });
      return;
    }

    if (seat !== this.game.current) {
      this.send(ws, { type: "error", error: "Not your turn" });
      return;
    }

    if (msg.type === "move") {
      const res = applyMove(this.game, { r: msg.r, c: msg.c });
      if (!res.ok) {
        this.send(ws, { type: "error", error: res.error });
        return;
      }
      this.game = res.game;
      await this.persist();
      this.broadcast({
        type: "state",
        state: this.publicState(),
        seats: this.seatSnapshot(),
        event: "move",
      });
      return;
    }

    if (msg.type === "wall") {
      const res = applyWall(this.game, {
        r: msg.r,
        c: msg.c,
        orient: msg.orient,
      });
      if (!res.ok) {
        this.send(ws, { type: "error", error: res.error });
        return;
      }
      this.game = res.game;
      await this.persist();
      this.broadcast({
        type: "state",
        state: this.publicState(),
        seats: this.seatSnapshot(),
        event: "wall",
      });
    }
  }

  async webSocketClose() {
    try {
      this.broadcast({ type: "seats", seats: this.seatSnapshot() });
    } catch {
      /* ignore */
    }
  }

  async webSocketError() {}
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/new") {
      return Response.json({ code: randomCode() });
    }

    // /api/room/:code or /api/room/:code/ws
    const match = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]+)(?:\/ws)?\/?$/);
    if (match) {
      const code = match[1].toUpperCase();
      if (code.length < 4 || code.length > 8) {
        return new Response("Invalid room code", { status: 400 });
      }

      const upgrade = request.headers.get("Upgrade");
      if (!upgrade || upgrade.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      try {
        const stub = env.GAME_ROOM.getByName(code);
        // Pass room code through query for the DO welcome payload
        const forwardUrl = new URL(request.url);
        forwardUrl.searchParams.set("room", code);
        return stub.fetch(new Request(forwardUrl.toString(), request));
      } catch (err) {
        return new Response(`DO error: ${err?.message || String(err)}`, {
          status: 500,
        });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
