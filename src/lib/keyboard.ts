/**
 * Keyboard shortcuts: a pure dispatcher from key presses to action names, and a
 * small registry where components handle those actions. The app layout owns the
 * one keydown listener that connects them (see routes/(app)/+layout.svelte).
 */

export type KeyPress = {
	key: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	target: EventTarget | null;
};

/** Shortcuts never fire while typing in a field. */
export function isTypingTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el || typeof el.tagName !== 'string') return false;
	return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/**
 * Esc inside the two boxes that handle it themselves (other fields keep their own Esc,
 * e.g. the task panel's fields close the panel). Search: clear the query, then leave
 * the box. Quick-add: with chips showing, keep the text as typed; otherwise leave the
 * box and keep the text.
 */
export function searchEscape(query: string): 'clear' | 'leave' {
	return query ? 'clear' : 'leave';
}

export function quickAddEscape(chipsShowing: boolean): 'literal' | 'leave' {
	return chipsShowing ? 'literal' : 'leave';
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS']);

/**
 * `bindings` maps a key (event.key), a two-key sequence ("g t") or an Alt
 * combination ("Alt+ArrowUp") to an action. Ctrl/Meta combinations are always
 * left to the browser, and Alt only counts for combinations bound explicitly.
 */
export function createDispatcher<A extends string>(
	bindings: Record<string, A>,
	{
		timeout = 1000,
		now = () => Date.now(),
		isTyping = isTypingTarget
	}: { timeout?: number; now?: () => number; isTyping?: (t: EventTarget | null) => boolean } = {}
) {
	const prefixes = new Set(
		Object.keys(bindings)
			.filter((k) => k.includes(' ') && k.length > 1)
			.map((k) => k.split(' ')[0])
	);
	let pending: { prefix: string; at: number } | null = null;

	return {
		handle(press: KeyPress): A | null {
			if (press.ctrlKey || press.metaKey || isTyping(press.target)) {
				pending = null;
				return null;
			}
			if (MODIFIERS.has(press.key)) return null; // e.g. Shift on its way to "?"
			if (press.altKey) {
				pending = null;
				return bindings[`Alt+${press.key}`] ?? null;
			}
			const at = now();
			if (pending) {
				const sequence =
					at - pending.at <= timeout ? bindings[`${pending.prefix} ${press.key}`] : undefined;
				pending = null;
				if (sequence) return sequence;
			}
			if (prefixes.has(press.key)) {
				pending = { prefix: press.key, at };
				return null;
			}
			return bindings[press.key] ?? null;
		},
		reset() {
			pending = null;
		}
	};
}

/** The app's bindings and their descriptions live in ./shortcuts (one list for everything). */
export { SHORTCUT_BINDINGS as SHORTCUTS, type ShortcutAction } from './shortcuts';
import type { ShortcutAction } from './shortcuts';

// ---------- handler registry ----------

type Handler = (event: KeyboardEvent) => boolean;
const registry = new Map<string, { handler: Handler; priority: number }[]>();

/**
 * Handle an action. Handlers run highest priority first until one returns true
 * (handled). Returns a function that unregisters it.
 */
export function onShortcut(action: ShortcutAction, handler: Handler, priority = 0): () => void {
	const list = registry.get(action) ?? [];
	const entry = { handler, priority };
	list.push(entry);
	list.sort((a, b) => b.priority - a.priority);
	registry.set(action, list);
	return () => {
		const current = registry.get(action) ?? [];
		registry.set(
			action,
			current.filter((e) => e !== entry)
		);
	};
}

export function runShortcut(action: ShortcutAction, event: KeyboardEvent): boolean {
	for (const { handler } of registry.get(action) ?? []) if (handler(event)) return true;
	return false;
}
