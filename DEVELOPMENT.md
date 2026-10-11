# Running, testing and deploying Bloombot-on-Strike

The app has two parts that run separately:

| Part | What it does | Runs where |
| --- | --- | --- |
| `client/` | React + Vite web page. Shows a remark slide deck in an iframe and a HeyGen LiveAvatar that narrates each slide. | Your browser. Deployed to GitHub Pages. |
| `python-server/` | WebSocket relay. Asks OpenAI what to say about each slide, and mints LiveAvatar session tokens. | Your machine, or the production droplet (pm2 process `scabbot`). |

The page and the server are linked only by the `wss` query parameter in the page's URL (section 4).

## 1. Prerequisites

- **Node.js 24** (CI uses 24) and npm
- **Python 3.11** and [pipenv](https://pipenv.pypa.io/en/latest/installation.html)
- An **OpenAI** API key, with credits
- A **HeyGen LiveAvatar** API key, with credits. **Every avatar session costs credits while it runs.**
- Optional:
  - [ngrok](https://ngrok.com/), to reach your local server from elsewhere
  - A [Recall.ai](https://www.recall.ai/) token, to put the bot in a Zoom call
  - Docker and [`act`](https://github.com/nektos/act) 0.2.89 or newer, to run the CI workflow in containers
  - [`actionlint`](https://github.com/rhysd/actionlint)

## 2. One-time setup

```bash
git clone https://github.com/bloombar/bloombot-on-strike.git
cd bloombot-on-strike

pipenv install            # Python deps, from Pipfile.lock at the repo root
(cd client && npm ci)     # client deps, from package-lock.json
```

Create the two env files from their templates. The templates are named `env.example`, with no leading dot.

```bash
cp python-server/env.example python-server/.env
cp client/env.example client/.env
```

Then fill them in:

- **`python-server/.env`**:

  | Setting | Value |
  | --- | --- |
  | `OPENAI_API_KEY`, `LIVEAVATAR_API_KEY` | your keys |
  | `MODE` | `development` locally (plain `ws://`). `production` on the droplet (`wss://`, section 6.2). |
  | `LIVEAVATAR_SANDBOX_MODE` | `false` for real sessions |
  | `LIVEAVATAR_MAX_SESSION_DURATION` | leave blank to use your plan's limit. **Never `0`**: that made the avatar disconnect and reconnect every few seconds. |
  | `PORT` | `8001` (default) |

- **`client/.env`**:
  - `VITE_LIVEAVATAR_API_URL` and `VITE_BOT_NAME`.
  - The `RECALLAI_*`, `MEETING_URL` and `SCREENSHARE_WEBPAGE_URL` settings are only needed for Zoom (section 6.7).
  - **Anything prefixed `VITE_` is compiled into the public web page. Never put a secret in a `VITE_` variable.**

Never commit either `.env` file.

Each course you present needs an entry in `python-server/bot_config.yml`. The entry's `title` must match the `course` URL parameter (section 4), and its `openai_assistant.prompt_id` is the OpenAI prompt used to write the narration.

## 3. Run it locally

Use two terminals.

**Terminal 1, the server.** Run it from `python-server/`, because it reads `bot_config.yml` and `.env` from the current directory:

```bash
cd python-server
pipenv run python server.py
# WS server running on ws://localhost:8001
```

**Terminal 2, the client:**

```bash
cd client
npm run dev
# Local: http://localhost:5173/
```

Open `http://localhost:5173/?wss=ws://localhost:8001&course=Software+Engineering`. Section 4 has other combinations.

The status bar at the bottom should say **Connected to: ws://localhost:8001**. Click **Start** on the avatar. It greets you, then advances through the slides and narrates each one. Click **Stop** to end the session; this closes it on HeyGen's side and stops the credit charge.

### Reaching your local server from elsewhere (ngrok)

```bash
ngrok http 8001
```

Use the `https://…ngrok-free.app` address it prints as `wss=wss://<that-host>`. If you also tunnel the Vite dev server, add the ngrok host to `server.allowedHosts` in `client/vite.config.ts`.

## 4. URLs for testing in the browser

Every page URL has the same structure:

```text
<client base URL>?wss=<server URL>&course=<course title>&url=<slide deck URL>
```

| Part | Values |
| --- | --- |
| Client base URL | `http://localhost:5173/` (dev server). `https://bloombar.github.io/bloombot-on-strike/` (deployed). |
| `wss` (**required**) | `ws://localhost:8001` (local server, `MODE=development`). `wss://seriousdata.org:8001` (production). `wss://<id>.ngrok-free.app` (local server through ngrok). |
| `course` | A `title` from `python-server/bot_config.yml`, URL-encoded: spaces become `+`, `&` becomes `%26`. Default: `Software Engineering`. |
| `url` | The slide deck to present, URL-encoded. Default: `https://knowledge.kitchen/content/courses/software-engineering/slides/continuous-integration/`. |
| `autostart` | `1`, `true` or `yes` starts the avatar by itself once the server is connected and the slides are loaded. Default: off (click Start). Used by the Recall bot (section 6.7). |
| `autostart_delay` | Seconds to wait before an autostart. Decimals allowed, clamped to 0-60. Default: `3`. |

**Rules:**

- An `https://` page (GitHub Pages) can only connect to a `wss://` server. Browsers block `ws://` from secure pages, so the deployed client can't reach `ws://localhost:8001`. Use ngrok or the production server instead.
- The deck in `url` must answer the page's `postMessage` commands (`getMarkdownSource`, `nextSlide`, `getContent`, and so on). The Knowledge Kitchen remark decks do; an arbitrary web page won't.
- `course` must match exactly, or the server logs `No OpenAI Prompt configured` and the avatar stays silent.

**Ready-made URLs:**

| Client | Server | URL |
| --- | --- | --- |
| local | local | `http://localhost:5173/?wss=ws://localhost:8001&course=Software+Engineering` |
| local | production | `http://localhost:5173/?wss=wss://seriousdata.org:8001&course=Software+Engineering` |
| deployed | production | `https://bloombar.github.io/bloombot-on-strike/?wss=wss://seriousdata.org:8001&course=Software+Engineering` |
| deployed | ngrok | `https://bloombar.github.io/bloombot-on-strike/?wss=wss://<id>.ngrok-free.app&course=Software+Engineering` |
| deployed, other course and deck | production | `https://bloombar.github.io/bloombot-on-strike/?wss=wss://seriousdata.org:8001&course=Agile+Software+Development+%26+DevOps&url=https%3A%2F%2Fknowledge.kitchen%2Fcontent%2Fcourses%2Fagile-development-and-devops%2Fslides%2F<deck>%2F` |
| deployed, autostart after 5 s | production | `https://bloombar.github.io/bloombot-on-strike/?wss=wss://seriousdata.org:8001&course=Software+Engineering&autostart=1&autostart_delay=5` |

In the "other course and deck" row, replace `<deck>` with a real deck's path and check the full path on knowledge.kitchen first.

**What you should see:**

- A **green** dot means connected to the server.
- A **yellow** dot means still connecting.
- A **grey** dot with "Failed to connect to" means the server can't be reached.
- A **red** dot with "Error" means `wss` is missing or not a valid URL.

## 5. Test it locally

### The one command

```bash
scripts/ci/all.sh            # about 35 s: every CI stage, against your working tree
scripts/ci/all.sh --clean    # about 40 s: also reinstalls deps like CI (npm ci, pipenv install --deploy)
```

Run `scripts/ci/all.sh --clean` before you push. GitHub Actions runs the same scripts, so a local pass should mean a CI pass. Each stage reports PASS or FAIL, and the script exits non-zero if any stage failed.

| Stage | What it checks |
| --- | --- |
| `python` | `Pipfile.lock` matches `Pipfile`, and the `python-server` unit tests pass |
| `client` | the lockfile is in sync, `npm test` (Vitest) passes, `npm run build` succeeds, and the no-new-diagnostics gate passes |
| `gate-tests` | self-tests for the gate script |
| `workflow-lint` | `.github/workflows/*.yml` parse; `actionlint` and an `act` dry run pass, if those tools are installed |
| `claude-hooks` | the agent guard-hook tests (`.claude/hooks/`) |

**About the no-new-diagnostics gate:**

- The client already has about 30 ESLint errors and 50 TypeScript errors.
- The gate (`scripts/ci/changed-checks.sh`) does not require them fixed. It fails only if your change adds a diagnostic the base branch doesn't have, in any file, not just the ones you edited.
- If your change touches dependencies, it reinstalls the base branch's dependencies to compare against.
- Compare against a different base with `CI_BASE=origin/main scripts/ci/all.sh`.

### Individual checks

```bash
(cd python-server && PYTHONDONTWRITEBYTECODE=1 pipenv run python -m unittest -v)
(cd client && npm test)                     # Vitest
(cd client && npm run build)
scripts/ci/changed-checks.sh origin/heygen-avatar
node --test scripts/ci/*.test.mjs .claude/hooks/*.test.mjs
```

Don't run `tsc -b` in `client/`: it rewrites the tracked `*.tsbuildinfo` files. Use `npx tsc -p tsconfig.app.json --noEmit --incremental false`.

### The workflow itself, in Docker

```bash
scripts/ci/act.sh
```

This runs `ci.yml` in containers with `act`. It's slow, needs Docker, and only sees committed changes.

### Manual end-to-end check

The automated tests mock HeyGen and never open a real avatar session, because sessions cost credits. After changing the avatar, the session lifecycle or the relay, check by hand with one of the section 4 URLs:

1. Click **Start**. The avatar appears, speaks the welcome, and then narrates slides as they advance.
2. It **stays connected for several minutes**. The browser console should show no `LiveAvatar session disconnected:` lines.
3. **Stop** ends the session, and the avatar goes away.

## 6. Deploy

### 6.1 The client (automatic, GitHub Pages)

`heygen-avatar` is the deploy branch. Every push to it builds `client/` and publishes it to `https://bloombar.github.io/bloombot-on-strike/`, using `.github/workflows/deploy-pages.yml`.

1. Branch from `heygen-avatar`: `git switch -c feat/<short-name>`.
2. Run `scripts/ci/all.sh --clean`, then commit and push the branch.
3. Open a PR into `heygen-avatar`. CI (`.github/workflows/ci.yml`) runs the `python` and `client` jobs.
4. Merge when CI is green. The merge triggers the Pages deploy.

To redeploy without a code change, run `gh workflow run deploy-pages.yml --ref heygen-avatar`.

**Nothing deploys the server automatically.** A merged change to `python-server/` takes effect only after you update the droplet and restart pm2 (section 6.3).

### 6.2 The production server

| | |
| --- | --- |
| Host | DigitalOcean droplet, reachable as `seriousdata.org` |
| Checkout | `~/bloombot-on-strike` on branch `heygen-avatar`, owned by the deploy user |
| Process manager | pm2, process name **`scabbot`** |
| pm2 command | `bash -c "pipenv run ./server.py"` |
| pm2 working dir | `~/bloombot-on-strike/python-server` (needed for `bot_config.yml` and `.env`) |
| Python | the pipenv virtualenv (Python 3.12 on the droplet; the Pipfile asks for 3.11) |
| Public endpoint | `wss://seriousdata.org:8001` |
| TLS certificate | Let's Encrypt, at `/etc/letsencrypt/live/seriousdata.org/{fullchain,privkey}.pem` (hard-coded in the `main()` function of `server.py`) |
| Logs | `~/.pm2/logs/server-out.log` and `~/.pm2/logs/server-error.log` (the names come from the process's original name; `pm2 logs scabbot` reads them) |

`python-server/.env` on the droplet must contain:

```text
MODE=production
LIVEAVATAR_SANDBOX_MODE=false
# LIVEAVATAR_MAX_SESSION_DURATION   ← unset or blank; never 0
OPENAI_API_KEY=…
LIVEAVATAR_API_KEY=…
```

The same pm2 daemon also runs unrelated `bloombot-*` processes. Leave them alone.

### 6.3 Updating the server (routine)

Run this on the droplet, as the deploy user:

```bash
cd ~/bloombot-on-strike
git status                                # must be clean; stop and check if not
git switch heygen-avatar && git pull --ff-only
git log --oneline -1                      # confirm you have the commit you expect

# Only if Pipfile or Pipfile.lock changed:
pipenv install --deploy

pm2 restart scabbot
pm2 logs scabbot --lines 30               # want: "server listening on 0.0.0.0:8001" and no new traceback
```

The server reads `.env` when it starts, so `pm2 restart scabbot` is enough after editing `.env`. You only need `--update-env` for variables that come from the shell rather than from `.env`.

Then check the server (section 6.6) and run the manual check in section 5 against the deployed URL.

### 6.4 Creating or recreating the pm2 process

Use this the first time, or to add the restart backoff to an existing process:

```bash
pm2 delete scabbot                        # if it already exists
cd ~/bloombot-on-strike/python-server
pm2 start bash --name scabbot \
  --exp-backoff-restart-delay=1000 --max-restarts 20 \
  -- -c "pipenv run ./server.py"
pm2 save                                  # remember it across pm2 restarts
pm2 startup                               # once per machine: prints a sudo command that starts pm2 at boot
```

With these options, pm2 waits progressively longer between restarts and gives up after 20 in a row. Without them, a startup error (such as the certificate problem below) loops forever: `scabbot` once reached **678,215 restarts**.

`server.py` must stay executable with its `#!/usr/bin/env python3` line, because pm2 runs it as `./server.py`.

### 6.5 TLS certificate permissions (one-time setup)

pm2 runs the server as the deploy user, but Let's Encrypt keys are readable only by root by default. Until that's fixed, every start fails with:

```text
ssl_context.load_cert_chain(
PermissionError: [Errno 13] Permission denied
```

The fix is to give a `ssl-cert` group read access to the certificate, and put the deploy user in it. The `chmod` on the key runs inside `sudo sh -c`, because your own shell can't list the directory to expand `*`.

```bash
sudo groupadd ssl-cert                    # skip if `getent group ssl-cert` already prints a line
sudo usermod -aG ssl-cert "$USER"
sudo chgrp ssl-cert /etc/letsencrypt/live /etc/letsencrypt/archive
sudo chmod 0750 /etc/letsencrypt/live /etc/letsencrypt/archive
sudo chgrp -R ssl-cert /etc/letsencrypt/live/seriousdata.org /etc/letsencrypt/archive/seriousdata.org
sudo chmod 0750 /etc/letsencrypt/live/seriousdata.org /etc/letsencrypt/archive/seriousdata.org
sudo sh -c 'chmod 0640 /etc/letsencrypt/archive/seriousdata.org/privkey*.pem'
```

Log out and back in so the new group applies, then check:

```bash
id | grep -o ssl-cert
head -c 0 /etc/letsencrypt/live/seriousdata.org/privkey.pem && echo "key readable"
```

The pm2 daemon keeps the groups it started with, so restart it to pick up `ssl-cert`:

```bash
pm2 save && pm2 update                    # briefly restarts every pm2 app, including bloombot-*
```

When certbot renews, it normally gives the new key the same group and permissions as the old one. Re-run the `head -c 0 … && echo "key readable"` check after each renewal. The current certificate expires on 20 December 2026. To see the expiry date, run `sudo certbot certificates`.

### 6.6 Checking the production server

From any machine:

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' https://seriousdata.org:8001/
# HTTP 426  → the WebSocket server is up and TLS works (426 = "Upgrade Required" for a plain HTTP request)

echo | openssl s_client -connect seriousdata.org:8001 -servername seriousdata.org 2>/dev/null \
  | openssl x509 -noout -subject -enddate
# subject=CN=seriousdata.org, notAfter=<expiry>
```

On the droplet, run `pm2 describe scabbot` twice, a minute apart. The status should be `online` and the restart count shouldn't change.

### 6.7 Putting the bot in a Zoom call (Recall.ai)

`client/run.py` asks Recall.ai to send a bot into a meeting. The bot's camera shows a web page: the deployed client, with the production server in `wss`. Set these in `client/.env`:

- `RECALLAI_API_URL` and `RECALLAI_API_TOKEN`
- `MEETING_URL`: the Zoom, Google Meet or Teams link
- `SCREENSHARE_WEBPAGE_URL`: a deployed-client URL from section 4, for example `https://bloombar.github.io/bloombot-on-strike/?wss=wss://seriousdata.org:8001&course=Software+Engineering`
- `AUTOSTART_DELAY_SECONDS` (optional, default 3): `run.py` adds `autostart=1` (and this delay as `autostart_delay`) to that URL, because nobody in the bot's browser can click Start. Params already in the URL are kept.

Then run:

```bash
cd client
pipenv run python run.py
```

## 7. Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| The status bar says `Missing required "wss" parameter` | Add `?wss=…` to the page URL (section 4). |
| Grey dot, "Failed to connect to" | The server isn't running, or the host or port is wrong. On the deployed page, `ws://` is blocked: use `wss://`. Check with `curl` (section 6.6). |
| The avatar connects, drops, and reconnects every few seconds | `LIVEAVATAR_MAX_SESSION_DURATION` must be blank or a positive number, never `0`. The browser console prints `LiveAvatar session disconnected: <reason>`. |
| `pm2 list` shows `scabbot` `stopped`, or a huge restart count (↺) | Run `pm2 logs scabbot --lines 60`. A `PermissionError` in `load_cert_chain` means section 6.5. Add the backoff from section 6.4. |
| `PermissionError: [Errno 13]` in `load_cert_chain` | The deploy user can't read the certificate key. See section 6.5, and re-check after each certbot renewal. |
| `RuntimeError: LiveAvatar token request failed (HTTP 4xx)` in the server log | Bad API key, no credits, an invalid avatar, voice or context ID, or a session length above your plan's limit. |
| The avatar is silent and the slides don't advance | No OpenAI credits, or `course` doesn't match a `title` in `bot_config.yml` (the server logs `No OpenAI Prompt configured`). |
| A server change doesn't seem to apply | The droplet wasn't updated, or pm2 wasn't restarted. Run `git log --oneline -1` on the droplet, then `pm2 restart scabbot` (section 6.3). |
| Pages shows an old version | Check the deploy run under the repo's **Actions** tab, then hard-refresh the browser. |
