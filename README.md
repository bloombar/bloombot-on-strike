# Bloombot-on-Strike

Automating the job of the Professor.

## Monorepo

This repository is a monorepo containing two loosely-coupled subsystems:

- `front-end/`: React.js-based front-end web app with embedded Zoom client. See front-end [README](./front-end/README.md) for more.
- `back-end/`: Express.js-based back-end server with authorization route for bot logging into Zoom. See back-end [README](./back-end/README.md) for more.

## How to run

- Install dependencies into both front- and back-ends (i.e. `npm install` in both)
- update `.env` files for both to suit your needs.
- Launch both front- and back-ends, then open browser to front end and play.
