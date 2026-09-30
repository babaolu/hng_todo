/**
 * Repeat rules for recurring tasks. Pure and shared (the quick-add preview and
 * the detail panel use it in the browser). All dates are 'YYYY-MM-DD' strings,
 * handled through ./dates.
 *
 * A rule describes a fixed grid of occurrence dates:
 * - daily:   every `interval` days, counted from `anchor`
 * - weekly:  on `weekdays` (ISO: 1 = Mon … 7 = Sun), in every `interval`-th week
 *            counted from the week (Mon-Sun) containing `anchor`
 * - monthly: on `monthDay` (1-31, or -1 for the last day), every `interval`-th
 *            month from `anchor`'s month. A day the month doesn't have (the 31st
 *            in April) falls on its last day; the rule itself keeps the 31st.
 * - yearly:  on `month`/`monthDay` every `interval`-th year from `anchor`'s year
 *            (29 Feb falls on 28 Feb in other years).
 */
import { addDays, daysBetween, fromParts, isDateString, weekdayOf } from './dates';

export type RepeatRule =
	| { freq: 'daily'; interval: number; anchor: string }
	| { freq: 'weekly'; interval: number; weekdays: number[]; anchor: string }
	| { freq: 'monthly'; interval: number; monthDay: number; anchor: string }
	| { freq: 'yearly'; interval: number; month: number; monthDay: number; anchor: string };

export type Freq = RepeatRule['freq'];

export const MAX_INTERVAL = 99;
/** monthDay value meaning "the last day of the month". */
export const LAST_DAY = -1;

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

const isInt = (v: unknown, min: number, max: number): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/**
 * The one validator for repeat rules: everything read from or written to the
 * database goes through it (see the repeat_rule column type in db/schema.ts).
 * Returns a clean copy, or null for anything that isn't exactly a valid rule.
 */
export function parseRule(value: unknown): RepeatRule | null {
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const v = value as Record<string, unknown>;
	if (!isInt(v.interval, 1, MAX_INTERVAL) || !isDateString(v.anchor)) return null;
	const { interval, anchor } = v;

	switch (v.freq) {
		case 'daily':
			return { freq: 'daily', interval, anchor };
		case 'weekly': {
			if (!Array.isArray(v.weekdays) || v.weekdays.length === 0) return null;
			if (!v.weekdays.every((d) => isInt(d, 1, 7))) return null;
			const weekdays = [...new Set(v.weekdays as number[])].sort((a, b) => a - b);
			return { freq: 'weekly', interval, weekdays, anchor };
		}
		case 'monthly':
			if (!(isInt(v.monthDay, 1, 31) || v.monthDay === LAST_DAY)) return null;
			return { freq: 'monthly', interval, monthDay: v.monthDay as number, anchor };
		case 'yearly':
			if (!isInt(v.month, 1, 12) || !isInt(v.monthDay, 1, 31)) return null;
			if (v.monthDay > daysInMonth(2000, v.month)) return null; // no 30 Feb (2000 is a leap year)
			return { freq: 'yearly', interval, month: v.month, monthDay: v.monthDay, anchor };
		default:
			return null;
	}
}

// ---------- calendar helpers ----------

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (date: string) => ((weekdayOf(date) + 6) % 7) + 1;

const parts = (date: string) => date.split('-').map(Number) as [number, number, number];

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `day` in that month, or its last day when the month is shorter; -1 = last day. */
function clampDay(year: number, month: number, day: number): string {
	const last = daysInMonth(year, month);
	return fromParts(year, month, day === LAST_DAY ? last : Math.min(day, last));
}

const mondayOf = (date: string) => addDays(date, 1 - isoWeekday(date));
const mod = (n: number, m: number) => ((n % m) + m) % m;

// ---------- occurrences ----------

