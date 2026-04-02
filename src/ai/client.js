import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
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

async function callChatJson(systemPrompt, userPrompt) {
  const response = await fetch(buildUrl("/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appConfig.aiApiKey}`
    },
    body: JSON.stringify({
      model: appConfig.aiModel,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
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
  return parseJsonFromText(content);
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
