import TelegramBot from "node-telegram-bot-api";
import { createServer } from "node:http";
import pg from "pg";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MC_ADDRESS = process.env.MC_ADDRESS || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

if (!TOKEN) {
  console.error("FATAL: TELEGRAM_BOT_TOKEN is not set. Get one from @BotFather, then add it in the service Variables tab and redeploy.");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const GAMES = [
  { id: "mc", label: "Minecraft", emoji: "⛏️" },
  { id: "val", label: "Valorant", emoji: "🎯" },
  { id: "fortnite", label: "Fortnite", emoji: "🎨" },
  { id: "lol", label: "League of Legends", emoji: "⚔️" },
];

const GAME_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));

// ---------- Optional persistence to Neon Postgres ----------

let pool = null;
if (DATABASE_URL) {
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_games (
        user_id BIGINT PRIMARY KEY,
        games TEXT[] NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    console.log("✅ Postgres ready (user_games table)");
  } catch (err) {
    console.error("Postgres init failed (falling back to in-memory):", err.message);
    pool = null;
  }
}

const memoryStore = new Map();

async function getGames(userId) {
  if (pool) {
    const { rows } = await pool.query("SELECT games FROM user_games WHERE user_id = $1", [userId]);
    return rows[0]?.games ?? [];
  }
  return memoryStore.get(userId) ?? [];
}

async function setGames(userId, games) {
  if (pool) {
    await pool.query(
      "INSERT INTO user_games (user_id, games, updated_at) VALUES ($1, $2, now()) ON CONFLICT (user_id) DO UPDATE SET games = $2, updated_at = now()",
      [userId, games]
    );
  } else {
    memoryStore.set(userId, games);
  }
}

// ---------- Minecraft status (free api, https://mcsrvstat.us) ----------

function cleanMotd(motd) {
  if (!motd) return "";
  const line = Array.isArray(motd.clean) ? motd.clean.join("\n") : String(motd.clean || "");
  return line.replace(/[&§][0-9a-fk-or]/gi, "").trim();
}

async function getMcStatus(address) {
  const addr = String(address || "").trim();
  if (!addr) return { ok: true, online: false, address: addr, note: "No server address configured yet." };
  const res = await fetch(`https://api.mcsrvstat.us/3/${encodeURIComponent(addr)}`);
  if (!res.ok) throw new Error(`Status API returned HTTP ${res.status}`);
  const data = await res.json();
  if (!data.online) {
    return { ok: true, online: false, address: addr, hostname: data.hostname || addr, motd: cleanMotd(data.motd) };
  }
  return {
    ok: true,
    online: true,
    address: addr,
    hostname: data.hostname || addr,
    version: data.version || "Unknown",
    players: { online: data.players?.online ?? 0, max: data.players?.max ?? 0 },
    motd: cleanMotd(data.motd),
  };
}

function mcStatusText(info) {
  if (info.note) return `🔴 ${info.note}`;
  const lines = [
    info.online ? "🟢 **Minecraft Server is ONLINE**" : "🔴 **Minecraft Server is OFFLINE**",
    "",
    `🏷️ **Address:** \`${info.address || "none"}\``,
    `📡 **Status:** ${info.online ? "Online" : "Offline"}`,
  ];
  if (info.online) {
    lines.push(
      `🕹️ **Version:** ${info.version}`,
      `👥 **Players:** ${info.players.online}/${info.players.max}`
    );
  }
  if (info.motd) lines.splice(2, 0, `💬 **MOTD:** ${info.motd}`);
  lines.push("", "_Data from mcsrvstat.us_");
  return lines.join("\n");
}

// ---------- Helpers ----------

function gameKeyboard(userId) {
  const rows = [];
  for (let i = 0; i < GAMES.length; i += 2) {
    const pair = GAMES.slice(i, i + 2);
    rows.push(
      pair.map((g) => ({
        text: `${g.emoji} ${g.label}`,
        callback_data: `toggle_${g.id}`,
      }))
    );
  }
  return { inline_keyboard: rows };
}

