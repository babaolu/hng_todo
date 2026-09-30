/**
 * Natural-language quick-add: "pay rent friday #home" -> title "pay rent",
 * due Friday, list Home. Pure and shared: the client runs it for the live
 * preview, and the server re-runs it on the raw text as the source of truth.
 *
 * Dates come from three sources, and the last date in the text wins:
 * 1. "next <weekday>" phrases (own rule, below),
 * 2. slash dates like 3/10 (own rule, below),
 * 3. everything else via chrono-node ("tomorrow", "sep 12", "in 3 days", "fri").
 */
import * as chrono from 'chrono-node/en';
import { addDays, fromParts, isDateString, weekdayOf } from './dates';

export type QuickAddList = { id: string; name: string; archived?: boolean };

/** Order of day and month in slash dates: day-first unless the user's locale is en-US. */
export type DateOrder = 'dmy' | 'mdy';

export type QuickAdd = {
	title: string;
	/** 'YYYY-MM-DD', or null when no date was found. */
	dueDate: string | null;
	/** The phrase the date came from, e.g. "next fri". */
	dateText: string | null;
	listId: string | null;
	listName: string | null;
};

type Span = { start: number; end: number };
type Candidate = Span & { dueDate: string; text: string };

const WEEKDAY =
	'(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
const WEEKDAY_WORD = new RegExp(`\\b${WEEKDAY}\\b`, 'i');
const DAY_INDEX: Record<string, number> = {
	sun: 0,
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6
};
const FULL_WEEKDAYS = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday'
];

/**
 * "next tue", "next week tue", "tue next week" (optionally with "on"): that
 * weekday in the following calendar week, weeks starting Monday. Longer forms
 * first so "next week tue" isn't read as "next week" + "tue".
 */
const NEXT_WEEK_PATTERNS = [
	new RegExp(`\\b(?:on\\s+)?next\\s+week\\s+(?:on\\s+)?${WEEKDAY}\\b`, 'gi'),
	new RegExp(`\\b(?:on\\s+)?${WEEKDAY}\\s+(?:of\\s+)?next\\s+week\\b`, 'gi'),
	new RegExp(`\\b(?:on\\s+)?next\\s+${WEEKDAY}\\b`, 'gi')
];

/*
 * Slash dates: d/m, d/m/yy, d/m/yyyy (m/d/… when the order is mdy). Dash and
 * dot forms (3-10, 3.10) are never dates: too often ranges, versions, prices.
 *
 * The rule, which keeps "1/2 cup flour", "add 3/4 tsp salt", "24/7 support",
 * "50/50 split", "rate it 4/5 stars" and "score 7/10" dateless while "pay rent
 * 3/10", "dentist 15/10", "exam 3/10/2027" and "renew 28/2/27" get a date:
 *
 * - It must be a real calendar date in the chosen order (50/50, 31/2, 13/13 aren't).
 * - With a year, that's enough: nobody writes a fraction with two slashes.
 * - Without a year it's a date only when it reads like one:
 *   - after a cue ("on 3/10", "by 15/10", "due 3/10"), or
 *   - at the end of the task (ignoring #tags, punctuation and a trailing time
 *     like "at 3pm"), unless the word before it is about scores or odds
 *     ("score 7/10", "rated 4/5"). Fractions and ratios are followed by what
 *     they measure ("1/2 cup", "4/5 stars"), dates usually end the task.
 *   - "24/7" is an idiom, never a date.
 * - No year means the next occurrence, never the past.
 */
const SLASH_DATE = /(?<![\w/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\w/])/g;
const DATE_CUE = /\b(on|by|due|until|till|before|from)\s+$/i;
const SCORE_WORD =
	/\b(score[sd]?|rat(?:e|ed|ing)|rank(?:ed)?|grade[sd]?|marks?|votes?|ratio|odds|split|got|gave)\s+$/i;
