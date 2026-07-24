# Walls — Quoridor

Neon-noir Quoridor for two players. Race your pawn to the opposite baseline while fencing paths with glowing walls.

## Play

```bash
npx wrangler dev
```

Open the local URL, or open `public/index.html` via any static server.

## Rules (2 players)

- 9×9 board; each player starts at the center of their baseline with **10 walls**
- On your turn: **move** one orthogonal step, or **place** a wall spanning two gaps
- You may **jump** an adjacent opponent; if the square behind is blocked, jump sideways
- A wall may never cut off **either** player's last path to their goal
- First pawn to any square on the opposite edge wins

## Deploy

```bash
CLOUDFLARE_API_TOKEN=… npx wrangler deploy
```

Serves at [walls.popped.dev](https://walls.popped.dev).

## Test

```bash
npm test
```
