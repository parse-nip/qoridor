# Quoridor / Walls — Understanding Checklist

Track mastery as we go. Don't check an item until you can explain it in your own words.

## 1. The problem

- [ ] What is Quoridor's win condition?
- [ ] Why do walls exist (what problem do they create for the opponent)?
- [ ] Why is "never fully block a path" a rule — what breaks without it?
- [ ] Jump branches: straight jump vs lateral jump — when does each apply?

## 2. The solution (this codebase)

- [ ] Board coords: who starts where, which row is whose goal?
- [ ] How a wall is stored (`r`, `c`, `orient`) and which square-edges it blocks
- [ ] Why `hasPathToGoal` (BFS) runs before every wall placement
- [ ] Why `wallsOverlap` treats same-line adjacency and h/v crossing differently
- [ ] How the UI ghost wall maps pointer → wall slot

## 3. Broader context

- [ ] What breaks for players if jump rules are wrong at the board edge?
- [ ] Impact of incorrect pathfinding (illegal traps vs allowing softlocks)
- [ ] Why this is deployed as static assets on a Worker (walls.popped.dev)

## Session notes

Built a 2-player neon-noir Quoridor (`public/`), rules in `public/game.js`, UI in `public/app.js` + `styles.css`, tests in `tests/game.test.js`.

**Update:** Clean lobby/game redesign + online multiplayer via Durable Object `GameRoom` (`src/index.js`) — WebSocket rooms on walls.popped.dev.

### Multiplayer extras to understand
- [ ] Why the server (DO) must be authoritative for moves/walls
- [ ] What a “seat” is (0 cyan / 1 pink / -1 spectator) and when you can act
- [ ] Why out-of-turn actions are rejected on the server, not only hidden in the UI
