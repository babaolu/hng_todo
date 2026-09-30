/**
 * Temporary guest accounts (GUEST_MODE=on). A guest is a users row with
 * is_guest = true, a random @guest.invalid email and a password hash that can
 * never match (login also rejects guests explicitly). Guests live exactly
 * GUEST_TTL from creation; deleting the users row cascades to their sessions,
 * lists and tasks.
 *
 * Every delete in this module is filtered on is_guest = true, so no caller can
 * reach a real account through it.
 */
import { randomUUID } from 'node:crypto';
import { and, count, eq, gt, lte } from 'drizzle-orm';
import { addDays, todayIn } from '../dates';
import { createAuthStore, GUEST_TTL } from './auth';
import { users } from './db/schema';
import type { Db } from './db/types';
import { createListStore } from './lists';
import { createTaskStore } from './tasks';

/** Not an argon2 hash, so verification always fails. */
export const GUEST_PASSWORD_HASH = '!guest-account-no-password';

export const GUEST_LIMITS = {
	/** New guests per IP per hour. */
	perIpPerHour: 10,
	/** Guests existing at once. */
	total: 500,
	/** Rows per guest, soft-deleted and completed included. */
	tasks: 200,
	lists: 20
};

const HOUR = 60 * 60 * 1000;

export type GuestResult =
	| { ok: true; userId: string; token: string; expiresAt: Date }
	| { ok: false; reason: 'rate-limited' | 'full' };

export type GuestStore = ReturnType<typeof createGuestStore>;

export function createGuestStore(
	db: Db,
	{
		clock = () => new Date(),
		limits = GUEST_LIMITS
	}: { clock?: () => Date; limits?: Pick<typeof GUEST_LIMITS, 'perIpPerHour' | 'total'> } = {}
) {
	const auth = createAuthStore(db, clock);
	const taskStore = createTaskStore(db);
	const listStore = createListStore(db);
	const isGuest = eq(users.isGuest, true);

	async function deleteWhere(where: ReturnType<typeof and>): Promise<number> {
		const rows = await db.delete(users).where(and(isGuest, where)).returning({ id: users.id });
		return rows.length;
	}

	/** Guests past their fixed expiry (uses users_guest_created_idx). */
	function deleteExpired(): Promise<number> {
		return deleteWhere(lte(users.createdAt, new Date(clock().getTime() - GUEST_TTL)));
	}

	/** Every guest: used when guest mode is off. */
	function deleteAll(): Promise<number> {
		return deleteWhere(undefined);
	}

	async function seed(userId: string, today: string) {
		const d = (n: number) => addDays(today, n);
		const home = await listStore.create(userId, 'Home');
		const work = await listStore.create(userId, 'Work');
		const add = async (
			title: string,
			dueDate: string | null,
			listId: string | null,
			extra: { notes?: string; pinned?: boolean; done?: boolean } = {}
		) => {
			const task = (await taskStore.create(userId, { title, listId, dueDate }))!;
			if (extra.notes) await taskStore.update(userId, task.id, { notes: extra.notes });
			if (extra.pinned) await taskStore.setPinned(userId, task.id, true);
			if (extra.done) await taskStore.setCompleted(userId, task.id, true);
		};

		// Created last-first: new tasks go to the top of their list.
		await add('Set up a guest account', d(-1), null, { done: true });
		await add('Ideas for the weekend', null, null);
		await add('Team retro', d(7), work.id);
		await add('Dentist appointment', d(1), null);
		await add('Plan the week', today, work.id);
		await add('Return library books', d(-2), home.id);
		await add('Buy groceries', d(3), home.id);
		await add('Read me: how quick-add works', null, null, {
			pinned: true,
			notes: [
				'Type a task in the box at the top and press Enter. Dates and lists are picked up as you type:',
				'',
				'• Dates: “tomorrow”, “fri”, “next tue”, “in 3 days”, “15/10” (day/month)',
				'• Lists: “#home” or “#work” puts the task in that list',
				'',
				'Try “pay rent 15/10 #home”. Click the date chip to pick another date, or ✕ to keep the text exactly as typed.',
				'',
				'Press n or / to jump to the box, t to pin a task to Today.'
			].join('\n')
		});
	}

	return {
		deleteExpired,
		deleteAll,

		/** Login and guest creation run this: expired guests go, or every guest when the mode is off. */
		housekeep(guestModeOn: boolean): Promise<number> {
			return guestModeOn ? deleteExpired() : deleteAll();
		},

		/**
		 * Create a guest with sample data and a session that ends with the account.
		 * `timeZone` should already be validated (the tz cookie, else UTC).
		 */
		async create(ip: string, timeZone: string): Promise<GuestResult> {
			await deleteExpired();
			const now = clock();

			const [fromIp] = await db
				.select({ n: count() })
				.from(users)
				.where(
					and(isGuest, eq(users.guestIp, ip), gt(users.createdAt, new Date(now.getTime() - HOUR)))
				);
			if ((fromIp?.n ?? 0) >= limits.perIpPerHour) return { ok: false, reason: 'rate-limited' };

			const [all] = await db.select({ n: count() }).from(users).where(isGuest);
			if ((all?.n ?? 0) >= limits.total) return { ok: false, reason: 'full' };

			const [user] = await db
				.insert(users)
				.values({
					email: `guest-${randomUUID()}@guest.invalid`,
					passwordHash: GUEST_PASSWORD_HASH,
					timeZone,
					isGuest: true,
					guestIp: ip,
					createdAt: now
				})
				.returning({ id: users.id });

			await seed(user.id, todayIn(timeZone, now));
			const { token, expiresAt } = await auth.createSession(
				user.id,
				new Date(now.getTime() + GUEST_TTL)
			);
			return { ok: true, userId: user.id, token, expiresAt };
		},

		/** Delete one guest and everything it owns. Never touches a real account. */
		async remove(userId: string): Promise<boolean> {
			return (await deleteWhere(eq(users.id, userId))) > 0;
		}
	};
}
