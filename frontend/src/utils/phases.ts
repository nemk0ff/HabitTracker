import { addDays, differenceInCalendarDays, parseISO } from 'date-fns';
import type { PhaseType, PlanPhase } from '../types';
import { fmt } from './nutrition';
import { toDateString } from './dates';

export const PHASE_LABELS: Record<PhaseType, string> = {
  bulk: 'Набор',
  cut: 'Сушка',
  maintain: 'Поддержание',
};

export const PHASE_COLORS: Record<PhaseType, string> = {
  bulk: 'var(--accent)',
  cut: 'var(--over)',
  maintain: 'var(--carbs)',
};

export const ON_TRACK_COLORS: Record<NonNullable<PlanPhase['onTrack']>, string> = {
  ahead: 'var(--carbs)',
  on: 'var(--accent)',
  behind: 'var(--over)',
};

export const ON_TRACK_LABELS: Record<NonNullable<PlanPhase['onTrack']>, string> = {
  ahead: 'опережаешь план',
  on: 'идёшь по плану',
  behind: 'отстаёшь от плана',
};

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n), 2)}`;

/** «Набор до 77 кг · осталось 138 дн · +0,2/0,35 кг/нед» */
export function phaseLine(p: PlanPhase): string {
  const parts = [p.label];
  if (p.daysLeft >= 0) parts.push(`осталось ${fmt(p.daysLeft)} дн`);
  if (p.plannedRateKgWeek !== null) {
    const planned = fmt(Math.abs(p.plannedRateKgWeek), 2);
    parts.push(
      p.actualRateKgWeek !== null
        ? `${signed(p.actualRateKgWeek)}/${planned} кг/нед`
        : `план ${signed(p.plannedRateKgWeek)} кг/нед`,
    );
  }
  return parts.join(' · ');
}

export interface TimelineSegment {
  type: PhaseType;
  /** Fractions of the bar, 0..1. */
  left: number;
  width: number;
  until: string;
}

/**
 * Lays phases on a bar from a week before today to the last phase's end.
 * Phase i runs from the day after phase i−1 ends (the first one from the bar start).
 */
export function phaseTimeline(
  phases: { type: PhaseType; until: string }[],
  today: string,
): { segments: TimelineSegment[]; now: number } | null {
  const valid = phases.filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.until)).sort((a, b) => a.until.localeCompare(b.until));
  if (valid.length === 0) return null;
  const start = toDateString(addDays(parseISO(today), -7));
  const lastUntil = valid[valid.length - 1]!.until;
  const end = lastUntil > today ? lastUntil : toDateString(addDays(parseISO(today), 7));
  const total = Math.max(1, differenceInCalendarDays(parseISO(end), parseISO(start)) + 1);
  const pos = (d: string) => Math.min(1, Math.max(0, differenceInCalendarDays(parseISO(d), parseISO(start)) / total));

  const segments: TimelineSegment[] = [];
  let from = start;
  for (const p of valid) {
    const left = pos(from);
    const right = pos(toDateString(addDays(parseISO(p.until), 1)));
    if (right > left) segments.push({ type: p.type, left, width: right - left, until: p.until });
    from = toDateString(addDays(parseISO(p.until), 1));
  }
  return { segments, now: pos(today) };
}
