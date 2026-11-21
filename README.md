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

## Game levels
- Up to three players join using their colour-specific QR code. The first player to join becomes the session controller and keeps controller privileges after reconnecting.
- The shared host display is split into a 70% upper game area and a 30% lower player strip. Each player column shows a QR code until that slot joins, then shows the player's live result and score.
- Level 1 is RGB Sequence Rush: complete R → G → B cycles. Config controls the target (1–100; default 20). A wrong button resets only the current cycle.
- Level 2 is Dice Reaction: three distinct values from 1–6 are rolled. R means left, G means middle, and B means right. The largest value is the correct position. The first correct answer earns +1 and triggers the next roll. A wrong answer displays a red X and disqualifies that player for that roll; if all remaining connected players have answered incorrectly, the dice roll again. First to 8 correct answers places first, and play continues for second and third.
- Both levels award placement points: 1st = 5, 2nd = 3, 3rd = 1. Cumulative points carry between levels.
- All players can pause/resume and move to the next level once the current level is finished. Only the controller can start/reset/finish a level or configure Level 1.
- Reset removes points awarded in the current level and clears its progress while preserving points from earlier levels.
- The desktop is a shared display; all gameplay input and player controls come from the phones.

## Input handling
Mobile buttons use pointer events so touch input is sent immediately without waiting for the browser's synthetic click event. Each touch has a monotonically increasing input ID; the server rejects duplicate IDs. Level 2 inputs also include the current dice-round ID, so late taps from a previous roll cannot score against the next roll. Socket.IO preserves event order for each player connection, and the Node server processes each event handler synchronously, so rapid and simultaneous touches are applied one by one in arrival order.

## Commands
- `npm run dev`
- `npm run build`
- `npm start`
- `npm test`

## Current limitations
Session state and scores are in memory. Avatar uploads, persistent scores, Supabase Auth, and the wider game library remain future work. Use HTTPS in production, restrict allowed origins, and use persistent/shared session storage before running multiple server instances.
