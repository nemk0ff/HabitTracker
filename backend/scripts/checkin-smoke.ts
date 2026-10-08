/**
 * Dev-only smoke test of the evening check-in against the local dev.db. Never starts the bot.
 * Run: BOT_TOKEN="0:dummy" npx tsx scripts/checkin-smoke.ts
 */
import { prisma } from '../src/db.js';
import { addDays, dayDate } from '../src/services/habitStats.js';
import { buildCheckinMessage, handleCheckinCallback, localClock, sortCheckinHabits } from '../src/services/checkin.js';

const telegramId = BigInt(9_000_000_000 + Math.floor(Math.random() * 1_000_000));
const clock = localClock(new Date(), -180);
const today = clock.date;

const user = await prisma.user.create({
  data: { telegramId, firstName: 'Smoke', tzOffset: -180, checkinTime: clock.hhmm },
});

try {
  const sport = await prisma.habit.create({ data: { userId: user.id, name: 'Спорт', icon: '💪', binary: true } });
  const sleep = await prisma.habit.create({ data: { userId: user.id, name: 'Сон', icon: '😴', measure: 'hours', timeOfDay: 'evening' } });
  const water = await prisma.habit.create({
    data: { userId: user.id, name: 'Вода', icon: '💧', measure: 'count', dailyTarget: 8, timeOfDay: 'morning' },
  });
  // Sport done the 4 previous days → after today's tap the streak is 5.
  for (let i = 1; i <= 4; i++) {
    await prisma.habitEntry.create({ data: { habitId: sport.id, date: dayDate(addDays(today, -i)), value: 1 } });
  }

  const show = (label: string, msg: { text: string; keyboard: { text: string; callback_data?: string }[][] }) => {
    console.log(`\n── ${label} ──\n${msg.text}`);
    for (const row of msg.keyboard) console.log('  ' + row.map((b) => `[${b.text} | ${b.callback_data ?? 'web_app'}]`).join(' '));
  };
  const entryOf = (habitId: number) => prisma.habitEntry.findFirst({ where: { habitId, date: dayDate(today) } });

  const habits = sortCheckinHabits(await prisma.habit.findMany({ where: { userId: user.id } }));
  console.log('order:', habits.map((h) => h.name).join(' → '), '(expect Вода → Сон → Спорт)');
  const entries = await prisma.habitEntry.findMany({ where: { habitId: { in: habits.map((h) => h.id) } } });
  console.log(`user ${user.id}, local ${today} ${clock.hhmm}, checkinTime ${user.checkinTime}`);
  show('initial message', buildCheckinMessage(user, habits, entries, today));

  let r = await handleCheckinCallback(telegramId, `ci:${sport.id}:${today}:1`);
  console.log(`\ntap Спорт → ${r.answer}; entry =`, (await entryOf(sport.id))?.value ?? null);
  r = await handleCheckinCallback(telegramId, `ci:${sport.id}:${today}:0`);
  console.log(`tap Спорт again → ${r.answer}; entry =`, (await entryOf(sport.id))?.value ?? null);
  r = await handleCheckinCallback(telegramId, `ci:${sport.id}:${today}:1`);
  r = await handleCheckinCallback(telegramId, `ci:${sleep.id}:${today}:480`);
  console.log(`tap Сон 8 ч → ${r.answer}; entry =`, (await entryOf(sleep.id))?.value ?? null);
  if (r.message) show('after taps', r.message);

  for (let i = 0; i < 3; i++) r = await handleCheckinCallback(telegramId, `ci:${water.id}:${today}:-1`);
  console.log(`
+1 ×3 Вода → ${r.answer}; entry =`, (await entryOf(water.id))?.value ?? null, '(expect 3)');
  if (r.message) show('water 3/8', r.message);
  r = await handleCheckinCallback(telegramId, `ci:${water.id}:${today}:8`);
  console.log(`✅ 8 → ${r.answer}; entry =`, (await entryOf(water.id))?.value ?? null, '(expect 8)');
  r = await handleCheckinCallback(telegramId, `ci:${water.id}:${today}:-1`);
  console.log(`+1 → ${r.answer}; entry =`, (await entryOf(water.id))?.value ?? null, '(expect 9)');
  r = await handleCheckinCallback(telegramId, `ci:${water.id}:${today}:8`);
  console.log(`stale ✅ 8 → ${r.answer}; entry =`, (await entryOf(water.id))?.value ?? null, '(expect 9, not lowered)');
  const bad = await handleCheckinCallback(telegramId, `ci:${water.id}:${today}:1000`);
  console.log(`value 1000 → alert=${bad.alert} "${bad.answer}"`);
  const plusOnBinary = await handleCheckinCallback(telegramId, `ci:${sport.id}:${today}:-1`);
  console.log(`-1 on binary habit → alert=${plusOnBinary.alert} "${plusOnBinary.answer}"`);

  const old = await handleCheckinCallback(telegramId, `ci:${sport.id}:${addDays(today, -3)}:1`);
  console.log(`\n3-day-old tap → alert=${old.alert} "${old.answer}"`);
  const foreign = await handleCheckinCallback(telegramId, `ci:1:${today}:1`);
  console.log(`foreign habit → alert=${foreign.alert} "${foreign.answer}"`);

  const done = await handleCheckinCallback(telegramId, `cd:${today}`);
  if (done.message) show('Готово', done.message);
} finally {
  await new Promise((res) => setTimeout(res, 300)); // let fire-and-forget track() land
  await prisma.analyticsEvent.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log(`\ntemp user ${user.id} deleted`);
  await prisma.$disconnect();
}
