import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// London, next to the Neon database (aws-eu-west-2).
			adapter: adapter({ regions: ['lhr1'] }),
			typescript: {
				config(config) {
					config.include.push('../scripts/**/*.ts', '../drizzle.config.ts');
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		// Each test file boots its own in-memory Postgres (PGlite): a few seconds and ~1 GB each.
		// One worker keeps `pnpm test` from exhausting memory next to `pnpm dev` (which also runs
		// PGlite), and on an 8 GB machine it's faster than two anyway (16.8s vs 19.8s).
		maxWorkers: 1,
		hookTimeout: 60_000,
		testTimeout: 30_000,
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
