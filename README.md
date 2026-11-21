# RGB Multiplayer

Node.js + Phaser 3 multiplayer party-game scaffold. A desktop host displays the shared Phaser game while up to three players join through mobile browsers.

## Requirements
- Node.js 20+
- npm

## Local setup
1. Run npm install.
2. Copy .env.example to .env if you need custom settings.
3. Run npm run dev.
4. Open http://localhost:5173/host/.

## Temporary whitelist accounts
whitelist.json stores scrypt password hashes, not plaintext passwords.

| Username | Temporary password | Role |
|---|---|---|
| admin | 122333 | admin |
| usera | 455666 | user |

These are demo credentials committed to a public repository. Replace them before public deployment and never reuse them elsewhere. Supabase Auth is a planned replacement for this temporary whitelist.

## Commands
- npm run dev
- npm run build
- npm start
- npm test

## Scaffold status
Includes whitelist login, host session creation, three unique QR join links, mobile name registration, server-validated RGB input, Socket.IO host subscription and a Phaser reaction display. Player avatar upload, session expiry, reconnect grace period, live host slot status, pause/reset/configuration controls and the reusable multi-game framework remain follow-up work.

Use HTTPS in production, restrict allowed origins, and use persistent/shared session storage before running multiple server instances.
