require("dotenv").config();

const callBot = require("./systems/call.js");

const token = process.env.CALL_BOT_TOKEN || process.env.BOT_TOKEN;

if (!token) {
  console.error(
    "=== CONFIGURAÇÃO FALTANDO ===\n" +
      "Faltando token do bot da call (CALL_BOT_TOKEN ou BOT_TOKEN) ou o arquivo .env.\n" +
      "Crie um .env na raiz com:\n\n" +
      "GUILD_ID=id_do_servidor\n" +
      "VOICE_CHANNEL_ID=id_do_canal_de_voz\n" +
      "CALL_BOT_TOKEN=token_do_bot_da_call\n"
  );
  process.exit(1);
}

console.log("=== Iniciando Call Bot ===");
callBot.start();

console.log(
  "\nO invite tracker roda separado, na pasta invite-tracker/ (cd invite-tracker && npm start)."
);
