import { todayIn } from '$lib/dates';
import { requireUser } from '$lib/server/actions';
import { data } from '$lib/server/data';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const userId = requireUser(locals);
	const { email, timeZone } = locals.user!;
	// "Today" is the user's calendar day, never the server's (Vercel runs in UTC).
	const today = todayIn(timeZone);
	const [lists, counts, todayCount] = await Promise.all([
		data.lists.all(userId),
		data.tasks.activeCounts(userId),
		data.tasks.todayCount(userId, today)
	]);
	return { email, timeZone, today, lists, counts: { ...counts, today: todayCount } };
};
