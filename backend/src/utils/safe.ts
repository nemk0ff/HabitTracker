/** JS getTimezoneOffset() minutes (UTC − local), real-world range UTC−14…UTC+14. */
export function isValidTzOffset(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= -840 && v <= 840;
}

/** Runs `fn` for every item; one item's failure is logged and never stops the rest. */
export async function forEachSafe<T>(
  items: readonly T[],
  label: string,
  describe: (item: T) => string,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (const item of items) {
    try {
      await fn(item);
    } catch (e) {
      console.error(`${label} failed for ${describe(item)}:`, e);
    }
  }
}
