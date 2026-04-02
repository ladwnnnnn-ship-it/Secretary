import { config as load } from "dotenv";

load();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function requiredAny(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required env var. Need one of: ${names.join(", ")}`);
}

export const appConfig = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  aiApiBaseUrl: requiredAny(["AI_API_BASE_URL", "BASE_URL"]),
  aiApiKey: required("AI_API_KEY"),
  aiModel: process.env.AI_MODEL || process.env.LLM_NAME || "gpt-5.4-mini",
  aiConfidenceThreshold: Number(process.env.AI_CONFIDENCE_THRESHOLD || 0.8),
  ownerTelegramUserId: Number(requiredAny(["OWNER_TELEGRAM_USER_ID", "OWNER_ID"])),
  pgUrl: process.env.DATABASE_URL || "",
  defaultTimezone: process.env.DEFAULT_TIMEZONE || "Asia/Shanghai"
};
