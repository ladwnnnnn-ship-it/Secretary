import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { appConfig } from "../config.js";

const { Pool } = pg;

const pool = appConfig.pgUrl
  ? new Pool({ connectionString: appConfig.pgUrl })
  : null;

const memoryTasks = [];

export async function initDb() {
  if (!pool) {
    return { mode: "memory" };
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const schemaPath = path.resolve(__dirname, "../../db/schema.sql");
  const schemaSql = (await readFile(schemaPath, "utf8")).replace(/^\uFEFF/, "");

  await pool.query(schemaSql);
  return { mode: "postgres" };
}

export async function saveTask(task, telegramUserId) {
  if (!pool) {
    const id = `mem-${Date.now()}`;
    memoryTasks.push({ id, telegramUserId, ...task });
    return { id, source: "memory" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `INSERT INTO app_users (telegram_user_id, timezone)
       VALUES ($1, $2)
       ON CONFLICT (telegram_user_id)
       DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [telegramUserId, task.timezone]
    );

    const ownerUserId = userResult.rows[0].id;

    const taskResult = await client.query(
      `INSERT INTO tasks
        (owner_user_id, title, description, start_at, due_at, timezone, priority, status, tags, repeat_rule, source)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'todo'), COALESCE($9, '{}'), COALESCE($10, 'none'), 'ai')
       RETURNING id`,
      [
        ownerUserId,
        task.title,
        task.description || null,
        task.start_at || null,
        task.due_at || null,
        task.timezone,
        task.priority,
        task.status || "todo",
        task.tags || [],
        task.repeat_rule || "none"
      ]
    );

    await client.query("COMMIT");
    return { id: taskResult.rows[0].id, source: "postgres" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listPendingTasks(telegramUserId, limit = 20) {
  if (!pool) {
    return memoryTasks
      .filter((task) => task.telegramUserId === telegramUserId)
      .filter((task) => task.status !== "done")
      .sort((a, b) => {
        const aDue = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
        const bDue = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
        return aDue - bDue;
      })
      .slice(0, limit)
      .map((task) => ({
        id: task.id,
        title: task.title,
        priority: task.priority || "medium",
        status: task.status || "todo",
        due_at: task.due_at || null
      }));
  }

  const result = await pool.query(
    `SELECT
       t.id,
       t.title,
       t.priority,
       t.status,
       t.due_at
     FROM tasks t
     JOIN app_users u ON t.owner_user_id = u.id
     WHERE u.telegram_user_id = $1
       AND t.status <> 'done'
     ORDER BY t.due_at NULLS LAST, t.created_at DESC
     LIMIT $2`,
    [telegramUserId, limit]
  );

  return result.rows;
}
