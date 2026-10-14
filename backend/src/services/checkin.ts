/**
 * Evening check-in: at the user's local `checkinTime` the bot sends one message with a
 * button per habit, so the day gets marked without opening the Mini App.
 *
 * Optional morning check-in at `morningCheckinTime`: only `timeOfDay='morning'` habits; with it on, the
 * evening one leaves morning habits out.
 *
 * Callback data (≤ 64 bytes): `ci:<habitId>:<YYYY-MM-DD>:<value>` (value 0 = unmark; for count
 * habits value is the new absolute count, and -1 = "+1 from the current entry at tap time"),
 * `cd:<YYYY-MM-DD>` («Готово» → summary); a trailing `:m` marks the morning message. The date is baked in so a late tap still marks
 * the day the message was about; only the user's own habits and dates ≤ 2 days old count.
 */
import cron from 'node-cron';
import { prisma } from '../db.js';
import { track } from './analytics.js';
import { forEachSafe } from '../utils/safe.js';
import { sendToUser } from './messaging.js';
import {
  addDays,
  challengeProgress,
  countTarget,
  datesByHabit,
  dayDate,
  formatStreak,
  habitStreak,
  isDone,
  isValidEntryValue,
  setHabitEntry,
  skippedByHabit,
  weekStats,
  weekdayIndex,
  type Streak,
} from './habitStats.js';

const WEBAPP_URL = process.env.WEBAPP_URL || '';
/** Moscow — for users whose client never sent an offset. */
export const DEFAULT_TZ_OFFSET = -180;
const MAX_CHECKIN_HABITS = 12;
const MAX_CALLBACK_AGE_DAYS = 2;
const HOURS_OPTIONS = [6, 7, 8, 9];
/** Entries this far back are enough for streaks. */
const HISTORY_DAYS = 400;

export const CHECKIN_TEXT = 'Как прошёл день? Отметь, что получилось:';
export const MORNING_CHECKIN_TEXT = 'Доброе утро! Отметь утренние привычки:';

export type CheckinKind = 'evening' | 'morning';

type Button = { text: string; callback_data?: string; web_app?: { url: string } };
export type Keyboard = Button[][];

export interface CheckinMessage {
  text: string;
  keyboard: Keyboard;
}

export interface CheckinHabit {
  id: number;
  name: string;
  icon: string | null;
  binary: boolean;
  measure: string | null;
  weeklyTarget: number | null;
  dailyTarget: number | null;
  timeOfDay: string | null;
  sortOrder: number;
  createdAt: Date;
  /** Challenge: done days to reach from `challengeStart` (local YYYY-MM-DD); null/absent = not a challenge. */
  challengeDays?: number | null;
  challengeStart?: string | null;
}

export interface CheckinEntry {
  habitId: number;
  date: Date;
  value: number;
  skipped?: boolean;
}

// ─── Local time ───────────────────────────────────────────────────────────────

/** The user's local date / time at `at` (`tzOffset` = JS getTimezoneOffset, Moscow −180). */
export function localClock(at: Date, tzOffset: number | null): { date: string; hhmm: string } {
  const shifted = new Date(at.getTime() - (tzOffset ?? DEFAULT_TZ_OFFSET) * 60_000);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), hhmm: iso.slice(11, 16) };
}

// ─── Message building (pure) ──────────────────────────────────────────────────

/** `-1` in a count habit's callback = add one to whatever is recorded when the tap lands. */
const PLUS_ONE = -1;
const MAX_COUNT = 999;
const TIME_ORDER: Record<string, number> = { morning: 0, day: 1, evening: 2 };