async function welcomeMessage(chatId) {
  const games = await getGames(chatId);
  const list =
    games.length > 0
      ? games.map((id) => GAME_BY_ID[id]?.emoji + " " + GAME_BY_ID[id]?.label).join("\n")
      : "_None selected yet._";
  return (
    "🎮 **Welcome to the gaming hub!**\n\n" +
    "Tap the buttons below to pick the games you play so you get the right pings.\n\n" +
    `**Your games:**\n${list}\n\n` +
    "Commands: `/mcstatus`, `/roll`, `/ping`, `/help`"
  );
}

// ---------- Commands ----------

bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, await welcomeMessage(chatId), {
    parse_mode: "Markdown",
    reply_markup: gameKeyboard(chatId),
  });
});

bot.onText(/^\/help/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    "🎮 **Gaming bot commands**\n\n" +
      "`/start` - show the game role menu\n" +
      "`/mcstatus [address]` - check Minecraft server status\n" +
      "`/roll [sides]` - roll a die (default 6)\n" +
      "`/ping` - bot latency\n\n" +
      "Use the buttons in /start to select your games.",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/^\/mcstatus(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const address = (match?.[1] || "").trim() || MC_ADDRESS;
  const sent = await bot.sendMessage(chatId, "🔎 Checking Minecraft server status…");
  try {
    const info = await getMcStatus(address);
    await bot.editMessageText(mcStatusText(info), {
      chat_id: chatId,
      message_id: sent.message_id,
      parse_mode: "Markdown",
    });
  } catch (err) {
    await bot.editMessageText(`⚠️ Couldn't reach the status API: ${err.message}`, {
      chat_id: chatId,
      message_id: sent.message_id,
    });
  }
});

bot.onText(/^\/roll(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const sides = Math.min(1000, Number(match?.[1]) || 6);
  const value = 1 + Math.floor(Math.random() * sides);
  await bot.sendMessage(chatId, `🎲 Rolled **${value}** (1–${sides})`, { parse_mode: "Markdown" });
});

bot.onText(/^\/ping/, async (msg) => {
  const chatId = msg.chat.id;
  const before = Date.now();
  const sent = await bot.sendMessage(chatId, "🏓 Pong!");
  const latency = Date.now() - before;
  await bot.editMessageText(`🏓 Pong! Latency: **${latency}ms**`, {
    chat_id: chatId,
    message_id: sent.message_id,
    parse_mode: "Markdown",
  });
});

// ---------- Game toggle buttons ----------

bot.on("callback_query", async (query) => {
  const data = query.data || "";
  if (!data.startsWith("toggle_")) {
    await bot.answerCallbackQuery(query.id);
    return;
  }
  const gameId = data.slice("toggle_".length);
  if (!GAME_BY_ID[gameId]) {
    await bot.answerCallbackQuery(query.id, { text: "Unknown game" });
    return;
  }
  const userId = query.from.id;
  const current = await getGames(userId);
  const has = current.includes(gameId);
  const next = has ? current.filter((g) => g !== gameId) : [...current, gameId];
  await setGames(userId, next);

  const game = GAME_BY_ID[gameId];
  await bot.answerCallbackQuery(query.id, {
    text: `${game.emoji} ${game.label} ${has ? "removed" : "added"}`,
  });

  if (query.message?.chat?.id) {
    await bot.editMessageText(await welcomeMessage(userId), {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "Markdown",
      reply_markup: gameKeyboard(userId),
    });
  }
});

bot.on("error", (err) => console.error("Bot error:", err.message));

// ---------- Health/keepalive server (free-tier hosts) ----------

const PORT = Number(process.env.PORT) || 3000;
createServer((req, res) => {
  const hit = new Date().toISOString();
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`ok ${hit}`);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<h1>🎮 Gaming bot is running</h1><p>Uptime: ${hit}</p>`);
}).listen(PORT, () => {
  console.log(`🩺 Health server listening on :${PORT}`);
});

console.log("🤖 Telegram bot started (polling mode)");
