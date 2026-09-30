import { appActions, requireUser, selectedTask } from '$lib/server/actions';
import { data } from '$lib/server/data';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = requireUser(locals);
	const [tasks, selected] = await Promise.all([
		data.tasks.listCompleted(userId),
		selectedTask(userId, url)
	]);
	return { tasks, selected };
};

export const actions = appActions satisfies Actions;
