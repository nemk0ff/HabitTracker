import { useState } from 'react';
import { X } from 'lucide-react';

const HINT_KEY = 'nutrition.templatesHintSeen';

function readSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Marks the one-time templates hint as seen (also called once a template is saved). */
export function markTemplatesHintSeen() {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    // private mode: the hint may come back, harmless
  }
}

/** One-time hint about meal templates; renders nothing once dismissed. */
export function TemplatesHint({ show }: { show: boolean }) {
  const [seen, setSeen] = useState(readSeen);
  if (!show || seen) return null;
  return (
    <div
      className="mt-3 rounded-xl pl-4 pr-1 py-1 flex items-center gap-2 text-sm"
      style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)' }}
    >
      <span className="flex-1 py-2">Ешь одно и то же? Сохрани приём как набор — потом одним тапом</span>
      <button
        onClick={() => {
          markTemplatesHintSeen();
          setSeen(true);
        }}
        aria-label="Скрыть подсказку"
        className="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg active:opacity-60"
      >
        <X size={18} aria-hidden />
      </button>
    </div>
  );
}
