import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({}) as { GUEST_MODE?: string });
const app = vi.hoisted(() => ({ building: false, dev: false }));
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$app/environment', () => app);

/** A fresh module per test, as on a new server instance (the warning is once per instance). */
const load = async () => {
	vi.resetModules();
	return import('./guest-mode');
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	delete env.GUEST_MODE;
	app.building = false;
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('GUEST_MODE', () => {
	it('"on" allows guests and cleans up expired ones', async () => {
		env.GUEST_MODE = 'on';
		const m = await load();
		expect([m.guestMode(), m.guestModeOn(), m.guestCleanup()]).toEqual(['on', true, 'expired']);
		expect(warn).not.toHaveBeenCalled();
	});

	it('"off" blocks guests and deletes all of them', async () => {
		env.GUEST_MODE = 'off';
		const m = await load();
		expect([m.guestMode(), m.guestModeOn(), m.guestCleanup()]).toEqual(['off', false, 'all']);
		expect(warn).not.toHaveBeenCalled();
	});

	it.each([undefined, '', 'of', 'OFF', 'On', ' on', 'true', 'false'])(
		'%j blocks guests, deletes nothing, and warns once per instance',
		async (value) => {
			if (value !== undefined) env.GUEST_MODE = value;
			const m = await load();
			for (let i = 0; i < 3; i++) {
				expect([m.guestMode(), m.guestModeOn(), m.guestCleanup()]).toEqual([
					'unrecognised',
					false,
					'none'
				]);
			}
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith(
				'[guest-mode] unrecognised value; guests disabled, no data deleted'
			);
		}
	);

	it('never cleans up during a build, whatever the value', async () => {
		app.building = true;
		const m = await load();
		for (const value of ['on', 'off', undefined]) {
			env.GUEST_MODE = value;
			expect(m.guestCleanup()).toBe('none');
		}
	});
});
