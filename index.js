import {
  Client,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { createServer } from "node:http";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID || "";
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || "";
const WELCOME_ROLE_ID = process.env.WELCOME_ROLE_ID || "";
const MC_ADDRESS = process.env.MC_ADDRESS || "";

if (!DISCORD_TOKEN) {
  console.error("FATAL: DISCORD_TOKEN is not set. Add it in the service Variables tab, then redeploy.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// Maps button customId -> role name users toggle.
const ROLE_MENU = {
  role_mc: "Minecraft",
  role_val: "Valorant",
  role_fortnite: "Fortnite",
  role_lol: "League of Legends",
};

// ---------- Minecraft status (free api, https://mcsrvstat.us) ----------

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
    icon: data.icon ?? null,
  };
}

function cleanMotd(motd) {
  if (!motd) return "";
  const line = Array.isArray(motd.clean) ? motd.clean.join("\n") : String(motd.clean || "");
  return line.replace(/[&§][0-9a-fk-or]/gi, "").trim();
}

function statusEmbed(info) {
  const e = new EmbedBuilder()
    .setTitle("🟢 Minecraft Server Status")
    .setDescription(info.motd || info.hostname || info.address)
    .setColor(info.online ? 0x22c55e : 0xef4444);
  if (info.note) e.setDescription(info.note);
  e.addFields(
    { name: "Address", value: `\`${info.address || "none"}\``, inline: true },
    { name: "Status", value: info.online ? "🟢 Online" : "🔴 Offline", inline: true }
  );
  if (info.online) {
    e.addFields(
      { name: "Version", value: info.version, inline: true },
      { name: "Players", value: `${info.players.online}/${info.players.max}`, inline: true }
    );
  }
  if (info.icon) {
    try {
      e.setThumbnail(`data:image/png;base64,${info.icon}`);
    } catch {
      /* ignore malformed icon */
    }
  }
  e.setFooter({ text: "Data from mcsrvstat.us" });
  return e;
}

function welcomeEmbed(member) {
  return new EmbedBuilder()
    .setTitle(`🎮 Welcome to the guild, ${member.displayName}!`)
    .setColor(0x5865f2)
    .setDescription(
      "Glad you're here!\nUse the buttons below to add roles for the games you play so you get the right pings."
    );
}

function roleMenuRow() {
  const styles = {
    role_mc: ButtonStyle.Success,
    role_val: ButtonStyle.Primary,
    role_fortnite: ButtonStyle.Danger,
    role_lol: ButtonStyle.Secondary,
  };
  return new ActionRowBuilder().addComponents(
    Object.entries(ROLE_MENU).map(([id, label]) =>
      new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(styles[id] ?? ButtonStyle.Primary)
    )
  );
}

// ---------- Ready ----------

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag} (${client.user.id})`);
  client.user.setPresence({
    activities: [
      {
        name: MC_ADDRESS ? `Minecraft ${MC_ADDRESS}` : "the gaming server",
        type: ActivityType.Playing,
      },
    ],
  });

  const commands = [
    new SlashCommandBuilder()
      .setName("mcstatus")
      .setDescription("Check the Minecraft server status")
      .addStringOption((o) => o.setName("address").setDescription("Override server address").setRequired(false)),
    new SlashCommandBuilder()
      .setName("roll")
      .setDescription("Roll a die")
      .addIntegerOption((o) => o.setName("sides").setDescription("Number of sides (default 6)").setRequired(false)),
    new SlashCommandBuilder().setName("ping").setDescription("Bot latency"),
    new SlashCommandBuilder().setName("invite").setDescription("Get the bot invite link"),
  ];

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
      console.log("✅ Registered guild commands");
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
      console.log("✅ Registered global commands");
    }
  } catch (err) {
    console.error("Command registration failed:", err.message);
  }
});

// ---------- Welcome / auto-role ----------

client.on(Events.GuildMemberAdd, async (member) => {
  console.log(`👋 ${member.user.tag} joined ${member.guild.name}`);
  if (WELCOME_ROLE_ID) {
    try {
      await member.roles.add(WELCOME_ROLE_ID);
      console.log(`Auto-assigned welcome role to ${member.displayName}`);
    } catch (err) {
      console.error("Auto-role failed:", err.message);
    }
  }
  const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (channel?.isTextBased()) {
    await channel.send({ content: `Welcome, <@${member.id}>! 👋`, embeds: [welcomeEmbed(member)], components: [roleMenuRow()] });
  }
});

// ---------- Interactions ----------

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inCachedGuild()) return;

  if (interaction.isChatInputCommand()) {
    switch (interaction.commandName) {
      case "mcstatus": {
        await interaction.deferReply({});
        const address = interaction.options.getString("address") || MC_ADDRESS;
        try {
          const info = await getMcStatus(address);
          await interaction.editReply({ embeds: [statusEmbed(info)] });
        } catch (err) {
          await interaction.editReply(`⚠️ Couldn't reach the status API: ${err.message}`);
        }
        return;
      }
      case "roll": {
        const sides = Math.min(1000, interaction.options.getInteger("sides") ?? 6);
        await interaction.reply(`🎲 Rolled **${1 + Math.floor(Math.random() * sides)}** (1–${sides})`);
        return;
      }
      case "ping":
        await interaction.reply(`🏓 Pong! Latency: **${client.ws.ping}ms**`);
        return;
      case "invite":
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("Invite this bot")
              .setURL(`https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot&permissions=8`)
              .setDescription("Click the title to add this bot to a server."),
          ],
        });
        return;
      default:
        await interaction.reply("Unknown command.");
    }
    return;
  }

  if (interaction.isButton()) {
    const roleName = ROLE_MENU[interaction.customId];
    if (!roleName) {
      await interaction.reply({ content: "Unknown button.", ephemeral: true });
      return;
    }
    const role = interaction.guild.roles.cache.find((r) => r.name.toLowerCase() === roleName.toLowerCase());
    if (!role) {
      await interaction.reply({
        content: `Role **"${roleName}"** doesn't exist yet. Create it in **Server Settings → Roles** with that exact name.`,
        ephemeral: true,
      });
      return;
    }
    const has = interaction.member.roles.cache.has(role.id);
    try {
      if (has) {
        await interaction.member.roles.remove(role);
        await interaction.reply({ content: `Removed **${role.name}**.`, ephemeral: true });
      } else {
        await interaction.member.roles.add(role);
        await interaction.reply({ content: `Added **${role.name}**!`, ephemeral: true });
      }
    } catch (err) {
      await interaction.reply({ content: `Couldn't update roles: ${err.message}`, ephemeral: true });
    }
  }
});

client.login(DISCORD_TOKEN);

// Lightweight health/keepalive server so free-tier hosts (Render, Koyeb, etc.)
// can ping the URL to keep the service from going idle. No extra dependencies.
const PORT = Number(process.env.PORT) || 3000;
createServer((req, res) => {
  const hit = new Date().toISOString();
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`ok ${client.user?.tag ?? "starting"} ${hit}`);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<h1>🎮 Gaming bot is running</h1><p>Uptime: ${hit}</p>`);
}).listen(PORT, () => {
  console.log(`🩺 Health server listening on :${PORT}`);
});