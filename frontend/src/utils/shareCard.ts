import { ApiError } from '../api/client';
import { fetchInvite, shareCardApi } from '../api/me';
import { toast } from '../stores/toastStore';
import { haptic } from '../hooks/useTelegramButtons';
import { getHeatmapColor, legibleColor } from './colors';
import { shiftDate, toDateString } from './dates';
import { entryLevel, weekDates, weeklyStreak } from './habits';
import { challengeProgress, completionRate, streaks } from './habitStats';
import { pluralForm } from './plural';
import { ensureWriteAccess } from './writeAccess';
import type { Habit } from '../types';

/**
 * «Поделиться прогрессом»: the client draws a 1080×1350 PNG on a canvas (no native deps on the
 * server), the backend sends it to the user's chat with the bot, captioned with the invite link —
 * from there it's one forward to a friend.
 */

const W = 1080;
const H = 1350;
const PAD = 96;
/** Footer text: baseline, font size and the minimum gap between the heatmap and it. */
const FOOTER_BASELINE = H - 72;
const FOOTER_SIZE = 34;
const FOOTER_GAP = 48;
const BG = '#111315';
const DISPLAY = "'Unbounded', 'Onest', system-ui, sans-serif";
const TEXT = "'Onest', system-ui, sans-serif";
const EMOJI = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

interface Headline {
  big: string;
  caption: string;
  /** 0–1 for a challenge progress bar. */
  progress: number | null;
}

export function shareHeadline(h: Habit, today: string): Headline {
  const ch = challengeProgress(h, today);
  if (ch) {
    return {
      big: `${ch.done}/${ch.total}`,
      caption: ch.succeeded ? 'челлендж пройден!' : `отмечено · день ${ch.dayIndex} из ${ch.total}`,
      progress: ch.done / ch.total,
    };
  }
  if (h.weeklyTarget) {
    const run = weeklyStreak(h, today);
    if (run > 0) return { big: String(run), caption: `${pluralForm(run, 'неделя', 'недели', 'недель')} подряд с целью`, progress: null };
  } else {
    const { current } = streaks(h);
    if (current > 0) return { big: String(current), caption: `${pluralForm(current, 'день', 'дня', 'дней')} подряд`, progress: null };
  }
  const rate = completionRate(h, 30, today);
  return { big: `${rate ?? 0}%`, caption: 'дней с отметкой за месяц', progress: null };
}

let footerPromise: Promise<string> | null = null;

/** «t.me/BotName» from the invite link (cached); empty when it can't be loaded. */
function botHandle(): Promise<string> {
  footerPromise ??= fetchInvite()
    .then(({ link }) => {
      const u = new URL(link);
      return `${u.host}${u.pathname}`.replace(/\/$/, '');
    })
    .catch(() => {
      footerPromise = null;
      return '';
    });
  return footerPromise;
}