const TRAILING_TIME = /^\s*(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*$/i;
const IDIOMS = new Set(['24/7', '24/365']);

/** Ambiguous numeric forms chrono might still find (3-10, 3.10, 3/10): never from chrono. */
const CHRONO_NUMERIC = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/;
/** Words that make an abbreviated weekday clearly a date ("by fri"). */
const WEEKDAY_CUE = /\b(next|this|on|by|due|until|before)\s+$/i;
/** Connectors left dangling once a trailing date is removed ("report due", "rent by"). */
const TRAILING_CONNECTOR = /\s+(on|by|due|for|until|before)\s*$/i;
const TAG = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

const normalizeName = (name: string) =>
	name.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

const blank = (text: string, span: Span) =>
	text.slice(0, span.start) + ' '.repeat(span.end - span.start) + text.slice(span.end);

export function parseQuickAdd(
	text: string,
	{
		today,
		lists,
		dateOrder = 'dmy'
	}: { today: string; lists: QuickAddList[]; dateOrder?: DateOrder }
): QuickAdd {
	// 1. #tags. The last one naming an active list wins; unmatched tags stay as typed.
	const byName = new Map<string, QuickAddList>();
	for (const list of lists) {
		const key = normalizeName(list.name);
		if (!list.archived && !byName.has(key)) byName.set(key, list);
	}
	const tags: (Span & { list?: QuickAddList })[] = [];
	for (const m of text.matchAll(TAG)) {
		const start = m.index + m[1].length;
		tags.push({ start, end: start + 1 + m[2].length, list: byName.get(normalizeName(m[2])) });
	}
	const tag = tags.findLast((t) => t.list);

	// 2. Dates, with every tag blanked out so "#friday-party" is never a date.
	let masked = text;
	for (const t of tags) masked = blank(masked, t);
	const date = findDate(masked, today, dateOrder);

	// 3. Title: remove the date phrase and the matched tag.
	const remove: Span[] = [];
	if (date) remove.push(date);
	if (tag) remove.push(tag);
	let title = text;
	for (const span of remove.sort((a, b) => b.start - a.start)) {
		title = title.slice(0, span.start) + ' ' + title.slice(span.end);
	}
	title = collapse(title)
		.replace(/\s+([.,;:!?])+$/, '') // "submit report by 15/10." leaves a stray " ."
		.replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '');
	if (!title) title = collapse(text);

	return {
		title,
		dueDate: date?.dueDate ?? null,
		dateText: date?.text ?? null,
		listId: tag?.list?.id ?? null,
		listName: tag?.list?.name ?? null
	};
}

function findDate(masked: string, today: string, order: DateOrder): Candidate | null {
	const candidates: Candidate[] = [];

	// Slash dates: our rule, not chrono's (which is always month-first).
	for (const m of masked.matchAll(SLASH_DATE)) {
		const span = { start: m.index, end: m.index + m[0].length };
		const dueDate = slashDate(m, masked, span, today, order);
		if (dueDate) {
			// "on 3/10", "by 15/10": the cue goes with the date.
			const cue = DATE_CUE.exec(masked.slice(0, span.start));
			const start = cue ? cue.index : span.start;
			candidates.push({ start, end: span.end, dueDate, text: masked.slice(start, span.end) });
		}
		masked = blank(masked, span);
	}

	// "next tue" / "next week tue" / "tue next week".
	for (const pattern of NEXT_WEEK_PATTERNS) {
		for (const m of masked.matchAll(pattern)) {
			const span = { start: m.index, end: m.index + m[0].length };
			const after = masked.slice(span.end);
			// "next Monday Island": a capitalised weekday before another capitalised word is a name.
			if (/^[A-Z]/.test(m[1]) && /^\s+[A-Z]/.test(after)) continue;
			candidates.push({ ...span, dueDate: inNextWeek(today, dayIndex(m[1])), text: m[0] });
			masked = blank(masked, span);
		}
	}

	// Everything else. Local noon on `today`: only calendar components are read
	// back, so the process's own time zone never shifts the result.
	const [y, mo, d] = today.split('-').map(Number);
	const results = chrono.casual.parse(masked, new Date(y, mo - 1, d, 12), { forwardDate: true });
	for (const result of results) {
		const dueDate = resolve(result, masked, today);
		if (!dueDate) continue;
		const start = result.index + (result.text.length - result.text.trimStart().length);
		candidates.push({
			start,
			end: start + result.text.trim().length,
			dueDate,
			text: result.text.trim()
		});
	}

	const last = candidates.filter((c) => c.dueDate >= today).sort((a, b) => b.start - a.start)[0];
	if (!last) return null;

	// "report due jan 5" -> "report": drop a connector left dangling at the end.
	if (!masked.slice(last.end).trim()) {
		const connector = TRAILING_CONNECTOR.exec(masked.slice(0, last.start));
		if (connector) return { ...last, start: connector.index };
	}
	return last;
}

