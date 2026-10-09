import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDays, differenceInCalendarDays, differenceInCalendarWeeks, format, parseISO, startOfWeek } from 'date-fns';
import { ru } from 'date-fns/locale';
import { getWeeksGrid, toDateString } from '../utils/dates';
import { getHeatmapColor, getEmptyColor } from '../utils/colors';
import { skipHatch } from '../utils/habits';
import type { HabitEntry } from '../types';

interface Props {
  /** Entries as levels 0–3 (see `levelEntries`). */
  entries: HabitEntry[];
  color: string;
  /** YYYY-MM-DD the habit starts (`habitStartDate`): earlier days aren't drawn (they aren't misses). */
  startDate?: string;
  /** Mondays of the weeks whose frequency goal was met; when set, a bar row is drawn under the grid. */
  metWeekStarts?: Set<string>;
}

const GAP = 3;
const MIN_WEEKS = 8;
const MAX_WEEKS = 18;
const MAX_CELL = 18;
const MIN_CELL = 9;
const LABEL_W = 28; // ≈ «сент» at text-xs
const HEADER_H = 16;
const BAR_H = 3;
/** Below this much history the tall grid would be mostly empty — a week strip is drawn instead. */
const COMPACT_HISTORY_DAYS = 14;
const STRIP_CELL = 28;
const STRIP_GAP = 4;
const WEEKDAY_LETTERS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * How many week columns to show and how big a cell is so the grid fills `width`:
 * as much history as exists (8–18 weeks), cells capped at MAX_CELL, more columns if they'd be bigger.
 */
function layout(width: number, historyWeeks: number): { weeks: number; cell: number } {
  if (width <= 0) return { weeks: MAX_WEEKS, cell: 11 };
  const fit = (n: number) => (width - (n - 1) * GAP) / n;
  let weeks = Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, historyWeeks));
  while (weeks < MAX_WEEKS && fit(weeks) > MAX_CELL) weeks++;
  while (weeks > MIN_WEEKS && fit(weeks) < MIN_CELL) weeks--;
  return { weeks, cell: Math.max(4, Math.min(MAX_CELL, Math.floor(fit(weeks) * 10) / 10)) };
}

