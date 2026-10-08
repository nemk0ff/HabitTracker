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

// ─── Пер-юзер активность (для админских команд бота) ──────────────────────────

/** Время и тип последнего события каждого пользователя. */
export async function getLastActivityPerUser(): Promise<
  Map<number, { at: Date; event: string }>
> {
  const grouped = await prisma.analyticsEvent.groupBy({
    by: ['userId'],
    _max: { createdAt: true },
    where: { userId: { not: null } },
  });

  const result = new Map<number, { at: Date; event: string }>();
  await Promise.all(
    grouped.map(async (g) => {
      if (g.userId == null || !g._max.createdAt) return;
      const latest = await prisma.analyticsEvent.findFirst({
        where: { userId: g.userId, createdAt: g._max.createdAt },
        orderBy: { id: 'desc' },
        select: { event: true },
      });
      result.set(g.userId, { at: g._max.createdAt, event: latest?.event ?? '—' });
    }),
  );
  return result;
}

export interface UserOverviewRow {
  id: number;
  telegramId: string;
  name: string;
  username: string | null;
  habitCount: number;
  lastSeenAt: Date | null;
  lastEvent: string | null;
}

/** Список всех пользователей с числом привычек и временем последнего действия. */
export async function getUserOverview(): Promise<UserOverviewRow[]> {
  const [users, lastActivity] = await Promise.all([
    prisma.user.findMany({
      include: { _count: { select: { habits: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    getLastActivityPerUser(),
  ]);

  return users
    .map((u) => {
      const activity = lastActivity.get(u.id) ?? null;
      return {
        id: u.id,
        telegramId: u.telegramId.toString(),
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Без имени',
        username: u.username,
        habitCount: u._count.habits,
        lastSeenAt: activity?.at ?? null,
        lastEvent: activity?.event ?? null,
      };
    })
    .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0));
}

export interface RecentActivityRow {
  at: Date;
  event: string;
  label: string | null;
  userName: string;
  userId: number | null;
}

/** Лента последних событий по всем пользователям. */
export async function getRecentActivity(limit = 25): Promise<RecentActivityRow[]> {
  const rows = await prisma.analyticsEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { user: true },
  });

  return rows.map((r) => ({
    at: r.createdAt,
    event: r.event,
    label: r.label,
    userId: r.userId,
    userName: r.user
      ? [r.user.firstName, r.user.lastName].filter(Boolean).join(' ') || `#${r.userId}`
      : 'аноним',
  }));
}

export interface UserDetail {
  id: number;
  telegramId: string;
  name: string;
  username: string | null;
  createdAt: Date;
  habitCount: number;
  entryCount: number;
  lastSeenAt: Date | null;
  lastEvent: string | null;
  topEvents: Array<{ event: string; count: number }>;
}

/** Детальная статистика по одному пользователю (по DB id). */
export async function getUserDetail(userId: number): Promise<UserDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { _count: { select: { habits: true } } },
  });
  if (!user) return null;

  const [entryCount, lastEvent, topEventRows] = await Promise.all([
    prisma.habitEntry.count({ where: { skipped: false, habit: { userId } } }),
    prisma.analyticsEvent.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, event: true },
    }),
    prisma.analyticsEvent.groupBy({
      by: ['event'],
      where: { userId },
      _count: { event: true },
      orderBy: { _count: { event: 'desc' } },
      take: 5,
    }),
  ]);

  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Без имени',
    username: user.username,
    createdAt: user.createdAt,
    habitCount: user._count.habits,
    entryCount,
    lastSeenAt: lastEvent?.createdAt ?? null,
    lastEvent: lastEvent?.event ?? null,
    topEvents: topEventRows.map((r) => ({ event: r.event, count: r._count.event })),
  };
}
