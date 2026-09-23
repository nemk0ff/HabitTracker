import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { adminGuard } from '../middleware/adminGuard.js';

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('onRequest', adminGuard);

  // All habits of all users, grouped by user. Same habit shape as GET /habits.
  app.get('/admin/habits', async () => {
    const since = new Date(Date.now() - 18 * 7 * 86_400_000);

    const [users, lastSeen] = await Promise.all([
      prisma.user.findMany({
        include: {
          habits: {
            where: { archived: false },
            include: {
              entries: {
                where: { date: { gte: since } },
                orderBy: { date: 'asc' },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      prisma.analyticsEvent.groupBy({
        by: ['userId'],
        _max: { createdAt: true },
        where: { userId: { not: null } },
      }),
    ]);

    const lastSeenByUser = new Map<number, Date>();
    for (const row of lastSeen) {
      if (row.userId != null && row._max.createdAt) {
        lastSeenByUser.set(row.userId, row._max.createdAt);
      }
    }

    return users
      .filter((u) => u.habits.length > 0)
      .map((u) => {
        const lastSeenAt = lastSeenByUser.get(u.id) ?? null;
        return {
          user: {
            id: u.id,
            telegramId: u.telegramId.toString(),
            firstName: u.firstName,
            lastName: u.lastName,
            username: u.username,
            lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
          },
          habits: u.habits.map((h) => ({
            id: h.id,
            name: h.name,
            color: h.color,
            icon: h.icon,
            binary: h.binary,
            measure: h.measure,
            createdAt: h.createdAt.toISOString(),
            entries: h.entries.map((e) => ({
              id: e.id,
              date: e.date.toISOString().split('T')[0],
              value: e.value,
            })),
          })),
          _sortKey: lastSeenAt ? lastSeenAt.getTime() : 0,
        };
      })
      .sort((a, b) => b._sortKey - a._sortKey)
      .map(({ _sortKey, ...group }) => group);
  });
}
