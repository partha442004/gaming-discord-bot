# Gaming Discord Bot — fully free

A gaming-community Discord bot that runs **completely for $0**.

## Features
- 👋 Welcome message (auto-role on join)
- 🎮 Role-menu buttons: Minecraft / Valorant / Fortnite / League of Legends
- ⛏ `/mcstatus` — live Minecraft server status & player count (works with Aternos)
- 🎲 `/roll`, 🏓 `/ping`, 🔗 `/invite`

## Environment variables
| Variable | Required | What it does |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Bot token from the Discord Developer Portal |
| `GUILD_ID` | optional | Your server ID (registers slash commands instantly) |
| `WELCOME_CHANNEL_ID` | optional | Text channel for welcome messages |
| `WELCOME_ROLE_ID` | optional | Role assigned to every new member |
| `MC_ADDRESS` | optional | Aternos/Minecraft address, e.g. `name.aternos.me` |
| `PORT` | optional | Health-check port (default 3000) |

## 100% free hosting (pick one)
No credit card required on any of these:

- **Render** (recommended) — free Web Service: sign up free → New → Web Service → point at this GitHub repo → set `DISCORD_TOKEN` → deploy.
- **Koyeb** — free "Web App" tier, same flow.
- **Your own PC** — run `npm start` whenever you want it online (free, no cloud).

The bot ships a tiny `/health` endpoint so a free ping monitor (e.g. UptimeRobot, free plan) can keep the service awake.

> Zero-cost tip: Minecraft itself is hosted for free on **[Aternos](https://aternos.org)** — the bot's `/minecraft` command reads its status through a free public API, so you never pay for the game server either.

## Run locally
```bash
npm install
# set DISCORD_TOKEN in your shell or a .env (not committed)
npm start
```

## Setup notes
- Create roles named exactly `Minecraft`, `Valorant`, `Fortnite`, `League of Legends` for the buttons to work.
- Set `GUILD_ID` to your server ID so `/minecraft` etc. appear right away.
- The bot will exit if `DISCORD_TOKEN` is missing — it's the only required var.