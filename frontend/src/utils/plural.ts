/** Russian plural form for `n`: one (1, 21) / few (2–4, 22–24) / many (the rest, 11–14 included). */
export function pluralForm(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
