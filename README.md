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
- Up to three players join using their colour-specific QR code. During join, each player can choose an astronaut, car-racer or hazmat suit and optionally upload a profile photo; the photo is resized in the browser and displayed inside the character's visor. Without a photo, the visor remains black. The first player to join becomes the session controller and keeps controller privileges after reconnecting.
- The shared host display is split into a 70% upper game area and a 30% lower player strip. Each player column shows a QR code until that slot joins, then shows the player's live result and score.
- Level 1 is RGB Sequence Rush: complete R → G → B cycles. Config controls the target (1–100; default 20). A wrong button resets only the current cycle. Every valid input triggers a green O flash and a short success tone on the host display.
- Level 2 is Dice Reaction: three distinct values from 1–6 are rolled with a short shuffle animation. R means left, G means middle, and B means right. The largest value is the correct position. Correct answers use the same green O and success tone feedback. The first correct answer earns +1 and triggers the next roll. A wrong answer displays a red X and disqualifies that player for that roll; if all remaining connected players have answered incorrectly, the dice roll again. First to 8 correct answers places first, and play continues for second and third.
- Level 3 is Highway Dodge. Each player's phone shows an individual three-lane road. R moves left, G moves to the centre and B moves right. The player's uploaded profile photo appears as a round marker; without a photo, a car icon is used. Dodge randomly spawned cars, taxis, vans, trucks and other traffic. A collision plays a crash animation and pauses that player's distance progress for 2 seconds. The simulated distance starts at 100 metres per second and accelerates as the race progresses, up to 2.5×. First to 3,000 metres places first; the remaining players continue until second and third place are decided.
- Level 4 is Rocket Flight: each player's phone becomes an individual Flappy Bird-style flight screen. Tap anywhere (or press Space/Enter/Up) to boost the rocket. An uploaded profile photo appears inside its circular rocket window; otherwise a rocket emoji is shown. Pass 20 moving blockers to finish. The first player to 20 places first while the other players continue. Obstacle speed, gap width and vertical drift increase after blockers 6, 12 and 18. A collision briefly resets the rocket to the centre with a short recovery pause; blocker progress is retained.
- Level 5 is Burger Builder and returns to the shared-screen layout (70% common game area, 30% player strip). The host shows a random recipe containing 4–8 ingredients per round. R = meat, G = vegetable and B = tomato. Players enter the recipe in order on their phones; each press animates its ingredient falling into the shared burger area. A wrong ingredient disqualifies that player for the current recipe only. The first player to finish a recipe earns 1 point, then a new recipe appears. Completing a burger animates the top bread closing. First to 6 points places first; the other players continue until second and third place are decided.
- All levels award placement points: 1st = 5, 2nd = 3, 3rd = 1. Cumulative points carry between levels.
- All players can pause/resume and move to the next level once the current level is finished. Only the controller can start/reset a level or configure Level 1. Levels 2, 4 and 5 run through all three placements automatically and cannot be manually finished early.
- Reset removes points awarded in the current level and clears its progress while preserving points from earlier levels.
- The desktop is a shared display for Levels 1 and 2. Level 3 gameplay is rendered independently on each player's phone, while the desktop shows the live distance and speed standings. All gameplay input comes from the phones.

## Input handling
Mobile buttons use pointer events so touch input is sent immediately without waiting for the browser's synthetic click event. Each touch has a monotonically increasing input ID; the server rejects duplicate IDs. Level 2 inputs also include the current dice-round ID, so late taps from a previous roll cannot score against the next roll. Socket.IO preserves event order for each player connection, and the Node server processes each event handler synchronously, so rapid and simultaneous touches are applied one by one in arrival order.

## Commands
- `npm run dev`
- `npm run build`
- `npm start`
- `npm test`

## Current limitations
Session state and scores are in memory. Persistent scores, Supabase Auth, and the wider game library remain future work. Player photos are currently held in in-memory session state and are lost when the server restarts. Use HTTPS in production, restrict allowed origins, and use persistent/shared session storage before running multiple server instances.
