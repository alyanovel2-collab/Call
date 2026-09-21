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
      console.log("[INVITE] invites.json carregado. users:", inviteData.users);
    } else {
      console.log("[INVITE] invites.json não existe. Criando novo.");
    }
  } catch (err) {
    console.log("[INVITE] Erro ao ler invites.json:", err.message);
  }
}

function saveInviteData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(inviteData, null, 2));
    console.log("[INVITE] invites.json salvo.");
  } catch (err) {
    console.log("[INVITE] Erro ao salvar invites.json:", err.message);
  }
}

loadInviteData();

client.once("ready", async () => {
  console.log(`${client.user.tag} online!`);

  console.log("[DEBUG] Env -> GUILD_ID:", GUILD_ID);
  console.log("[DEBUG] Env -> VOICE_CHANNEL_ID:", VOICE_CHANNEL_ID);
  console.log("[DEBUG] Env -> INVITE_LOG_CHANNEL_ID:", INVITE_LOG_CHANNEL_ID);
  console.log(
    "[DEBUG] Intents habilitados: Guilds, GuildVoiceStates, GuildMembers, GuildInvites"
  );

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.log("[DEBUG] Servidor da GUILD_ID NÃO encontrado no cache. Guilds disponíveis:");
    client.guilds.cache.forEach((g) =>
      console.log(`[DEBUG]   - ${g.name} (${g.id})`)
    );
    return;
  }
  console.log(`[DEBUG] Servidor encontrado: ${guild.name} (${guild.id})`);

  const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
  if (!channel) {
    console.log("[DEBUG] Canal de voz NÃO encontrado no cache.");
    return;
  }
  console.log(`[DEBUG] Canal de voz encontrado: #${channel.name} (${channel.id})`);

  const logChannel = guild.channels.cache.get(INVITE_LOG_CHANNEL_ID);
  console.log(
    "[DEBUG] Canal de log de invites:",
    logChannel ? `#${logChannel.name} (${logChannel.id})` : "NÃO ENCONTRADO"
  );

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
    if (!guild) {
      console.log("[INVITE] refreshInvites: guild não encontrada.");
      return;
    }
    const invites = await guild.invites.fetch();
    inviteCache = new Map(invites.map((inv) => [inv.code, inv]));
    console.log(
      `[INVITE] Cache de invites atualizado (${inviteCache.size} invites).`
    );
    for (const inv of inviteCache.values()) {
      console.log(
        `[INVITE]   -> código "${
          inv.code
        }" | criado por ${inv.inviter?.tag ?? "???"} (${inv.inviter?.id ?? "???"}) | uses = ${inv.uses}`
      );
    }
  } catch (err) {
    console.log("[INVITE] Erro ao buscar invites:", err.message);
  }
}

client.on("guildMemberAdd", async (member) => {
  console.log(
    `[INVITE] guildMemberAdd acionado: ${member.user.tag} (${member.id}) no guild ${member.guild.name} (${member.guild.id})`
  );
  console.log(
    `[INVITE] GUILD_ID esperado: ${GUILD_ID} | comparação: ${
      member.guild.id === GUILD_ID
    }`
  );

  if (member.guild.id !== GUILD_ID) {
    console.log(`[INVITE] Membro não pertence à GUILD_ID. Ignorando.`);
    return;
  }

  try {
    const invites = await member.guild.invites.fetch();
    console.log(`[INVITE] Invites atuais após a entrada (${invites.size}):`);
    for (const inv of invites.values()) {
      console.log(
        `[INVITE]   -> código "${inv.code}" | inviter ${inv.inviter?.tag ?? "???"} (${inv.inviter?.id ?? "???"}) | uses = ${inv.uses}`
      );
    }

    console.log(`[INVITE] Comparando com o cache (${inviteCache.size}):`);
    let used;
    for (const inv of inviteCache.values()) {
      const current = invites.get(inv.code);
      console.log(
        `[INVITE]   - cache "${inv.code}" (inviter ${inv.inviter?.id ?? "???"}, uses ${inv.uses}) | atual: ${
          current ? `code ${current.code}, uses ${current.uses}` : "DELETADO"
        }`
      );
      if (!current || current.uses > inv.uses) {
        used = inv;
        console.log(`[INVITE]   -> CORRESPONDÊNCIA encontrada! Código usado: "${inv.code}"`);
        break;
      }
    }

    inviteCache = new Map(invites.map((inv) => [inv.code, inv]));

    if (!used) {
      console.log(
        `[INVITE] NENHUM invite correspondente encontrado para ${member.user.tag}.`
      );
      return;
    }

    if (!used.inviter) {
      console.log(
        `[INVITE] Invite "${used.code}" POSSÍVEL usado, mas sem inviter disponível.`
      );
      return;
    }

    const inviterId = used.inviter.id;
    console.log(
      `[INVITE] Invite usado: "${used.code}" -> inviter ${used.inviter.tag} (${inviterId})`
    );

    const before = inviteData.users[inviterId] || 0;
    inviteData.users[inviterId] = before + 1;
    saveInviteData();

    const count = inviteData.users[inviterId];
    const logChannel = member.guild.channels.cache.get(INVITE_LOG_CHANNEL_ID);
    const message = `O usuário <@${member.id}> entrou no servidor através do usuário <@${inviterId}> que agora possui ${count} invite(s)!! 🥳🥳`;

    if (logChannel && logChannel.isTextBased()) {
      try {
        const sent = await logChannel.send(message);
        console.log(`[INVITE] Mensagem enviada no canal ${logChannel.id}: ${sent.id}`);
      } catch (sendErr) {
        console.log(
          `[INVITE] Falha ao enviar mensagem no canal: ${sendErr.message}`
        );
      }
    } else {
      console.log(
        `[INVITE] Canal de log ${INVITE_LOG_CHANNEL_ID} não encontrado ou não é de texto.`
      );
    }
    console.log(message);
  } catch (err) {
    console.log("[INVITE] Erro ao detectar invite:", err.message);
  }
});

client.on("error", (err) => {
  console.log("Erro do client:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.log("Rejeição não tratada:", reason?.message || reason);
});

client.login(process.env.BOT_TOKEN);