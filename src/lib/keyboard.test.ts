import { describe, expect, it } from 'vitest';
import {
	createDispatcher,
	isTypingTarget,
	quickAddEscape,
	searchEscape,
	SHORTCUTS
} from './keyboard';

const press = (
	key: string,
	extra: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; target: unknown }> = {}
) =>
	({
		key,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		target: null as EventTarget | null,
		...extra
	}) as Parameters<ReturnType<typeof createDispatcher>['handle']>[0];

function setup() {
	let t = 0;
	const d = createDispatcher(SHORTCUTS, {
		now: () => t,
		isTyping: (target) => target === ('input' as unknown)
	});
	return { d, advance: (ms: number) => (t += ms) };
}

describe('keyboard dispatcher', () => {
	it('maps single keys', () => {
		const { d } = setup();
		expect(d.handle(press('j'))).toBe('next');
		expect(d.handle(press('x'))).toBe('toggle');
		expect(d.handle(press(' '))).toBe('toggle');
		expect(d.handle(press('/'))).toBe('search');
		expect(d.handle(press('?'))).toBe('help');
		expect(d.handle(press('Escape'))).toBe('escape');
		expect(d.handle(press('q'))).toBeNull();
	});

	it('handles "g then t/u/i" within 1 second', () => {
		const { d, advance } = setup();
		expect(d.handle(press('g'))).toBeNull();
		advance(900);
		expect(d.handle(press('t'))).toBe('goToday');
		d.handle(press('g'));
		expect(d.handle(press('u'))).toBe('goUpcoming');
		d.handle(press('g'));
		expect(d.handle(press('i'))).toBe('goInbox');
	});

	it('drops the sequence after the timeout, and the key then acts on its own', () => {
		const { d, advance } = setup();
		d.handle(press('g'));
		advance(1001);
		expect(d.handle(press('t'))).toBe('pin');
	});

	it('an unrelated key cancels the sequence and acts on its own', () => {
		const { d } = setup();
		d.handle(press('g'));
		expect(d.handle(press('j'))).toBe('next');
		expect(d.handle(press('t'))).toBe('pin');
	});

	it('Shift on its way to "?" does not break anything', () => {
		const { d } = setup();
		d.handle(press('g'));
		expect(d.handle(press('Shift'))).toBeNull();
		expect(d.handle(press('t'))).toBe('goToday');
		expect(d.handle(press('?'))).toBe('help');
	});

	it('ignores keys while typing in a field, and cancels a pending sequence', () => {
		const { d } = setup();
		expect(d.handle(press('j', { target: 'input' }))).toBeNull();
		d.handle(press('g'));
		expect(d.handle(press('t', { target: 'input' }))).toBeNull();
		expect(d.handle(press('t'))).toBe('pin');
	});

	it('leaves Ctrl and Meta combinations to the browser', () => {
		const { d } = setup();
		expect(d.handle(press('k', { ctrlKey: true }))).toBeNull();
		expect(d.handle(press('n', { metaKey: true }))).toBeNull();
		d.handle(press('g'));
		expect(d.handle(press('t', { ctrlKey: true }))).toBeNull();
		expect(d.handle(press('t'))).toBe('pin');
	});

	it('Alt only for the bound Alt+Up/Down', () => {
		const { d } = setup();
		expect(d.handle(press('ArrowUp', { altKey: true }))).toBe('moveUp');
		expect(d.handle(press('ArrowDown', { altKey: true }))).toBe('moveDown');
		expect(d.handle(press('j', { altKey: true }))).toBeNull();
		expect(d.handle(press('ArrowUp'))).toBe('rowUp');
	});
});

describe('isTypingTarget', () => {
	it('recognises fields and editable content', () => {
		expect(
			isTypingTarget({ tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget)
		).toBe(true);
		expect(
			isTypingTarget({ tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget)
		).toBe(true);
		expect(
			isTypingTarget({ tagName: 'SELECT', isContentEditable: false } as unknown as EventTarget)
		).toBe(true);
		expect(
			isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)
		).toBe(true);
		expect(
			isTypingTarget({ tagName: 'LI', isContentEditable: false } as unknown as EventTarget)
		).toBe(false);
		expect(isTypingTarget(null)).toBe(false);
	});
});

describe('Esc in fields', () => {
	it('is left to the field: the dispatcher only turns Esc into an action outside fields', () => {
		const { d } = setup();
		expect(d.handle(press('Escape', { target: 'input' }))).toBeNull();
		expect(d.handle(press('Escape'))).toBe('escape');
	});

	it('search: clears a query first, then leaves the box', () => {
		expect(searchEscape('rent')).toBe('clear');
		expect(searchEscape('  ')).toBe('clear');
		expect(searchEscape('')).toBe('leave');
	});

	it('quick-add: keeps the text literal while chips show, otherwise leaves the box', () => {
		expect(quickAddEscape(true)).toBe('literal');
		expect(quickAddEscape(false)).toBe('leave');
	});
});
