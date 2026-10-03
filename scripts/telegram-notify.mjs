#!/usr/bin/env node

// Load local development env when Telegram vars are not already exported.
// Secrets are used in-process only and are never printed.
if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
  try {
    const { config } = await import("dotenv");
    const { fileURLToPath } = await import("node:url");
    const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
    config({ path: envPath, quiet: true });
  } catch {
    // Keep the explicit environment-variable path working even if dotenv is unavailable.
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const text = process.argv.slice(2).join(" ").trim();

if (!token || !chatId) {
  console.error("Telegram notification not configured: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.");
  process.exit(2);
}

if (!text) {
  console.error("Usage: node scripts/telegram-notify.mjs \"message\"");
  process.exit(2);
}

if (text.length > 4096) {
  console.error("Telegram message exceeds 4096 characters.");
  process.exit(2);
}

const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: chatId, text }),
});

if (!response.ok) {
  const body = await response.text();
  console.error(`Telegram API failed: HTTP ${response.status}`);
  console.error(body.slice(0, 500));
  process.exit(1);
}

console.log("Telegram notification sent.");