async function loadFonts() {
  if (!document.fonts?.load) return;
  try {
    await Promise.all([
      document.fonts.load(`600 200px Unbounded`),
      document.fonts.load(`600 60px Onest`),
      document.fonts.load(`500 40px Onest`),
    ]);
  } catch {
    /* fallback sans */
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Splits `text` into at most `maxLines` lines fitting `width` (the last one gets an ellipsis). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last.length > 1 && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

/** The backend rejects PNGs above 1.5 MB; stay under with a margin. */
const MAX_PNG_BYTES = 1.4 * 1024 * 1024;
const FALLBACK_SCALE = 0.75;

function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Draws the card (W×H × `scale`) and returns a PNG data URL. */
export async function renderShareCard(h: Habit, today = toDateString(new Date()), scale = 1): Promise<string> {
  const [handle] = await Promise.all([botHandle(), loadFonts()]);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.scale(scale, scale);
  const accent = legibleColor(h.color, true);
  const head = shareHeadline(h, today);

  // Background: near-black with a glow of the habit colour.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, 120, 0, W * 0.85, 120, 900);
  glow.addColorStop(0, `${h.color}66`);
  glow.addColorStop(1, `${h.color}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Icon + name
  ctx.textBaseline = 'alphabetic';
  let y = PAD + 100;
  let nameX = PAD;
  if (h.icon) {
    ctx.font = `104px ${EMOJI}`;
    ctx.fillText(h.icon, PAD, y);
    nameX = PAD + 140;
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 58px ${TEXT}`;
  const nameLines = wrap(ctx, h.name, W - PAD - nameX, 2);
  const nameTop = nameLines.length === 1 ? y - 20 : y - 52;
  nameLines.forEach((l, i) => ctx.fillText(l, nameX, nameTop + i * 66));

  // Big number
  y = 520;
  ctx.fillStyle = accent;
  let size = 230;
  ctx.font = `600 ${size}px ${DISPLAY}`;
  while (ctx.measureText(head.big).width > W - 2 * PAD && size > 120) {
    size -= 10;
    ctx.font = `600 ${size}px ${DISPLAY}`;
  }
  ctx.fillText(head.big, PAD - 6, y);
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = `500 44px ${TEXT}`;
  ctx.fillText(head.caption, PAD, y + 76);

  // Challenge bar
  if (head.progress !== null) {
    const bw = W - 2 * PAD;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, PAD, y + 112, bw, 18, 9);
    ctx.fill();
    ctx.fillStyle = h.color;
    roundRect(ctx, PAD, y + 112, Math.max(18, bw * Math.min(1, head.progress)), 18, 9);
    ctx.fill();
  }

  // Last 5 weeks: rows are weeks (oldest on top), columns Mon–Sun. Cells shrink so the grid
  // (incl. today's 5px ring) ends ≥ FOOTER_GAP above the footer text.
  const gap = 14;
  const gy = 740;
  const gridBottomMax = FOOTER_BASELINE - FOOTER_SIZE - FOOTER_GAP - 5;
  const cell = Math.min(96, Math.floor((gridBottomMax - gy - 4 * gap) / 5));
  const radius = Math.round(cell * 0.21);
  const gridW = 7 * cell + 6 * gap;
  const gx = (W - gridW) / 2;
  ctx.font = `500 30px ${TEXT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.textAlign = 'center';
  WEEKDAYS.forEach((d, i) => ctx.fillText(d, gx + i * (cell + gap) + cell / 2, gy - 22));
  ctx.textAlign = 'left';
  const byDate = new Map(h.entries.map((e) => [e.date, e]));
  for (let row = 0; row < 5; row++) {
    const days = weekDates(shiftDate(today, -7 * (4 - row)));
    days.forEach((date, col) => {
      const x = gx + col * (cell + gap);
      const cy = gy + row * (cell + gap);
      roundRect(ctx, x, cy, cell, cell, radius);
      if (date > today) {
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 3;
        ctx.stroke();
        return;
      }
      const e = byDate.get(date);
      const level = e && !e.skipped ? entryLevel(h, e.value) : 0;
      ctx.fillStyle = level > 0 ? getHeatmapColor(h.color, level) : 'rgba(255,255,255,0.08)';
      ctx.fill();
      if (e?.skipped) {
        // A pass: diagonal hatch, like the in-app heatmap.
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = `${h.color}99`;
        ctx.lineWidth = 6;
        for (let k = -cell; k < cell * 2; k += 22) {
          ctx.beginPath();
          ctx.moveTo(x + k, cy + cell);
          ctx.lineTo(x + k + cell, cy);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (date === today) {
        roundRect(ctx, x - 5, cy - 5, cell + 10, cell + 10, radius + 4);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    });
  }

  // Footer
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `500 ${FOOTER_SIZE}px ${TEXT}`;
  ctx.fillText(handle ? `Трекер привычек · ${handle}` : 'Трекер привычек', PAD, FOOTER_BASELINE);

  return canvas.toDataURL('image/png');
}

const SEND_FAILED = 'Не получилось отправить картинку, попробуй ещё раз';

function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return SEND_FAILED;
  if (e.status === 429) return 'Уже отправил — проверь чат с ботом';
  if (e.status === 413) return 'Картинка слишком большая, попробуй ещё раз позже';
  if (e.status === 502) return 'Telegram не принял картинку, попробуй чуть позже';
  return SEND_FAILED;
}

let sharing = false;

/**
 * Renders the card for `h`, asks the backend to send it to the user's chat and toasts the result.
 * If the bot can't message the user yet, asks for write access and retries once.
 */
export async function shareHabitProgress(h: Habit): Promise<boolean> {
  if (sharing) return false;
  sharing = true;
  try {
    const today = toDateString(new Date());
    let image = await renderShareCard(h, today);
    if (dataUrlBytes(image) > MAX_PNG_BYTES) image = await renderShareCard(h, today, FALLBACK_SCALE);
    const head = shareHeadline(h, today);
    const caption = `${h.icon ? `${h.icon} ` : ''}${h.name}: ${head.big} — ${head.caption}`;
    let res = await shareCardApi(image, caption);
    if (!res.ok && res.reason === 'unreachable' && (await ensureWriteAccess())) {
      res = await shareCardApi(image, caption);
    }
    if (!res.ok) {
      if (res.reason !== 'unreachable') toast(SEND_FAILED, { tone: 'error' });
      return false;
    }
    haptic('success');
    toast('Картинка в чате с ботом — перешли её друзьям', { ms: 5000 });
    return true;
  } catch (e) {
    toast(errorMessage(e), { tone: 'error' });
    return false;
  } finally {
    sharing = false;
  }
}
