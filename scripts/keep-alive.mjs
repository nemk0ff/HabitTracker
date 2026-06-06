#!/usr/bin/env node
// Keep-alive script for Claude Code 5-hour quota window.
// Sends a minimal "привет" prompt via `claude -p` through SOCKS_PROXY,
// then notifies the local backend so the Telegram bot can track the session.
//
// Designed to be run from cron on the VPS:
//   0 */5 * * * cd /habitBot/HabitTracker && /usr/bin/node scripts/keep-alive.mjs >> /tmp/keep-alive.log 2>&1

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_PATH = resolve(ROOT, 'backend', '.env');
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

function parseEnv(raw) {
  const map = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    map[key] = val;
  }
  return map;
}

function ts() {
  return new Date().toISOString();
}

async function main() {
  let raw;
  try {
    raw = await readFile(ENV_PATH, 'utf8');
  } catch (err) {
    console.error(`[${ts()}] [keep-alive] Cannot read ${ENV_PATH}:`, err.message);
    process.exit(1);
  }
  const env = parseEnv(raw);

  if (!env.KEEP_ALIVE_SECRET) {
    console.error(`[${ts()}] [keep-alive] KEEP_ALIVE_SECRET missing in backend/.env`);
    process.exit(1);
  }

  // Claude Code's fetch rejects socks5:// in HTTPS_PROXY ("UnsupportedProxyProtocol"),
  // so prefer CLAUDE_PROXY (HTTP scheme) when set; fall back to SOCKS_PROXY otherwise.
  const claudeProxy = env.CLAUDE_PROXY || env.SOCKS_PROXY || '';
  const childEnv = { ...process.env };
  if (claudeProxy) {
    childEnv.HTTPS_PROXY = claudeProxy;
    childEnv.HTTP_PROXY = claudeProxy;
    childEnv.ALL_PROXY = claudeProxy;
    console.log(`[${ts()}] [keep-alive] Using proxy: ${claudeProxy}`);
  } else {
    console.log(`[${ts()}] [keep-alive] No CLAUDE_PROXY/SOCKS_PROXY in .env — running without proxy`);
  }

  // Use long-lived OAuth token from `claude setup-token` instead of the rotating
  // refresh token in ~/.claude/.credentials.json. The latter gets invalidated whenever
  // any other Claude Code instance (e.g. on the dev laptop) refreshes its access token.
  if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    childEnv.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN;
  } else {
    console.warn(`[${ts()}] [keep-alive] CLAUDE_CODE_OAUTH_TOKEN missing — relying on ~/.claude/.credentials.json (will break when local Claude refreshes)`);
  }

  console.log(`[${ts()}] [keep-alive] Running: claude -p "привет"`);
  const result = spawnSync('claude', ['-p', 'привет'], {
    env: childEnv,
    stdio: 'inherit',
    shell: false,
    timeout: 60_000,
  });

  if (result.error) {
    console.error(`[${ts()}] [keep-alive] Failed to spawn claude:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[${ts()}] [keep-alive] claude exited with code ${result.status}`);
    process.exit(result.status ?? 1);
  }

  console.log(`[${ts()}] [keep-alive] claude OK — notifying backend`);
  try {
    const res = await fetch(`${BACKEND_URL}/api/claude/session-start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.KEEP_ALIVE_SECRET}` },
    });
    if (!res.ok) {
      console.error(`[${ts()}] [keep-alive] Backend returned ${res.status}: ${await res.text()}`);
      process.exit(1);
    }
    console.log(`[${ts()}] [keep-alive] Done`);
  } catch (err) {
    console.error(`[${ts()}] [keep-alive] Backend POST failed:`, err.message);
    process.exit(1);
  }
}

main();
