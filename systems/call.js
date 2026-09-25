require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
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
  ],
});

const GUILD_ID = process.env.GUILD_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;

const BUILD_VERSION = "v9-livecache";
console.log(`[CALL] BUILD: ${BUILD_VERSION}`);

client.once("ready", async () => {
  console.log(`[CALL] ${client.user.tag} online!`);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.log("[CALL] Servidor da GUILD_ID não encontrado. GUILD_ID =", GUILD_ID);
    return;
  }
  console.log(`[CALL] Servidor encontrado: ${guild.name} (${guild.id})`);

  const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
  if (!channel) {
    console.log(
      "[CALL] Canal de voz não encontrado. VOICE_CHANNEL_ID =",
      VOICE_CHANNEL_ID
    );
    return;
  }
  console.log(`[CALL] Canal de voz encontrado: #${channel.name} (${channel.id})`);

  function connectVoice() {
    console.log("[CALL] Tentando conectar na call...");

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });

    connection.on(VoiceConnectionStatus.Ready, () => {
      console.log("[CALL] Bot conectado e AFK na call 24/7.");
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.log("[CALL] Bot desconectado. Tentando reconectar...");
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        console.log("[CALL] Reconexão automática bem-sucedida.");
      } catch {
        connection.destroy();
        console.log("[CALL] Reconectando do zero em 5 segundos...");
        setTimeout(connectVoice, 5_000);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      console.log("[CALL] Conexão destruída. Reconectando em 5 segundos...");
      setTimeout(connectVoice, 5_000);
    });
  }

  connectVoice();
});

client.on("error", (err) => {
  console.log("[CALL] Erro do client:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.log("[CALL] Rejeição não tratada:", reason?.message || reason);
});

function start() {
  if (process.env.ENABLE_CALL_BOT === "false") {
    console.log("[CALL] Desabilitado via ENABLE_CALL_BOT=false.");
    return;
  }
  const token = process.env.CALL_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!token) {
    console.log("[CALL] ERRO: nenhum token definido (CALL_BOT_TOKEN ou BOT_TOKEN).");
    return;
  }
  client.login(token).catch((err) => {
    console.log("[CALL] Falha no login:", err.message);
  });
}

module.exports = { start, client };

if (require.main === module) {
  start();
}