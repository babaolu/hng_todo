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
