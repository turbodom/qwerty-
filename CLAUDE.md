# Короны Пустоши

Online turn-based strategy in the spirit of Heroes of Might and Magic 3, built for Pi Network (runs in Pi Browser).
Architecture and cross-package contracts: `docs/ARCHITECTURE.md`. Game design: `docs/plan.md`. Playable single-file prototype with the reference rules and balance: `docs/prototype.html`.

## Commands
- `npm install` at the repo root (npm workspaces).
- `npm run check`: typecheck + tests + client build. Run it before every commit.
- `npm run dev:server` (port 2567) and `npm run dev:client` (port 5173).

## Conventions
- TypeScript strict everywhere; use `import type` for type-only imports.
- `packages/shared` is pure and deterministic: no DOM, no Node APIs, no `Math.random`, no `Date`. All randomness goes through `createRng` and the state stored in `GameState`/`Battle`.
- Game state is plain JSON. Do not put classes, Maps, Sets or functions into it.
- The server is authoritative. The client only sends `GameAction`s and renders `PlayerView`s.
- Player-facing text is Russian by default and goes through the client i18n module; code identifiers and comments are English.
- Pi payment amounts always come from `SHOP_ITEMS` on the server, never from the client.
- Never commit secrets. `PI_API_KEY` and `SESSION_SECRET` come from the environment (`.env.example` lists them).
