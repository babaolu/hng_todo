import { generateKeyBetween } from 'fractional-indexing';

/**
 * Key for an item placed after `prev` and before `next` (null = start / end).
 * Only the moved row is rewritten. If the neighbours' keys are equal or out of
 * order (concurrent inserts, stale client), `nextAfter` supplies the first key
 * strictly greater than `prev` so the result is still valid.
 */
export async function keyBetween(
	prev: string | null,
	next: string | null,
	nextAfter: (key: string) => Promise<string | null>
): Promise<string> {
	if (prev !== null && next !== null && prev >= next) next = await nextAfter(prev);
	return generateKeyBetween(prev, next);
}

export { generateKeyBetween };
