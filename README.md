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

## RGB Sequence Rush
- Up to three players join using their colour-specific QR code.
- The first player to join becomes the session controller. That player keeps controller privileges if they disconnect and reconnect.
- Every player can pause/resume and move to the next level once the current level is finished.
- Only the controller can start/reset/finish a level or change configuration.
- Config currently controls the required number of R → G → B cycles (1–100; default 20).
- A wrong button resets only the current cycle. Completing the sequence adds one cycle.
- First to the configured target places first. Placement points per level: 1st = 5, 2nd = 3, 3rd = 1. Cumulative points carry between levels.
- Reset removes any points awarded in the current level, clears that level's progress and returns it to waiting; points from earlier levels remain.
- The desktop is a display-only scoreboard. Player phones provide game input and controls.
- A player's QR code disappears from the host display once that slot has joined.

## Input handling
Mobile buttons use pointer events so touch input is sent immediately without waiting for the browser's synthetic click event. Each touch has a monotonically increasing input ID; the server rejects duplicate IDs. Socket.IO preserves event order for each player connection, and the Node server processes each event handler synchronously, so rapid and simultaneous touches are applied one by one in arrival order. Different players' inputs are also processed sequentially by the server.

## Commands
- `npm run dev`
- `npm run build`
- `npm start`
- `npm test`

## Current limitations
Session state and scores are in memory. Avatar uploads, persistent scores, Supabase Auth, and the wider game library remain future work. Use HTTPS in production, restrict allowed origins, and use persistent/shared session storage before running multiple server instances.
