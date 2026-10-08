/**
 * Dev-only smoke test of the evening check-in against the local dev.db. Never starts the bot.
 * Run: BOT_TOKEN="0:dummy" npx tsx scripts/checkin-smoke.ts
 */
import { prisma } from '../src/db.js';
import {
  addDays,
  dailyStreak,
  datesByHabit,
  dayDate,
  setHabitEntry,
  skippedByHabit,
  weekdayIndex,
  weeklyStreak,
} from '../src/services/habitStats.js';
import {
  buildCheckinMessage,
  checkinHabitsFor,
  handleCheckinCallback,
  localClock,
  sortCheckinHabits,
} from '../src/services/checkin.js';

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

  // ── Skipped days ──
  // Йога: done −1, skipped −2 (sick), done −3, −4 → streak 3 (the skip is transparent); today skipped → shows ⏸.
  const yoga = await prisma.habit.create({ data: { userId: user.id, name: 'Йога', icon: '🧘', binary: true, timeOfDay: 'day' } });
  for (const i of [1, 3, 4]) await setHabitEntry(yoga, dayDate(addDays(today, -i)), 1);
  await setHabitEntry(yoga, dayDate(addDays(today, -2)), 0, true);
  await setHabitEntry(yoga, dayDate(today), 1);
  await setHabitEntry(yoga, dayDate(today), 0, true); // skip overrides today's mark
  const yogaEntries = await prisma.habitEntry.findMany({ where: { habitId: yoga.id } });
  const yogaDone = datesByHabit(yogaEntries, [yoga]).get(yoga.id) ?? new Set<string>();
  const yogaSkips = skippedByHabit(yogaEntries).get(yoga.id);
  console.log(`\nЙога today entry =`, JSON.stringify(yogaEntries.find((e) => e.date.getTime() === dayDate(today).getTime())), '(expect value 0, skipped)');
  console.log('Йога streak =', dailyStreak(yogaDone, today, yogaSkips), '(expect 3: skipped −2 and today transparent)');
  console.log('Йога streak ignoring skips =', dailyStreak(yogaDone, today), '(expect 1)');
  // Weekly 3×: a week with 2 skipped days needs 1 done day.
  const mon = addDays(today, -weekdayIndex(today) - 7);
  const wk = new Set([mon, addDays(mon, -7), addDays(mon, -6), addDays(mon, -5)]);
  console.log('weekly 3× streak with last week 2 skipped =', weeklyStreak(wk, 3, today, new Set([addDays(mon, 1), addDays(mon, 2)])), '(expect 2)');
  console.log('… without the skips =', weeklyStreak(wk, 3, today), '(expect 0)');

  r = await handleCheckinCallback(telegramId, `cd:${today}`);
  if (r.message) show('Готово with Йога skipped (expect "из 3")', r.message);

  // ── Morning check-in ──
  const morningUser = await prisma.user.update({ where: { id: user.id }, data: { morningCheckinTime: '08:00' } });
  await prisma.habitEntry.deleteMany({ where: { habitId: water.id } });
  const all = sortCheckinHabits(await prisma.habit.findMany({ where: { userId: user.id } }));
  const allEntries = await prisma.habitEntry.findMany({ where: { habitId: { in: all.map((h) => h.id) } } });
  const morning = checkinHabitsFor('morning', all, morningUser);
  const evening = checkinHabitsFor('evening', all, morningUser);
  console.log('\nmorning habits:', morning.map((h) => h.name).join(', '), '(expect Вода)');
  console.log('evening habits:', evening.map((h) => h.name).join(', '), '(expect no Вода)');
  show('morning message', buildCheckinMessage(morningUser, morning, allEntries, today, 'morning'));
  r = await handleCheckinCallback(telegramId, `ci:${water.id}:${today}:-1:m`);
  console.log(`morning +1 Вода → ${r.answer}`);
  if (r.message) show('morning after tap (expect only Вода, ":m" callbacks)', r.message);
  r = await handleCheckinCallback(telegramId, `cd:${today}:m`);
  if (r.message) show('morning Готово', r.message);

  show('evening with Йога skipped (expect ⏸ 🧘 Йога → :1)', buildCheckinMessage(morningUser, evening, allEntries, today));
  r = await handleCheckinCallback(telegramId, `ci:${yoga.id}:${today}:1`);
  console.log(`\ntap ⏸ Йога → ${r.answer}; entry =`, JSON.stringify(await entryOf(yoga.id)), '(expect value 1, skipped false)');
  if (r.message) show('evening after unskip (no Вода)', r.message);
} finally {
  await new Promise((res) => setTimeout(res, 300)); // let fire-and-forget track() land
  await prisma.analyticsEvent.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log(`\ntemp user ${user.id} deleted`);
  await prisma.$disconnect();
}