const dayIndex = (word: string) => DAY_INDEX[word.slice(0, 3).toLowerCase()];

/** The given weekday (0 = Sunday) in the calendar week after this one; weeks start Monday. */
export function inNextWeek(today: string, weekday: number): string {
	const sinceMonday = (weekdayOf(today) + 6) % 7;
	const nextMonday = addDays(today, 7 - sinceMonday);
	return addDays(nextMonday, (weekday + 6) % 7);
}

function slashDate(
	m: RegExpMatchArray,
	masked: string,
	span: Span,
	today: string,
	order: DateOrder
): string | null {
	const [a, b, rawYear] = [Number(m[1]), Number(m[2]), m[3]];
	const [day, month] = order === 'mdy' ? [b, a] : [a, b];
	if (IDIOMS.has(`${m[1]}/${m[2]}`)) return null;

	// fromParts rolls 31/2 over into March; a real date comes back unchanged.
	const pad = (n: number) => String(n).padStart(2, '0');
	const valid = (year: number) => {
		const date = fromParts(year, month, day);
		return isDateString(date) && date === `${year}-${pad(month)}-${pad(day)}` ? date : null;
	};

	if (rawYear) {
		return valid(rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear));
	}

	const before = masked.slice(0, span.start);
	const after = masked.slice(span.end).replace(/[\s,.;:!?)]+$/, '');
	const cued = DATE_CUE.test(before);
	const endsTask = !after.trim() || TRAILING_TIME.test(after);
	if (!cued && !(endsTask && !SCORE_WORD.test(before))) return null;

	// No year: the next occurrence (29/2 may be a few years away).
	const thisYear = Number(today.slice(0, 4));
	for (let year = thisYear; year <= thisYear + 8; year++) {
		const date = valid(year);
		if (date && date >= today) return date;
	}
	return null;
}

function resolve(result: chrono.ParsedResult, masked: string, today: string): string | null {
	const text = result.text.trim();
	const lower = text.toLowerCase();
	const { start } = result;

	// Time-only ("at 5") and month-only ("May", "march") matches carry no day.
	if (!start.isCertain('day') && !start.isCertain('weekday')) return null;
	if (lower === 'now' || lower === 'right now') return null;
	if (CHRONO_NUMERIC.test(text)) return null;
	if (/\b(last|past|previous|ago)\b/i.test(lower)) return null;

	if (start.isCertain('weekday') && !start.isCertain('day')) {
		const word = WEEKDAY_WORD.exec(text);
		if (word) {
			const after = masked.slice(result.index + result.text.length);
			const before = masked.slice(0, result.index + word.index);
			// "book flight to Monday Island": a capitalised weekday followed by another
			// capitalised word is part of a name.
			if (/^[A-Z]/.test(word[0]) && /^\s+[A-Z]/.test(after)) return null;
			// "buy sun cream", "sat down": abbreviations count only at the end or after a cue.
			const abbreviated = !FULL_WEEKDAYS.includes(word[0].toLowerCase());
			if (abbreviated && after.trim() && !WEEKDAY_CUE.test(before)) return null;
		}
		const target = start.get('weekday') ?? 0;
		// Normally "next …" was already handled above; keep the same rule if chrono finds one.
		if (/\bnext\b/i.test(lower)) return inNextWeek(today, target);
		// A bare weekday is its next occurrence, today included.
		return addDays(today, (target - weekdayOf(today) + 7) % 7);
	}

	return fromParts(start.get('year') ?? 0, start.get('month') ?? 0, start.get('day') ?? 0);
}
