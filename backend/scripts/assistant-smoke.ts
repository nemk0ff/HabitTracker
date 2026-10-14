/**
 * Dev-only smoke test of the text assistant (services/assistant.ts) against the local dev.db.
 * Hermes is mocked — no network. Run it against a COPY of dev.db (from backend/):
 *   cp prisma/dev.db prisma/smoke.db
 *   DATABASE_URL="file:./smoke.db" BOT_TOKEN="0:dummy" DEV_LOGIN=1 npx tsx scripts/assistant-smoke.ts
 *   rm prisma/smoke.db
 */
import assert from 'node:assert/strict';
import { prisma } from '../src/db.js';
import { HermesError, type ChatMessage } from '../src/services/hermes.js';
import {
  formatAssistantResult,
  matchHabit,
  parseOffline,
  startAssistant,
  undoJob,
  waitForJob,
  type AgentFn,
} from '../src/services/assistant.js';
import { dayDate } from '../src/services/habitStats.js';

const telegramId = BigInt(9_100_000_000 + Math.floor(Math.random() * 1_000_000));
process.env.DEVELOPER_CHAT_ID = String(telegramId);
const today = new Date(Date.now() + 180 * 60_000).toISOString().slice(0, 10);

let failures = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${label}: ${(e as Error).message}`);
  }
}

// ─── Offline regex ────────────────────────────────────────────────────────────
console.log('offline parser');
const H = [{ name: 'Зарядка' }, { name: 'Вода' }, { name: 'Утренняя пробежка' }];
const off = (t: string) => parseOffline(t, H);
check('«вес 70.5»', () => assert.deepEqual(off('вес 70.5'), { reply: { weight: { kg: 70.5 } }, rest: '' }));
check('«70,5 кг»', () => assert.deepEqual(off('70,5 кг'), { reply: { weight: { kg: 70.5 } }, rest: '' }));
check('«спал 7»', () => assert.deepEqual(off('спал 7'), { reply: { sleep: { hours: 7 } }, rest: '' }));
check('«спал 7,5 ч»', () => assert.deepEqual(off('спал 7,5 ч'), { reply: { sleep: { hours: 7.5 } }, rest: '' }));
check('«лёг 1:30 встал 8»', () => assert.deepEqual(off('лёг 1:30 встал 8'), { reply: { sleep: { bed: '01:30', wake: '08:00' } }, rest: '' }));
check('«лег 01:30 встал 08:00»', () => assert.deepEqual(off('лег 01:30 встал 08:00').reply.sleep, { bed: '01:30', wake: '08:00' }));
check('«спал с 23:40 до 7:15»', () => assert.deepEqual(off('спал с 23:40 до 7:15').reply.sleep, { bed: '23:40', wake: '07:15' }));
check('«зарядка ✓»', () => assert.deepEqual(off('зарядка ✓'), { reply: { habits: [{ name: 'Зарядка', done: true }] }, rest: '' }));
check('«сделал зарядку»', () => assert.deepEqual(off('сделал зарядку'), { reply: { habits: [{ name: 'Зарядка', done: true }] }, rest: '' }));
check('combo «вес 70,5, спал 7 и зарядка сделана»', () => {
  const r = off('Вес 70,5, спал 7 и зарядка сделана.');
  assert.equal(r.rest, '');
  assert.deepEqual(r.reply, { weight: { kg: 70.5 }, sleep: { hours: 7 }, habits: [{ name: 'Зарядка', done: true }] });
});
check('«сделал зар» — not an exact name → left for the agent', () => assert.notEqual(off('сделал зар').rest, ''));
check('food is never parsed offline', () => assert.notEqual(off('съел 200 г творога').rest, ''));
check('question → rest keeps «?»', () => assert.ok(off('сколько осталось белка?').rest.includes('?')));
check('weight out of range ignored', () => assert.equal(off('вес 7').reply.weight, undefined));
check('«вес 200 г» is a food weight, not body weight', () => assert.equal(off('курица вес 200 г').reply.weight, undefined));
check('«вес 70,5 г» not split into 70', () => assert.equal(off('вес 70,5 г').reply.weight, undefined));
check('«вес 330 мл» ignored', () => assert.equal(off('вес 330 мл').reply.weight, undefined));
check('«вес 70,5 кг» still weight', () => assert.deepEqual(off('вес 70,5 кг').reply.weight, { kg: 70.5 }));
check('«спал 30 минут» = 0.5 h', () => assert.deepEqual(off('спал 30 минут'), { reply: { sleep: { hours: 0.5 } }, rest: '' }));
check('«спал 7 ч 30 мин» = 7.5 h', () => assert.deepEqual(off('спал 7 ч 30 мин').reply.sleep, { hours: 7.5 }));
check('«спал 450 минут» = 7.5 h', () => assert.deepEqual(off('спал 450 минут').reply.sleep, { hours: 7.5 }));

// ─── Full flow on the db ──────────────────────────────────────────────────────
const user = await prisma.user.create({ data: { telegramId, firstName: 'Smoke', tzOffset: -180 } });
try {
  const zar = await prisma.habit.create({ data: { userId: user.id, name: 'Зарядка', icon: '🤸', binary: true } });
  const sleep = await prisma.habit.create({ data: { userId: user.id, name: 'Сон', icon: '😴', measure: 'hours' } });
  const water = await prisma.habit.create({ data: { userId: user.id, name: 'Вода', icon: '💧', measure: 'count', dailyTarget: 8 } });
  await prisma.nutritionGoal.create({ data: { userId: user.id, kcal: 2500, protein: 140, sleepHabitId: sleep.id } });
  // Pre-existing state the undo must restore exactly.
  await prisma.weightEntry.create({ data: { userId: user.id, date: dayDate(today), weightKg: 71.2 } });
  await prisma.habitEntry.create({ data: { habitId: sleep.id, date: dayDate(today), value: 420, startTime: '00:00', endTime: '07:00' } });
  await prisma.habitEntry.create({ data: { habitId: water.id, date: dayDate(today), value: 3 } });

  check('matchHabit exact / startsWith / none', () => {
    const hs = [zar, sleep, water];
    assert.equal('habit' in matchHabit('зарядка', hs) && (matchHabit('зарядка', hs) as { habit: { id: number } }).habit.id, zar.id);
    assert.equal((matchHabit('Зар', hs) as { habit: { id: number } }).habit.id, zar.id);
    assert.ok('error' in matchHabit('медитация', hs));
  });

  const state = async () => ({
    food: await prisma.foodLogEntry.count({ where: { userId: user.id } }),
    ownFoods: await prisma.food.count({ where: { ownerId: user.id } }),
    weight: (await prisma.weightEntry.findFirst({ where: { userId: user.id, date: dayDate(today) } }))?.weightKg ?? null,
    sleep: await prisma.habitEntry.findFirst({
      where: { habitId: sleep.id, date: dayDate(today) },
      select: { value: true, skipped: true, startTime: true, endTime: true },
    }),
    zar: await prisma.habitEntry.findFirst({ where: { habitId: zar.id, date: dayDate(today) }, select: { value: true, skipped: true } }),
    water: await prisma.habitEntry.findFirst({ where: { habitId: water.id, date: dayDate(today) }, select: { value: true } }),
  });
  const before = await state();

  // Mocked Hermes: answers with the new contract; records what it was asked.
  const asked: ChatMessage[][] = [];
  const mock: AgentFn = async (messages) => {
    asked.push(messages);
    return (
      'Вот разбор:\n```json\n' +
      JSON.stringify({
        food: [
          { name: 'Творог 5%', store: null, grams: 200, own_food_id: null, kcal_per_100g: 121, protein_per_100g: 17.2, fat_per_100g: 5, carbs_per_100g: 1.8, source_url: null },
          { name: 'Сырок глазированный Smoke', store: 'Пятёрочка', grams: 40, own_food_id: null, kcal_per_100g: 400, protein_per_100g: 8, fat_per_100g: 25, carbs_per_100g: 35, source_url: null },
        ],
        meal: 'breakfast',
        day_offset: 0,
        weight: { kg: 70.5 },
        sleep: { bed: '1:30', wake: '08:00' },
        habits: [{ name: 'Зарядка', done: true }, { name: 'Вода', value: 8 }, { name: 'Медитация', done: true }],
        question: null,
      }) +
      '\n```'
    );
  };

  console.log('\nmocked Hermes: «съел 200 г творога, спал с 1:30 до 8, вес 70,5, зарядка сделана, воды 8»');
  const job = await waitForJob(startAssistant(user.id, 'съел 200 г творога и сырок из пятёрочки, спал с 1:30 до 8, вес 70,5, зарядка сделана, воды 8 стаканов', {}, mock));
  if (job.status !== 'done') console.log('  job error:', job.error);
  const after = await state();
  console.log(formatAssistantResult(job.result!).replace(/^/gm, '    | '));
  check('agent called once (no question)', () => assert.equal(asked.length, 1));
  check('prompt lists habits', () => assert.ok(asked[0]![0]!.content.includes('- Зарядка')));
  check('2 food entries, 1 new product', () => {
    assert.equal(after.food - before.food, 2);
    assert.equal(after.ownFoods - before.ownFoods, 1);
  });
  check('weight 70.5', () => assert.equal(after.weight, 70.5));
  check('sleep 01:30–08:00 = 390 min', () => assert.deepEqual(after.sleep, { value: 390, skipped: false, startTime: '01:30', endTime: '08:00' }));
  check('Зарядка done', () => assert.deepEqual(after.zar, { value: 1, skipped: false }));
  check('Вода = 8', () => assert.deepEqual(after.water, { value: 8 }));
  check('unknown habit reported', () => assert.ok(job.result!.notes.some((n) => n.includes('Медитация'))));

  check('undo ok', () => undefined);
  assert.ok(await undoJob(user.id, job.id));
  const restored = await state();
  check('undo restores everything exactly', () => assert.deepEqual(restored, before));
  check('second undo refused', () => undefined);
  assert.equal(await undoJob(user.id, job.id), false);

  // Offline fast path: the agent must not be called.
  console.log('\noffline fast path');
  const boom: AgentFn = async () => {
    throw new Error('agent must not be called');
  };
  const fast = await waitForJob(startAssistant(user.id, 'вес 69,9, лёг 0:45 встал 7:15, сделал зарядку', {}, boom));
  console.log(formatAssistantResult(fast.result!).replace(/^/gm, '    | '));
  check('fast path done', () => assert.equal(fast.status, 'done'));
  const fastState = await state();
  check('weight / sleep / habit written', () => {
    assert.equal(fastState.weight, 69.9);
    assert.equal(fastState.sleep?.value, 390);
    assert.equal(fastState.zar?.value, 1);
  });
  await undoJob(user.id, fast.id);
  check('fast path undo restores', async () => undefined);
  assert.deepEqual(await state(), before);

  // Mixed message, agent omits weight/sleep: offline weight/sleep are NOT merged (fast path only).
  console.log('\nmixed message, agent without weight');
  const noWeight: AgentFn = async () => JSON.stringify({ food: [], weight: null, sleep: null, habits: [{ name: 'Зарядка', done: true }] });
  const mixed = await waitForJob(startAssistant(user.id, 'съел пиццу, вес 70, спал 7, сделал зарядку', {}, noWeight));
  check('offline weight/sleep not merged', () => {
    assert.equal(mixed.status, 'done');
    assert.equal(mixed.result!.weight, null);
    assert.equal(mixed.result!.sleep, null);
    assert.equal(mixed.result!.habits.length, 1);
  });
  await undoJob(user.id, mixed.id);
  assert.deepEqual(await state(), before);

  // Hours habit by value clears the bed/wake span; undo restores it.
  const hoursOnly: AgentFn = async () => JSON.stringify({ food: [], habits: [{ name: 'Сон', value: 6 }] });
  const hrs = await waitForJob(startAssistant(user.id, 'сон 6 часов и ещё кое-что', {}, hoursOnly));
  const hrsState = await state();
  check('hours habit value clears startTime/endTime', () =>
    assert.deepEqual(hrsState.sleep, { value: 360, skipped: false, startTime: null, endTime: null }),
  );
  await undoJob(user.id, hrs.id);
  const hrsRestored = await state();
  check('undo restores the span', () => assert.deepEqual(hrsRestored, before));

  // Agent offline: write only the habit marks the regexes understood, say so.
  console.log('\nagent offline');
  const down: AgentFn = async () => {
    throw new HermesError('Агент сейчас недоступен (ноутбук выключен или туннель упал) — попробуй позже');
  };
  const partial = await waitForJob(startAssistant(user.id, 'съел пиццу, вес 70, сделал зарядку', {}, down));
  console.log(formatAssistantResult(partial.result!).replace(/^/gm, '    | '));
  check('partial write + agentError', () => {
    assert.equal(partial.status, 'done');
    assert.ok(partial.result!.agentError);
    assert.equal(partial.result!.weight, null);
    assert.equal(partial.result!.habits.length, 1);
    assert.equal(partial.result!.items.length, 0);
  });
  await undoJob(user.id, partial.id);

  const weightOnly = await waitForJob(startAssistant(user.id, 'съел пиццу, вес 70', {}, down));
  check('offline weight not written in a mixed message', () => assert.equal(weightOnly.status, 'error'));

  const nothing = await waitForJob(startAssistant(user.id, 'съел пиццу', {}, down));
  check('nothing understood → error', () => {
    assert.equal(nothing.status, 'error');
    assert.match(nothing.error!, /недоступен/);
  });

  // Question with the agent offline → template answer from facts.
  const q = await waitForJob(startAssistant(user.id, 'сколько мне ещё есть сегодня?', {}, down));
  console.log(formatAssistantResult(q.result!).replace(/^/gm, '    | '));
  check('template answer', () => {
    assert.equal(q.status, 'done');
    assert.match(q.result!.answer ?? '', /Сегодня съедено/);
  });

  // Question with the agent online → second call phrases the answer.
  const qa: AgentFn = async (messages) =>
    messages[0]!.content.startsWith('Ты — личный ассистент по питанию')
      ? 'Осталось около 2500 ккал — ты ещё ничего не ел.'
      : JSON.stringify({ food: [], question: 'сколько мне ещё есть сегодня?' });
  const q2 = await waitForJob(startAssistant(user.id, 'сколько мне ещё есть сегодня?', {}, qa));
  check('agent answer used', () => assert.equal(q2.result!.answer, 'Осталось около 2500 ккал — ты ещё ничего не ел.'));
  check('no undo for a pure question', async () => assert.equal(q2.undo.length, 0));

  // Backward compatibility: old food-only answer `{items, meal, day_offset}`.
  const old: AgentFn = async () =>
    JSON.stringify({
      items: [{ name: 'Творог 5%', store: null, grams: 100, own_food_id: null, kcal_per_100g: 121, protein_per_100g: 17.2, fat_per_100g: 5, carbs_per_100g: 1.8, source_url: null }],
      meal: 'обед',
      day_offset: 0,
    });
  const legacy = await waitForJob(startAssistant(user.id, 'творог 100 г', {}, old));
  check('legacy {items} answer logged', () => {
    assert.equal(legacy.result!.items.length, 1);
    assert.equal(legacy.result!.meal, 'lunch');
  });
  await undoJob(user.id, legacy.id);
  assert.deepEqual(await state(), before);
} finally {
  await prisma.food.deleteMany({ where: { ownerId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
