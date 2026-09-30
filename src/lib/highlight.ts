/**
 * Split text into plain and matched segments for highlighting search words.
 * The caller renders each segment as text (never HTML), so nothing in a task
 * title can be interpreted as markup.
 */
export type Segment = { text: string; match: boolean };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function highlight(text: string, words: string[]): Segment[] {
	const terms = words.filter(Boolean).sort((a, b) => b.length - a.length);
	if (!terms.length || !text) return [{ text, match: false }];
	const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
	const segments: Segment[] = [];
	let last = 0;
	for (const m of text.matchAll(pattern)) {
		if (m.index > last) segments.push({ text: text.slice(last, m.index), match: false });
		segments.push({ text: m[0], match: true });
		last = m.index + m[0].length;
	}
	if (last < text.length) segments.push({ text: text.slice(last), match: false });
	return segments;
}

/** How much of the notes an excerpt shows, and how much of that comes before the match. */
const EXCERPT_LENGTH = 100;
const EXCERPT_LEAD = 20;
/** A word longer than this is cut mid-word rather than widening the excerpt to finish it. */
const LONG_WORD = 15;

/**
 * One line of the notes around the first match of any search word, for search results:
 * about 100 characters, newlines collapsed to spaces, cut at word boundaries, with "…"
 * where text was trimmed, and every word highlighted. At most ~20 characters come before
 * the match and the rest after, so the match stays visible when a narrow screen cuts
 * the line short.
 * Null when the notes don't contain any of the words.
 */
export function excerpt(notes: string | null, words: string[]): Segment[] | null {
	const terms = words.filter(Boolean);
	if (!notes || !terms.length) return null;
	const text = notes.replace(/\s+/g, ' ').trim();
	const lower = text.toLowerCase();

	let at = -1;
	let matchEnd = -1;
	for (const term of terms) {
		const i = lower.indexOf(term.toLowerCase());
		if (i !== -1 && (at === -1 || i < at)) [at, matchEnd] = [i, i + term.length];
	}
	if (at === -1) return null;

	// Never more than the lead before the match, even near the end of the notes: the line
	// is cut short with an ellipsis on narrow screens, and the match must stay visible.
	let start = at - EXCERPT_LEAD < 10 ? 0 : at - EXCERPT_LEAD; // don't trim just a word or two
	let end = Math.min(text.length, start + EXCERPT_LENGTH);

	// Word boundaries: drop a cut word at either end, so the match stays near the start;
	// if that would lose part of the match, finish the word instead.
	if (start > 0 && text[start - 1] !== ' ') {
		const after = text.indexOf(' ', start);
		const before = text.lastIndexOf(' ', start);
		if (after !== -1 && after < at) start = after + 1;
		else if (before !== -1 && start - before <= LONG_WORD) start = before + 1;
	}
	if (end < text.length && text[end] !== ' ') {
		const before = text.lastIndexOf(' ', end);
		const after = text.indexOf(' ', end);
		if (before > matchEnd) end = before;
		else if (after !== -1 && after - end <= LONG_WORD) end = after;
	}

	const segments = highlight(text.slice(start, end).trim(), terms);
	if (start > 0) segments.unshift({ text: '…', match: false });
	if (end < text.length) segments.push({ text: '…', match: false });
	return segments;
}
