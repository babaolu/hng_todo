<script lang="ts">
	import { SHORTCUT_ROWS } from '$lib/shortcuts';
</script>

<!-- The shortcuts, from the one list in $lib/shortcuts (the "?" dialog and /help both use this). -->
<dl class="space-y-2 text-sm">
	{#each SHORTCUT_ROWS as row (row.label)}
		<div class="flex items-center justify-between gap-4">
			<dt class="text-muted">{row.label}</dt>
			<dd class="flex shrink-0 gap-1">
				{#each row.keys as key (key)}
					<kbd class="rounded border border-line bg-raised px-1.5 py-0.5 text-xs text-ink"
						>{key}</kbd
					>
				{/each}
			</dd>
		</div>
	{/each}
</dl>
