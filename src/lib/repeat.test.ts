import { describe as group, expect, it } from 'vitest';
import { addDays } from './dates';
import {
	anchorRule,
	describe,
	firstOccurrence,
	LAST_DAY,
	nextAfterCompletion,
	nextOccurrence,
	parseRule,
	ruleFromFields,
	type RepeatRule
} from './repeat';

const daily = (interval: number, anchor = '2026-10-01'): RepeatRule => ({
	freq: 'daily',
	interval,
	anchor
});
const weekly = (weekdays: number[], interval = 1, anchor = '2026-09-28'): RepeatRule => ({
	freq: 'weekly',
	interval,
	weekdays,
	anchor
});
const monthly = (monthDay: number, interval = 1, anchor = '2026-01-31'): RepeatRule => ({
	freq: 'monthly',
	interval,
	monthDay,
	anchor
});
const yearly = (
	month: number,
	monthDay: number,
	interval = 1,
	anchor = '2024-02-29'
): RepeatRule => ({
	freq: 'yearly',
	interval,
	month,
	monthDay,
	anchor
});

/** The first n occurrences on or after `from`. */
function series(rule: RepeatRule, from: string, n: number) {
	const out = [firstOccurrence(rule, from)];
	while (out.length < n) out.push(nextOccurrence(rule, out.at(-1)!));
	return out;
}

group('daily', () => {
	it.each([
		[1, '2026-10-01', ['2026-10-01', '2026-10-02', '2026-10-03']],
		[3, '2026-10-01', ['2026-10-01', '2026-10-04', '2026-10-07']],
		[3, '2026-10-02', ['2026-10-04', '2026-10-07', '2026-10-10']], // off-grid start snaps forward
		[2, '2026-12-31', ['2027-01-01', '2027-01-03', '2027-01-05']] // 31 Dec is off the 2-day grid from 1 Oct
	])('every %i days from %s', (interval, from, expected) => {
		expect(series(daily(interval), from, 3)).toEqual(expected);
	});
});

group('weekly', () => {
	// 2026-09-28 is a Monday.
	it.each([
		['every Mon', [1], 1, '2026-09-28', ['2026-09-28', '2026-10-05', '2026-10-12']],
		[
			'Mon & Thu',
			[1, 4],
			1,
			'2026-09-29',
			['2026-10-01', '2026-10-05', '2026-10-08', '2026-10-12']
		],
		['weekdays', [1, 2, 3, 4, 5], 1, '2026-10-02', ['2026-10-02', '2026-10-05', '2026-10-06']],
		['Sat & Sun', [6, 7], 1, '2026-09-28', ['2026-10-03', '2026-10-04', '2026-10-10']],
		['every 2 weeks on Fri', [5], 2, '2026-09-28', ['2026-10-02', '2026-10-16', '2026-10-30']],
		// the grid week is the anchor's; starting in an off week jumps to the next on-grid week
		['every 2 weeks on Fri, off week', [5], 2, '2026-10-05', ['2026-10-16', '2026-10-30']],
		[
			'every 3 weeks on Mon & Wed',
			[1, 3],
			3,
			'2026-09-28',
			['2026-09-28', '2026-09-30', '2026-10-19', '2026-10-21']
		]
	])('%s', (_, days, interval, from, expected) => {
		expect(series(weekly(days, interval), from, expected.length)).toEqual(expected);
	});
});

