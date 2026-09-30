/**
 * Natural-language quick-add: "pay rent friday #home" -> title "pay rent",
 * due Friday, list Home. Pure and shared: the client runs it for the live
 * preview, and the server re-runs it on the raw text as the source of truth.
 */
import * as chrono from 'chrono-node/en';
import { addDays, fromParts, weekdayOf } from './dates';

export type QuickAddList = { id: string; name: string; archived?: boolean };

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

const WEEKDAY_NAMES = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday'
];
const WEEKDAY_WORD =
	/\b(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\b/i;
/** Ambiguous day/month order ("3/10", "3.10.26"): skip rather than guess. */
const NUMERIC_DATE = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/;
/** Words that make an abbreviated weekday clearly a date ("next fri", "by sat"). */
const WEEKDAY_CUE = /\b(next|this|on|by|due|until|before)\s+$/i;
/** Connectors left dangling once a trailing date is removed ("report due", "rent by"). */
const TRAILING_CONNECTOR = /\s+(on|by|due|for|until|before)\s*$/i;
const TAG = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

const normalizeName = (name: string) =>
	name.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

export function parseQuickAdd(
	text: string,
	{ today, lists }: { today: string; lists: QuickAddList[] }
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
	for (const t of tags) {
		masked = masked.slice(0, t.start) + ' '.repeat(t.end - t.start) + masked.slice(t.end);
	}
	const date = findDate(masked, today);

	// 3. Title: remove the date phrase and the matched tag.
	const remove: Span[] = [];
	if (date) remove.push(date.span);
	if (tag) remove.push(tag);
	let title = text;
	for (const span of remove.sort((a, b) => b.start - a.start)) {
		title = title.slice(0, span.start) + ' ' + title.slice(span.end);
	}
	title = collapse(title).replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '');
	if (!title) title = collapse(text);

	return {
		title,
		dueDate: date?.dueDate ?? null,
		dateText: date?.text ?? null,
		listId: tag?.list?.id ?? null,
		listName: tag?.list?.name ?? null
	};
}

function findDate(masked: string, today: string) {
	const [y, m, d] = today.split('-').map(Number);
	// Local noon on `today`: only calendar components are read back, so the
	// process's own zone never shifts the result.
	const results = chrono.casual.parse(masked, new Date(y, m - 1, d, 12), { forwardDate: true });

	for (const result of results.reverse()) {
		const dueDate = resolve(result, masked, today);
		if (!dueDate || dueDate < today) continue;

		let span = { start: result.index, end: result.index + result.text.length };
		// "report due jan 5" -> "report": drop a connector left dangling at the end.
		if (!masked.slice(span.end).trim()) {
			const connector = TRAILING_CONNECTOR.exec(masked.slice(0, span.start));
			if (connector) span = { start: connector.index, end: span.end };
		}
		return { dueDate, span, text: result.text.trim() };
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
	if (NUMERIC_DATE.test(text)) return null;
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
			const abbreviated = !WEEKDAY_NAMES.includes(word[0].toLowerCase());
			if (abbreviated && after.trim() && !WEEKDAY_CUE.test(before)) return null;
		}
		// A bare weekday is its next occurrence, today included; "next <weekday>" is a week later.
		const target = start.get('weekday') ?? 0;
		const ahead = (target - weekdayOf(today) + 7) % 7;
		return addDays(today, ahead + (/\bnext\b/i.test(lower) ? 7 : 0));
	}

	return fromParts(start.get('year') ?? 0, start.get('month') ?? 0, start.get('day') ?? 0);
}
