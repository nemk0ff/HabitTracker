import { spawn, spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_PATH = resolve(ROOT, 'backend', '.env');

const TUNNEL_URL_REGEX = /https:\/\/[a-zA-Z0-9\-\.]+\.tunnelmole\.net/i;
const TUNNEL_TIMEOUT_MS = 60_000;
const HEALTH_INTERVAL_MS = 2 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 10_000;

let tunnelProcess = null;
let backendProcess = null;
let healthCheckTimer = null;
let currentTunnelUrl = null;
let developerChatId = null;
let isShuttingDown = false;
let isHandlingFailure = false;

// ─── .env helpers ────────────────────────────────────────────────────────────

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

async function updateEnvKey(filePath, key, value) {
  const raw = await readFile(filePath, 'utf8');
  const lines = raw.split('\n');
  let found = false;
  const updated = lines.map((line) => {
    if (line.trimStart().startsWith(key + '=') || line.trimStart().startsWith(key + ' =')) {
      found = true;
      return `${key}="${value}"`;
    }
    return line;
  });
  if (!found) {
    updated.push(`${key}="${value}"`);
  }
  await writeFile(filePath, updated.join('\n'), 'utf8');
}

// ─── Frontend build ───────────────────────────────────────────────────────────

function buildFrontend() {
  console.log('\n[dev] Building frontend...');
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: resolve(ROOT, 'frontend'),
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    console.error('[dev] Frontend build failed. Aborting.');
    process.exit(1);
  }
  console.log('[dev] Frontend built successfully.');
}

// ─── Tunnel ──────────────────────────────────────────────────────────────────

function spawnTunnel() {
  return new Promise((resolve, reject) => {
    console.log('\n[dev] Starting tunnel...');
    const proc = spawn('npx', ['tunnelmole', '3001'], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    tunnelProcess = proc;

    const rl = createInterface({ input: proc.stdout });
    const rlErr = createInterface({ input: proc.stderr });

    const timeout = setTimeout(() => {
      cleanup();
      proc.kill('SIGTERM');
      reject(new Error('Tunnel URL not received within 60 seconds'));
    }, TUNNEL_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeout);
      rl.close();
      rlErr.close();
    }

    function checkLine(line) {
      process.stdout.write(`[tunnel] ${line}\n`);
      const match = line.match(TUNNEL_URL_REGEX);
      if (match) {
        cleanup();
        // Watch for unexpected exits after URL is received
        proc.on('exit', (code) => {
          if (!isShuttingDown && code !== null) {
            console.warn(`\n[tunnel] Process exited (code ${code}). Restarting...`);
            handleTunnelFailure();
          }
        });
        resolve({ proc, url: match[0] });
      }
    }

    rl.on('line', checkLine);
    rlErr.on('line', checkLine);

    proc.on('exit', (code) => {
      cleanup();
      if (code !== null) {
        reject(new Error(`Tunnel exited before providing URL (code ${code})`));
      }
    });
  });
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function setChatMenuButtonRequest(botToken, webAppUrl, chatId) {
  const body = {
    menu_button: {
      type: 'web_app',
      text: '📱 Трекер',
      web_app: { url: webAppUrl },
    },
  };
  if (chatId) body.chat_id = Number(chatId);

  const res = await fetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function setTelegramMenuButton(botToken, webAppUrl) {
  try {
    // 1. Set global default (for all new chats)
    const global = await setChatMenuButtonRequest(botToken, webAppUrl, null);
    if (!global.ok) {
      console.warn('[telegram] setChatMenuButton (global) failed:', global.description);
    } else {
      console.log(`[telegram] Menu button (global) updated → ${webAppUrl}`);
    }

    // 2. Force-update for developer's existing chat (bypasses client cache)
    if (developerChatId) {
      const perChat = await setChatMenuButtonRequest(botToken, webAppUrl, developerChatId);
      if (!perChat.ok) {
        console.warn('[telegram] setChatMenuButton (per-chat) failed:', perChat.description);
      } else {
        console.log(`[telegram] Menu button (chat ${developerChatId}) updated`);
      }
    }
  } catch (err) {
    console.warn('[telegram] Could not update menu button:', err.message);
  }
}

// Telegram Bot API cannot set the "Main App" URL (BotFather-only setting).
// Instead, we send the developer a message with the URL + BotFather deep link
// so they can update it in one tap.
async function notifyDeveloper(botToken, developerChatId, webAppUrl) {
  if (!developerChatId) return;
  try {
    const text =
      `🔄 <b>Tunnel URL обновился</b>\n\n` +
      `<code>${webAppUrl}</code>\n\n` +
      `Вставь ссылку в BotFather → Main App:\n` +
      `<a href="https://t.me/BotFather">Открыть BotFather</a> → /mybots → Edit Bot → Mini App URL`;
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: developerChatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    console.log(`[telegram] Notification sent to developer (${developerChatId})`);
  } catch (err) {
    console.warn('[telegram] Could not notify developer:', err.message);
  }
}

// ─── Backend ──────────────────────────────────────────────────────────────────

function spawnBackend(envVars) {
  console.log('\n[dev] Starting backend...');
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: resolve(ROOT, 'backend'),
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, ...envVars },
  });
  proc.on('exit', (code) => {
    if (!isShuttingDown && code !== null && code !== 0) {
      console.error(`[dev] Backend exited with code ${code}`);
    }
  });
  backendProcess = proc;
  return proc;
}

