import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const endpointKinds = new Set(['email', 'phone']);

const assertKey = (key, name) => {
	if (!Buffer.isBuffer(key) || key.length !== 32) {
		throw new TypeError(`${name} must be a 32-byte Buffer`);
	}
};

export const assertOpaqueId = (value, name) => {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,191}$/.test(value)) {
		throw new TypeError(`${name} must be an opaque identifier without path characters`);
	}

	return value;
};

export const normalizeEndpoint = (kind, value) => {
	if (!endpointKinds.has(kind)) {
		throw new TypeError(`unsupported endpoint kind: ${kind}`);
	}

	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new TypeError('endpoint value must be a non-empty string');
	}

	if (kind === 'email') {
		const normalized = value.trim().toLowerCase();
		const parts = normalized.split('@');

		if (parts.length !== 2 || parts[0].length === 0 || !parts[1].includes('.')) {
			throw new TypeError('email endpoint is invalid');
		}

		return normalized;
	}

	const trimmed = value.trim();
	const digits = trimmed.replace(/\D/g, '');
	const normalizedDigits = digits.length === 10 ? `1${digits}` : digits;

	if (normalizedDigits.length < 8 || normalizedDigits.length > 15) {
		throw new TypeError('phone endpoint must contain 8 to 15 digits');
	}

	return `+${normalizedDigits}`;
};

export const createLookupHmac = (lookupKey, namespace, value) => {
	assertKey(lookupKey, 'lookupKey');
	return createHmac('sha256', lookupKey).update(`${namespace}\0${value}`, 'utf8').digest('hex');
};

export const encryptValue = (encryptionKey, namespace, value) => {
	assertKey(encryptionKey, 'encryptionKey');
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
	cipher.setAAD(Buffer.from(namespace, 'utf8'));
	const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

	return JSON.stringify({
		algorithm: 'aes-256-gcm',
		iv: iv.toString('base64'),
		tag: cipher.getAuthTag().toString('base64'),
		value: ciphertext.toString('base64'),
	});
};

export const decryptValue = (encryptionKey, namespace, encoded) => {
	assertKey(encryptionKey, 'encryptionKey');
	const payload = JSON.parse(encoded);

	if (payload.algorithm !== 'aes-256-gcm') {
		throw new Error(`unsupported encrypted identity value: ${payload.algorithm}`);
	}

	const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(payload.iv, 'base64'));
	decipher.setAAD(Buffer.from(namespace, 'utf8'));
	decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

	return Buffer.concat([decipher.update(Buffer.from(payload.value, 'base64')), decipher.final()]).toString('utf8');
};

export const getSafeEndpointLabel = (kind, normalized) => {
	if (kind === 'phone') {
		return `phone ending ${normalized.slice(-4)}`;
	}

	const [local, domain] = normalized.split('@');
	return `${local.slice(0, 1)}***@${domain}`;
};
