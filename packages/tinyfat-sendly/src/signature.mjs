import { createHmac, timingSafeEqual } from 'node:crypto';

const timestampMilliseconds = (value) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return null;
	return numeric > 9_999_999_999 ? numeric : numeric * 1000;
};

const constantTimeEqual = (left, right) => {
	const a = Buffer.from(String(left), 'utf8');
	const b = Buffer.from(String(right), 'utf8');
	return a.length === b.length && timingSafeEqual(a, b);
};

export const buildSendlySignature = ({ rawBody, secret, timestamp }) => {
	if (typeof rawBody !== 'string') throw new TypeError('rawBody must be a string');
	if (typeof secret !== 'string' || secret.length < 16) {
		throw new TypeError('secret must contain at least 16 characters');
	}
	if (!timestampMilliseconds(timestamp)) throw new TypeError('timestamp must be Unix seconds or milliseconds');
	const digest = createHmac('sha256', secret)
		.update(`${timestamp}.${rawBody}`, 'utf8')
		.digest('hex');
	return `sha256=${digest}`;
};

export const verifySendlySignature = ({
	rawBody,
	secret,
	timestamp,
	signature,
	now = Date.now(),
	maxAgeMilliseconds = 5 * 60 * 1000,
}) => {
	const observed = timestampMilliseconds(timestamp);
	if (!observed || !Number.isFinite(now) || Math.abs(now - observed) > maxAgeMilliseconds) return false;
	let expected;
	try {
		expected = buildSendlySignature({ rawBody, secret, timestamp });
	} catch {
		return false;
	}
	return constantTimeEqual(expected, signature);
};
