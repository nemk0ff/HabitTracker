const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * Telegram ids allowed into the nutrition module. `NUTRITION_USER_IDS` is a
 * comma-separated list; defaults to DEVELOPER_CHAT_ID. In dev with nothing
 * configured the module is open so the `dev-mode` test user can reach it.
 */
function nutritionAllowList(): Set<string> | null {
  const raw = process.env.NUTRITION_USER_IDS || process.env.DEVELOPER_CHAT_ID || '';
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return IS_DEV ? null : new Set();
  return new Set(ids);
}

export function hasNutritionAccess(telegramId: number | bigint | string): boolean {
  const allow = nutritionAllowList();
  if (allow === null) return true;
  if (IS_DEV && String(telegramId) === '999999' && !process.env.NUTRITION_USER_IDS) return true;
  return allow.has(String(telegramId));
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
