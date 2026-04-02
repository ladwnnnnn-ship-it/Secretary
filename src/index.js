import { createBot } from "./bot/createBot.js";
import { initDb } from "./infra/db.js";

async function main() {
  const db = await initDb();
  console.log(`DB mode: ${db.mode}`);

  const bot = createBot();
  await bot.launch();

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  console.log("Bot is running.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
