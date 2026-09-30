import { requireUser } from '$lib/server/actions';
import { data } from '$lib/server/data';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const userId = requireUser(locals);
	const [lists, counts] = await Promise.all([
		data.lists.all(userId),
		data.tasks.activeCounts(userId)
	]);
	return { email: locals.user!.email, lists, counts };
};
