const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * The nutrition module is open to everyone (since 08.10.2026). `NUTRITION_USER_IDS`
 * (comma-separated telegram ids) can still narrow it down again if ever needed.
 * Only the AI text logging stays private — see hasAgentLogAccess.
 */
function nutritionAllowList(): Set<string> | null {
  const ids = (process.env.NUTRITION_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

export function hasNutritionAccess(telegramId: number | bigint | string): boolean {
  const allow = nutritionAllowList();
  return allow === null || allow.has(String(telegramId));
}

/**
 * "Добавить текстом" through the developer's own Hermes agent — developer only
 * (it runs on their laptop with their model). Dev mode lets the test user in.
 */
export function hasAgentLogAccess(telegramId: number | bigint | string): boolean {
  const dev = process.env.DEVELOPER_CHAT_ID || '';
  if (IS_DEV && !dev && String(telegramId) === '999999') return true;
  return dev !== '' && String(telegramId) === dev;
}
