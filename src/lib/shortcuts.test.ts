import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from './keyboard';
import { SHORTCUT_BINDINGS, SHORTCUT_ROWS } from './shortcuts';

const source = (path: string) => readFileSync(path, 'utf8');
const DIALOG = 'src/lib/components/ShortcutsDialog.svelte';
const HELP = 'src/routes/(app)/help/+page.svelte';
const TABLE = 'src/lib/components/ShortcutsTable.svelte';

describe('one source for shortcuts', () => {
	it('the dispatcher uses exactly the bindings listed in $lib/shortcuts', () => {
		expect(SHORTCUTS).toBe(SHORTCUT_BINDINGS);
		const fromRows = Object.assign({}, ...SHORTCUT_ROWS.map((r) => r.bindings));
		expect(SHORTCUTS).toEqual(fromRows);
	});

	it('every row documents at least one key and binds at least one action', () => {
		for (const row of SHORTCUT_ROWS) {
			expect(row.keys.length, row.label).toBeGreaterThan(0);
			expect(Object.keys(row.bindings).length, row.label).toBeGreaterThan(0);
		}
	});

	it('the "?" dialog and the help page both render the shared table, which reads $lib/shortcuts', () => {
		expect(source(TABLE)).toMatch(/import \{ SHORTCUT_ROWS \} from '\$lib\/shortcuts'/);
		expect(source(TABLE)).toMatch(/\{#each SHORTCUT_ROWS as/);
		for (const file of [DIALOG, HELP]) {
			expect(source(file), file).toMatch(/import ShortcutsTable from/);
			expect(source(file), file).toMatch(/<ShortcutsTable \/>/);
		}
	});

	it('neither the dialog nor the help page keeps its own copy of the list', () => {
		for (const file of [DIALOG, HELP]) {
			for (const row of SHORTCUT_ROWS)
				expect(source(file), `${file}: ${row.label}`).not.toContain(row.label);
		}
	});
});
