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
		// Each test file boots its own in-memory Postgres (PGlite): a few seconds and ~1 GB each,
		// so cap parallelism to keep `pnpm test` from exhausting memory next to `pnpm dev`.
		maxWorkers: 2,
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
