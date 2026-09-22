require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
});

const GUILD_ID = process.env.GUILD_ID;
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
    console.log(`[INVITE] invites.json salvo. users:`, inviteData.users);
  } catch (err) {
    console.log("[INVITE] Erro ao salvar invites.json:", err.message);
  }
}

loadInviteData();

client.once("ready", async () => {
  console.log(`[INVITE] ${client.user.tag} online!`);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.log(`[INVITE] Guild ${GUILD_ID} não encontrada. Guilds:\n`);
    client.guilds.cache.forEach((g) => console.log(`[INVITE]   - ${g.name} (${g.id})`));
    return;
  }

  const logChannel = guild.channels.cache.get(INVITE_LOG_CHANNEL_ID);
  console.log(
    `[INVITE] Pronto. Guild: ${guild.name} | Canal de log: ${
      logChannel ? `#${logChannel.name} (${logChannel.id})` : "NÃO ENCONTRADO -> verifique INVITE_LOG_CHANNEL_ID"
    }`
  );

  await refreshInvites();
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
    console.log(`[INVITE] Cache de invites atualizado (${inviteCache.size}).`);
  } catch (err) {
    console.log("[INVITE] Erro ao atualizar cache de invites:", err.message);
  }
}

client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== GUILD_ID) {
    console.log("[INVITE] Membro de outro guild. Ignorando.");
    return;
  }
  console.log(
    `[INVITE] >> ENTRADA detectada: ${member.user.tag} (${member.id})`
  );

  try {
    const invites = await member.guild.invites.fetch();

    let diffs = [];
    for (const [code, cached] of inviteCache) {
      const current = invites.get(code);
      if (!current) {
        diffs.push({ code, inviter: cached.inviter, delta: "DELETADO" });
      } else if (current.uses > cached.uses) {
        diffs.push({
          code,
          inviter: cached.inviter,
          delta: `${cached.uses} -> ${current.uses}`,
        });
      }
    }

    inviteCache = new Map(invites.map((inv) => [inv.code, inv]));

    if (diffs.length === 0) {
      console.log("[INVITE] NENHUMA mudança de uses encontrada. Sem detecção (join por vanity/link fixo? ou convite já zerou o cache).");
      return;
    }
    if (diffs.length > 1) {
      console.log(
        "[INVITE] AVISO: múltiplas mudanças detectadas, usando a primeira:",
        JSON.stringify(diffs)
      );
    }

    const used = diffs[0];
    const inviter = used.inviter;
    console.log(
      `[INVITE] -> Invite usado: "${used.code}" (uses ${used.delta}) | criado por ${
        inviter ? `${inviter.tag} (${inviter.id})` : "DESCONHECIDO"
      }`
    );

    if (!inviter) {
      console.log("[INVITE] Sem dados do criador do invite. Não dá pra creditar.");
      return;
    }

    const inviterId = inviter.id;
    const before = inviteData.users[inviterId] || 0;
    inviteData.users[inviterId] = before + 1;
    saveInviteData();

    const count = inviteData.users[inviterId];
    const logChannel = member.guild.channels.cache.get(INVITE_LOG_CHANNEL_ID);
    const message = `O usuário <@${member.id}> entrou no servidor através do usuário <@${inviterId}> que agora possui ${count} invite(s)!! 🥳🥳`;

    if (logChannel && logChannel.isTextBased()) {
      try {
        await logChannel.send(message);
        console.log(`[INVITE] >> Mensagem ENVIADA para #${logChannel.name}.`);
      } catch (sendErr) {
        console.log(
          `[INVITE] Falha ao enviar mensagem no canal: ${sendErr.message}`
        );
      }
    } else {
      console.log(
        `[INVITE] Canal ${INVITE_LOG_CHANNEL_ID} não encontrado ou não é de texto.`
      );
    }
    console.log(`[INVITE] MENSAAGEM: ${message}`);
  } catch (err) {
    console.log("[INVITE] Erro ao detectar invite:", err.message);
  }
});

client.on("error", (err) => {
  console.log("[INVITE] Erro do client:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.log("[INVITE] Rejeição não tratada:", reason?.message || reason);
});

process.on("uncaughtException", (err) => {
  console.log("[INVITE] Exceção não capturada:", err.message);
});

function start() {
  const token = process.env.INVITE_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!token) {
    console.log(
      "[INVITE] ERRO: nenhum token (INVITE_BOT_TOKEN ou BOT_TOKEN)."
    );
    return;
  }
  client.login(token).catch((err) =>
    console.log("[INVITE] Falha no login:", err.message)
  );
}

module.exports = { start, client };

if (require.main === module) {
  start();
}