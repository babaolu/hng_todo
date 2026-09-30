import { describe, expect, it } from 'vitest';
import { addDays, weekdayOf } from './dates';
import { parseQuickAdd } from './quick-add';

const TODAY = '2026-10-01'; // Thursday
const lists = [
	{ id: 'work', name: 'Work' },
	{ id: 'side', name: 'Side project' },
	{ id: 'fin', name: 'Finance' },
	{ id: 'old', name: 'Old stuff', archived: true }
];
const parse = (text: string, today = TODAY) => parseQuickAdd(text, { today, lists });

describe('dates', () => {
	it.each([
		// [input, title, dueDate]
		['call mom tomorrow', 'call mom', '2026-10-02'],
		['call mom today', 'call mom', '2026-10-01'],
		['tonight: take out bins', 'take out bins', '2026-10-01'],
		['pay rent friday', 'pay rent', '2026-10-02'],
		['pay rent on friday', 'pay rent', '2026-10-02'],
		['pay rent fri', 'pay rent', '2026-10-02'],
		['review thursday', 'review', '2026-10-01'], // bare weekday includes today
		['review next thursday', 'review', '2026-10-08'],
		['plan next mon', 'plan', '2026-10-12'], // bare mon = 5 Oct, next mon = 12 Oct
		['friday: send invoice', 'send invoice', '2026-10-02'],
		['renew passport sep 12', 'renew passport', '2027-09-12'], // no year -> next occurrence
		['renew passport 12 sep', 'renew passport', '2027-09-12'],
		['dentist oct 5', 'dentist', '2026-10-05'],
		['dentist oct 1', 'dentist', '2026-10-01'], // today counts as the next occurrence
		['dentist sep 30', 'dentist', '2027-09-30'],
		['dinner may 5', 'dinner', '2027-05-05'],
		['dinner 5 may', 'dinner', '2027-05-05'],
		['water plants in 3 days', 'water plants', '2026-10-04'],
		['start course next week', 'start course', '2026-10-08'],
		['dentist tomorrow at 3pm', 'dentist', '2026-10-02'], // time of day ignored
		['report due jan 5', 'report', '2027-01-05'],
		['submit form by friday', 'submit form', '2026-10-02'],
		['taxes 2027-04-15', 'taxes', '2027-04-15']
	])('%s', (input, title, dueDate) => {
		const result = parse(input);
		expect(result.dueDate).toBe(dueDate);
		expect(result.title).toBe(title);
	});

	it('uses only the last of several dates', () => {
		expect(parse('call mom tomorrow and friday').dueDate).toBe('2026-10-02');
		expect(parse('move dentist tomorrow or next wed').dueDate).toBe('2026-10-14');
	});

	it('keeps the original text when stripping would empty the title', () => {
		expect(parse('tomorrow')).toMatchObject({ title: 'tomorrow', dueDate: '2026-10-02' });
		expect(parse('  next friday ')).toMatchObject({ title: 'next friday', dueDate: '2026-10-09' });
	});
});

describe('false positives get no date and keep their text', () => {
	it.each([
		'call May about rent',
		'buy 2 eggs',
		'read chapter 3',
		'watch 24',
		'meeting at 5',
		'call at 5',
		'book flight to Monday Island',
		'buy sun cream',
		'sat down with Ana',
		'wed invitations',
		'plan march trip',
		'fix 3/10 bug',
		'do it now',
		'review last friday notes',
		'file jan 5 2020 taxes'
	])('%s', (input) => {
		expect(parse(input)).toMatchObject({ title: input, dueDate: null, dateText: null });
	});
});

describe('weekday rules on each day of the week', () => {
	// Sun 27 Sep 2026 .. Sat 3 Oct 2026
	const days = Array.from({ length: 7 }, (_, i) => addDays('2026-09-27', i));
	const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

	for (const today of days) {
		for (const [target, name] of names.entries()) {
			const bare = addDays(today, (target - weekdayOf(today) + 7) % 7);
			it(`on ${names[weekdayOf(today)]}: "${name}" -> ${bare}, "next ${name}" -> +7`, () => {
				expect(parse(`task ${name}`, today).dueDate).toBe(bare);
				expect(parse(`task next ${name}`, today).dueDate).toBe(addDays(bare, 7));
				expect(parse(`task ${name.slice(0, 3)}`, today).dueDate).toBe(bare);
			});
		}
	}
});

describe('#list', () => {
	it('assigns an existing list case-insensitively and strips the tag', () => {
		expect(parse('#work email boss')).toMatchObject({
			title: 'email boss',
			listId: 'work',
			listName: 'Work'
		});
		expect(parse('email boss #WORK').listId).toBe('work');
	});

	it('matches multi-word names typed with hyphens or underscores', () => {
		expect(parse('sketch logo #side-project')).toMatchObject({
			title: 'sketch logo',
			listId: 'side'
		});
		expect(parse('sketch logo #Side_Project').listId).toBe('side');
	});

	it('leaves unknown and archived tags as typed, and never creates lists', () => {
		expect(parse('#nope thing')).toMatchObject({ title: '#nope thing', listId: null });
		expect(parse('clear out #old-stuff')).toMatchObject({
			title: 'clear out #old-stuff',
			listId: null
		});
	});

	it('combines with a date', () => {
		expect(parse('call bank #finance tomorrow')).toMatchObject({
			title: 'call bank',
			listId: 'fin',
			dueDate: '2026-10-02'
		});
	});

	it('never reads a date out of a tag', () => {
		expect(parse('plan #friday-party')).toMatchObject({
			title: 'plan #friday-party',
			dueDate: null
		});
	});

	it('uses the last matching tag and leaves the others in the title', () => {
		expect(parse('#work #finance invoice')).toMatchObject({
			title: '#work invoice',
			listId: 'fin'
		});
	});

	it('keeps the tag in the title if it is the only text', () => {
		expect(parse('#work')).toMatchObject({ title: '#work', listId: 'work' });
	});
});
