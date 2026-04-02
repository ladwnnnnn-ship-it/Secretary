import { createBot } from "./bot/createBot.js";

async function main() {
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
