# RGB Multiplayer

Node.js + Phaser 3 multiplayer party-game scaffold. A desktop host displays the shared Phaser game while up to three players join through mobile browsers.

## Requirements
- Node.js 20+
- npm

## Local setup
1. Run `npm install`.
2. Copy `.env.example` to `.env`.
3. For phone testing on the same Wi-Fi, set `PUBLIC_BASE_URL` in `.env` to the host computer's LAN address, for example `http://192.168.1.25:5173`. Allow ports 3000 and 5173 through the computer firewall.
4. Run `npm run dev`.
5. Open `http://localhost:5173/host/` on the host computer.

## Temporary whitelist accounts
`whitelist.json` stores scrypt password hashes, not plaintext passwords.

| Username | Temporary password | Role |
|---|---|---|
| admin | 122333 | admin |
| usera | 455666 | user |

These are demo credentials committed to a public repository. Replace them before public deployment and never reuse them elsewhere. Supabase Auth is a planned replacement for this temporary whitelist.

## RGB Sequence Rush (first playable scene)
- Up to three players join using their colour-specific QR code.
- The fixed sequence is **R → G → B**. A wrong button resets only the current cycle.
- Completing R, G and B in order adds one cycle. First to 20 cycles places first.
- Players who finish continue to appear on the scoreboard while remaining players race for second and third.
- Placement points per level: 1st = 5, 2nd = 3, 3rd = 1. Players who do not finish before the host ends the level earn 0.
- The host can start, pause/resume, manually finish a level and start the next level.
- Cumulative points carry between levels; cycle progress resets for each new level.
- The level automatically finishes when every participant in that level has completed 20 cycles.

## Commands
- `npm run dev`
- `npm run build`
- `npm start`
- `npm test`

## Current limitations
This milestone implements one game scene and in-memory session state. Avatar uploads, session expiry, persistent scores, Supabase Auth, and the wider 10–20 game library remain future work. Player reconnection preserves current cycle progress. The host can manually finish the level if a player does not return.

Use HTTPS in production, restrict allowed origins, and use persistent/shared session storage before running multiple server instances.
