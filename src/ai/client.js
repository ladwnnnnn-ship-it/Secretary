import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { appConfig } from "../config.js";
import { validateAiResult } from "./schemas.js";

function buildUrl(pathName) {
  const base = appConfig.aiApiBaseUrl.replace(/\/$/, "");
  const normalizedPath = pathName.startsWith("/") ? pathName : `/${pathName}`;

  if (base.endsWith("/v1") && normalizedPath.startsWith("/v1/")) {
    return `${base}${normalizedPath.slice(3)}`;
  }

  return `${base}${normalizedPath}`;
}

function parseJsonFromText(text) {
  const trimmed = (text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error(`Model did not return valid JSON: ${trimmed.slice(0, 200)}`);
  }
}

async function loadPromptFile(fileName) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const fullPath = path.resolve(__dirname, "../../prompts", fileName);
  return readFile(fullPath, "utf8");
}

async function postChat(payload) {
  const response = await fetch(buildUrl("/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appConfig.aiApiKey}`
    },
    body: JSON.stringify({
      model: appConfig.aiModel,
      temperature: 0.1,
      ...payload
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AI API /chat/completions failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI API returned empty completion content.");
  }

  return content;
}

async function callChatJson(systemPrompt, userPrompt) {
  const content = await postChat({
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });
  return parseJsonFromText(content);
}

async function callVisionJson(systemPrompt, textPrompt, imageUrl) {
  const content = await postChat({
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: textPrompt },
          { type: "image_url", image_url: { url: imageUrl } }
        ]
      }
    ]
  });
  return parseJsonFromText(content);
}

async function callChatText(systemPrompt, userPrompt) {
  return postChat({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  });
}

export async function parseTaskInput(inputText, timezone, nowIso) {
  const systemPrompt = await loadPromptFile("system_parser.txt");
  const userPrompt = [
    "Return only JSON with this schema:",
    '{"intent":"create_task|update_task|delete_task|query_task|report","task":{"title":"string","description":"string|null","start_at":"ISO-8601|null","due_at":"ISO-8601|null","timezone":"IANA tz","priority":"low|medium|high|urgent","status":"todo|in_progress|done|deferred","tags":["string"],"repeat_rule":"none|daily|weekly|rrule"},"reminder_plan":{"daily_digest":["08:00"],"before_start_minutes":[30],"before_due_minutes":[120,30],"overdue_repeat_minutes":[60]},"confidence":0.0,"needs_confirmation":true,"questions":["string"]}',
    `timezone=${timezone}`,
    `now=${nowIso}`,
    `input=${inputText}`
  ].join("\n");

  const raw = await callChatJson(systemPrompt, userPrompt);
  return validateAiResult(raw);
}

export async function reviewParsedResult(parsed) {
  const systemPrompt = await loadPromptFile("system_reviewer.txt");
  const userPrompt = [
    "Review this parser output and return corrected JSON in same schema. Return JSON only.",
    JSON.stringify(parsed)
  ].join("\n");

  const raw = await callChatJson(systemPrompt, userPrompt);
  return validateAiResult(raw);
}

const imageImportSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().nullable().optional(),
      start_at: z.string().nullable().optional(),
      due_at: z.string().nullable().optional(),
      timezone: z.string().optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      status: z.enum(["todo", "in_progress", "done", "deferred"]).optional(),
      tags: z.array(z.string()).optional(),
      repeat_rule: z.enum(["none", "daily", "weekly", "rrule"]).optional()
    })
  ),
  confidence: z.number().min(0).max(1).default(0.8),
  questions: z.array(z.string()).default([])
});

export async function parseTasksFromImage(imageUrl, timezone, nowIso, hintText = "") {
  const systemPrompt = await loadPromptFile("system_image_parser.txt");
  const userPrompt = [
    "Extract schedule items from image and return JSON only.",
    `timezone=${timezone}`,
    `now=${nowIso}`,
    `hint=${hintText || "(none)"}`,
    "JSON schema:",
    '{"tasks":[{"title":"string","description":"string|null","start_at":"ISO-8601|null","due_at":"ISO-8601|null","timezone":"IANA tz","priority":"low|medium|high|urgent","status":"todo|in_progress|done|deferred","tags":["string"],"repeat_rule":"none|daily|weekly|rrule"}],"confidence":0.0,"questions":["string"]}'
  ].join("\n");

  const raw = await callVisionJson(systemPrompt, userPrompt, imageUrl);
  const parsed = imageImportSchema.parse(raw);

  const normalizedTasks = parsed.tasks.map((task) => {
    const normalized = validateAiResult({
      intent: "create_task",
      task: {
        ...task,
        timezone: task.timezone || timezone,
        priority: task.priority || "medium",
        status: task.status || "todo",
        tags: task.tags || [],
        repeat_rule: task.repeat_rule || "none"
      },
      confidence: parsed.confidence,
      needs_confirmation: false,
      questions: parsed.questions
    });

    return normalized.task;
  }).filter(Boolean);

  return {
    tasks: normalizedTasks,
    confidence: parsed.confidence,
    questions: parsed.questions
  };
}

export async function summarizeReport(period, metrics, timezone) {
  const systemPrompt = await loadPromptFile("system_summarizer.txt");
  const userPrompt = [
    "Return JSON only with fields: summary_markdown (string), confidence (0-1).",
    `period=${period}`,
    `timezone=${timezone}`,
    `metrics=${JSON.stringify(metrics)}`
  ].join("\n");

  return callChatJson(systemPrompt, userPrompt);
}

export async function chatReply(inputText, timezone, nowIso) {
  const systemPrompt = await loadPromptFile("system_chat.txt");
  const userPrompt = [
    `timezone=${timezone}`,
    `now=${nowIso}`,
    `input=${inputText}`
  ].join("\n");
  return callChatText(systemPrompt, userPrompt);
}
