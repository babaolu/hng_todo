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
		['plan next mon', 'plan', '2026-10-05'], // the Monday of next week
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
		expect(parse('move dentist tomorrow or next wed').dueDate).toBe('2026-10-07');
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
		'do it now',
		'review last friday notes',
		'file jan 5 2020 taxes'
	])('%s', (input) => {
		expect(parse(input)).toMatchObject({ title: input, dueDate: null, dateText: null });
	});
});

describe('weekday rules on each day of the week', () => {
	// Mon 28 Sep 2026 .. Sun 4 Oct 2026: every day of the week as "today".
	const days = Array.from({ length: 7 }, (_, i) => addDays('2026-09-28', i));
	const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

	/** Found by search, not by the parser's formula: the target day in the Mon-Sun week after today's. */
	function inFollowingWeek(today: string, target: number) {
		let monday = today;
		while (weekdayOf(monday) !== 1) monday = addDays(monday, -1);
		for (let i = 7; i < 14; i++) {
			const day = addDays(monday, i);
			if (weekdayOf(day) === target) return day;
		}
		throw new Error('unreachable');
	}

	for (const today of days) {
		for (const [target, name] of names.entries()) {
			const short = name.slice(0, 3);
			const bare = addDays(today, (target - weekdayOf(today) + 7) % 7);
			const next = inFollowingWeek(today, target);
			it(`on ${names[weekdayOf(today)]}: "${name}" -> ${bare}; next-week forms -> ${next}`, () => {
				expect(parse(`task ${name}`, today).dueDate).toBe(bare);
				expect(parse(`task ${short}`, today).dueDate).toBe(bare);
				for (const phrase of [
					`next ${short}`,
					`next ${name}`,
					`next week ${short}`,
					`next week ${name}`,
					`${name} next week`,
					`${short} next week`,
					`on ${name} next week`
				]) {
					expect(parse(`call bank ${phrase}`, today), phrase).toMatchObject({
						title: 'call bank',
						dueDate: next
					});
				}
			});
		}
	}

	it('matches the examples for Wed 30 Sep 2026', () => {
		const wed = '2026-09-30';
		expect(parse('gym next tue', wed).dueDate).toBe('2026-10-06');
		expect(parse('gym next mon', wed).dueDate).toBe('2026-10-05');
		expect(parse('gym next fri', wed).dueDate).toBe('2026-10-09');
		expect(parse('gym fri', wed).dueDate).toBe('2026-10-02');
		expect(parse('gym next sun', wed).dueDate).toBe('2026-10-11');
		expect(parse('gym next week tue', wed).dueDate).toBe('2026-10-06');
		expect(parse('gym tuesday next week', wed).dueDate).toBe('2026-10-06');
	});

	it('on a Sunday, "next mon" is tomorrow (the next week starts then), same as "mon"', () => {
		const sun = '2026-10-04';
		expect(parse('gym next mon', sun).dueDate).toBe('2026-10-05');
		expect(parse('gym mon', sun).dueDate).toBe('2026-10-05');
		expect(parse('gym next sun', sun).dueDate).toBe('2026-10-11');
	});

	it('leaves "next week" alone as +7 days', () => {
		expect(parse('start course next week', '2026-09-30')).toMatchObject({
			title: 'start course',
			dueDate: '2026-10-07'
		});
	});
});

