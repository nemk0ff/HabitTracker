/**
 * One-off repair (idempotent): before `User.canMessage` existed, a 403 on the evening check-in nulled the
 * user's checkinTime/morningCheckinTime (`checkin_disabled_blocked`). For users still without a checkinTime,
 * restore it from their latest `checkin_time_set` (label) / `onboarding_completed` (metadata.checkinTime)
 * event before that block, and mark an unknown channel (canMessage=null) closed so sends wait for /start or
 * write access. Prints every change.
 * Run: npx tsx scripts/repair-unreachable.ts [--dry-run]
 */
import { prisma } from '../src/db.js';

const CHECKIN_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const dryRun = process.argv.includes('--dry-run');

function timeFrom(event: { event: string; label: string | null; metadata: string | null }): string | null {
  if (event.event === 'checkin_time_set') return event.label && CHECKIN_RE.test(event.label) ? event.label : null;
  try {
    const t = event.metadata ? JSON.parse(event.metadata)?.checkinTime : null;
    return typeof t === 'string' && CHECKIN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

try {
  const blocked = await prisma.analyticsEvent.findMany({
    where: { event: 'checkin_disabled_blocked', userId: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  const latestBlock = new Map<number, Date>();
  for (const e of blocked) if (!latestBlock.has(e.userId!)) latestBlock.set(e.userId!, e.createdAt);
  console.log(`${latestBlock.size} user(s) with checkin_disabled_blocked${dryRun ? ' (dry run)' : ''}`);

  let changed = 0;
  for (const [userId, blockedAt] of latestBlock) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) continue;
    if (user.checkinTime !== null) {
      console.log(`user ${userId}: checkinTime already ${user.checkinTime} — skip`);
      continue;
    }
    // The last choice the user made before the block. A later explicit "off" (after the block) means
    // they turned it off themselves — leave it.
    const offAfter = await prisma.analyticsEvent.findFirst({
      where: { userId, event: 'checkin_time_set', label: 'off', createdAt: { gt: blockedAt } },
    });
    if (offAfter) {
      console.log(`user ${userId}: turned the check-in off after the block — skip`);
      continue;
    }
    const source = await prisma.analyticsEvent.findFirst({
      where: { userId, event: { in: ['checkin_time_set', 'onboarding_completed'] }, createdAt: { lte: blockedAt } },
      orderBy: { createdAt: 'desc' },
    });
    const time = source ? timeFrom(source) : null;
    if (!time) {
      console.log(`user ${userId}: no check-in time to restore — skip`);
      continue;
    }
    console.log(
      `user ${userId} (tg ${user.telegramId}): checkinTime null → ${time} (from ${source!.event} ${source!.createdAt.toISOString()}), canMessage ${user.canMessage}${user.canMessage === null ? ' → false' : ' (kept)'}`,
    );
    if (!dryRun) {
      // Only an unknown channel is marked closed — never overwrite a confirmed true (/start, a successful send).
      await prisma.user.update({
        where: { id: userId },
        data: { checkinTime: time, ...(user.canMessage === null ? { canMessage: false } : {}) },
      });
    }
    changed++;
  }
  console.log(`${changed} user(s) ${dryRun ? 'would be ' : ''}repaired`);
} finally {
  await prisma.$disconnect();
}
