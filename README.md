# Secret Santa Draw (Persistent)

A minimal Secret Santa web app backed by a small Node server. Drawn names are written to `data/state.json` so once someone reveals their match the giver is removed from the picker and the recipient leaves the draw pool—even if you restart the server.

## Getting started

1. Install Node.js 18 or newer.
2. From this folder run `npm start`.
3. Open [http://localhost:3000](http://localhost:3000) in your browser.

The first time you run the server it creates `data/state.json`. Each reveal updates that file so the state survives restarts.

## Customising participants

Edit the `PARTICIPANTS` array near the top of [`server.js`](./server.js). You can also add optional exclusions in the `EXCLUSIONS` object (e.g. prevent partners from drawing each other). Restart the server after changing the list. If you change the roster the server automatically regenerates a fresh assignment file.

## Resetting draws

Use the **Reset** button in the UI or stop the server and delete `data/state.json`. Both approaches clear all previously revealed matches and rebuild the assignments from scratch.

## Development scripts

- `npm start` – runs the HTTP server.
- `npm test` – quick syntax check (`node --check server.js`).

Feel free to extend the project (e.g. add authentication or export assignments) by building on the existing API endpoints in `server.js`.
