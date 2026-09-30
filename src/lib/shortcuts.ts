/**
 * Every keyboard shortcut, once. The dispatcher's key bindings are derived from
 * this list, and both the "?" dialog and the help page render their tables
 * from it, so what's documented is always what works.
 */

export type ShortcutAction =
	| 'next'
	| 'prev'
	| 'rowDown'
	| 'rowUp'
	| 'toggle'
	| 'open'
	| 'openRow'
	| 'pin'
	| 'delete'
	| 'quickAdd'
	| 'search'
	| 'escape'
	| 'help'
	| 'goToday'
	| 'goUpcoming'
	| 'goInbox'
	| 'moveUp'
	| 'moveDown';

export type ShortcutRow = {
	/** The keys as shown to people. */
	keys: string[];
	label: string;
	/** event.key (or "g t", "Alt+ArrowUp") -> action; may include unlisted aliases. */
	bindings: Record<string, ShortcutAction>;
};

export const SHORTCUT_ROWS: ShortcutRow[] = [
	{
		keys: ['j', 'k'],
		label: 'Next / previous task',
		// With a task focused, the arrow keys move too.
		bindings: { j: 'next', k: 'prev', ArrowDown: 'rowDown', ArrowUp: 'rowUp' }
	},
	{
		keys: ['x', 'Space'],
		label: 'Complete or reopen the focused task',
		bindings: { x: 'toggle', ' ': 'toggle' }
	},
	{ keys: ['e'], label: 'Open the focused task', bindings: { e: 'open', Enter: 'openRow' } },
	{ keys: ['t'], label: 'Pin the focused task to Today', bindings: { t: 'pin' } },
	{
		keys: ['Alt ↑', 'Alt ↓'],
		label: 'Move the focused task (or list) up / down',
		bindings: { 'Alt+ArrowUp': 'moveUp', 'Alt+ArrowDown': 'moveDown' }
	},
	{
		keys: ['Delete'],
		label: 'Delete the focused task',
		bindings: { Delete: 'delete', Backspace: 'delete' }
	},
	{ keys: ['n'], label: 'New task', bindings: { n: 'quickAdd' } },
	{ keys: ['/'], label: 'Search', bindings: { '/': 'search' } },
	{ keys: ['g t'], label: 'Go to Today', bindings: { 'g t': 'goToday' } },
	{ keys: ['g u'], label: 'Go to Upcoming', bindings: { 'g u': 'goUpcoming' } },
	{ keys: ['g i'], label: 'Go to Inbox', bindings: { 'g i': 'goInbox' } },
	{
		keys: ['Esc'],
		label: 'Close the panel or dialog, or clear focus',
		bindings: { Escape: 'escape' }
	},
	{ keys: ['?'], label: 'Show these shortcuts', bindings: { '?': 'help' } }
];

/** Key -> action, for the dispatcher. */
export const SHORTCUT_BINDINGS: Record<string, ShortcutAction> = Object.assign(
	{},
	...SHORTCUT_ROWS.map((row) => row.bindings)
);

export const SHORTCUTS_NOTE =
	"Shortcuts are off while you're typing in a field. Ctrl and ⌘ combinations are left to the browser.";