group('monthly: month-end anchors across a whole year', () => {
	it('on the 31st: the last day of shorter months, back to the 31st when it exists', () => {
		expect(series(monthly(31), '2026-01-01', 12)).toEqual([
			'2026-01-31',
			'2026-02-28',
			'2026-03-31',
			'2026-04-30',
			'2026-05-31',
			'2026-06-30',
			'2026-07-31',
			'2026-08-31',
			'2026-09-30',
			'2026-10-31',
			'2026-11-30',
			'2026-12-31'
		]);
	});

	it('on the 31st in a leap year: 29 Feb', () => {
		expect(series(monthly(31, 1, '2028-01-31'), '2028-01-31', 3)).toEqual([
			'2028-01-31',
			'2028-02-29',
			'2028-03-31'
		]);
	});

	it('on the 30th: 28 Feb, then the 30th again', () => {
		expect(series(monthly(30), '2026-01-01', 4)).toEqual([
			'2026-01-30',
			'2026-02-28',
			'2026-03-30',
			'2026-04-30'
		]);
	});

	it('the last day', () => {
		expect(series(monthly(LAST_DAY), '2026-01-01', 4)).toEqual([
			'2026-01-31',
			'2026-02-28',
			'2026-03-31',
			'2026-04-30'
		]);
	});

	it('on the 15th, every 2 months, stays on the anchor grid', () => {
		expect(series(monthly(15, 2, '2026-01-15'), '2026-02-01', 3)).toEqual([
			'2026-03-15',
			'2026-05-15',
			'2026-07-15'
		]);
	});

	it('every 3 months on the 31st keeps its anchor through short months', () => {
		expect(series(monthly(31, 3, '2026-01-31'), '2026-01-31', 4)).toEqual([
			'2026-01-31',
			'2026-04-30',
			'2026-07-31',
			'2026-10-31'
		]);
	});
});

group('yearly', () => {
	it('on 29 Feb: 28 Feb in non-leap years, 29 Feb in leap years', () => {
		expect(series(yearly(2, 29), '2025-01-01', 5)).toEqual([
			'2025-02-28',
			'2026-02-28',
			'2027-02-28',
			'2028-02-29',
			'2029-02-28'
		]);
	});

	it('every 2 years on 3 Oct, on the anchor grid', () => {
		expect(series(yearly(10, 3, 2, '2026-10-03'), '2027-01-01', 2)).toEqual([
			'2028-10-03',
			'2030-10-03'
		]);
	});
});

group('completion: next = first occurrence strictly after max(due, today)', () => {
	const mon = weekly([1]); // every Monday
	it.each([
		// [label, due, today, next]
		['on the occurrence day itself', '2026-10-05', '2026-10-05', '2026-10-12'],
		['early: due tomorrow, done today', '2026-10-06', '2026-10-05', '2026-10-13'],
		['two weeks late: one future date, no catch-up', '2026-09-21', '2026-10-07', '2026-10-12'],
		[
			'late, finished on an occurrence day: the next one after today',
			'2026-09-21',
			'2026-10-05',
			'2026-10-12'
		]
	])('%s', (_, due, today, next) => {
		const rule = due === '2026-10-06' ? weekly([2]) : mon;
		expect(nextAfterCompletion(rule, due, today)).toBe(next);
	});

	it('intervals stay on their grid after skipping missed occurrences', () => {
		const every2Fri = weekly([5], 2, '2026-10-02'); // Fri 2, 16, 30 Oct …
		expect(nextAfterCompletion(every2Fri, '2026-10-02', '2026-10-20')).toBe('2026-10-30');
		const every3Days = daily(3, '2026-10-01'); // 1, 4, 7, 10 …
		expect(nextAfterCompletion(every3Days, '2026-10-01', '2026-10-08')).toBe('2026-10-10');
		const quarterly31 = monthly(31, 3, '2026-01-31');
		expect(nextAfterCompletion(quarterly31, '2026-01-31', '2026-06-01')).toBe('2026-07-31');
	});
});

group('describe', () => {
	it.each([
		[daily(1), 'Every day'],
		[daily(3), 'Every 3 days'],
		[weekly([1, 2, 3, 4, 5]), 'Weekdays'],
		[weekly([1, 4]), 'Every Mon & Thu'],
		[weekly([1, 3, 5]), 'Every Mon, Wed & Fri'],
		[weekly([5], 2), 'Every 2 weeks on Fri'],
		[weekly([7]), 'Every Sun'],
		[monthly(15), 'Monthly on the 15th'],
		[monthly(1), 'Monthly on the 1st'],
		[monthly(22), 'Monthly on the 22nd'],
		[monthly(13), 'Monthly on the 13th'],
		[monthly(LAST_DAY), 'Monthly on the last day'],
		[monthly(31, 3), 'Every 3 months on the 31st'],
		[yearly(10, 3), 'Every year on 3 Oct'],
		[yearly(2, 29, 2), 'Every 2 years on 29 Feb']
	])('%j -> %s', (rule, text) => {
		expect(describe(rule)).toBe(text);
	});
});

