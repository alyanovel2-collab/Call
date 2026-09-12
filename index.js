require("dotenv").config();
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
});

client.on("error", (err) => {
  console.log("Erro do client:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.log("Rejeição não tratada:", reason?.message || reason);
});

client.login(process.env.BOT_TOKEN);