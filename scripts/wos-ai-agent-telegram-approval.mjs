#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STATE_DIR = path.join(ROOT, ".wos-ai-agent");
const OFFSET_FILE = path.join(STATE_DIR, "telegram-offset.json");
const LOCK_FILE = path.join(STATE_DIR, "telegram-poll.lock");

async function loadEnv() {
  if (process.env.WOS_AI_AGENT_TELEGRAM_BOT_TOKEN &&
      process.env.WOS_AI_AGENT_TELEGRAM_CHAT_ID) {
    return;
  }

  try {
    const { config } = await import("dotenv");
    config({
      path: path.join(ROOT, ".env.local"),
      quiet: true,
    });
  } catch {}
}

await loadEnv();

const token =
  process.env.WOS_AI_AGENT_TELEGRAM_BOT_TOKEN ||
  process.env.TELEGRAM_BOT_TOKEN;

const chatId =
  process.env.WOS_AI_AGENT_TELEGRAM_CHAT_ID ||
  process.env.TELEGRAM_CHAT_ID;

const userId =
  process.env.WOS_AI_AGENT_TELEGRAM_USER_ID ||
  process.env.TELEGRAM_USER_ID;

const timeoutMs = Number(
  process.env.WOS_AI_AGENT_APPROVAL_TIMEOUT_MS || 600000
);

const action = process.argv[2];
const details = process.argv.slice(3).join(" ").trim();

function acquirePollLock() {
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const writeLock = () => {
    const fd = fs.openSync(LOCK_FILE, "wx");
    try {
      fs.writeFileSync(
        fd,
        JSON.stringify(
          {
            pid: process.pid,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );
    } finally {
      fs.closeSync(fd);
    }
  };

  try {
    writeLock();
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }

  let existingPid = null;

  try {
    const existing = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
    existingPid = Number(existing?.pid);
  } catch {}

  if (Number.isInteger(existingPid) && existingPid > 0) {
    try {
      process.kill(existingPid, 0);
      throw new Error(
        "Telegram approval blocked: another approval process is already polling Telegram.",
      );
    } catch (probeError) {
      if (probeError?.message?.includes("another approval process")) {
        throw probeError;
      }
    }
  }

  try {
    fs.rmSync(LOCK_FILE, { force: true });
  } catch {}

  try {
    writeLock();
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        "Telegram approval blocked: another approval process is already polling Telegram.",
      );
    }
    throw error;
  }
}

function releasePollLock() {
  try {
    fs.rmSync(LOCK_FILE, { force: true });
  } catch {}
}

if (!token || !chatId || !userId) {
  console.error(
    "Telegram approval blocked: Telegram bot token, chat ID, and authorized user ID are required."
  );
  process.exit(2);
}

acquirePollLock();
process.on("exit", releasePollLock);
process.on("SIGINT", () => {
  releasePollLock();
  process.exit(130);
});
process.on("SIGTERM", () => {
  releasePollLock();
  process.exit(143);
});

if (!action) {
  console.error("Usage: node scripts/wos-ai-agent-telegram-approval.mjs <action> [details]");
  process.exit(2);
}

if (!Number.isFinite(timeoutMs) || timeoutMs < 10000) {
  console.error("Invalid WOS_AI_AGENT_APPROVAL_TIMEOUT_MS.");
  process.exit(2);
}

fs.mkdirSync(STATE_DIR, { recursive: true });

function requestId() {
  return `WOS-${new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

async function telegram(method, body = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Telegram returned invalid JSON: HTTP ${response.status}`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(
      `Telegram API ${method} failed: HTTP ${response.status} ${text.slice(0, 500)}`
    );
  }

  return data.result;
}

function readOffset() {
  try {
    const data = JSON.parse(fs.readFileSync(OFFSET_FILE, "utf8"));
    return Number.isInteger(data.offset) ? data.offset : undefined;
  } catch {
    return undefined;
  }
}

function writeOffset(offset) {
  const temp = `${OFFSET_FILE}.tmp`;
  fs.writeFileSync(
    temp,
    JSON.stringify(
      {
        offset,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );
  fs.renameSync(temp, OFFSET_FILE);
}

const id = requestId();

const message = [
  " WOS AI Dev Agent",
  "",
  `Action: ${action}`,
  details ? `Details: ${details}` : "",
  "",
  "Approval required.",
  "",
  `Request: ${id}`,
  "",
  `APPROVE ${id}`,
  `REJECT ${id}`,
  "",
  `Expires in ${Math.round(timeoutMs / 60000)} minute(s).`,
].filter(Boolean).join("\n");

try {
  await telegram("sendMessage", {
    chat_id: chatId,
    text: message,
  });
} catch (error) {
  console.error(`Telegram approval request failed: ${error.message}`);
  process.exit(1);
}

console.log(`Telegram approval requested: ${id}`);

const started = Date.now();
let offset = readOffset();

while (Date.now() - started < timeoutMs) {
  const remaining = timeoutMs - (Date.now() - started);
  const pollSeconds = Math.max(
    1,
    Math.min(20, Math.floor(remaining / 1000))
  );

  let updates;

  try {
    updates = await telegram("getUpdates", {
      offset,
      timeout: pollSeconds,
      allowed_updates: ["message"],
    });
  } catch (error) {
    console.error(`Telegram polling failed: ${error.message}`);
    process.exit(1);
  }

  for (const update of updates) {
    offset = update.update_id + 1;
    writeOffset(offset);

    const messageData = update.message;

    if (!messageData) continue;

    const incomingChatId = String(messageData.chat?.id ?? "");
    const incomingUserId = String(messageData.from?.id ?? "");

    if (incomingChatId !== String(chatId)) {
      continue;
    }

    if (incomingUserId !== String(userId)) {
      continue;
    }

    const text = String(messageData.text ?? "").trim();

    const approve = new RegExp(
      `^APPROVE\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i"
    );

    const reject = new RegExp(
      `^REJECT\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i"
    );

    if (approve.test(text)) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: ` Approval accepted\nRequest: ${id}\nAction: ${action}`,
      });

      console.log(`TELEGRAM_APPROVAL PASS: ${id}`);
      process.exit(0);
    }

    if (reject.test(text)) {
      await telegram("sendMessage", {
        chat_id: chatId,
        text: ` Rejected\nRequest: ${id}\nAction: ${action}`,
      });

      console.error(`TELEGRAM_APPROVAL REJECTED: ${id}`);
      process.exit(1);
    }
  }
}

try {
  await telegram("sendMessage", {
    chat_id: chatId,
    text: ` Approval expired\nRequest: ${id}\nAction: ${action}`,
  });
} catch {}

console.error(`TELEGRAM_APPROVAL EXPIRED: ${id}`);
process.exit(1);
