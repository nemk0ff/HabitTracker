import { useRef, useEffect, useCallback, type KeyboardEvent } from 'react';

interface Props {
  items: string[];
  value: number;
  onChange: (index: number) => void;
  itemHeight?: number;
  visibleCount?: number;
  /** Accessible name, e.g. «Часы». */
  label?: string;
}

export function WheelPicker({ items, value, onChange, itemHeight = 40, visibleCount = 5, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const padding = Math.floor(visibleCount / 2) * itemHeight;
  const containerHeight = visibleCount * itemHeight;

  const scrollToIndex = useCallback(
    (index: number, smooth = false) => {
      const el = containerRef.current;
      if (!el) return;
      const top = index * itemHeight;
      el.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' });
    },
    [itemHeight],
  );

  useEffect(() => {
    scrollToIndex(value, false);
  }, [value, scrollToIndex]);

  const handleScroll = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    isScrolling.current = true;

    timeoutRef.current = setTimeout(() => {
      isScrolling.current = false;
      const el = containerRef.current;
      if (!el) return;
      const index = Math.round(el.scrollTop / itemHeight);
      const clamped = Math.max(0, Math.min(items.length - 1, index));
      if (clamped !== value) {
        onChange(clamped);
      }
      scrollToIndex(clamped, true);
    }, 80);
  };

  const fadeStop = `${((itemHeight / containerHeight) * 100).toFixed(1)}%`;
  const fadeMask = `linear-gradient(to bottom, transparent 0%, black ${fadeStop}, black calc(100% - ${fadeStop}), transparent 100%)`;

  const last = items.length - 1;
  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
    let next: number;
    if (e.key in step) next = value + step[e.key]!;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    next = Math.max(0, Math.min(last, next));
    if (next !== value) {
      onChange(next);
      window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
    }
  };

  return (
    <div
      className="relative rounded-xl focus-ring"
      style={{ height: containerHeight, overflow: 'hidden' }}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuetext={items[value]}
      onKeyDown={handleKey}
    >
      {/* Scrollable area — mask applied here directly so it works inside the compositor layer */}
      <div
        aria-hidden="true"
        tabIndex={-1}
        ref={containerRef}
        className="absolute inset-0 overflow-y-scroll"
        style={{
          scrollSnapType: 'y mandatory',
          scrollbarWidth: 'none',
          WebkitMaskImage: fadeMask,
          maskImage: fadeMask,
        }}
        onScroll={handleScroll}
      >
        {/* Top padding */}
        <div style={{ height: padding }} />

        {items.map((item, i) => (
          <div
            key={i}
            className="flex items-center justify-center font-semibold select-none"
            style={{
              height: itemHeight,
              scrollSnapAlign: 'start',
              fontSize: '22px',
              color: 'var(--tg-theme-text-color, #000)',
            }}
          >
            {item}
          </div>
        ))}

        {/* Bottom padding */}
        <div style={{ height: padding }} />
      </div>

      {/* Selection indicator: top/bottom lines only, no background fill */}
      <div
        className="absolute left-2 right-2 pointer-events-none"
        style={{
          top: padding,
          height: itemHeight,
          borderTop: '1px solid rgba(128,128,128,0.35)',
          borderBottom: '1px solid rgba(128,128,128,0.35)',
        }}
      />
    </div>
  );
}
