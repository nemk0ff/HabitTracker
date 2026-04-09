import { prisma } from '../db.js';

export type EventCategory = 'bot' | 'miniapp' | 'reminder';

interface TrackOptions {
  userId?: number | null;
  event: string;
  category: EventCategory;
  label?: string;
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget — никогда не блокирует основной поток */
export function track(opts: TrackOptions): void {
  try {
    prisma.analyticsEvent
      .create({
        data: {
          userId: opts.userId ?? null,
          event: opts.event,
          category: opts.category,
          label: opts.label ?? null,
          metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
        },
      })
      .catch(() => {
        // аналитика не должна ломать продукт
      });
  } catch {
    // Prisma client может не иметь модели (e.g. client не был regenerated)
  }
}

// ─── Агрегаты для алертов ─────────────────────────────────────────────────────

export async function getNewUsersCount(from: Date, to: Date): Promise<number> {
  return prisma.user.count({ where: { createdAt: { gte: from, lt: to } } });
}

export async function getDau(from: Date, to: Date): Promise<number> {
  const rows = await prisma.analyticsEvent.findMany({
    where: { createdAt: { gte: from, lt: to }, userId: { not: null } },
    select: { userId: true },
    distinct: ['userId'],
  });
  return rows.length;
}

export async function getWau(from: Date, to: Date): Promise<number> {
  const rows = await prisma.analyticsEvent.findMany({
    where: { createdAt: { gte: from, lt: to }, userId: { not: null } },
    select: { userId: true },
    distinct: ['userId'],
  });
  return rows.length;
}

export async function getTopEvents(
  from: Date,
  to: Date,
  limit = 5,
): Promise<Array<{ event: string; count: number }>> {
  const rows = await prisma.analyticsEvent.groupBy({
    by: ['event'],
    where: { createdAt: { gte: from, lt: to } },
    _count: { event: true },
    orderBy: { _count: { event: 'desc' } },
    take: limit,
  });
  return rows.map((r) => ({ event: r.event, count: r._count.event }));
}
