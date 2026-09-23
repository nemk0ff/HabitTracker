/**
 * Idempotent seed of the base food catalog (prisma/seed/foods.ru.json).
 * Row format: [name, kcal, protein, fat, carbs, [[servingLabel, grams], ...]] — per 100 g.
 * Run: npm run db:seed-foods
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { prisma } from '../src/db.js';
import { normalizeSearch } from '../src/services/nutrition/nutritionMath.js';

type Row = [string, number, number, number, number, [string, number][]];

const file = fileURLToPath(new URL('../prisma/seed/foods.ru.json', import.meta.url));
const rows = JSON.parse(readFileSync(file, 'utf-8')) as Row[];

let count = 0;
for (const [name, kcal, protein, fat, carbs, servings] of rows) {
  const searchName = normalizeSearch(name);
  const data = {
    name,
    searchName,
    kcal,
    protein,
    fat,
    carbs,
    servings: servings.length
      ? JSON.stringify(servings.map(([label, grams]) => ({ label, grams })))
      : null,
  };
  await prisma.food.upsert({
    where: { source_externalId: { source: 'seed', externalId: searchName } },
    update: data,
    create: { ...data, source: 'seed', externalId: searchName },
  });
  count++;
}

console.log(`Seeded ${count} foods`);
await prisma.$disconnect();
