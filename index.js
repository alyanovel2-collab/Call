require("dotenv").config();

const callBot = require("./systems/call.js");
const inviteBot = require("./systems/invite.js");

console.log("=== Iniciando Call Bot ===");
callBot.start();

console.log("=== Iniciando Invite Bot ===");
if ((process.env.CALL_BOT_TOKEN || process.env.BOT_TOKEN) === (process.env.INVITE_BOT_TOKEN || process.env.BOT_TOKEN)) {
  console.log(
    "AVISO: os dois bots estão usando o MESMO token. O Discord derruba um dos dois. Use CALL_BOT_TOKEN e INVITE_BOT_TOKEN diferentes (2 aplicações), ou rode apenas um deles."
  );
}
inviteBot.start();