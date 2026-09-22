require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");

const BUILD_VERSION = "v10-watcher";
console.log(`[INVITE] BUILD: ${BUILD_VERSION}`);

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
const WATCH_INTERVAL_MS = 5 * 1000;
const PENDING_TTL_MS = 3 * 60 * 1000;

let inviteData = { users: {} };
let lastSeen = new Map();
let pendingJoins = [];
let watchLooping = false;

function loadInviteData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      inviteData = { users: {}, ...parsed };
      console.log("[INVITE] invites.json carregado. users:", inviteData.users);
    }
  } catch (err) {
    console.log("[INVITE] Erro ao ler invites.json:", err.message);
  }
}

function saveInviteData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(inviteData, null, 2));
  } catch (err) {
    console.log("[INVITE] Erro ao salvar invites.json:", err.message);
  }
}

loadInviteData();

function snapshotMap(invites) {
  const map = new Map();
  for (const inv of invites.values()) {
    map.set(inv.code, {
      uses: inv.uses,
      inviter: inv.inviter,
      name: inv.inviter?.tag ?? "?",
    });
  }
  return map;
}

async function fetchSnapshot(guild) {
  try {
    const invites = await guild.invites.fetch();
    return snapshotMap(invites);
  } catch (err) {
    console.log("[INVITE] Erro ao buscar invites:", err.message);
    return null;
  }
}

function creditInviter(member, inviter) {
  if (!inviter) {
    console.log("[INVITE] Sem dados do criador do invite. Não dá pra creditar.");
    return false;
  }
  const inviterId = inviter.id;
  inviteData.users[inviterId] = (inviteData.users[inviterId] || 0) + 1;
  saveInviteData();

  const count = inviteData.users[inviterId];
  const logChannel = member.guild.channels.cache.get(INVITE_LOG_CHANNEL_ID);
  const message = `O usuário <@${member.id}> entrou no servidor através do usuário <@${inviterId}> que agora possui ${count} invite(s)!! 🥳🥳`;

  if (logChannel && logChannel.isTextBased()) {
    logChannel
      .send(message)
      .then(() => console.log(`[INVITE] >> Mensagem ENVIADA para #${logChannel.name}.`))
      .catch((e) => console.log("[INVITE] Falha ao enviar mensagem:", e.message));
  }
  console.log(`[INVITE] RESULTADO: ${message}`);
  return true;
}

function attribute(member, used, prevUses) {
  const detail =
    used.created === undefined
      ? `uses ${prevUses} -> ${used.uses}`
      : "invite NOVO criado/registrado agora";
  console.log(
    `[INVITE] >> ${member.user.tag} (${
      member.id
    }) convidado | invite "${used.code}" (${detail}) | criado por ${
      used.name ?? "?"
    } (${used.inviter?.id ?? "?"})`
  );
  return creditInviter(member, used.inviter);
}

async function watchLoop() {
  if (watchLooping) return;
  watchLooping = true;
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;

    const now = Date.now();
    pendingJoins = pendingJoins.filter((p) => now - p.at < PENDING_TTL_MS);

    const current = await fetchSnapshot(guild);
    if (!current) return;

    if (lastSeen.size === 0) {
      lastSeen = current;
      console.log(`[INVITE] Watch init: ${lastSeen.size} invites.`);
      return;
    }

    const changed = [];
    for (const [code, entry] of lastSeen) {
      const cur = current.get(code);
      if (!cur) {
        changed.push({ code, uses: "DELETADO", inviter: entry.inviter, name: entry.name });
      } else if (cur.uses > entry.uses) {
        changed.push({
          code,
          uses: cur.uses,
          delta: cur.uses - entry.uses,
          inviter: cur.inviter,
          name: cur.name,
          prevUses: entry.uses,
        });
      }
    }
    for (const [code, entry] of current) {
      if (!lastSeen.has(code)) {
        changed.push({
          code,
          uses: entry.uses,
          delta: entry.uses,
          created: true,
          inviter: entry.inviter,
          name: entry.name,
          prevUses: 0,
        });
      }
    }

    if (changed.length > 0) {
      console.log(
        `[INVITE] Mudanças vistas (${changed.length}, pendentes=${pendingJoins.length}):`,
        JSON.stringify(
          changed.map((c) => ({
            code: c.code,
            state: c.uses,
            delta: c.delta,
            by: c.name,
          }))
        )
      );
    }

    const candidates =
      changed.filter((c) => c.uses !== "DELETADO" && c.delta > 0) ||
      [];

    if (candidates.length === 1 && pendingJoins.length > 0) {
      const used = candidates[0];
      const member = pendingJoins[0].member;
      if (attribute(member, used, used.prevUses)) {
        pendingJoins.shift();
      }
    } else if (changed.length === 1 && changed[0].uses === "DELETADO" && pendingJoins.length > 0) {
      const used = changed[0];
      const member = pendingJoins[0].member;
      console.log(`[INVITE] >> invite deletado "${used.code}" (criado por ${used.name}): atribuindo`);
      if (creditInviter(member, used.inviter)) {
        pendingJoins.shift();
      }
    }

    lastSeen = current;
  } finally {
    watchLooping = false;
  }
}

client.once("ready", async () => {
  console.log(`[INVITE] ${client.user.tag} online! BUILD ${BUILD_VERSION}`);
  console.log("[INVITE] Canal de log:", INVITE_LOG_CHANNEL_ID);
  await watchLoop();
  setInterval(watchLoop, WATCH_INTERVAL_MS);
});

client.on("guildMemberAdd", (member) => {
  if (member.guild.id !== GUILD_ID) return;

  const alreadyPending = pendingJoins.some(
    (p) => p.member.id === member.id && Date.now() - p.at < 10_000
  );
  if (alreadyPending) {
    console.log(`[INVITE] ENTRADA redeclarada (ignorando duplicata): ${member.user.tag}`);
    return;
  }

  pendingJoins.push({ member, at: Date.now() });
  console.log(
    `[INVITE] >> ENTRADA registrada (fila=${pendingJoins.length}): ${member.user.tag} (${member.id})`
  );

  setTimeout(() => {
    const idx = pendingJoins.findIndex((p) => p.member.id === member.id);
    if (idx !== -1) {
      console.log(
        `[INVITE] Fila vazia pro join de ${member.user.tag} (3min sem mudança de invite).`
      );
      pendingJoins.splice(idx, 1);
    }
  }, PENDING_TTL_MS);
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
  if (process.env.ENABLE_INVITE_BOT === "false") {
    console.log("[INVITE] Desabilitado via ENABLE_INVITE_BOT=false.");
    return;
  }
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