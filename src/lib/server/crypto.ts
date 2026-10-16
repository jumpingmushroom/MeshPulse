import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const keys = new Map<string, Buffer>();
// scrypt is deliberately slow, so derive once per secret
const key = (secret: string) => keys.get(secret) ?? keys.set(secret, scryptSync(secret, 'meshpulse', 32)).get(secret)!;

/** AES-256-GCM, returns base64(iv | tag | ciphertext). */
export function encrypt(plain: string, secret: string): string {
	const iv = randomBytes(12);
	const c = createCipheriv('aes-256-gcm', key(secret), iv);
	const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
	return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

export function decrypt(blob: string, secret: string): string {
	const buf = Buffer.from(blob, 'base64');
	const d = createDecipheriv('aes-256-gcm', key(secret), buf.subarray(0, 12));
	d.setAuthTag(buf.subarray(12, 28));
	return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
