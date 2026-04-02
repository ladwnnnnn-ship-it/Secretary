import { DateTime } from "luxon";
import { Telegraf } from "telegraf";
import { appConfig } from "../config.js";
import { chatReply, parseTaskInput, parseTasksFromImage, reviewParsedResult } from "../ai/client.js";
import { listPendingTasks, saveTask } from "../infra/db.js";

function isAuthorized(ctx) {
  const userId = ctx.from?.id;
  return userId === appConfig.ownerTelegramUserId;
}

function formatDue(dueAt) {
  if (!dueAt) {
    return "-";
  }

  const dt = DateTime.fromISO(String(dueAt));
  if (!dt.isValid) {
    return String(dueAt);
  }

  return dt.setZone(appConfig.defaultTimezone).toFormat("yyyy-LL-dd HH:mm");
}

export function createBot() {
  const bot = new Telegraf(appConfig.telegramBotToken);

  bot.use(async (ctx, next) => {
    if (!isAuthorized(ctx)) {
      await ctx.reply("未授权用户。请在配置里设置 OWNER_TELEGRAM_USER_ID 或白名单。");
      return;
    }
    return next();
  });

  bot.start(async (ctx) => {
    await ctx.reply("AI-first 任务 Bot 已启动。直接发一句话我就会识别任务并创建；普通问题我会直接聊天回复。也可以直接发日程图片导入。 ");
  });

  async function showPendingTasks(ctx) {
    try {
      const items = await listPendingTasks(ctx.from.id, 30);
      if (!items.length) {
        await ctx.reply("当前没有未办事项。");
        return;
      }

      const lines = ["未办事项："];
      for (const item of items) {
        lines.push(`${item.id} | ${item.title} | ${item.priority} | ${item.status} | 截止: ${formatDue(item.due_at)}`);
      }
      await ctx.reply(lines.join("\n"));
    } catch (error) {
      await ctx.reply(`查询失败：${error.message}`);
    }
  }

  async function handleNaturalText(ctx, inputText) {
    const timezone = appConfig.defaultTimezone;
    const nowIso = DateTime.now().setZone(timezone).toISO();

    try {
      const parsed = await parseTaskInput(inputText, timezone, nowIso);
      const reviewed = await reviewParsedResult(parsed);

      if (reviewed.intent === "create_task") {
        if (!reviewed.task?.title || !reviewed.task?.priority || !reviewed.task?.timezone) {
          await ctx.reply("我识别到你在创建任务，但信息还不完整。请补上时间或优先级后再发一次。 ");
          return;
        }

        const saved = await saveTask(reviewed.task, ctx.from.id);
        await ctx.reply(`已添加任务：${reviewed.task.title}\ntask_id=${saved.id} (store=${saved.source})`);
        return;
      }

      if (reviewed.intent === "query_task") {
        await showPendingTasks(ctx);
        return;
      }

      const reply = await chatReply(inputText, timezone, nowIso);
      await ctx.reply(reply);
    } catch (error) {
      await ctx.reply(`AI 处理失败：${error.message}`);
    }
  }

  bot.command("quick", async (ctx) => {
    const inputText = ctx.message.text.replace(/^\/quick\s*/i, "").trim();
    if (!inputText) {
      await ctx.reply("你直接输入一句话就行，不一定要用 /quick。 ");
      return;
    }
    await handleNaturalText(ctx, inputText);
  });

  bot.on("photo", async (ctx) => {
    try {
      const photos = ctx.message.photo || [];
      if (!photos.length) {
        await ctx.reply("未检测到图片内容。");
        return;
      }

      const best = photos[photos.length - 1];
      const fileLink = await ctx.telegram.getFileLink(best.file_id);
      const caption = ctx.message.caption?.trim() || "";

      const timezone = appConfig.defaultTimezone;
      const nowIso = DateTime.now().setZone(timezone).toISO();

      const parsed = await parseTasksFromImage(fileLink.toString(), timezone, nowIso, caption);
      if (!parsed.tasks.length) {
        const ask = parsed.questions?.length ? `\n备注: ${parsed.questions.join(" | ")}` : "";
        await ctx.reply(`没有识别到可导入的日程任务。${ask}`);
        return;
      }

      const created = [];
      for (const task of parsed.tasks) {
        if (!task.title) {
          continue;
        }
        const saved = await saveTask(task, ctx.from.id);
        created.push({ id: saved.id, title: task.title, due_at: task.due_at || null, source: saved.source });
      }

      if (!created.length) {
        await ctx.reply("识别到了内容，但没有可入库的有效任务。请给图片加一段说明文字后重试。");
        return;
      }

      const lines = [
        `图片导入完成：${created.length} 条`,
        `confidence: ${Number(parsed.confidence || 0).toFixed(2)}`
      ];

      for (const item of created.slice(0, 10)) {
        lines.push(`${item.id} | ${item.title} | 截止: ${formatDue(item.due_at)} | ${item.source}`);
      }

      if (created.length > 10) {
        lines.push(`...其余 ${created.length - 10} 条已导入`);
      }

      if (parsed.questions?.length) {
        lines.push(`备注: ${parsed.questions.join(" | ")}`);
      }

      await ctx.reply(lines.join("\n"));
    } catch (error) {
      await ctx.reply(`图片导入失败：${error.message}`);
    }
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message?.text?.trim() || "";
    if (!text || text.startsWith("/")) {
      return;
    }

    await handleNaturalText(ctx, text);
  });

  bot.command("todo", showPendingTasks);
  bot.command("list", showPendingTasks);
  bot.command("today", showPendingTasks);

  bot.command("confirm", async (ctx) => {
    await ctx.reply("当前已改为自动创建任务，不再需要 /confirm。 ");
  });

  bot.command("myid", async (ctx) => {
    await ctx.reply(`你的 Telegram ID: ${ctx.from.id}`);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply([
      "可用命令：",
      "直接发一句话（自动识别任务或聊天）",
      "直接发送图片（自动识别并导入任务）",
      "/todo",
      "/list",
      "/today",
      "/myid",
      "/help"
    ].join("\n"));
  });

  return bot;
}
