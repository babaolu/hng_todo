<script lang="ts">
	import ShortcutsTable from '$lib/components/ShortcutsTable.svelte';
	import { dueLabel } from '$lib/dates';
	import { parseQuickAdd } from '$lib/quick-add';
	import { SHORTCUTS_NOTE } from '$lib/shortcuts';

	let { data } = $props();

	// The examples are run through the real parser (relative to your today), so
	// this table always shows what quick-add actually does.
	const EXAMPLES = [
		'pay rent fri',
		'call mum next tue',
		'dentist 15/10',
		'exam 3/10/2027',
		'gym every mon and thu #health',
		'water plants every 3 days',
		'standup weekdays',
		'rent monthly on the 1st'
	];
	const exampleLists = [{ id: 'health', name: 'Health' }];
	const examples = $derived(
		EXAMPLES.map((input) => {
			const r = parseQuickAdd(input, { today: data.today, lists: exampleLists, dateOrder: 'dmy' });
			return {
				input,
				title: r.title,
				due: r.dueDate ? dueLabel(r.dueDate, data.today).text : '—',
				repeat: r.repeatText ?? '—',
				list: r.listName ?? 'Inbox'
			};
		})
	);

	const sections = [
		['quick-add', 'Quick-add'],
		['views', 'Views'],
		['tasks', 'Tasks'],
		['shortcuts', 'Keyboard shortcuts'],
		['install', 'Install on your phone'],
		['export', 'Your data']
	];
</script>

<svelte:head><title>Help · Todo</title></svelte:head>