/** The first occurrence on or after `from`. */
export function firstOccurrence(rule: RepeatRule, from: string): string {
	switch (rule.freq) {
		case 'daily': {
			const offset = mod(daysBetween(rule.anchor, from), rule.interval);
			return offset === 0 ? from : addDays(from, rule.interval - offset);
		}
		case 'weekly': {
			const anchorWeek = mondayOf(rule.anchor);
			// At most `interval` weeks until the next week on the grid, then up to 7 days in it.
			for (let i = 0; i < 7 * (rule.interval + 1); i++) {
				const day = addDays(from, i);
				const weeks = daysBetween(anchorWeek, mondayOf(day)) / 7;
				if (mod(weeks, rule.interval) === 0 && rule.weekdays.includes(isoWeekday(day))) return day;
			}
			throw new Error('unreachable: weekly rule without a matching day');
		}
		case 'monthly': {
			const [ay, am] = parts(rule.anchor);
			let [y, m] = parts(from);
			for (let i = 0; i <= 2 * rule.interval + 1; i++) {
				const months = y * 12 + m - (ay * 12 + am);
				if (mod(months, rule.interval) === 0) {
					const day = clampDay(y, m, rule.monthDay);
					if (day >= from) return day;
				}
				[y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
			}
			throw new Error('unreachable: monthly rule');
		}
		case 'yearly': {
			const [ay] = parts(rule.anchor);
			let [y] = parts(from);
			for (let i = 0; i <= 2 * rule.interval + 1; i++, y++) {
				if (mod(y - ay, rule.interval) === 0) {
					const day = clampDay(y, rule.month, rule.monthDay);
					if (day >= from) return day;
				}
			}
			throw new Error('unreachable: yearly rule');
		}
	}
}

/** The first occurrence strictly after `after`. */
export function nextOccurrence(rule: RepeatRule, after: string): string {
	return firstOccurrence(rule, addDays(after, 1));
}

/**
 * When a recurring task is completed: missed occurrences are skipped, so the next
 * one is the first strictly after the later of its due date and today.
 */
export function nextAfterCompletion(rule: RepeatRule, dueDate: string, today: string): string {
	return nextOccurrence(rule, dueDate > today ? dueDate : today);
}

/**
 * A rule's missing specifics (weekday, day of month, month) come from `start`,
 * which also becomes the anchor of its grid: "weekly" started on a Friday means
 * every Friday. Returns the complete rule.
 */
export function anchorRule(
	rule: { freq: Freq; interval: number; weekdays?: number[]; monthDay?: number; month?: number },
	start: string
): RepeatRule {
	const [, month, day] = parts(start);
	switch (rule.freq) {
		case 'daily':
			return { freq: 'daily', interval: rule.interval, anchor: start };
		case 'weekly':
			return {
				freq: 'weekly',
				interval: rule.interval,
				weekdays: rule.weekdays?.length ? rule.weekdays : [isoWeekday(start)],
				anchor: start
			};
		case 'monthly':
			return {
				freq: 'monthly',
				interval: rule.interval,
				monthDay: rule.monthDay ?? day,
				anchor: start
			};
		case 'yearly':
			return {
				freq: 'yearly',
				interval: rule.interval,
				month: rule.month ?? month,
				monthDay: rule.monthDay ?? day,
				anchor: start
			};
	}
}

// ---------- wording ----------

function list(items: string[]): string {
	return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} & ${items.at(-1)}`;
}

function ordinal(n: number): string {
	const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
	return `${n}${suffix}`;
}

/** "Every day", "Weekdays", "Every Mon & Thu", "Every 2 weeks on Fri", "Monthly on the 15th"… */
export function describe(rule: RepeatRule): string {
	const n = rule.interval;
	switch (rule.freq) {
		case 'daily':
			return n === 1 ? 'Every day' : `Every ${n} days`;
		case 'weekly': {
			const days = list(rule.weekdays.map((d) => WEEKDAY_SHORT[d - 1]));
			if (rule.weekdays.join() === '1,2,3,4,5')
				return n === 1 ? 'Weekdays' : `Every ${n} weeks on weekdays`;
			if (rule.weekdays.length === 7) return n === 1 ? 'Every day' : `Every ${n} weeks, every day`;
			return n === 1 ? `Every ${days}` : `Every ${n} weeks on ${days}`;
		}
		case 'monthly': {
			const day = rule.monthDay === LAST_DAY ? 'the last day' : `the ${ordinal(rule.monthDay)}`;
			return n === 1 ? `Monthly on ${day}` : `Every ${n} months on ${day}`;
		}
		case 'yearly': {
			const on = `${rule.monthDay} ${MONTH_SHORT[rule.month - 1]}`;
			return n === 1 ? `Every year on ${on}` : `Every ${n} years on ${on}`;
		}
	}
}

// ---------- the detail panel's form fields ----------

export type RepeatChoice = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

/**
 * Build a rule from the panel's fields (shared by the server action and the
 * client preview). `start` is the date the rule is anchored to. Returns null for
 * "none"; throws on invalid input.
 */
export function ruleFromFields(
	fields: {
		repeat: string;
		interval?: string;
		weekdays?: string[];
		monthDay?: string;
		/** Yearly only: keep this month/day instead of taking them from `start`. */
		month?: string;
		day?: string;
	},
	start: string
): RepeatRule | null {
	const choice = fields.repeat as RepeatChoice;
	if (choice === 'none' || !choice) return null;
	const interval = Number(fields.interval || 1);
	if (!isInt(interval, 1, MAX_INTERVAL)) throw new Error('Interval must be 1-99');
	let rule: RepeatRule;
	switch (choice) {
		case 'daily':
			rule = anchorRule({ freq: 'daily', interval }, start);
			break;
		case 'weekdays':
			rule = anchorRule({ freq: 'weekly', interval, weekdays: [1, 2, 3, 4, 5] }, start);
			break;
		case 'weekly': {
			const weekdays = (fields.weekdays ?? []).map(Number).filter((d) => isInt(d, 1, 7));
			rule = anchorRule({ freq: 'weekly', interval, weekdays }, start);
			break;
		}
		case 'monthly': {
			const raw = fields.monthDay;
			const monthDay = raw === 'last' ? LAST_DAY : raw ? Number(raw) : undefined;
			if (monthDay !== undefined && !(isInt(monthDay, 1, 31) || monthDay === LAST_DAY)) {
				throw new Error('Invalid day of month');
			}
			rule = anchorRule({ freq: 'monthly', interval, monthDay }, start);
			break;
		}
		case 'yearly': {
			const month = fields.month ? Number(fields.month) : undefined;
			const monthDay = fields.day ? Number(fields.day) : undefined;
			rule = anchorRule({ freq: 'yearly', interval, month, monthDay }, start);
			break;
		}
		default:
			throw new Error('Invalid repeat');
	}
	const valid = parseRule(rule);
	if (!valid) throw new Error('Invalid repeat');
	return valid;
}
