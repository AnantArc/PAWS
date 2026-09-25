# PAWS — How to run it (one-time setup)

Everything you need is in `paws-console.zip` (699 KB, 128 files).
No cloud account, no internet at run time, no ESP32 needed — it boots straight into demo mode.

---

## 1. Install Node.js — once, ever

Download the **LTS** installer from <https://nodejs.org> (Node 18.17 or newer; 20 or 22 is ideal).

Check it worked — open a terminal (Windows: PowerShell, Mac: Terminal):

```bash
node -v      # should print v18.17.0 or higher
npm -v
```

That's the only thing you install globally.

---

## 2. Unzip and install dependencies — once per copy

```bash
cd path/to/paws            # the folder containing package.json
npm install
```

- Takes **1–3 minutes** and **~520 MB** of disk.
- **This is a one-time thing.** `node_modules` stays on your disk. You do **not** re-run it every time you start the app.
- Only run it again if `package.json` changes, or if you delete `node_modules`.
- npm keeps a download cache, so even a re-install is fast and offline.

**Skip this to save ~500 MB:** if you don't need the screenshot scripts, you never need to run
`npx playwright install` — that downloads ~500 MB of browsers into `~/.cache/ms-playwright` and is
**not** required to run PAWS. Everything else works without it.

---

## 3. Run it

```bash
npm run dev
```

Then open **<http://localhost:3000>**

**Sign in:**
| Field | Value |
|---|---|
| Email | `operator@paws.local` |
| Password | `paws-demo-operator` |

Press **Start mission** (top-right mission row) if a mission isn't already running — the robot starts
walking and everything comes alive within a second or two. Survivors are met roughly once a minute.

Stop the server with `Ctrl + C`.

### Optional: run it in production mode (faster, uses less memory)

```bash
npm run build     # one-time, ~30 s, creates a 77 MB .next folder
npm start
```

---

## 4. Other commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 (hot reload) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Fusion engine test suite (12 tests) |
| `npm run typecheck` | TypeScript check, no output = clean |
| `npm run lint` | Next.js lint |

---

## 5. Disk space — the honest numbers

| Item | Size | When |
|---|---|---|
| Source code (the zip) | 0.7 MB | once |
| `node_modules` | ~520 MB | **once** — stays put |
| `.next` (only if you run `npm run build`) | ~77 MB | each production build, safe to delete anytime |
| npm download cache | ~200–400 MB | reusable; `npm cache clean --force` frees it |

You are **not** re-installing repeatedly. The re-installs you saw were inside my sandbox, which wipes
its working directory between turns — that's a limitation of my environment, not of the project.

If you're ever short on space: delete `.next` (it regenerates), and `npm cache clean --force`.
Only delete `node_modules` if you're done working on the project for a while — it's the one thing
that costs a few minutes to rebuild.

---

## 6. Where things are

```
src/app/                    pages + all API routes
src/lib/world.ts            the simulated floor: survivors, gas pocket, debris
src/lib/simulator.ts        the robot that walks it
src/lib/fusion/engine.ts    survivor / hazard / accessibility scoring
src/components/console/     the dashboard UI (camera, score, sensor cards, command bar)
public/logo.jpg|.png        ANANT ARC badge
.env                        demo-mode defaults (works as-is)
```

`git` users: `.gitignore` already excludes `node_modules`, `.next` and `.env`.

---

## 7. Troubleshooting

**Port 3000 busy** → `npm run dev -- -p 3001`, then open `http://localhost:3001`

**Blank screen / sensors all show nothing** → a mission isn't running. Log in and press
**Start mission**.

**`next: command not found`** → you're in the wrong folder, or `npm install` hasn't been run yet.

**PowerShell blocks `npm`** → run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, reopen the terminal.

**Want a different tick speed** → set `SIM_TICK_MS=500` in `.env` for a faster demo.
