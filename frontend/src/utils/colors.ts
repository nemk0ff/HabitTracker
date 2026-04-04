export const HABIT_COLORS = [
  '#4CAF50', // green
  '#2196F3', // blue
  '#FF9800', // orange
  '#E91E63', // pink
  '#9C27B0', // purple
  '#00BCD4', // teal
  '#FF5722', // deep orange
  '#607D8B', // blue gray
  '#F44336', // red
  '#8BC34A', // light green
  '#3F51B5', // indigo
  '#FFEB3B', // yellow
];

export function getHeatmapColor(
  baseColor: string,
  value: number,
): string {
  if (value === 0) return 'transparent';

  const opacity = [0, 0.3, 0.6, 1.0][Math.min(value, 3)] ?? 1;
  const r = parseInt(baseColor.slice(1, 3), 16);
  const g = parseInt(baseColor.slice(3, 5), 16);
  const b = parseInt(baseColor.slice(5, 7), 16);

  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function getEmptyColor(isDark: boolean): string {
  return isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
}