<article class="help space-y-10 text-sm leading-relaxed">
	<header class="space-y-3">
		<h1 class="text-2xl font-semibold tracking-tight">Help</h1>
		{#if data.guest}
			<p class="rounded-lg bg-raised px-4 py-2 text-muted">
				You're using a guest account: everything here is deleted on {data.guest.deletesOn}. Download
				it from <a href="/settings">Settings</a> first if you want to keep it.
			</p>
		{/if}
		<nav aria-label="On this page">
			<ul class="flex flex-wrap gap-2">
				{#each sections as [id, label] (id)}
					<li>
						<a href="#{id}" class="rounded-full border border-line px-3 py-1 hover:bg-raised"
							>{label}</a
						>
					</li>
				{/each}
			</ul>
		</nav>
	</header>

	<section id="quick-add" class="space-y-3">
		<h2>Quick-add</h2>
		<p>
			Type a task in the box at the top of any view and press Enter. Dates, repeats and lists are
			picked up from what you type and taken out of the title:
		</p>
		<!-- Phones: one card per example. Wider screens: a table. -->
		<ul class="examples space-y-2 sm:hidden">
			{#each examples as ex (ex.input)}
				<li class="rounded-lg border border-line bg-surface p-3">
					<code>{ex.input}</code>
					<p class="mt-1">
						→ <strong>{ex.title}</strong>, due {ex.due}{#if ex.repeat !== '—'}, ↻ {ex.repeat}{/if},
						in {ex.list}
					</p>
				</li>
			{/each}
		</ul>
		<table class="hidden w-full border-collapse text-left sm:table">
			<thead class="text-xs text-muted">
				<tr>
					<th class="py-1 pr-3 font-medium">You type</th>
					<th class="py-1 pr-3 font-medium">Task</th>
					<th class="py-1 pr-3 font-medium">Due</th>
					<th class="py-1 pr-3 font-medium">Repeats</th>
					<th class="py-1 font-medium">List</th>
				</tr>
			</thead>
			<tbody>
				{#each examples as ex (ex.input)}
					<tr class="border-t border-line">
						<td class="py-1.5 pr-3"><code>{ex.input}</code></td>
						<td class="py-1.5 pr-3">{ex.title}</td>
						<td class="py-1.5 pr-3">{ex.due}</td>
						<td class="py-1.5 pr-3">{ex.repeat}</td>
						<td class="py-1.5">{ex.list}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="text-xs text-muted">
			Dates are relative to today. The #health example assumes you have a list called Health;
			unknown #tags stay in the title as typed.
		</p>
		<ul>
			<li>
				As you type, <strong>chips</strong> under the box show what was understood. Tap the date
				chip to pick a different date. Tap <strong>✕</strong> on a chip (or press Esc) to keep your text
				exactly as typed.
			</li>
			<li>
				<strong>Slash dates</strong> like 15/10 are day first. If your browser is set to US English, they're
				month first (10/15).
			</li>
			<li>
				<strong>Repeats</strong> (“every mon”, “daily”, “monthly on the 1st”) only count at the
				<em>end</em> of the text, so “review the weekly report” stays a plain task. The same goes for
				slash dates without a year, unless they follow “on”, “by” or “due”.
			</li>
			<li>Adding a task in Today gives it today's date unless you type one.</li>
		</ul>
	</section>

	<section id="views" class="space-y-3">
		<h2>Views</h2>
		<dl>
			<dt>Today</dt>
			<dd>Tasks due today, anything overdue (at the top), and tasks you've pinned to Today.</dd>
			<dt>Upcoming</dt>
			<dd>Tasks due in the next 14 days, day by day, then everything further out under Later.</dd>
			<dt>Inbox</dt>
			<dd>Tasks that aren't in a list. Anything you add without a #list lands here.</dd>
			<dt>Lists</dt>
			<dd>
				Your own groups, like Work or Home. Drag to reorder; archive the ones you're not using.
			</dd>
			<dt>Logbook</dt>
			<dd>Everything you've completed, newest first.</dd>
		</dl>
	</section>

	<section id="tasks" class="space-y-3">
		<h2>Tasks</h2>
		<ul>
			<li>
				<strong>Open a task</strong> by clicking or tapping it: the panel lets you change the title, notes,
				due date, repeat and list.
			</li>
			<li>
				<strong>Pin to Today</strong> (★) keeps a task in Today whatever its date. Use the checkbox in
				the panel, or press t on a focused task.
			</li>
			<li>
				<strong>Repeating tasks</strong> (↻): completing one moves it to the Logbook and creates the next
				one on its schedule. Missed ones are skipped, so a weekly task finished late comes back next week,
				not several times. Undo straight after completing brings the original back. To end a series, set
				Repeat to Never in the panel, or delete the task.
			</li>
			<li>
				<strong>Delete</strong> from the panel (or press Delete on a focused task); Undo in the message
				that follows brings it back.
			</li>
		</ul>
	</section>

	<section id="shortcuts" class="space-y-3">
		<h2>Keyboard shortcuts</h2>
		<p>On a computer, press <kbd>?</kbd> anywhere to see these.</p>
		<ShortcutsTable />
		<p class="text-xs text-muted">{SHORTCUTS_NOTE}</p>
	</section>

	<section id="install" class="space-y-3">
		<h2>Install on your phone</h2>
		<ul>
			<li>
				<strong>Android (Chrome):</strong> open the ⋮ menu and choose “Install app” (or “Add to Home screen”).
			</li>
			<li>
				<strong>iPhone (Safari):</strong> tap the Share button, then “Add to Home Screen”.
			</li>
		</ul>
		<p>
			It then opens full screen like an app. It still needs a connection: offline you'll see a short
			message instead.
		</p>
	</section>

	<section id="export" class="space-y-3">
		<h2>Your data</h2>
		<p>
			<a href="/settings">Settings</a> → “Download my data (JSON)” gives you a file with all your lists
			(archived ones too) and tasks, open and completed, with their notes, dates, pins and repeats. Deleted
			tasks and account details (email, password, sessions) are never included.
		</p>
	</section>
</article>

<style>
	.help :global(h2) {
		font-size: 1.125rem;
		font-weight: 600;
		scroll-margin-top: 4rem;
	}
	.help section {
		scroll-margin-top: 4rem;
	}
	.help section ul:not(.examples) {
		list-style: disc;
		padding-left: 1.25rem;
	}
	.help section ul:not(.examples) li + li {
		margin-top: 0.5rem;
	}
	.help dt {
		font-weight: 600;
		margin-top: 0.75rem;
	}
	.help dd {
		color: var(--muted);
	}
	.help a:not([class]) {
		color: var(--accent);
		text-decoration: underline;
	}
	.help code {
		border-radius: 0.25rem;
		background: var(--raised);
		padding: 0.1rem 0.3rem;
		white-space: nowrap;
	}
	.help kbd {
		border: 1px solid var(--line);
		border-radius: 0.25rem;
		background: var(--raised);
		padding: 0 0.35rem;
		font-size: 0.75rem;
	}
</style>
