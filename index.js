require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
});

const GUILD_ID = process.env.GUILD_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const INVITE_LOG_CHANNEL_ID = process.env.INVITE_LOG_CHANNEL_ID;

const DATA_FILE = path.join(__dirname, "invites.json");
const INVITE_REFRESH_MS = 10 * 60 * 1000;

let inviteData = { users: {} };
let inviteCache = new Map();

function loadInviteData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      inviteData = { users: {}, ...parsed };
    }
  } catch (err) {
    console.log("Erro ao ler invites.json:", err.message);
  }
}

function saveInviteData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(inviteData, null, 2));
  } catch (err) {
    console.log("Erro ao salvar invites.json:", err.message);
  }
}

loadInviteData();

client.once("ready", async () => {
  console.log(`${client.user.tag} online!`);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.log("Servidor não encontrado.");
    return;
  }

  const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
  if (!channel) {
    console.log("Canal de voz não encontrado.");
    return;
  }

  function connectVoice() {
    console.log("Tentando conectar na call...");

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
      console.log("Bot conectado e AFK na call 24/7.");
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.log("Bot desconectado. Tentando reconectar...");
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        console.log("Reconexão automática bem-sucedida.");
      } catch {
        connection.destroy();
        console.log("Reconectando do zero em 5 segundos...");
        setTimeout(connectVoice, 5_000);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      console.log("Conexão destruída. Reconectando em 5 segundos...");
      setTimeout(connectVoice, 5_000);
    });
  }

  connectVoice();

  refreshInvites();
  setInterval(refreshInvites, INVITE_REFRESH_MS);
});

async function refreshInvites() {
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    const invites = await guild.invites.fetch();
    inviteCache = new Map(invites.map((inv) => [inv.code, inv]));
    console.log(`Cache de invites atualizado (${inviteCache.size} invites).`);
  } catch (err) {
    console.log("Erro ao buscar invites:", err.message);
  }
}

client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  try {
    const invites = await member.guild.invites.fetch();

    let used;
    for (const inv of inviteCache.values()) {
      const current = invites.get(inv.code);
      if (!current || current.uses > inv.uses) {
        used = inv;
        break;
      }
    }

    inviteCache = new Map(invites.map((inv) => [inv.code, inv]));

    if (!used || !used.inviter) {
      console.log(
        `Não foi possível identificar o invite usado por ${member.user.tag}.`
      );
      return;
    }

    const inviterId = used.inviter.id;
    inviteData.users[inviterId] = (inviteData.users[inviterId] || 0) + 1;
    saveInviteData();

    const count = inviteData.users[inviterId];
    const logChannel = member.guild.channels.cache.get(INVITE_LOG_CHANNEL_ID);
    const message = `O usuário <@${member.id}> entrou no servidor através do usuário <@${inviterId}> que agora possui ${count} invite(s)!! 🥳🥳`;

    if (logChannel && logChannel.isTextBased()) {
      await logChannel.send(message);
    }
    console.log(message);
  } catch (err) {
    console.log("Erro ao detectar invite:", err.message);
  }
});

client.on("error", (err) => {
  console.log("Erro do client:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.log("Rejeição não tratada:", reason?.message || reason);
});

client.login(process.env.BOT_TOKEN);