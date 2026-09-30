import { describe, expect, it } from 'vitest';
import {
	addDays,
	dayOf,
	daysBetween,
	dueLabel,
	formatDateTime,
	formatDay,
	isDateString,
	isValidTimeZone,
	todayIn,
	weekdayOf
} from './dates';

describe('todayIn', () => {
	it('Africa/Lagos: 00:30 local is already the next day while UTC is still the previous one', () => {
		const now = new Date('2026-10-01T23:30:00Z'); // 00:30 on 2 Oct in Lagos (UTC+1)
		expect(todayIn('UTC', now)).toBe('2026-10-01');
		expect(todayIn('Africa/Lagos', now)).toBe('2026-10-02');
	});

	it('America/New_York across the end of DST (1 Nov 2026, EDT -4 -> EST -5)', () => {
		const at = (iso: string) => todayIn('America/New_York', new Date(iso));
		expect(at('2026-11-01T03:59:00Z')).toBe('2026-10-31'); // 23:59 EDT
		expect(at('2026-11-01T04:00:00Z')).toBe('2026-11-01'); // 00:00 EDT
		expect(at('2026-11-02T04:30:00Z')).toBe('2026-11-01'); // 23:30 EST: an hour later in UTC than a day earlier
		expect(at('2026-11-02T05:00:00Z')).toBe('2026-11-02'); // 00:00 EST
	});

	it('America/New_York across the start of DST (8 Mar 2026, EST -5 -> EDT -4)', () => {
		const at = (iso: string) => todayIn('America/New_York', new Date(iso));
		expect(at('2026-03-08T04:59:00Z')).toBe('2026-03-07'); // 23:59 EST
		expect(at('2026-03-08T05:00:00Z')).toBe('2026-03-08'); // 00:00 EST
		expect(at('2026-03-09T03:59:00Z')).toBe('2026-03-08'); // 23:59 EDT
		expect(at('2026-03-09T04:00:00Z')).toBe('2026-03-09'); // 00:00 EDT
	});

	it('falls back to UTC for an invalid zone', () => {
		expect(todayIn('Mars/Olympus', new Date('2026-10-01T23:30:00Z'))).toBe('2026-10-01');
	});
});

describe('date arithmetic on YYYY-MM-DD', () => {
	it('adds days across month, year, leap day and DST boundaries', () => {
		expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
		expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // US DST ends; irrelevant to days
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
	});

	it('counts days between dates', () => {
		expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14);
		expect(daysBetween('2026-10-15', '2026-10-01')).toBe(-14);
		expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
	});

	it('knows weekdays', () => {
		expect(weekdayOf('2026-10-01')).toBe(4); // Thursday
		expect(weekdayOf('2026-10-04')).toBe(0); // Sunday
	});

	it('validates real calendar dates only', () => {
		expect(isDateString('2026-10-01')).toBe(true);
		expect(isDateString('2028-02-29')).toBe(true);
		expect(isDateString('2026-02-29')).toBe(false);
		expect(isDateString('2026-13-01')).toBe(false);
		expect(isDateString('2026-1-01')).toBe(false);
		expect(isDateString(' 2026-10-01')).toBe(false);
		expect(isDateString(20261001)).toBe(false);
	});

	it('validates IANA zones', () => {
		expect(isValidTimeZone('Africa/Lagos')).toBe(true);
		expect(isValidTimeZone('America/New_York')).toBe(true);
		expect(isValidTimeZone('UTC')).toBe(true);
		expect(isValidTimeZone('Mars/Olympus')).toBe(false);
		expect(isValidTimeZone('')).toBe(false);
		expect(isValidTimeZone('x'.repeat(100))).toBe(false);
	});
});

describe('labels', () => {
	const today = '2026-10-01';
	it('formats days, with the year only when it differs', () => {
		expect(formatDay('2026-10-03', today)).toBe('Sat 3 Oct');
		expect(formatDay('2027-01-05', today)).toBe('Tue 5 Jan 2027');
	});

	it('labels due dates relative to today', () => {
		expect(dueLabel('2026-10-01', today)).toEqual({ text: 'Today', overdue: false });
		expect(dueLabel('2026-10-02', today)).toEqual({ text: 'Tomorrow', overdue: false });
		expect(dueLabel('2026-10-09', today)).toEqual({ text: 'Fri 9 Oct', overdue: false });
		expect(dueLabel('2026-09-30', today)).toEqual({ text: 'Yesterday', overdue: true });
		expect(dueLabel('2026-09-28', today)).toEqual({ text: '3 days ago', overdue: true });
	});
});

describe('fixed formats for instants', () => {
	it('dayOf is the calendar day in the zone', () => {
		const late = new Date('2026-09-30T23:30:00Z'); // 00:30 on 1 Oct in Lagos
		expect(dayOf(late, 'UTC')).toBe('2026-09-30');
		expect(dayOf(late, 'Africa/Lagos')).toBe('2026-10-01');
	});

	it('formatDateTime uses the app format and a 24-hour clock in the zone', () => {
		const at = new Date('2026-09-30T16:58:00Z');
		expect(formatDateTime(at, 'Africa/Lagos', '2026-09-30')).toBe('Wed 30 Sep, 17:58');
		expect(formatDateTime(at, 'America/New_York', '2026-09-30')).toBe('Wed 30 Sep, 12:58');
		expect(formatDateTime(at, 'Africa/Lagos', '2027-01-01')).toBe('Wed 30 Sep 2026, 17:58');
	});
});
