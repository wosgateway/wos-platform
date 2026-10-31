#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const DEFAULT_HOST = "127.0.0.1";
const CONTAINER_NAME = /^wos-webhook(?:-|$)/i;

function dockerPs() {
  try {
    return execFileSync(
      process.platform === "win32" ? "docker.exe" : "docker",
      ["ps", "--format", "{{.Names}}\\t{{.Ports}}"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    return "";
  }
}

function findPublishedPort() {
  const rows = dockerPs().split(/\r?\n/).filter(Boolean);
  for (const row of rows) {
    const [name, ports = ""] = row.split("\t");
    if (!CONTAINER_NAME.test(name)) continue;
    const match = ports.match(/(?:127\.0\.0\.1|0\.0\.0\.0):([0-9]+)->3000\/tcp/);
    if (match) return Number(match[1]);
  }
  return null;
}

export function resolveAiTestBaseUrl() {
  const configured = process.env.WOS_TEST_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const port = findPublishedPort();
  if (port) return `http://${DEFAULT_HOST}:${port}`;

  throw new Error(
    "No running WOS webhook container with a published port to container port 3000 was found. " +
    "Set WOS_TEST_BASE_URL or pass --base-url explicitly.",
  );
}
export function resolveAiTestBaseUrlFromArgs(args = process.argv.slice(2)) {
  const index = args.indexOf("--base-url");
  if (index >= 0 && args[index + 1]) {
    return args[index + 1].replace(/\/$/, "");
  }
  return resolveAiTestBaseUrl();
}

if (process.argv[1]?.endsWith("resolve-ai-test-url.mjs")) {
  console.log(resolveAiTestBaseUrlFromArgs());
}
