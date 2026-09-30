import { describe, expect, it } from 'vitest';
import { highlight } from './highlight';

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
