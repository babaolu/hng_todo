import { formatDay, todayIn } from '$lib/dates';
import { requireUser } from '$lib/server/actions';
import { data } from '$lib/server/data';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const userId = requireUser(locals);
	const { email, timeZone, isGuest, guestExpiresAt } = locals.user!;
	// "Today" is the user's calendar day, never the server's (Vercel runs in UTC).
	const today = todayIn(timeZone);
	const [lists, counts, todayCount] = await Promise.all([
		data.lists.all(userId),
		data.tasks.activeCounts(userId),
		data.tasks.todayCount(userId, today)
	]);
	// Guests: the day their account is deleted, in their own zone ("Wed 7 Oct").
	const guest =
		isGuest && guestExpiresAt
			? { deletesOn: formatDay(todayIn(timeZone, guestExpiresAt), today) }
			: null;
	return { email, timeZone, today, guest, lists, counts: { ...counts, today: todayCount } };
};