/** Morning → day → evening → any time, then manual order, then creation. */
export function sortCheckinHabits<T extends Pick<CheckinHabit, 'timeOfDay' | 'sortOrder' | 'createdAt'>>(habits: T[]): T[] {
  const rank = (h: T) => (h.timeOfDay != null ? (TIME_ORDER[h.timeOfDay] ?? 3) : 3);
  return [...habits].sort(
    (a, b) => rank(a) - rank(b) || a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/**
 * Habits of a `kind` check-in: the morning one has only morning habits; the evening one drops them
 * when the user has the morning check-in on.
 */
export function checkinHabitsFor<T extends Pick<CheckinHabit, 'timeOfDay'>>(
  kind: CheckinKind,
  habits: T[],
  user: { morningCheckinTime: string | null },
): T[] {
  if (kind === 'morning') return habits.filter((h) => h.timeOfDay === 'morning');
  return user.morningCheckinTime ? habits.filter((h) => h.timeOfDay !== 'morning') : habits;
}

const label = (h: CheckinHabit) => (h.icon ? `${h.icon} ${h.name}` : h.name);

/** Button label: the habit plus « · 12/30» for a challenge. */
function buttonLabel(h: CheckinHabit, entries: CheckinEntry[], date: string): string {
  const p = challengeProgress(h, entries, date);
  return p ? `${label(h)} · ${p.done}/${p.total}` : label(h);
}

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} ч`;
}

function weekLine(habits: CheckinHabit[], entries: CheckinEntry[], date: string): string | null {
  if (weekdayIndex(date) !== 6) return null; // Sundays only
  const stats = weekStats(habits, datesByHabit(entries, habits), date, skippedByHabit(entries));
  if (stats.target === 0) return null;
  let line = `За неделю: ${stats.done} из ${stats.target} отметок`;
  if (stats.best) line += `, лучшая — ${stats.best.name} ${Math.min(stats.best.done, stats.best.target)}/${stats.best.target}`;
  return line;
}

function footerRow(date: string, withDone: boolean, suffix = ''): Button[] {
  const row: Button[] = [];
  if (WEBAPP_URL) row.push({ text: '📱 Открыть трекер', web_app: { url: WEBAPP_URL } });
  if (withDone) row.push({ text: 'Готово', callback_data: `cd:${date}${suffix}` });
  return row;
}

/**
 * The check-in message for `date`: a toggle per habit (`✅`/`▫️`; `⏸` = skipped day, a tap marks it done), a 6–9 h
 * row for hours habits, `[3/8] [+1] [✅ 8]` for count habits, then «Открыть трекер» + «Готово». `habits` are already
 * filtered for `kind` (see `checkinHabitsFor`). `entries` should cover at least the Monday week of `date` (for the
 * Sunday week line of the evening message).
 */
export function buildCheckinMessage(
  _user: { id: number },
  habits: CheckinHabit[],
  entries: CheckinEntry[],
  date: string,
  kind: CheckinKind = 'evening',
): CheckinMessage {
  const today = new Map<number, number>();
  const skippedToday = new Set<number>();
  for (const e of entries) {
    if (e.date.getTime() !== dayDate(date).getTime()) continue;
    if (e.skipped) skippedToday.add(e.habitId);
    else today.set(e.habitId, e.value);
  }
  const suffix = kind === 'morning' ? ':m' : '';

  const keyboard: Keyboard = [];
  // Telegram caps an inline keyboard at 100 buttons; an hours habit takes 1 + 4. 12 habits stay well under it.
  for (const h of habits.slice(0, MAX_CHECKIN_HABITS)) {
    const value = today.get(h.id);
    const skipped = skippedToday.has(h.id);
    const cb = (v: number) => `ci:${h.id}:${date}:${v}${suffix}`;
    const name = buttonLabel(h, entries, date);
    if (h.measure === 'hours') {
      // Header shows the recorded amount; tapping it clears the mark (a skipped one asks for the hours instead).
      const head = skipped ? `⏸ ${name}` : value ? `✅ ${name} · ${fmtHours(value)}` : `▫️ ${name}`;
      keyboard.push([{ text: head, callback_data: cb(0) }]);
      keyboard.push(
        HOURS_OPTIONS.map((hours) => {
          const minutes = hours * 60;
          const selected = value === minutes;
          return { text: selected ? `✅ ${hours} ч` : `${hours} ч`, callback_data: cb(selected ? 0 : minutes) };
        }),
      );
    } else if (h.measure === 'count') {
      // Header shows progress; tapping it clears a recorded count (or adds one when empty).
      const target = countTarget(h);
      const n = value ?? 0;
      keyboard.push([
        skipped
          ? { text: `⏸ ${name}`, callback_data: cb(target) }
          : { text: `${isDone(h, n) ? '✅' : '▫️'} ${name} ${n}/${target}`, callback_data: cb(n ? 0 : PLUS_ONE) },
        { text: '+1', callback_data: cb(PLUS_ONE) },
        { text: `✅ ${target}`, callback_data: cb(target) },
      ]);
    } else {
      keyboard.push([
        skipped
          ? { text: `⏸ ${name}`, callback_data: cb(1) }
          : { text: `${value ? '✅' : '▫️'} ${name}`, callback_data: cb(value ? 0 : 1) },
      ]);
    }
  }
  keyboard.push(footerRow(date, true, suffix));

  const header = kind === 'morning' ? MORNING_CHECKIN_TEXT : CHECKIN_TEXT;
  const week = kind === 'evening' ? weekLine(habits, entries, date) : null;
  return { text: week ? `${header}\n\n${week}` : header, keyboard: keyboard.filter((r) => r.length > 0) };
}

/** «Готово»: "Отмечено 3 из 4 · серия: 💪 Спорт — 5 дней 🔥". Habits skipped on `date` are left out of the count. */
export function buildCheckinSummary(
  habits: CheckinHabit[],
  entries: CheckinEntry[],
  date: string,
  kind: CheckinKind = 'evening',
): CheckinMessage {
  const byHabit = datesByHabit(entries, habits);
  const skips = skippedByHabit(entries);
  const marked = habits.filter((h) => byHabit.get(h.id)?.has(date)).length;
  const counted = habits.filter((h) => !skips.get(h.id)?.has(date)).length;

  const empty =
    kind === 'morning' ? 'Пока без отметок — можно отметить позже в трекере' : 'Сегодня без отметок — завтра новый день 🌙';
  let text = marked === 0 ? empty : `Отмечено ${marked} из ${counted}`;

  let best: { habit: CheckinHabit; streak: Streak } | null = null;
  for (const h of habits) {
    const streak = habitStreak(h, byHabit.get(h.id) ?? new Set(), date, skips.get(h.id));
    // Compare in days so a 2-week streak beats a 5-day one.
    const weight = (s: Streak) => s.count * (s.unit === 'week' ? 7 : 1);
    if (streak.count >= 2 && (!best || weight(streak) > weight(best.streak))) best = { habit: h, streak };
  }
  if (best) text += ` · серия: ${label(best.habit)} — ${formatStreak(best.streak)} 🔥`;

  const week = kind === 'evening' ? weekLine(habits, entries, date) : null;
  if (week) text += `\n${week}`;
  return { text, keyboard: [footerRow(date, false)].filter((r) => r.length > 0) };
}

// ─── Data ─────────────────────────────────────────────────────────────────────

async function loadUserHabits(userId: number, date: string) {
  const habits = sortCheckinHabits(await prisma.habit.findMany({ where: { userId, archived: false } }));
  const entries = await prisma.habitEntry.findMany({
    where: {
      habitId: { in: habits.map((h) => h.id) },
      date: { gte: dayDate(addDays(date, -HISTORY_DAYS)), lte: dayDate(date) },
    },
    select: { habitId: true, date: true, value: true, skipped: true },
  });
  return { habits, entries };
}

// ─── Sending ──────────────────────────────────────────────────────────────────

let isRunning = false;

/** A tick can be missed (pm2 restart during a deploy, a slow previous run) — catch up within this window. */
const SEND_WINDOW_MIN = 10;

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Sends both check-ins (evening, then morning) that are due. */
export async function sendDueCheckins(now = new Date()): Promise<void> {
  await sendDue('evening', now);
  await sendDue('morning', now);
}

/**
 * Sends the `kind` check-in to every user whose `checkinTime` / `morningCheckinTime` passed less than SEND_WINDOW_MIN
 * ago (once per local day, deduped by `lastCheckinDate` / `lastMorningCheckinDate`).
 */
async function sendDue(kind: CheckinKind, now: Date): Promise<void> {
  const morning = kind === 'morning';
  const users = await prisma.user.findMany({
    where: morning ? { morningCheckinTime: { not: null } } : { checkinTime: { not: null } },
  });
  const due = users
    .map((u) => ({ user: u, clock: localClock(now, u.tzOffset) }))
    .filter(({ user, clock }) => {
      const at = morning ? user.morningCheckinTime : user.checkinTime;
      const last = morning ? user.lastMorningCheckinDate : user.lastCheckinDate;
      if (!at) return false;
      const late = toMinutes(clock.hhmm) - toMinutes(at);
      return late >= 0 && late < SEND_WINDOW_MIN && last !== clock.date && user.canMessage !== false;
    });

  await forEachSafe(due, `[checkin] send ${kind}`, ({ user }) => `user ${user.id}`, async ({ user, clock }) => {
    const loaded = await loadUserHabits(user.id, clock.date);
    const habits = checkinHabitsFor(kind, loaded.habits, user);
    const { entries } = loaded;
    if (habits.length === 0) return;

    // Done or skipped today = nothing to ask about.
    const todayMs = dayDate(clock.date).getTime();
    const resolvedToday = new Set(
      entries
        .filter(
          (e) => e.date.getTime() === todayMs && (e.skipped || habits.some((h) => h.id === e.habitId && isDone(h, e.value))),
        )
        .map((e) => e.habitId),
    );
    // Claim the day first: a slow/failed send must never repeat on the next tick.
    const previous = morning ? user.lastMorningCheckinDate : user.lastCheckinDate;
    await prisma.user.update({
      where: { id: user.id },
      data: morning ? { lastMorningCheckinDate: clock.date } : { lastCheckinDate: clock.date },
    });
    if (habits.every((h) => resolvedToday.has(h.id))) return;

    const msg = buildCheckinMessage(user, habits, entries, clock.date, kind);
    // A 403 marks the channel closed (canMessage=false) but keeps the check-in time: the user chose it,
    // the bot just can't reach them yet (e.g. opened the Mini App without /start).
    const sent = await sendToUser(user, msg.text, { reply_markup: { inline_keyboard: msg.keyboard as any } }, { purpose: `checkin_${kind}` });
    if (!sent) {
      // Closed channel (403 / skipped): release the claim so a grant later today still gets it in the window.
      await prisma.user.update({
        where: { id: user.id },
        data: morning ? { lastMorningCheckinDate: previous } : { lastCheckinDate: previous },
      });
      return;
    }
    track({ userId: user.id, event: morning ? 'morning_checkin_sent' : 'checkin_sent', category: 'bot', label: clock.date });
  });
}

export function startCheckinCron(): void {
  cron.schedule(
    '* * * * *',
    async () => {
      if (isRunning) return;
      isRunning = true;
      try {
        await sendDueCheckins();
      } catch (e) {
        console.error('[checkin] tick failed:', e);
      } finally {
        isRunning = false;
      }
    },
    { timezone: 'UTC' },
  );
  console.log('[checkin] scheduled (runs every minute)');
}

// ─── Callbacks ────────────────────────────────────────────────────────────────

export interface CheckinCallbackResult {
  /** Toast text (or alert text when `alert`). */
  answer?: string;
  /** Rejected tap: show a popup and leave the message untouched. */
  alert?: boolean;
  /** New message content to edit in. */
  message?: CheckinMessage;
}

const reject = (answer: string): CheckinCallbackResult => ({ answer, alert: true });

/** Handles `ci:` / `cd:` taps for the Telegram user `telegramId`. */
export async function handleCheckinCallback(telegramId: number | bigint, data: string): Promise<CheckinCallbackResult> {
  const m = data.match(/^(?:ci:(\d+):(\d{4}-\d{2}-\d{2}):(-1|\d+)|cd:(\d{4}-\d{2}-\d{2}))(:m)?$/);
  if (!m) return reject('Неизвестная кнопка');
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
  if (!user) return reject('Недоступно');

  const date = (m[2] ?? m[4])!;
  const kind: CheckinKind = m[5] ? 'morning' : 'evening';
  const load = async () => {
    const { habits, entries } = await loadUserHabits(user.id, date);
    return { habits: checkinHabitsFor(kind, habits, user), entries };
  };
  const today = localClock(new Date(), user.tzOffset).date;
  if (Number.isNaN(dayDate(date).getTime()) || date > today || date < addDays(today, -MAX_CALLBACK_AGE_DAYS)) {
    return reject('Эта сводка устарела — отметь в трекере');
  }

  if (m[4]) {
    const { habits, entries } = await load();
    const summary = buildCheckinSummary(habits, entries, date, kind);
    track({ userId: user.id, event: 'checkin_done', category: 'bot', label: date });
    return { message: summary };
  }

  const habitId = Number(m[1]);
  let value = Number(m[3]);
  const habit = await prisma.habit.findFirst({ where: { id: habitId, userId: user.id, archived: false } });
  if (!habit) return reject('Привычка не найдена');
  const isCount = habit.measure === 'count';
  if (value === PLUS_ONE ? !isCount : !isValidEntryValue(habit, value)) return reject('Странное значение');

  let answer: string | undefined;
  if (isCount && value !== 0) {
    // Relative "+1" reads the entry at tap time; an absolute value from a stale «✅ N» never lowers the count.
    const existing = await prisma.habitEntry.findFirst({ where: { habitId, date: dayDate(date) } });
    const current = existing?.value ?? 0;
    value = value === PLUS_ONE ? Math.min(current + 1, MAX_COUNT) : Math.max(current, value);
    await setHabitEntry(habit, dayDate(date), value);
    track({ userId: user.id, event: 'entry_checked', category: 'bot', label: date, metadata: { habitId, value, source: 'bot' } });
    answer = isDone(habit, value) ? `Отмечено ✅ ${value}/${countTarget(habit)}` : `Записал: ${value}/${countTarget(habit)}`;
  } else if (value === 0) {
    const existing = await prisma.habitEntry.findFirst({ where: { habitId, date: dayDate(date) } });
    if ((!existing || existing.skipped) && habit.measure === 'hours') return { answer: 'Выбери, сколько часов' };
    await setHabitEntry(habit, dayDate(date), 0);
    track({ userId: user.id, event: 'entry_unchecked', category: 'bot', label: date, metadata: { habitId, source: 'bot' } });
    answer = 'Отметка снята';
  } else {
    // A stale «▫️» button (the day was marked in the Mini App meanwhile) must not downgrade
    // an intensity of 2–3 to 1: for non-hours habits "mark" only creates a missing entry.
    if (habit.measure !== 'hours') {
      const existing = await prisma.habitEntry.findFirst({ where: { habitId, date: dayDate(date) } });
      if (existing && existing.value > 0) value = existing.value;
    }
    await setHabitEntry(habit, dayDate(date), value);
    track({ userId: user.id, event: 'entry_checked', category: 'bot', label: date, metadata: { habitId, value, source: 'bot' } });
    answer = habit.measure === 'hours' ? `Записал: ${fmtHours(value)}` : 'Отмечено ✅';
  }
  track({ userId: user.id, event: 'checkin_marked', category: 'bot', label: date, metadata: { habitId, value } });

  const { habits, entries } = await load();
  return { answer, message: buildCheckinMessage(user, habits, entries, date, kind) };
}