group('parseRule validates everything', () => {
	it('accepts valid rules and normalises weekdays', () => {
		expect(
			parseRule({ freq: 'weekly', interval: 1, weekdays: [4, 1, 4], anchor: '2026-10-01' })
		).toEqual({
			freq: 'weekly',
			interval: 1,
			weekdays: [1, 4],
			anchor: '2026-10-01'
		});
		expect(parseRule(JSON.stringify(daily(2)))).toEqual(daily(2));
		expect(parseRule(monthly(LAST_DAY))).toEqual(monthly(LAST_DAY));
		expect(parseRule(yearly(2, 29))).toEqual(yearly(2, 29));
	});

	it('drops unknown fields', () => {
		expect(parseRule({ ...daily(1), evil: '<script>' })).toEqual(daily(1));
	});

	it.each([
		null,
		'not json',
		[],
		{ freq: 'hourly', interval: 1, anchor: '2026-10-01' },
		{ freq: 'daily', interval: 0, anchor: '2026-10-01' },
		{ freq: 'daily', interval: 100, anchor: '2026-10-01' },
		{ freq: 'daily', interval: 1.5, anchor: '2026-10-01' },
		{ freq: 'daily', interval: 1, anchor: '2026-02-30' },
		{ freq: 'daily', interval: '1', anchor: '2026-10-01' },
		{ freq: 'weekly', interval: 1, weekdays: [], anchor: '2026-10-01' },
		{ freq: 'weekly', interval: 1, weekdays: [0], anchor: '2026-10-01' },
		{ freq: 'weekly', interval: 1, weekdays: [8], anchor: '2026-10-01' },
		{ freq: 'monthly', interval: 1, monthDay: 0, anchor: '2026-10-01' },
		{ freq: 'monthly', interval: 1, monthDay: 32, anchor: '2026-10-01' },
		{ freq: 'yearly', interval: 1, month: 2, monthDay: 30, anchor: '2026-10-01' },
		{ freq: 'yearly', interval: 1, month: 13, monthDay: 1, anchor: '2026-10-01' }
	])('rejects %j', (value) => {
		expect(parseRule(value)).toBeNull();
	});
});

group('anchoring and the panel fields', () => {
	it('fills missing specifics from the start date', () => {
		expect(anchorRule({ freq: 'weekly', interval: 1 }, '2026-10-02')).toEqual(
			weekly([5], 1, '2026-10-02')
		);
		expect(anchorRule({ freq: 'monthly', interval: 1 }, '2026-10-15')).toEqual(
			monthly(15, 1, '2026-10-15')
		);
		expect(anchorRule({ freq: 'yearly', interval: 1 }, '2026-10-03')).toEqual(
			yearly(10, 3, 1, '2026-10-03')
		);
	});

	it('builds rules from the panel fields', () => {
		const start = '2026-10-01';
		expect(ruleFromFields({ repeat: 'none' }, start)).toBeNull();
		expect(ruleFromFields({ repeat: 'daily', interval: '2' }, start)).toEqual(daily(2, start));
		expect(ruleFromFields({ repeat: 'weekdays' }, start)).toEqual(
			weekly([1, 2, 3, 4, 5], 1, start)
		);
		expect(ruleFromFields({ repeat: 'weekly', weekdays: ['4', '1'] }, start)).toEqual(
			weekly([1, 4], 1, start)
		);
		expect(ruleFromFields({ repeat: 'weekly', weekdays: [] }, start)).toEqual(
			weekly([4], 1, start)
		);
		expect(ruleFromFields({ repeat: 'monthly', monthDay: 'last' }, start)).toEqual(
			monthly(LAST_DAY, 1, start)
		);
		expect(() => ruleFromFields({ repeat: 'daily', interval: '0' }, start)).toThrow();
		expect(() => ruleFromFields({ repeat: 'hourly' }, start)).toThrow();
		expect(addDays(start, 0)).toBe(start);
	});
});
