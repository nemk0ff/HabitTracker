/**
 * Idempotent import of a user's store products into "Мои продукты".
 * Input JSON: { store, baseUrl, items: [[name, kcal, protein, fat, carbs, [[label, grams], ...], slug], ...] }
 * (macros per 100 g). Upserts by externalId "<store>:<slug>".
 *
 * Run: npx tsx scripts/import-foods.ts <file.json> <telegramId>
 */
import { readFileSync } from 'fs';
import { prisma } from '../src/db.js';
import { normalizeSearch } from '../src/services/nutrition/nutritionMath.js';

type Item = [string, number, number, number, number, [string, number][], string];

const [file, telegramId] = process.argv.slice(2);
if (!file || !telegramId) {
  console.error('usage: tsx scripts/import-foods.ts <file.json> <telegramId>');
  process.exit(1);
}

const { store, baseUrl, items } = JSON.parse(readFileSync(file, 'utf-8')) as {
  store: string;
  baseUrl: string;
  items: Item[];
};

const user = await prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
if (!user) {
  console.error(`user with telegramId ${telegramId} not found`);
  process.exit(1);
}

let created = 0;
let updated = 0;
for (const [name, kcal, protein, fat, carbs, servings, slug] of items) {
  const externalId = `${store}:${slug}`;
  const data = {
    ownerId: user.id,
    name,
    brand: store,
    searchName: normalizeSearch(`${name} ${store}`),
    sourceUrl: baseUrl + slug,
    kcal,
    protein,
    fat,
    carbs,
    servings: servings.length ? JSON.stringify(servings.map(([label, grams]) => ({ label, grams }))) : null,
  };
  const existing = await prisma.food.findUnique({
    where: { source_externalId: { source: 'custom', externalId } },
  });
  await prisma.food.upsert({
    where: { source_externalId: { source: 'custom', externalId } },
    update: data,
    create: { ...data, source: 'custom', externalId },
  });
  if (existing) updated++;
  else created++;
}

console.log(`${store}: created ${created}, updated ${updated}`);
await prisma.$disconnect();
