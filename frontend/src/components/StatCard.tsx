interface Props {
  label: string;
  value: string | number;
  color?: string;
}

export function StatCard({ label, value, color }: Props) {
  return (
    <div className="bg-tg-section rounded-2xl p-3 text-center flex-1">
      <div
        className="text-2xl font-bold mb-0.5"
        style={{ color: color || 'var(--tg-theme-text-color)' }}
      >
        {value}
      </div>
      <div className="text-[11px] text-tg-hint font-medium">{label}</div>
    </div>
  );
}
