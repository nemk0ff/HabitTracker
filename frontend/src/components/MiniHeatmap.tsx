import { useMemo } from 'react';
import { getWeeksGrid, toDateString, isToday } from '../utils/dates';
import { getHeatmapColor, getEmptyColor } from '../utils/colors';
import type { HabitEntry } from '../types';

interface Props {
  entries: HabitEntry[];
  color: string;
  binary?: boolean;
  weeks?: number;
  showDayLabels?: boolean;
}

const DAY_LABELS = ['Пн', '', 'Ср', '', 'Пт', '', ''];

export function MiniHeatmap({ entries, color, binary = false, weeks = 18, showDayLabels = true }: Props) {
  const { weeks: grid, monthLabels } = useMemo(() => getWeeksGrid(weeks), [weeks]);
  const entryMap = useMemo(
    () => new Map(entries.map((e) => [e.date, e.value])),
    [entries],
  );

  const isDark =
    typeof window !== 'undefined' &&
    window.Telegram?.WebApp?.colorScheme === 'dark';

  const cellSize = 11;
  const gap = 3;
  const labelWidth = showDayLabels ? 18 : 0;
  const headerHeight = 16;

  return (
    <div className="select-none">
      {/* Month labels row */}
      <div className="flex relative" style={{ height: headerHeight, marginLeft: labelWidth + (labelWidth > 0 ? gap : 0) }}>
        {monthLabels.map((m) => (
          <span
            key={`${m.label}-${m.colIndex}`}
            className="absolute text-[10px] text-tg-hint font-medium capitalize"
            style={{ left: m.colIndex * (cellSize + gap) }}
          >
            {m.label}
          </span>
        ))}
      </div>

      {/* Grid: (optional day labels) + cells */}
      <div className="flex" style={{ gap: showDayLabels ? gap : 0 }}>
        {/* Day-of-week labels */}
        {showDayLabels && (
          <div className="flex flex-col shrink-0" style={{ width: labelWidth, gap }}>
            {DAY_LABELS.map((label, i) => (
              <div
                key={i}
                className="flex items-center text-[9px] text-tg-hint font-medium"
                style={{ height: cellSize }}
              >
                {label}
              </div>
            ))}
          </div>
        )}

        {/* Week columns */}
        <div className="flex" style={{ gap }}>
          {grid.map((week, wi) => (
            <div key={wi} className="flex flex-col" style={{ gap }}>
              {week.map((day, di) => {
                if (!day) {
                  return <div key={`e-${wi}-${di}`} style={{ width: cellSize, height: cellSize }} />;
                }

                const dateStr = toDateString(day);
                const value = entryMap.get(dateStr) ?? 0;
                const bg = value > 0
                  ? getHeatmapColor(color, binary ? 3 : value)
                  : getEmptyColor(!!isDark);
                const isTodayCell = isToday(day);

                return (
                  <div
                    key={dateStr}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      backgroundColor: bg,
                      borderRadius: 2,
                      outline: isTodayCell ? `1.5px solid ${color}` : undefined,
                      outlineOffset: '1px',
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        colorScheme?: string;
        initData?: string;
        ready: () => void;
        expand: () => void;
        MainButton: any;
        BackButton: any;
        HapticFeedback: {
          impactOccurred: (style: string) => void;
          notificationOccurred: (type: string) => void;
          selectionChanged: () => void;
        };
        close: () => void;
      };
    };
  }
}
