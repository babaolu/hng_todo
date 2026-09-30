import { appActions, requireUser, selectedTask } from '$lib/server/actions';
import { data } from '$lib/server/data';
import { searchWords } from '$lib/server/tasks';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = requireUser(locals);
	const q = (url.searchParams.get('q') ?? '').slice(0, 200);
	const words = searchWords(q);
	const [tasks, selected] = await Promise.all([
		words.length ? data.tasks.search(userId, q) : Promise.resolve([]),
		selectedTask(userId, url)
	]);
	return { q, words, tasks, selected };
};

export const actions = appActions satisfies Actions;