/** Decorative overview: the card around it carries the accessible text. */
export const MiniHeatmap = memo(function MiniHeatmap({ entries, color, startDate, metWeekStarts }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const todayStr = toDateString(new Date());
  const compact =
    !!startDate && differenceInCalendarDays(parseISO(todayStr), parseISO(startDate)) + 1 < COMPACT_HISTORY_DAYS;
  const historyWeeks = startDate
    ? differenceInCalendarWeeks(parseISO(todayStr), parseISO(startDate), { weekStartsOn: 1 }) + 1
    : MAX_WEEKS;
  const { weeks, cell } = layout(width, historyWeeks);

  const entryMap = useMemo(() => new Map(entries.map((e) => [e.date, e.value])), [entries]);
  // Skipped days (ill / vacation) are hatched, not empty — they aren't misses.
  const skippedSet = useMemo(() => new Set(entries.filter((e) => e.skipped).map((e) => e.date)), [entries]);

  const columns = useMemo(() => {
    const { weeks: grid } = getWeeksGrid(weeks);
    return grid.map((week) => {
      const days = week.map((d) => {
        if (!d) return null;
        const date = toDateString(d);
        return startDate && date < startDate ? null : { date, month: d.getMonth(), d };
      });
      const monday = week[0] ? toDateString(week[0]) : '';
      return { monday, days };
    });
    // todayStr: rebuild the grid when the day changes.
  }, [weeks, startDate, todayStr]);

  const gridWidth = weeks * cell + (weeks - 1) * GAP;

  // A month label at the first column showing that month, only where it doesn't collide.
  const monthLabels = useMemo(() => {
    const labels: { label: string; left: number }[] = [];
    let lastMonth = -1;
    let lastRight = -Infinity;
    columns.forEach((col, i) => {
      const first = col.days.find((x) => x !== null);
      if (!first || first.month === lastMonth) return;
      lastMonth = first.month;
      const left = i * (cell + GAP);
      if (left < lastRight + 4 || left + LABEL_W > gridWidth + GAP) return;
      labels.push({ label: format(first.d, 'LLL', { locale: ru }).replace('.', ''), left });
      lastRight = left + LABEL_W;
    });
    return labels;
  }, [columns, cell, gridWidth]);

  const radius = cell >= 14 ? 3 : 2;

  if (compact && startDate) {
    return (
      <div ref={ref} className="select-none w-full" aria-hidden="true">
        <WeekStrip entryMap={entryMap} skippedSet={skippedSet} color={color} startDate={startDate} today={todayStr} width={width} />
      </div>
    );
  }

  return (
    <div ref={ref} className="select-none w-full" aria-hidden="true">
      <div className="relative" style={{ height: HEADER_H }}>
        {monthLabels.map((m) => (
          <span
            key={`${m.label}-${m.left}`}
            className="absolute top-0 text-xs leading-none text-tg-hint font-medium"
            style={{ left: m.left }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className="flex" style={{ gap: GAP }}>
        {columns.map((col, wi) => (
          <div key={col.monday || wi} className="flex flex-col" style={{ gap: GAP }}>
            {col.days.map((day, di) => {
              if (!day) return <div key={di} style={{ width: cell, height: cell }} />;
              const value = entryMap.get(day.date) ?? 0;
              const isTodayCell = day.date === todayStr;
              const skipped = value <= 0 && skippedSet.has(day.date);
              return (
                <div
                  key={di}
                  title={skipped ? 'пропуск' : undefined}
                  style={{
                    width: cell,
                    height: cell,
                    borderRadius: radius,
                    backgroundColor: value > 0 ? getHeatmapColor(color, value) : getEmptyColor(),
                    backgroundImage: skipped ? skipHatch(color, 1.5, cell >= 14 ? 3.5 : 2.5) : undefined,
                    outline: isTodayCell ? `1.5px solid ${color}` : undefined,
                    outlineOffset: isTodayCell ? 1 : undefined,
                  }}
                />
              );
            })}
            {metWeekStarts && (
              <div
                style={{
                  width: cell,
                  height: BAR_H,
                  borderRadius: BAR_H,
                  backgroundColor: metWeekStarts.has(col.monday) ? color : 'transparent',
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

/**
 * Short history: the current week (plus last week if the habit started then) as rows of
 * 7 large cells with weekday letters underneath. Today outlined, future faded, pre-start days blank.
 */
function WeekStrip({
  entryMap,
  skippedSet,
  color,
  startDate,
  today,
  width,
}: {
  entryMap: Map<string, number>;
  skippedSet: Set<string>;
  color: string;
  startDate: string;
  today: string;
  width: number;
}) {
  const monday = startOfWeek(parseISO(today), { weekStartsOn: 1 });
  const thisMonday = toDateString(monday);
  const weekStarts = startDate < thisMonday ? [addDays(monday, -7), monday] : [monday];
  const fit = width > 0 ? Math.floor((width - 6 * STRIP_GAP) / 7) : STRIP_CELL;
  const cell = Math.max(12, Math.min(STRIP_CELL, fit));

  return (
    <div className="flex flex-col" style={{ gap: STRIP_GAP }}>
      {weekStarts.map((start) => (
        <div key={toDateString(start)} className="flex" style={{ gap: STRIP_GAP }}>
          {Array.from({ length: 7 }, (_, i) => {
            const date = toDateString(addDays(start, i));
            if (date < startDate) return <div key={date} style={{ width: cell, height: cell }} />;
            const value = entryMap.get(date) ?? 0;
            const isToday = date === today;
            const skipped = value <= 0 && skippedSet.has(date);
            return (
              <div
                key={date}
                title={skipped ? 'пропуск' : undefined}
                style={{
                  width: cell,
                  height: cell,
                  borderRadius: 6,
                  backgroundColor: value > 0 ? getHeatmapColor(color, value) : getEmptyColor(),
                  backgroundImage: skipped ? skipHatch(color) : undefined,
                  opacity: date > today ? 0.4 : 1,
                  outline: isToday ? `2px solid ${color}` : undefined,
                  outlineOffset: isToday ? 1 : undefined,
                }}
              />
            );
          })}
        </div>
      ))}
      <div className="flex" style={{ gap: STRIP_GAP }}>
        {WEEKDAY_LETTERS.map((l) => (
          <span key={l} className="text-[11px] leading-none text-tg-hint text-center" style={{ width: cell }}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

// Telegram WebApp typings (historically declared here; global for the whole app).
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
        onEvent?: (event: string, cb: () => void) => void;
        offEvent?: (event: string, cb: () => void) => void;
        isVersionAtLeast?: (version: string) => boolean;
        /** Bot API 6.9+: asks the user to let the bot message them. */
        requestWriteAccess?: (cb?: (granted: boolean) => void) => void;
      };
    };
  }
}
