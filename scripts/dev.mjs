// HabitTracker dev launcher — CloudPub edition.
//
// CloudPub exposes the backend on a STABLE https://<name>.cloudpub.ru subdomain, so the
// old localtunnel/tunnelmole URL-rotation + health-monitor machinery is gone. This script:
//   1. discovers (or registers) the CloudPub publication for port 3001,
//   2. writes its URL into backend/.env (WEBAPP_URL),
//   3. builds the frontend and starts the backend,
//   4. points the Telegram menu button at the URL once.
//
// `clo` (the CloudPub agent) must be installed and logged in for steps 1/2. If it isn't,
// the script still builds + runs the backend and just prints manual instructions.
import { spawn, spawnSync } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { SocksProxyAgent } from 'socks-proxy-agent';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_PATH = resolve(ROOT, 'backend', '.env');
const PORT = parseInt(process.env.PORT || '3001', 10);
const PUB_NAME = 'habit-tracker'; // CloudPub publication name

let backendProcess = null;
let developerChatId = null;
let isShuttingDown = false;

// Proxy-aware POST for Telegram API calls (api.telegram.org may be blocked on some hosts).
// Reads SOCKS_PROXY from process.env at call time (set from .env before first use).
async function tgPost(url, body) {
  const socksProxy = process.env.SOCKS_PROXY || '';
  if (socksProxy) {
    const { request } = await import('https');
    const agent = new SocksProxyAgent(socksProxy);
    const parsed = new URL(url);
    const bodyStr = JSON.stringify(body);
    return new Promise((resolvePromise, reject) => {
      const req = request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname,
          method: 'POST',
          port: 443,
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
          agent,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => { try { resolvePromise(JSON.parse(data)); } catch { resolvePromise({}); } });
        },
      );
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

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
  if (!found) updated.push(`${key}="${value}"`);
  await writeFile(filePath, updated.join('\n'), 'utf8');
}

// ─── CloudPub ──────────────────────────────────────────────────────────────────

// Returns the stable https://<name>.cloudpub.ru URL mapped to `port`, or null.
// Registers the publication if it doesn't exist yet. Best-effort: returns null if the
// `clo` CLI isn't installed/logged in.
function ensureCloudpubUrl(port) {
  const urlRe = new RegExp(`localhost:${port}\\s*->\\s*(https://[a-zA-Z0-9.-]+\\.cloudpub\\.ru)`, 'i');

  const runClo = (args) => {
    const r = spawnSync('clo', args, { shell: true, encoding: 'utf8' });
    if (r.error) return null;                 // clo not installed
    return `${r.stdout || ''}${r.stderr || ''}`;
  };

  let out = runClo(['ls']);
  if (out === null) {
    console.warn('[dev] CloudPub CLI (`clo`) not found — skipping tunnel setup.');
    return null;
  }
  let m = out.match(urlRe);
  if (!m) {
    console.log(`[dev] Port ${port} not published — registering on CloudPub…`);
    const reg = runClo(['register', 'http', String(port), '-n', PUB_NAME]) || '';
    m = reg.match(urlRe) || (runClo(['ls']) || '').match(urlRe);
  }
  return m ? m[1].replace(/\/$/, '') : null;
}

// ─── Frontend / Backend ─────────────────────────────────────────────────────────

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

function spawnBackend(envVars) {
  console.log('\n[dev] Starting backend...');
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: resolve(ROOT, 'backend'),
    shell: true,
    stdio: ['ignore', process.stdout, process.stderr],
    env: { ...process.env, ...envVars },
  });
  proc.on('exit', (code) => {
    if (!isShuttingDown && code !== null && code !== 0) {
      console.error(`[dev] Backend exited with code ${code}`);
    }
    if (!isShuttingDown) process.exit(code ?? 0);
  });
  backendProcess = proc;
  return proc;
}

async function waitForBackend(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  console.log('[dev] Waiting for backend to be ready...');
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://localhost:${PORT}/api/health`, { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) {
        console.log('[dev] Backend is ready.');
        return;
      }
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Backend did not become ready within 30 seconds');
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function setChatMenuButtonRequest(botToken, webAppUrl, chatId) {
  const body = {
    menu_button: { type: 'web_app', text: 'Трекер', web_app: { url: webAppUrl } },
  };
  if (chatId) body.chat_id = Number(chatId);
  return tgPost(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, body);
}

