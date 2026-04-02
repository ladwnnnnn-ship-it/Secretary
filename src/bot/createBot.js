import { DateTime } from "luxon";
import { Telegraf } from "telegraf";
import { appConfig } from "../config.js";
import { parseTaskInput, parseTasksFromImage, reviewParsedResult } from "../ai/client.js";
import { listPendingTasks, saveTask } from "../infra/db.js";

function isAuthorized(ctx) {
  const userId = ctx.from?.id;
  return userId === appConfig.ownerTelegramUserId;
}

function formatDraft(result) {
  const task = result.task || {};
  return [
    "AI 解析结果：",
    `intent: ${result.intent}`,
    `title: ${task.title || "(缺失)"}`,
    `priority: ${task.priority || "(缺失)"}`,
    `start_at: ${task.start_at || "-"}`,
    `due_at: ${task.due_at || "-"}`,
    `timezone: ${task.timezone || "(缺失)"}`,
    `status: ${task.status || "todo"}`,
    `tags: ${(task.tags || []).join(", ") || "-"}`,
    `confidence: ${result.confidence.toFixed(2)}`,
    result.questions?.length ? `questions: ${result.questions.join(" | ")}` : "questions: -"
  ].join("\n");
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
    await ctx.reply("AI-first 任务 Bot 已启动。使用 /quick + 自然语言创建任务，或直接发送日程图片自动导入。\n例：/quick 明天10点前提交周报，优先级高");
  });

  bot.command("quick", async (ctx) => {
    const inputText = ctx.message.text.replace(/^\/quick\s*/i, "").trim();
    if (!inputText) {
      await ctx.reply("请输入任务描述。例如：/quick 明晚8点前完成复盘，优先级高");
      return;
    }

    const timezone = appConfig.defaultTimezone;
    const nowIso = DateTime.now().setZone(timezone).toISO();

    try {
      const parsed = await parseTaskInput(inputText, timezone, nowIso);
      const reviewed = await reviewParsedResult(parsed);

      if (reviewed.intent !== "create_task") {
        await ctx.reply(`${formatDraft(reviewed)}\n\n当前 /quick 仅支持创建任务。`);
        return;
      }

      if (!reviewed.task?.title || !reviewed.task?.priority || !reviewed.task?.timezone) {
        await ctx.reply(`${formatDraft(reviewed)}\n\n关键信息不完整，请补充后重新 /quick。`);
        return;
      }

      const saved = await saveTask(reviewed.task, ctx.from.id);
      await ctx.reply(`${formatDraft(reviewed)}\n\n任务已自动创建。task_id=${saved.id} (store=${saved.source})`);
    } catch (error) {
      await ctx.reply(`AI 处理失败：${error.message}`);
    }
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

  bot.command("todo", showPendingTasks);
  bot.command("list", showPendingTasks);
  bot.command("today", showPendingTasks);

  bot.command("confirm", async (ctx) => {
    await ctx.reply("当前已改为 /quick 自动创建任务，不再需要 /confirm。 ");
  });

  bot.command("myid", async (ctx) => {
    await ctx.reply(`你的 Telegram ID: ${ctx.from.id}`);
  });

  bot.command("help", async (ctx) => {
    await ctx.reply([
      "可用命令：",
      "/quick <自然语言>",
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
