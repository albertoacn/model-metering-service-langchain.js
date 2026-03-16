/**
 * Reset schedule logic for API key token counts.
 *
 * Pure functions only — no DB access — so they are easy to unit test
 * and can be reused anywhere without side effects.
 */

export type ResetSchedule = 'none' | 'daily' | 'weekly' | 'monthly';

/**
 * Returns the next reset Date after `from` for the given schedule.
 * Returns `null` for 'none'.
 */
export function getNextResetDate(schedule: ResetSchedule, from: Date): Date | null {
	if (schedule === 'none') return null;

	const next = new Date(from);

	if (schedule === 'daily') {
		next.setUTCDate(next.getUTCDate() + 1);
		next.setUTCHours(0, 0, 0, 0);
		return next;
	}

	if (schedule === 'weekly') {
		// Advance to the next Monday
		const daysUntilMonday = ((8 - next.getUTCDay()) % 7) || 7;
		next.setUTCDate(next.getUTCDate() + daysUntilMonday);
		next.setUTCHours(0, 0, 0, 0);
		return next;
	}

	// monthly — first day of the next calendar month
	next.setUTCMonth(next.getUTCMonth() + 1, 1);
	next.setUTCHours(0, 0, 0, 0);
	return next;
}

/**
 * Returns true if the stored reset timestamp has passed and a reset is due.
 * Always returns false when `resetAt` is null (i.e. schedule is 'none').
 */
export function shouldReset(resetAt: string | null, now: Date): boolean {
	if (!resetAt) return false;
	return now >= new Date(resetAt);
}