async function setTelegramMenuButton(botToken, webAppUrl) {
  try {
    const global = await setChatMenuButtonRequest(botToken, webAppUrl, null);
    if (!global.ok) console.warn('[telegram] setChatMenuButton (global) failed:', global.description);
    else console.log(`[telegram] Menu button (global) → ${webAppUrl}`);

    if (developerChatId) {
      const perChat = await setChatMenuButtonRequest(botToken, webAppUrl, developerChatId);
      if (!perChat.ok) console.warn('[telegram] setChatMenuButton (per-chat) failed:', perChat.description);
      else console.log(`[telegram] Menu button (chat ${developerChatId}) updated`);
    }
  } catch (err) {
    console.warn('[telegram] Could not update menu button:', err.message);
  }
}

// Telegram Bot API cannot set the "Main App" URL (BotFather-only). With CloudPub the URL
// is stable, so this only needs doing once — we still notify on change for convenience.
async function notifyDeveloper(botToken, webAppUrl) {
  if (!developerChatId) return;
  try {
    await tgPost(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: developerChatId,
      text:
        `✅ <b>HabitTracker (CloudPub)</b>\n\n<code>${webAppUrl}</code>\n\n` +
        `Если меняешь Main App URL вручную: ` +
        `<a href="https://t.me/BotFather">BotFather</a> → /mybots → Edit Bot → Mini App URL`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    console.log(`[telegram] Notification sent to developer (${developerChatId})`);
  } catch (err) {
    console.warn('[telegram] Could not notify developer:', err.message);
  }
}

function printManualInstructions(port) {
  console.log('\n┌─────────────────────────────────────────────────────────────┐');
  console.log('│  CloudPub CLI not available — expose the backend manually:   │');
  console.log(`│    clo publish http ${String(port).padEnd(41)}│`);
  console.log('│  then put the printed https URL into backend/.env WEBAPP_URL │');
  console.log('└─────────────────────────────────────────────────────────────┘');
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[dev] Received ${signal}. Shutting down...`);
  if (backendProcess) backendProcess.kill('SIGTERM');
  setTimeout(() => process.exit(0), 2000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   HabitTracker — dev launcher        ║');
  console.log('╚══════════════════════════════════════╝\n');

  let raw;
  try {
    raw = await readFile(ENV_PATH, 'utf8');
  } catch {
    console.error('[dev] Cannot read backend/.env\n  → Create it with BOT_TOKEN, DATABASE_URL, JWT_SECRET');
    process.exit(1);
  }
  const envVars = parseEnv(raw);
  if (!envVars.BOT_TOKEN) {
    console.error('[dev] BOT_TOKEN is not set in backend/.env');
    process.exit(1);
  }
  developerChatId = envVars.DEVELOPER_CHAT_ID || null;
  if (envVars.SOCKS_PROXY) process.env.SOCKS_PROXY = envVars.SOCKS_PROXY; // for tgPost

  // 1. Discover / register the stable CloudPub URL and sync it into .env BEFORE the
  //    backend starts, so it boots with the correct WEBAPP_URL (no restart needed).
  const url = ensureCloudpubUrl(PORT);
  if (url && url !== envVars.WEBAPP_URL) {
    await updateEnvKey(ENV_PATH, 'WEBAPP_URL', url);
    envVars.WEBAPP_URL = url;
    console.log(`[dev] WEBAPP_URL set to ${url}`);
  } else if (url) {
    console.log(`[dev] CloudPub URL: ${url} (already in .env)`);
  }

  // 2. Build frontend + start backend.
  buildFrontend();
  spawnBackend(envVars);
  try {
    await waitForBackend();
  } catch (err) {
    console.error('[dev]', err.message);
    process.exit(1);
  }

  // 3. Point the Telegram menu button at the stable URL (or print manual steps).
  if (url) {
    await setTelegramMenuButton(envVars.BOT_TOKEN, url);
    await notifyDeveloper(envVars.BOT_TOKEN, url);
  } else {
    printManualInstructions(PORT);
  }

  console.log('\n[dev] Running. CloudPub URL is stable — Ctrl+C to stop.\n');
}

main().catch((err) => {
  console.error('[dev] Unexpected error:', err);
  process.exit(1);
});
