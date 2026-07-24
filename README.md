# Walls

Clean neon Quoridor for two — local hotseat or online rooms.

**Live:** [walls.popped.dev](https://walls.popped.dev)

## Play

- **New room** — host a match, share the code/link
- **Join** — enter a room code
- **Play on this device** — pass-and-play

## Dev

```bash
npm test
npm run dev
```

## Deploy

```bash
CLOUDFLARE_API_TOKEN=… npm run deploy
```

Uses Cloudflare Workers + Durable Objects (one `GameRoom` per code) for authoritative multiplayer over WebSockets.
