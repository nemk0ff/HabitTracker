/**
 * Dev-only smoke test of the morning / evening briefings (iteration B, stage 3) against a COPY of dev.db.
 * Never starts the bot. Run from backend/:
 *   cp prisma/dev.db prisma/smoke.db
 *   DATABASE_URL="file:./smoke.db" BOT_TOKEN="0:dummy" DEV_LOGIN=1 npx tsx scripts/briefing-smoke.ts
 *   rm prisma/smoke.db
 */
import { prisma } from '../src/db.js';
import { addDays, dayDate } from '../src/services/habitStats.js';
import { MORNING_OFF, handleCheckinCallback, localClock, morningTimeOf } from '../src/services/checkin.js';
import {
  buildEveningBriefing,
  buildMorningBriefing,
  loadEveningData,
  loadMorningData,
  proteinSuggestions,
  sendDueBriefings,
  sleepPresets,
} from '../src/services/briefing.js';
import { handlePromptCallback } from '../src/services/nutrition/prompts.js';

const telegramId = BigInt(9_000_000_000 + Math.floor(Math.random() * 1_000_000));
process.env.DEVELOPER_CHAT_ID = String(telegramId); // the temp user plays the owner
const today = localClock(new Date(), -180).date;
const yesterday = addDays(today, -1);

type Msg = { text: string; keyboard: { text: string; callback_data?: string }[][] };
const show = (label: string, msg: Msg) => {
  console.log(`\n── ${label} ──\n${msg.text}`);
  for (const row of msg.keyboard) console.log('  ' + row.map((b) => `[${b.text} | ${b.callback_data ?? 'web_app'}]`).join(' '));
};
let failures = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
};

// ── Pure helpers ──
console.log('presets (no data) =', JSON.stringify(sleepPresets([])));
const presets = sleepPresets([
  { startTime: '01:00', endTime: '08:00' },
  { startTime: '00:40', endTime: '07:50' },
  { startTime: '23:50', endTime: '08:10' },
  { startTime: '01:20', endTime: '08:00' },
  { startTime: '01:10', endTime: '08:20' },
]);
console.log('presets =', presets.map((p) => `${p.bed}–${p.wake}`).join(', '), '(expect 01:00–08:00, 01:30–08:30, 00:30–07:30)');
console.log(
  'proteinSuggestions =',
  JSON.stringify(
    proteinSuggestions(
      [
        { name: 'Творог 5%', kcal: 121, protein: 17, servingGrams: 200 },
        { name: 'Печенье', kcal: 450, protein: 6, servingGrams: null },
        { name: 'Куриная грудка', kcal: 165, protein: 31, servingGrams: null },
      ],
      600,
      40,
    ),
  ),
  '(expect грудка, творог)',
);

const user = await prisma.user.create({
  data: { telegramId, firstName: 'Smoke', tzOffset: -180, checkinTime: '21:00', canMessage: true },
});

