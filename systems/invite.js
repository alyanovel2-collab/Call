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

loadInviteData();

function saveInviteData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(inviteData, null, 2));
    console.log("[INVITE] invites.json salvo.");
  } catch (err) {
    console.log("[INVITE] Erro ao salvar invites.json:", err.message);
  }
}

client.once("ready", async () => {
  console.log(`[INVITE] ${client.user.tag} online!`);

  console.log("[INVITE] Env -> GUILD_ID:", GUILD_ID);
  console.log("[INVITE] Env -> INVITE_LOG_CHANNEL_ID:", INVITE_LOG_CHANNEL_ID);
  console.log(
    "[INVITE] Intents: Guilds, GuildMembers, GuildInvites (GUILD_MEMBERS precisa estar ativado no portal!)"
  );

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.log("[INVITE] Servidor da GUILD_ID não encontrado. Guilds:");
    client.guilds.cache.forEach((g) =>
      console.log(`[INVITE]   - ${g.name} (${g.id})`)
    );
    return;
  }
  console.log(`[INVITE] Servidor encontrado: ${guild.name} (${guild.id})`);

  const logChannel = guild.channels.cache.get(INVITE_LOG_CHANNEL_ID);
  console.log(
    "[INVITE] Canal de log:",
    logChannel ? `#${logChannel.name} (${logChannel.id})` : "NÃO ENCONTRADO"
  );

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
        `[INVITE]   -> código "${inv.code}" | criado por ${inv.inviter?.tag ?? "???"} (${inv.inviter?.id ?? "???"}) | uses = ${inv.uses}`
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
  console.log(`[INVITE] GUILD_ID esperado: ${GUILD_ID} | iguais: ${member.guild.id === GUILD_ID}`);

  if (member.guild.id !== GUILD_ID) {
    console.log("[INVITE] Membro não pertence à GUILD_ID. Ignorando.");
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
        console.log(`[INVITE]   -> CORRESPONDÊNCIA! Código usado: "${inv.code}"`);
        break;
      }
    }

    inviteCache = new Map(invites.map((inv) => [inv.code, inv]));

    if (!used) {
      console.log(`[INVITE] NENHUM invite correspondente encontrado para ${member.user.tag}.`);
      return;
    }

    if (!used.inviter) {
      console.log(`[INVITE] Invite "${used.code}" usado, mas sem inviter disponível.`);
      return;
    }

    const inviterId = used.inviter.id;
    console.log(`[INVITE] Invite usado: "${used.code}" -> inviter ${used.inviter.tag} (${inviterId})`);

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
        console.log(`[INVITE] Falha ao enviar mensagem: ${sendErr.message}`);
      }
    } else {
      console.log(`[INVITE] Canal de log ${INVITE_LOG_CHANNEL_ID} não encontrado ou não é de texto.`);
    }
    console.log(message);
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

function start() {
  const token = process.env.INVITE_BOT_TOKEN || process.env.BOT_TOKEN;
  if (!token) {
    console.log("[INVITE] ERRO: nenhum token definido (INVITE_BOT_TOKEN ou BOT_TOKEN).");
    return;
  }
  client.login(token).catch((err) => {
    console.log(
      "[INVITE] Falha no login:",
      err.message,
      "-> Se a mensagem for 'Used disallowed intents', ative SERVER MEMBERS INTENT no portal."
    );
  });
}

module.exports = { start, client };

if (require.main === module) {
  start();
}