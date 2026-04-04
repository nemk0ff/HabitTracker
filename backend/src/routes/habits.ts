import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { authGuard, JwtPayload } from '../middleware/auth.js';

export async function habitsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authGuard);

  app.get('/habits', async (request) => {
    const { userId } = (request as any).user as JwtPayload;

    const habits = await prisma.habit.findMany({
      where: { userId, archived: false },
      include: {
        entries: {
          where: {
            date: {
              gte: new Date(Date.now() - 18 * 7 * 86_400_000),
            },
          },
          orderBy: { date: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return habits.map((h) => ({
      id: h.id,
      name: h.name,
      color: h.color,
      icon: h.icon,
      binary: h.binary,
      createdAt: h.createdAt.toISOString(),
      entries: h.entries.map((e) => ({
        id: e.id,
        date: e.date.toISOString().split('T')[0],
        value: e.value,
      })),
    }));
  });

  app.post<{ Body: { name: string; color?: string; icon?: string; binary?: boolean } }>(
    '/habits',
    async (request, reply) => {
      const { userId } = (request as any).user as JwtPayload;
      const { name, color, icon, binary } = request.body;

      if (!name?.trim()) {
        return reply.status(400).send({ error: 'Name is required' });
      }

      const habit = await prisma.habit.create({
        data: {
          userId,
          name: name.trim(),
          color: color || '#4CAF50',
          icon: icon || null,
          binary: binary ?? false,
        },
      });

      return {
        id: habit.id,
        name: habit.name,
        color: habit.color,
        icon: habit.icon,
        binary: habit.binary,
        createdAt: habit.createdAt.toISOString(),
        entries: [],
      };
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; color?: string; icon?: string; binary?: boolean } }>(
    '/habits/:id',
    async (request, reply) => {
      const { userId } = (request as any).user as JwtPayload;
      const habitId = Number(request.params.id);

      const existing = await prisma.habit.findFirst({
        where: { id: habitId, userId },
      });
      if (!existing) {
        return reply.status(404).send({ error: 'Habit not found' });
      }

      const { name, color, icon, binary } = request.body;
      const habit = await prisma.habit.update({
        where: { id: habitId },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(color !== undefined && { color }),
          ...(icon !== undefined && { icon }),
          ...(binary !== undefined && { binary }),
        },
      });

      return {
        id: habit.id,
        name: habit.name,
        color: habit.color,
        icon: habit.icon,
        binary: habit.binary,
        createdAt: habit.createdAt.toISOString(),
      };
    },
  );

  app.delete<{ Params: { id: string } }>('/habits/:id', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const habitId = Number(request.params.id);

    const existing = await prisma.habit.findFirst({
      where: { id: habitId, userId },
    });
    if (!existing) {
      return reply.status(404).send({ error: 'Habit not found' });
    }

    await prisma.habit.delete({ where: { id: habitId } });

    return { success: true };
  });
}