try {
  const sleep = await prisma.habit.create({ data: { userId: user.id, name: 'Сон', icon: '😴', measure: 'hours', timeOfDay: 'morning' } });
  const train = await prisma.habit.create({ data: { userId: user.id, name: 'Тренировка', icon: '💪', binary: true } });
  const water = await prisma.habit.create({
    data: { userId: user.id, name: 'Вода', icon: '💧', measure: 'count', dailyTarget: 8, timeOfDay: 'morning' },
  });
  const read = await prisma.habit.create({ data: { userId: user.id, name: 'Чтение', icon: '📚', binary: true, timeOfDay: 'evening' } });
  // Backdate so yesterday's habit count includes them.
  await prisma.habit.updateMany({ where: { userId: user.id }, data: { createdAt: dayDate(addDays(today, -30)) } });
  await prisma.habitEntry.create({ data: { habitId: read.id, date: dayDate(yesterday), value: 1 } });

  const nights = [
    ['01:00', '08:00'],
    ['00:40', '07:50'],
    ['23:50', '08:10'],
    ['01:20', '08:00'],
    ['01:10', '08:20'],
  ];
  for (const [i, [bed, wake]] of nights.entries()) {
    await prisma.habitEntry.create({
      data: { habitId: sleep.id, date: dayDate(addDays(today, -1 - i)), value: 420, startTime: bed, endTime: wake },
    });
  }
  await prisma.weightEntry.create({ data: { userId: user.id, date: dayDate(yesterday), weightKg: 70.5 } });
  await prisma.nutritionGoal.create({
    data: { userId: user.id, kcal: 2400, protein: 150, sleepHabitId: sleep.id, trainingHabitId: train.id },
  });
  const tvorog = await prisma.food.create({
    data: {
      ownerId: user.id, name: 'Творог 5%', searchName: 'творог 5%', source: 'custom',
      kcal: 121, protein: 17, fat: 5, carbs: 3, servings: JSON.stringify([{ label: 'пачка', grams: 200 }]),
    },
  });
  const chicken = await prisma.food.create({
    data: { ownerId: user.id, name: 'Куриная грудка', searchName: 'куриная грудка', source: 'custom', kcal: 165, protein: 31, fat: 4, carbs: 0 },
  });
  for (const f of [tvorog, chicken]) await prisma.favoriteFood.create({ data: { userId: user.id, foodId: f.id } });
  const log = (date: string, kcal: number, protein: number) =>
    prisma.foodLogEntry.create({
      data: { userId: user.id, date: dayDate(date), meal: 'lunch', name: 'Обед', grams: 500, kcal, protein, fat: 30, carbs: 150 },
    });
  await log(yesterday, 2200, 120);
  await log(today, 1500, 70);

  // ── Morning ──
  const morning = buildMorningBriefing(await loadMorningData(user.id, today));
  show('morning briefing', morning);
  const cbs = morning.keyboard.flat().map((b) => b.callback_data ?? '');
  const slCb = cbs.find((c) => c.startsWith('ci:sl:'))!;
  const wtSame = morning.keyboard.flat().find((b) => b.text === 'как вчера')?.callback_data!;
  check('sleep presets from history', slCb === `ci:sl:${today}:0100-0800:m`);
  check('callbacks ≤ 64 bytes', cbs.every((c) => Buffer.byteLength(c) <= 64));
  check('sleep habit not among habit buttons', !cbs.some((c) => c.startsWith(`ci:${sleep.id}:`)));

  let r = await handleCheckinCallback(telegramId, slCb);
  const slept = await prisma.habitEntry.findFirst({ where: { habitId: sleep.id, date: dayDate(today) } });
  console.log(`\ntap ${slCb} → ${r.answer}; entry`, JSON.stringify({ v: slept?.value, s: slept?.startTime, e: slept?.endTime }));
  check('sleep preset written (420 min, 01:00–08:00)', slept?.value === 420 && slept.startTime === '01:00' && slept.endTime === '08:00');
  r = await handleCheckinCallback(telegramId, wtSame);
  const w = await prisma.weightEntry.findUnique({ where: { userId_date: { userId: user.id, date: dayDate(today) } } });
  console.log(`tap ${wtSame} → ${r.answer}; weight today = ${w?.weightKg}`);
  check('weight «как вчера» = 70.5', w?.weightKg === 70.5);
  if (r.message) show('morning after taps (sleep/weight logged, no buttons)', r.message);
  check('re-rendered morning has no sl/wt buttons', !r.message?.keyboard.flat().some((b) => /^ci:(sl|wt):/.test(b.callback_data ?? '')));
  r = await handleCheckinCallback(telegramId, `ci:${water.id}:${today}:-1:m`);
  check('morning habit tap keeps the briefing', !!r.message?.text.startsWith('☀️'));

  // Legacy sl: bed-wake form (old prompt messages / other senders).
  const ctx = { from: { id: Number(telegramId) } } as any;
  const legacy = await handlePromptCallback(ctx, `sl:${yesterday}:2330-0700`);
  const y = await prisma.habitEntry.findFirst({ where: { habitId: sleep.id, date: dayDate(yesterday) } });
  console.log(`legacy sl:…:2330-0700 → ${legacy?.text}`);
  check('legacy bed–wake sl: written (450 min)', y?.value === 450 && y.startTime === '23:30');
  const legacyMin = await handlePromptCallback(ctx, `sl:${yesterday}:480`);
  const y2 = await prisma.habitEntry.findFirst({ where: { habitId: sleep.id, date: dayDate(yesterday) } });
  check(`legacy minutes sl: still works (${legacyMin?.text})`, y2?.value === 480 && y2.startTime === null);

  // ── Evening ──
  const evening = buildEveningBriefing(await loadEveningData(user.id, today));
  show('evening briefing', evening);
  check('protein suggestions present', evening.text.includes('Добрать белок'));
  check('training asked, habit button hidden', evening.keyboard.flat().some((b) => b.callback_data === `ci:tr:${today}:1`) &&
    !evening.keyboard.flat().some((b) => b.callback_data?.startsWith(`ci:${train.id}:`)));
  r = await handleCheckinCallback(telegramId, `ci:tr:${today}:1`);
  console.log(`\ntap training → ${r.answer}`);
  r = await handleCheckinCallback(telegramId, `ci:dc:${today}`);
  console.log(`tap day complete → ${r.answer}`);
  if (r.message) show('evening after taps', r.message);
  const mark = await prisma.dayMark.findUnique({ where: { userId_date: { userId: user.id, date: dayDate(today) } } });
  check('day marked complete', mark?.complete === true);
  check('training now a plain ✅ habit button', !!r.message?.keyboard.flat().some((b) => b.text.startsWith('✅ 💪')));

  const stale = await handleCheckinCallback(telegramId, `ci:wt:${addDays(today, -5)}:70:m`);
  check(`stale weight tap rejected ("${stale.answer}")`, stale.alert === true);
  const stranger = await handleCheckinCallback(telegramId + 1n, `ci:dc:${today}`);
  check('non-owner rejected', stranger.alert === true);

  // Sleep habit without a morning timeOfDay still isn't an evening toggle.
  await prisma.habit.update({ where: { id: sleep.id }, data: { timeOfDay: null } });
  const evening2 = buildEveningBriefing(await loadEveningData(user.id, today));
  check('sleep habit excluded from evening buttons', !evening2.keyboard.flat().some((b) => b.callback_data?.startsWith(`ci:${sleep.id}:`)));

  // Morning on/off: null = 09:00, 'off' = disabled.
  check("morningTimeOf: null → 09:00, 'off' → null, '07:00'", morningTimeOf({ morningCheckinTime: null }) === '09:00' &&
    morningTimeOf({ morningCheckinTime: MORNING_OFF }) === null && morningTimeOf({ morningCheckinTime: '07:00' }) === '07:00');

  // Midnight wrap: 23:55 briefing, tick at 00:02 local belongs to the previous date — already claimed → no resend.
  const D = addDays(today, 1);
  const tick = new Date(new Date(`${D}T00:02:00.000Z`).getTime() - 180 * 60_000); // 00:02 MSK on D
  check('tick is 00:02 local', localClock(tick, -180).hhmm === '00:02' && localClock(tick, -180).date === D);
  await prisma.user.update({ where: { id: user.id }, data: { morningCheckinTime: '23:55', lastMorningCheckinDate: today, canMessage: true } });
  await sendDueBriefings(tick);
  let u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  check('wrapped tick: claimed date = previous day → not re-sent', u.lastMorningCheckinDate === today);

  // A failed send (dummy token → Telegram error) releases the claim so the next tick retries.
  const prevClaim = addDays(today, -3);
  await prisma.user.update({ where: { id: user.id }, data: { lastMorningCheckinDate: prevClaim, canMessage: true } });
  const timedOut = await Promise.race([
    sendDueBriefings(tick).then(() => false),
    new Promise<boolean>((res) => setTimeout(() => res(true), 30_000)),
  ]);
  u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (timedOut) console.log('SKIP failed-send release (Telegram API did not answer in 30 s)');
  else check(`failed send releases the claim (${u.lastMorningCheckinDate})`, u.lastMorningCheckinDate === prevClaim);
} finally {
  await new Promise((res) => setTimeout(res, 300)); // let fire-and-forget track() land
  await prisma.analyticsEvent.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log(`\ntemp user ${user.id} deleted`);
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
