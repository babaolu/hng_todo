import { describe, expect, it } from 'vitest';
import { excerpt, highlight, type Segment } from './highlight';

describe('highlight', () => {
	it('marks every case-insensitive match', () => {
		expect(highlight('Pay the Rent, then rent a car', ['rent'])).toEqual([
			{ text: 'Pay the ', match: false },
			{ text: 'Rent', match: true },
			{ text: ', then ', match: false },
			{ text: 'rent', match: true },
			{ text: ' a car', match: false }
		]);
	});

	it('handles several words, preferring the longer match', () => {
		expect(
			highlight('renewal', ['ren', 'renew'])
				.filter((s) => s.match)
				.map((s) => s.text)
		).toEqual(['renew']);
	});

	it('treats regex characters in the query literally', () => {
		expect(highlight('50% off (today)', ['50%', '(today)']).filter((s) => s.match)).toEqual([
			{ text: '50%', match: true },
			{ text: '(today)', match: true }
		]);
	});

	it('returns markup-looking text as plain text segments', () => {
		const segments = highlight('<img src=x onerror=alert(1)> task', ['task']);
		expect(segments.map((s) => s.text).join('')).toBe('<img src=x onerror=alert(1)> task');
	});

	it('no words: one plain segment', () => {
		expect(highlight('abc', [])).toEqual([{ text: 'abc', match: false }]);
	});
});

describe('excerpt (notes in search results)', () => {
	const text = (segments: Segment[] | null) => segments?.map((s) => s.text).join('') ?? null;
	const matched = (segments: Segment[] | null) =>
		segments?.filter((s) => s.match).map((s) => s.text) ?? [];
	const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

	it('is null when only the title matches (the notes have none of the words), or there are no notes', () => {
		expect(excerpt('Call the landlord about the boiler', ['rent'])).toBeNull();
		expect(excerpt(null, ['rent'])).toBeNull();
		expect(excerpt('', ['rent'])).toBeNull();
		expect(excerpt('rent', [])).toBeNull();
	});

	it('short notes are shown whole, with no ellipsis', () => {
		expect(excerpt('Pay the rent by Friday', ['rent'])).toEqual([
			{ text: 'Pay the ', match: false },
			{ text: 'rent', match: true },
			{ text: ' by Friday', match: false }
		]);
	});

	it('a match at the start: no leading …, trailing … where the rest is cut', () => {
		const e = excerpt(`Rent is due ${filler(40)}`, ['rent']);
		expect(e![0]).toEqual({ text: 'Rent', match: true });
		expect(text(e)!.endsWith('…')).toBe(true);
		expect(text(e)!.length).toBeLessThanOrEqual(110);
	});

	it('a match in the middle: … on both sides, cut at word boundaries, match kept near the start', () => {
		const notes = `${filler(40)} then pay the rent on time ${filler(40)}`;
		const e = excerpt(notes, ['rent']);
		const t = text(e)!;
		expect(t.startsWith('…')).toBe(true);
		expect(t.endsWith('…')).toBe(true);
		expect(matched(e)).toEqual(['rent']);
		// whole words only: every word in the excerpt is a word of the notes
		const words = new Set(notes.split(' '));
		for (const w of t.replace(/…/g, '').trim().split(' ')) expect(words.has(w), w).toBe(true);
		// at most ~20 characters of context before the match
		expect(t.indexOf('rent')).toBeLessThanOrEqual(22);
		expect(t.length).toBeGreaterThan(80);
		expect(t.length).toBeLessThanOrEqual(120);
	});

	it('does not trim just a word or two from the beginning', () => {
		const e = excerpt(`Bank details for the landlord are in the shared folder ${filler(30)}`, [
			'landlord'
		]);
		expect(text(e)!.startsWith('Bank details for the ')).toBe(true);
	});

	it('a match at the end: leading …, no trailing …, and still little text before the match', () => {
		const e = excerpt(`${filler(40)} and finally the rent`, ['rent']);
		const t = text(e)!;
		expect(t.startsWith('…')).toBe(true);
		expect(t.endsWith('the rent')).toBe(true);
		expect(e!.at(-1)).toEqual({ text: 'rent', match: true });
		expect(t.indexOf('rent')).toBeLessThanOrEqual(22);
	});

	it('several words: the window starts at the earliest match, and every word in it is highlighted', () => {
		const notes = `${filler(10)} landlord said the rent and the deposit are due; rent first ${filler(40)}`;
		const e = excerpt(notes, ['rent', 'landlord', 'deposit', 'absent']);
		expect(matched(e)).toEqual(['landlord', 'rent', 'deposit', 'rent']);
	});

	it('long notes: about 100 characters, newlines and runs of spaces collapsed', () => {
		const notes = `${filler(300)}\n\n  • the   rent\nis due\t${filler(300)}`;
		const t = text(excerpt(notes, ['rent']))!;
		expect(t).toContain('• the rent is due word0');
		expect(t).not.toMatch(/[\n\t]| {2}/);
		expect(t.length).toBeGreaterThan(80);
		expect(t.length).toBeLessThanOrEqual(120);
	});

	it('treats markup and regex characters in notes and words as plain text', () => {
		const e = excerpt('<script>alert("rent")</script> <b>50%</b>', ['rent', '50%']);
		expect(text(e)).toBe('<script>alert("rent")</script> <b>50%</b>');
		expect(matched(e)).toEqual(['rent', '50%']);
	});
});
