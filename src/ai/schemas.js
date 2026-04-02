import { DateTime } from "luxon";
import { z } from "zod";

const taskPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  start_at: z.string().nullable().optional(),
  due_at: z.string().nullable().optional(),
  timezone: z.string().min(1).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  status: z.enum(["todo", "in_progress", "done", "deferred"]).optional(),
  tags: z.array(z.string()).optional(),
  repeat_rule: z.enum(["none", "daily", "weekly", "rrule"]).optional()
});

const reminderPlanSchema = z
  .object({
    daily_digest: z.array(z.string()).optional(),
    before_start_minutes: z.array(z.number().int()).optional(),
    before_due_minutes: z.array(z.number().int()).optional(),
    overdue_repeat_minutes: z.array(z.number().int()).optional()
  })
  .optional();

export const aiResultSchema = z.object({
  intent: z.enum(["create_task", "update_task", "delete_task", "query_task", "report"]),
  task: taskPayloadSchema.optional(),
  reminder_plan: reminderPlanSchema,
  confidence: z.number().min(0).max(1),
  needs_confirmation: z.boolean(),
  questions: z.array(z.string()).default([])
});

function tryParseDateTime(value, timezone) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const zone = timezone || "Asia/Shanghai";
  const candidates = [
    DateTime.fromISO(text, { setZone: true }),
    DateTime.fromISO(text, { zone }),
    DateTime.fromRFC2822(text, { zone }),
    DateTime.fromHTTP(text, { zone }),
    DateTime.fromFormat(text, "yyyy-MM-dd HH:mm", { zone }),
    DateTime.fromFormat(text, "yyyy/MM/dd HH:mm", { zone }),
    DateTime.fromFormat(text, "yyyy-MM-dd HH:mm:ss", { zone }),
    DateTime.fromFormat(text, "yyyy/MM/dd HH:mm:ss", { zone }),
    DateTime.fromFormat(text, "yyyy-MM-dd'T'HH:mm", { zone }),
    DateTime.fromFormat(text, "yyyy-MM-dd", { zone })
  ];

  for (const dt of candidates) {
    if (dt.isValid) {
      return dt.toISO();
    }
  }

  return null;
}

function normalizeRaw(raw) {
  const normalized = structuredClone(raw);

  if (!Array.isArray(normalized.questions)) {
    normalized.questions = [];
  }

  if (!normalized.task) {
    return normalized;
  }

  const tz = normalized.task.timezone || "Asia/Shanghai";

  for (const field of ["start_at", "due_at"]) {
    const source = normalized.task[field];
    if (source === null || source === undefined) {
      continue;
    }

    const parsed = tryParseDateTime(source, tz);
    if (parsed) {
      normalized.task[field] = parsed;
      continue;
    }

    normalized.task[field] = null;
    normalized.needs_confirmation = true;
    normalized.confidence = Math.min(Number(normalized.confidence || 0), 0.79);
    normalized.questions.push(`${field} 无法解析，请明确时间（例如 2026-04-03 19:00）`);
  }

  return normalized;
}

export function validateAiResult(raw) {
  return aiResultSchema.parse(normalizeRaw(raw));
}
