import { error } from '@sveltejs/kit';
import { appActions, isUuid, requireUser, selectedTask } from '$lib/server/actions';
import { data } from '$lib/server/data';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const userId = requireUser(locals);
	if (!isUuid(params.id)) error(404, 'List not found');
	const [list, tasks, selected] = await Promise.all([
		data.lists.get(userId, params.id),
		data.tasks.listActive(userId, params.id),
		selectedTask(userId, url)
	]);
	if (!list) error(404, 'List not found');
	return { list, tasks, selected };
};

export const actions = appActions satisfies Actions;
