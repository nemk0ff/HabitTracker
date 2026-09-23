import { useEffect, useState } from 'react';
import { subDays } from 'date-fns';
import { BottomSheet } from './BottomSheet';
import { Heatmap } from '../Heatmap';
import { fetchStats } from '../../api/nutrition';
import { toDateString } from '../../utils/dates';
import { NUTRITION_COLOR, goalLevel } from '../../utils/nutrition';
import type { HabitEntry } from '../../types';

interface Props {
  open: boolean;
  selectedDate: string;
  onClose: () => void;
  onSelect: (date: string) => void;
}

/** Month calendar colored by how close each day came to the kcal goal. */
export function FoodCalendarSheet({ open, selectedDate, onClose, onSelect }: Props) {
  const [entries, setEntries] = useState<HabitEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    const today = new Date();
    fetchStats(toDateString(subDays(today, 400)), toDateString(today))
      .then((stats) =>
        setEntries(
          stats.days.map((d, i) => ({ id: i, date: d.date, value: goalLevel(d.kcal, stats.goal?.kcal) })),
        ),
      )
      .catch(() => setEntries([]));
  }, [open]);

  return (
    <BottomSheet open={open} onClose={onClose}>
      <Heatmap
        entries={entries}
        color={NUTRITION_COLOR}
        selectedDate={selectedDate}
        onSelect={(date) => {
          onSelect(date);
          onClose();
        }}
      />
      <p className="text-[11px] text-tg-hint text-center mt-4">Чем ярче день — тем ближе к цели по калориям</p>
    </BottomSheet>
  );
}
