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
const PENDING_TTL_MS = 10 * 60 * 1000;
const RETRY_DELAYS = [0, 2000, 5000, 10000];

let inviteData = { users: {} };
let inviteCache = new Map();
const pendingJoins = new Map();

function dumpCodes(map, label) {
  const line = [...map.values()]
    .map((inv) => `${inv.code}:${inv.uses}`)
    .join(" ");
  console.log(`[INVITE] ${label} (${map.size}): ${line}`);
}

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
    console.log("[INVITE] invites.json atualizado.");
  } catch (err) {
    console.log("[INVITE] Erro ao salvar invites.json:", err.message);
  }
}

loadInviteData();

function diffInvites(base, current) {
  const used = [];
  const deleted = [];
  for (const [code, cached] of base) {
    const now = current.get(code);
    if (!now) {
      deleted.push({ code, inviter: cached.inviter, detail: "DELETADO" });
    } else if (now.uses > cached.uses) {
      used.push({
        code,
        inviter: cached.inviter,
        detail: `${cached.uses} -> ${now.uses}`,
        delta: now.uses - cached.uses,
      });
    }
  }
  return { used, deleted };
}

async function fetchInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    return new Map(invites.map((inv) => [inv.code, inv]));
  } catch (err) {
    console.log("[INVITE] Erro ao buscar invites:", err.message);
    return null;
  }
}

async function creditInviter(member, used) {
  const inviter = used.inviter;
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
      console.log(`[INVITE] Falha ao enviar mensagem: ${sendErr.message}`);
    }
  } else {
    console.log(
      `[INVITE] Canal ${INVITE_LOG_CHANNEL_ID} não encontrado ou não é de texto.`
    );
  }
  console.log(`[INVITE] RESULTADO: ${message}`);
}

async function tryDetect(member, base, baseText, quiet = false) {
  const invites = await fetchInvites(member.guild);
  if (!invites) return null;
  const { used, deleted } = diffInvites(base, invites);
  inviteCache = invites;

  if (used.length > 0) {
    const pick = used.sort((a, b) => b.delta - a.delta)[0];
    if (used.length > 1) {
      console.log(
        `[INVITE] ${baseText} AVISO: ${used.length} invites com uses alterado, pegando o maior:`,
        JSON.stringify(used.map((d) => ({ code: d.code, detail: d.detail })))
      );
    }
    console.log(
      `[INVITE] ${baseText} -> Invite usado "${pick.code}" (uses ${pick.detail}) | criado por ${
        pick.inviter ? `${pick.inviter.tag} (${pick.inviter.id})` : "DESCONHECIDO"
      }`
    );
    return pick;
  }

  if (deleted.length === 1) {
    const pick = deleted[0];
    console.log(
      `[INVITE] ${baseText} -> Apenas 1 invite deletado "${pick.code}" | criado por ${
        pick.inviter ? `${pick.inviter.tag} (${pick.inviter.id})` : "DESCONHECIDO"
      } -> tratando como usado`
    );
    return pick;
  }

  if (!quiet) {
    if (deleted.length > 1) {
      console.log(
        `[INVITE] ${baseText} ${deleted.length} invites deletados e nenhum uses alterado.`
      );
    } else {
      console.log(`[INVITE] ${baseText} NENHUMA mudança de uses encontrada.`);
    }
    dumpCodes(invites, "atuais");
  }
  return null;
}

function recheckPending() {
  const now = Date.now();
  for (const [memberId, entry] of pendingJoins) {
    if (now - entry.startedAt > PENDING_TTL_MS) {
      pendingJoins.delete(memberId);
      console.log("[INVITE] recheck expirou para:", memberId);
      continue;
    }
    tryDetect(entry.member, inviteCache, "[INVITE] (recheck)", true).then((used) => {
      if (used) {
        pendingJoins.delete(memberId);
        creditInviter(entry.member, used);
      }
    });
  }
}

client.once("ready", async () => {
  console.log(`[INVITE] ${client.user.tag} online!`);
  console.log("  [INVITE] Canal de log:", INVITE_LOG_CHANNEL_ID);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.log(`  [INVITE] Guild ${GUILD_ID} não encontrada. Guilds:\n`);
    client.guilds.cache.forEach((g) =>
      console.log(`  [INVITE]   - ${g.name} (${g.id})`)
    );
    return;
  }
  console.log(`  [INVITE] Pronto. Guild: ${guild.name}.`);

  await refreshInvites();
  setInterval(refreshInvites, INVITE_REFRESH_MS);
  setInterval(recheckPending, 5_000);
});

async function refreshInvites() {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;
  const invites = await fetchInvites(guild);
  if (invites) {
    inviteCache = invites;
    console.log(`[INVITE] Cache de invites atualizado (${inviteCache.size}).`);
    recheckPending();
  }
}

client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== GUILD_ID) {
    console.log("[INVITE] Membro de outro guild. Ignorando.");
    return;
  }
  console.log(`[INVITE] >> ENTRADA detectada: ${member.user.tag} (${member.id})`);

  const base = inviteCache;
  for (const delay of RETRY_DELAYS) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const used = await tryDetect(member, base, "[INVITE]");
    if (used) {
      await creditInviter(member, used);
      return;
    }
  }

  console.log(
    "[INVITE] Ainda sem detecção (uses atrasado?). Agendando recheck por 2 min..."
  );
  pendingJoins.set(member.id, { member, startedAt: Date.now() });
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
    console.log("[INVITE] ERRO: nenhum token (INVITE_BOT_TOKEN ou BOT_TOKEN).");
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