// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: import('$lib/server/auth').SessionUser | null;
		}
		// interface PageData {}
		interface PageState {
			/** Task open in the detail panel (shallow routing). */
			taskId?: string | null;
		}
		// interface Platform {}
	}
}

export {};
