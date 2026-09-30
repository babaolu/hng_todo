/**
 * Calendar days as 'YYYY-MM-DD' strings. Due dates are days, not instants, so
 * arithmetic is done on UTC midnights purely as a counting device: it never
 * depends on the server's or browser's zone. The only zone-aware function is
 * `todayIn`, which says which day it currently is for a given IANA zone.
 *
 * Shared by server and client (quick-add preview, due labels). Use these
 * instead of ad hoc Date math.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A real calendar date in 'YYYY-MM-DD' form (rejects 2026-02-30). */
export function isDateString(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const m = DATE.exec(value);
	return !!m && fromParts(+m[1], +m[2], +m[3]) === value;
}

export function fromParts(year: number, month: number, day: number): string {
	return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function toUtc(date: string): number {
	const m = DATE.exec(date);
	if (!m) throw new Error(`Not a date: ${date}`);
	return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

export function addDays(date: string, days: number): string {
	return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
	return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
	return new Date(toUtc(date)).getUTCDay();
}

export function isValidTimeZone(zone: unknown): zone is string {
	if (typeof zone !== 'string' || zone.length === 0 || zone.length > 64) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/** The calendar day it is right now (or at `now`) in an IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: isValidTimeZone(timeZone) ? timeZone : 'UTC',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric'
	}).formatToParts(now);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	return fromParts(get('year'), get('month'), get('day'));
}

/** The calendar day an instant falls on in a time zone (e.g. when a task was completed). */
export function dayOf(instant: Date, timeZone: string): string {
	return todayIn(timeZone, instant);
}

/**
 * An instant in the app's fixed format, in the user's zone: "Wed 30 Sep, 17:58".
 * The only way dates with times are shown: never the browser's own locale format.
 */
export function formatDateTime(instant: Date, timeZone: string, today: string): string {
	const time = new Intl.DateTimeFormat('en-GB', {
		timeZone: isValidTimeZone(timeZone) ? timeZone : 'UTC',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(instant);
	return `${formatDay(dayOf(instant, timeZone), today)}, ${time}`;
}

/** "Fri 3 Oct", plus the year when it isn't the same year as `today`. */
export function formatDay(date: string, today: string): string {
	const d = new Date(toUtc(date));
	const label = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
	return date.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${date.slice(0, 4)}`;
}

/** A due date relative to today: "Today", "Tomorrow", "Fri 3 Oct", or quiet overdue text. */
export function dueLabel(date: string, today: string): { text: string; overdue: boolean } {
	const diff = daysBetween(today, date);
	if (diff === 0) return { text: 'Today', overdue: false };
	if (diff === 1) return { text: 'Tomorrow', overdue: false };
	if (diff === -1) return { text: 'Yesterday', overdue: true };
	if (diff < 0) return { text: `${-diff} days ago`, overdue: true };
	return { text: formatDay(date, today), overdue: false };
}