describe('numeric (slash) dates', () => {
	const WED = '2026-09-30';
	const dmy = (text: string) => parseQuickAdd(text, { today: WED, lists, dateOrder: 'dmy' });
	const mdy = (text: string) => parseQuickAdd(text, { today: WED, lists, dateOrder: 'mdy' });

	it.each([
		// [input, title, dueDate] with day-first order
		['pay rent 3/10', 'pay rent', '2026-10-03'],
		['dentist 15/10', 'dentist', '2026-10-15'],
		['exam 3/10/2027', 'exam', '2027-10-03'],
		['renew 28/2/27', 'renew', '2027-02-28'],
		['pay rent 3/10 #finance', 'pay rent', '2026-10-03'],
		['call bank on 3/10 about the loan', 'call bank about the loan', '2026-10-03'],
		['submit report by 15/10.', 'submit report', '2026-10-15'],
		['dentist 15/10 at 3pm', 'dentist at 3pm', '2026-10-15'],
		['birthday 29/9', 'birthday', '2027-09-29'], // no year: next occurrence, never the past
		['leap day party 29/2', 'leap day party', '2028-02-29']
	])('%s', (input, title, dueDate) => {
		expect(dmy(input)).toMatchObject({ title, dueDate });
	});

	it('reads month first only in mdy mode', () => {
		expect(mdy('pay rent 10/3')).toMatchObject({ title: 'pay rent', dueDate: '2026-10-03' });
		expect(dmy('pay rent 10/3')).toMatchObject({ dueDate: '2027-03-10' });
		expect(mdy('dentist 15/10').dueDate).toBeNull(); // month 15
		expect(mdy('exam 10/3/2027').dueDate).toBe('2027-10-03');
	});

	it.each([
		'1/2 cup flour',
		'add 3/4 tsp salt',
		'24/7 support',
		'open 24/7',
		'50/50 split',
		'rate it 4/5 stars',
		'score 7/10',
		'rated 4/5',
		'fix 3/10 bug', // mid-sentence with no cue: could be a ratio
		'due 31/2', // not a real date
		'task 0/5',
		'task 13/13',
		'exam 3/10/2020', // in the past
		'read pages 3-10', // dash and dot forms are never dates
		'upgrade to 3.10',
		'costs 5.99'
	])('%s gets no date', (input) => {
		expect(dmy(input)).toMatchObject({ title: input, dueDate: null });
		expect(mdy(input).dueDate).toBeNull();
	});
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

describe('repeats (at the end of the text only)', () => {
	// TODAY is Thu 1 Oct 2026.
	it.each([
		// [input, title, wording, first due]
		['task daily', 'task', 'Every day', '2026-10-01'],
		['task every day', 'task', 'Every day', '2026-10-01'],
		['task weekdays', 'task', 'Weekdays', '2026-10-01'],
		['task every weekday', 'task', 'Weekdays', '2026-10-01'],
		['task every mon', 'task', 'Every Mon', '2026-10-05'],
		['task every monday', 'task', 'Every Mon', '2026-10-05'],
		['task every mon and thu', 'task', 'Every Mon & Thu', '2026-10-01'],
		['task every monday, thursday', 'task', 'Every Mon & Thu', '2026-10-01'],
		['task every sat & sun', 'task', 'Every Sat & Sun', '2026-10-03'],
		['task weekly', 'task', 'Every Thu', '2026-10-01'], // anchored to the first due date
		['task every week', 'task', 'Every Thu', '2026-10-01'],
		['task every 2 weeks', 'task', 'Every 2 weeks on Thu', '2026-10-01'],
		['task every 2 weeks on fri', 'task', 'Every 2 weeks on Fri', '2026-10-02'],
		['task every 3 days', 'task', 'Every 3 days', '2026-10-01'],
		['task monthly', 'task', 'Monthly on the 1st', '2026-10-01'],
		['task every month', 'task', 'Monthly on the 1st', '2026-10-01'],
		['task every month on the 15th', 'task', 'Monthly on the 15th', '2026-10-15'],
		['task monthly on the 1st', 'task', 'Monthly on the 1st', '2026-10-01'],
		['task monthly on the 31st', 'task', 'Monthly on the 31st', '2026-10-31'],
		['task monthly on the last day', 'task', 'Monthly on the last day', '2026-10-31'],
		['task every 3 months', 'task', 'Every 3 months on the 1st', '2026-10-01'],
		['task yearly', 'task', 'Every year on 1 Oct', '2026-10-01'],
		['task every year', 'task', 'Every year on 1 Oct', '2026-10-01'],
		['task annually', 'task', 'Every year on 1 Oct', '2026-10-01'],
		// the brief's must-repeat examples
		['standup daily', 'standup', 'Every day', '2026-10-01'],
		['water plants every 3 days', 'water plants', 'Every 3 days', '2026-10-01'],
		['pay rent monthly on the 1st', 'pay rent', 'Monthly on the 1st', '2026-10-01'],
		['review budget weekly', 'review budget', 'Every Thu', '2026-10-01'],
		['standup daily.', 'standup', 'Every day', '2026-10-01'] // trailing punctuation
	])('%s', (input, title, wording, dueDate) => {
		expect(parse(input)).toMatchObject({ title, repeatText: wording, dueDate });
	});

	it('works before #tags', () => {
		expect(parse('gym every mon and thu #work')).toMatchObject({
			title: 'gym',
			listId: 'work',
			repeatText: 'Every Mon & Thu',
			dueDate: '2026-10-01'
		});
		// an unknown tag stays in the title; the repeat is still found
		expect(parse('gym every mon and thu #health')).toMatchObject({
			title: 'gym #health',
			repeatText: 'Every Mon & Thu'
		});
	});

	it('starts from an explicit date, which also anchors "weekly" / "monthly"', () => {
		expect(parse('pay rent 15/10 monthly')).toMatchObject({
			title: 'pay rent',
			repeatText: 'Monthly on the 15th',
			dueDate: '2026-10-15'
		});
		expect(parse('gym fri weekly')).toMatchObject({
			title: 'gym',
			repeatText: 'Every Fri',
			dueDate: '2026-10-02'
		});
		expect(parse('sync next tue every week')).toMatchObject({
			title: 'sync',
			repeatText: 'Every Tue',
			dueDate: '2026-10-06'
		});
		// explicit weekdays: the first matching day on or after the date
		expect(parse('gym next wed every mon and thu')).toMatchObject({ dueDate: '2026-10-08' });
	});

	it('stores the anchor and specifics in the rule', () => {
		expect(parse('task every 2 weeks on fri').repeat).toEqual({
			freq: 'weekly',
			interval: 2,
			weekdays: [5],
			anchor: '2026-10-01'
		});
		expect(parse('task monthly on the last day').repeat).toEqual({
			freq: 'monthly',
			interval: 1,
			monthDay: -1,
			anchor: '2026-10-01'
		});
	});

	it('a picked date moves the first occurrence and keeps the rule', () => {
		const picked = (text: string, pickedDate: string) =>
			parseQuickAdd(text, { today: TODAY, lists, pickedDate });
		expect(picked('gym every mon', '2026-10-14')).toMatchObject({
			repeatText: 'Every Mon',
			dueDate: '2026-10-19'
		});
		expect(picked('pay rent monthly', '2026-10-20')).toMatchObject({
			repeatText: 'Monthly on the 20th',
			dueDate: '2026-10-20'
		});
		expect(picked('dentist tomorrow', '2026-11-03')).toMatchObject({
			title: 'dentist',
			dueDate: '2026-11-03',
			repeat: null
		});
	});

	it.each([
		'read every chapter',
		'check every page',
		'review the weekly report',
		'print monthly statement',
		'daily standup notes doc',
		'every day is a gift, write it down',
		'task every 0 days'
	])('%s does not repeat', (input) => {
		expect(parse(input)).toMatchObject({ title: input, repeat: null, repeatText: null });
	});
});
