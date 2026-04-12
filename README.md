# battleship-ascii

3D ASCII multiplayer battleship with cockpit animations, torpedoes, submarines, and an in-game market.

## Stack

- **Monorepo**: npm workspaces (`shared/`, `server/`, `client/`)
- **Server**: Node + TypeScript + [Colyseus](https://colyseus.io/) (rooms, state sync, reconnection)
- **Client**: [Ink](https://github.com/vadimdemedes/ink) (React for terminals) + `colyseus.js`
- **Shared**: TypeScript types + [Zod](https://zod.dev/) message schemas
- **3D grid**: 10×10×4 voxel grid projected isometrically into ASCII (surface layer + 3 underwater layers for subs/torpedoes/depth charges)

## Layout

```
shared/   types, zod message schemas, ship & weapon specs
server/   Colyseus BattleRoom, authoritative state
client/   Ink TUI: grid view, cockpit, HUD
```

## Run

```bash
npm install
npm run dev:server        # terminal 1
npm run dev:client        # terminal 2 (open two for multiplayer)
```

## Controls

- arrows — move cursor on X/Y
- `q` / `e` — change depth (z)
- space — fire current weapon at cursor
- `r` — ready up

## Roadmap

- [ ] Ship placement UI with axis rotation
- [ ] Weapon inventory + market phase between rounds
- [ ] Torpedo travel animation across a row
- [ ] Sonar ping reveals (fog of war)
- [ ] Spectator mode & lobby browser
- [ ] Persistent accounts / credits (Postgres + Drizzle)
