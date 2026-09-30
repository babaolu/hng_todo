import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id parameters (the library's defaults).
export function hashPassword(password: string): Promise<string> {
	return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
	try {
		return await verify(passwordHash, password);
	} catch {
		return false;
	}
}

let dummyHash: Promise<string> | undefined;

/** Burn the same time as a real verify so unknown emails can't be detected by timing. */
export async function verifyDummy(password: string): Promise<void> {
	dummyHash ??= hash('not-a-real-password');
	await verifyPassword(await dummyHash, password);
}