function printMainAppInstructions(webAppUrl) {
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│  ⚠️  Main App URL (обновить вручную в BotFather)            │');
  console.log('│                                                             │');
  console.log(`│  ${webAppUrl.padEnd(59)}│`);
  console.log('│                                                             │');
  console.log('│  BotFather → /mybots → Edit Bot → Mini App URL             │');
  console.log('└─────────────────────────────────────────────────────────────┘');
}

// ─── Health monitor ───────────────────────────────────────────────────────────

async function checkHealth(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function handleTunnelFailure() {
  if (isShuttingDown || isHandlingFailure) return;
  isHandlingFailure = true;

  console.warn('\n[dev] Tunnel failure detected. Replacing tunnel...');

  // Kill old tunnel
  if (tunnelProcess) {
    tunnelProcess.removeAllListeners('exit');
    tunnelProcess.kill('SIGTERM');
    tunnelProcess = null;
  }

  let newUrl;
  try {
    const { url } = await spawnTunnel();
    newUrl = url;
    currentTunnelUrl = newUrl;
  } catch (err) {
    console.error('[dev] Failed to get new tunnel URL:', err.message);
    console.log('[dev] Will retry at next health check interval.');
    isHandlingFailure = false;
    return;
  }

  // Read BOT_TOKEN again (in case .env changed)
  const raw = await readFile(ENV_PATH, 'utf8');
  const envVars = parseEnv(raw);

  await updateEnvKey(ENV_PATH, 'WEBAPP_URL', newUrl);
  await setTelegramMenuButton(envVars.BOT_TOKEN, newUrl);
  printMainAppInstructions(newUrl);
  await notifyDeveloper(envVars.BOT_TOKEN, developerChatId, newUrl);

  // Restart backend with new env
  if (backendProcess) {
    backendProcess.removeAllListeners('exit');
    backendProcess.kill('SIGTERM');
    backendProcess = null;
    await waitForPortFree(Number(envVars.PORT || 3001));
  }

  const freshEnv = parseEnv(await readFile(ENV_PATH, 'utf8'));
  spawnBackend(freshEnv);

  console.log(`[dev] Redeployed with new tunnel URL: ${newUrl}`);
  isHandlingFailure = false;
}

function startHealthMonitor() {
  healthCheckTimer = setInterval(async () => {
    if (isShuttingDown || isHandlingFailure || !currentTunnelUrl) return;
    const healthy = await checkHealth(currentTunnelUrl);
    if (!healthy) {
      console.warn(`[dev] Health check failed for ${currentTunnelUrl}`);
      await handleTunnelFailure();
    }
  }, HEALTH_INTERVAL_MS);
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[dev] Received ${signal}. Shutting down...`);
  if (healthCheckTimer) clearInterval(healthCheckTimer);
  if (backendProcess) backendProcess.kill('SIGTERM');
  if (tunnelProcess) {
    tunnelProcess.removeAllListeners('exit');
    tunnelProcess.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ─── Main ─────────────────────────────────────────────────────────────────────

async function waitForBackend(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  const port = parseInt(process.env.PORT || '3001', 10);
  console.log('[dev] Waiting for backend to be ready...');
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://localhost:${port}/api/health`, { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) {
        console.log('[dev] Backend is ready.');
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Backend did not become ready within 30 seconds');
}

async function waitForPortFree(port, timeoutMs = 10_000) {
  const { createServer } = await import('net');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const free = await new Promise((res) => {
      const s = createServer();
      s.once('error', () => res(false));
      s.once('listening', () => { s.close(); res(true); });
      s.listen(port, '127.0.0.1');
    });
    if (free) return;
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║    HabitTracker — dev launcher       ║');
  console.log('╚══════════════════════════════════════╝\n');

  // 1. Read .env
  let raw;
  try {
    raw = await readFile(ENV_PATH, 'utf8');
  } catch {
    console.error(`[dev] Cannot read backend/.env\n  → Create it: backend/.env with BOT_TOKEN, DATABASE_URL, JWT_SECRET`);
    process.exit(1);
  }

  const envVars = parseEnv(raw);

  if (!envVars.BOT_TOKEN) {
    console.error('[dev] BOT_TOKEN is not set in backend/.env\n  → Add: BOT_TOKEN="your_token"');
    process.exit(1);
  }

  developerChatId = envVars.DEVELOPER_CHAT_ID || null;

  // 2. Stop any pm2-managed backend to avoid port conflicts
  try {
    const { spawnSync: ss } = await import('child_process');
    const r = ss('pm2', ['delete', 'habit-backend'], { shell: true, stdio: 'pipe' });
    if (r.status === 0) console.log('[dev] Stopped pm2 habit-backend.');
  } catch { /* pm2 not installed or process not found — ok */ }

  // 3. Build frontend
  buildFrontend();

  // 4. Start backend with current env so port 3001 is occupied before tunnelmole
  spawnBackend(envVars);
  try {
    await waitForBackend();
  } catch (err) {
    console.error('[dev]', err.message);
    process.exit(1);
  }

  // 5. Start tunnel (port 3001 is now open — tunnelmole won't exit early)
  let tunnelUrl;
  try {
    const { url } = await spawnTunnel();
    tunnelUrl = url;
    currentTunnelUrl = url;
    console.log(`\n[dev] Tunnel URL: ${tunnelUrl}`);
  } catch (err) {
    console.error('[dev] Failed to start tunnel:', err.message);
    process.exit(1);
  }

  // 6. Update .env with tunnel URL
  await updateEnvKey(ENV_PATH, 'WEBAPP_URL', tunnelUrl);

  // 7. Configure Telegram menu button
  await setTelegramMenuButton(envVars.BOT_TOKEN, tunnelUrl);

  // 8. Print Main App instructions + notify developer
  printMainAppInstructions(tunnelUrl);
  await notifyDeveloper(envVars.BOT_TOKEN, developerChatId, tunnelUrl);

  // 9. Restart backend so it picks up the new WEBAPP_URL from .env
  console.log('\n[dev] Restarting backend with updated WEBAPP_URL...');
  backendProcess.removeAllListeners('exit');
  backendProcess.kill('SIGTERM');
  backendProcess = null;
  const port = parseInt(envVars.PORT || '3001', 10);
  await waitForPortFree(port);
  const freshEnv = parseEnv(await readFile(ENV_PATH, 'utf8'));
  spawnBackend(freshEnv);

  // 10. Start health monitor
  startHealthMonitor();

  console.log('\n[dev] Running. Health check every 2 minutes. Ctrl+C to stop.\n');
}

main().catch((err) => {
  console.error('[dev] Unexpected error:', err);
  process.exit(1);
});
