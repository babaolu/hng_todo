import { requireUser } from '$lib/server/actions';
import { data } from '$lib/server/data';
import type { RequestHandler } from './$types';

/** GET /settings/export: the signed-in user's lists and tasks as a JSON download. */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = requireUser(locals);
	const { timeZone } = locals.user!;
	const now = new Date();
	const body = JSON.stringify(await data.exports.build(userId, timeZone, now), null, 2);
	return new Response(body, {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="${data.exports.filename(timeZone, now)}"`,
			'cache-control': 'no-store'
		}
	});
};
