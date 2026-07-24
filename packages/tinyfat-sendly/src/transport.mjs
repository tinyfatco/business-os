import { normalizeEndpoint } from '../../tinyfat-customer-identity/src/index.mjs';

const requireText = (value, label, maximum) => {
	if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`${label} must be a non-empty bounded string`);
	}
	return value;
};

export class SendlyTransportError extends Error {
	constructor(code) {
		super(code);
		this.name = 'SendlyTransportError';
		this.code = code;
	}
}

export class TestScopedSendlyTransport {
	constructor({
		mode = 'disabled',
		apiKey,
		senderAddress,
		allowedRecipients = [],
		fetchImpl = fetch,
		baseUrl = 'https://sendly.live',
	}) {
		if (!['disabled', 'test'].includes(mode)) {
			throw new TypeError('Sendly spike transport supports only disabled or test mode');
		}
		const parsed = new URL(baseUrl);
		if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
			throw new TypeError('baseUrl must be an HTTPS URL without credentials');
		}
		if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
		this.mode = mode;
		this.apiKey = requireText(apiKey, 'apiKey', 1000);
		this.senderAddress = normalizeEndpoint('phone', senderAddress);
		this.allowedRecipients = new Set(allowedRecipients.map((value) => normalizeEndpoint('phone', value)));
		if (mode === 'test' && this.allowedRecipients.size === 0) {
			throw new TypeError('test mode requires at least one allowed recipient');
		}
		this.fetchImpl = fetchImpl;
		this.baseUrl = parsed.toString().replace(/\/$/, '');
	}

	async send({ to, body, idempotencyKey, customerChannelId, actor }) {
		if (this.mode !== 'test') throw new SendlyTransportError('sendly_delivery_disabled');
		const recipient = normalizeEndpoint('phone', to);
		if (!this.allowedRecipients.has(recipient)) {
			throw new SendlyTransportError('sendly_test_recipient_denied');
		}
		requireText(body, 'body', 3_200);
		requireText(idempotencyKey, 'idempotencyKey', 256);
		requireText(customerChannelId, 'customerChannelId', 192);
		if (!actor || !['human', 'agent'].includes(actor.kind) || typeof actor.id !== 'string') {
			throw new TypeError('actor must identify the human or agent who authored the body');
		}
		const response = await this.fetchImpl(`${this.baseUrl}/api/v1/messages`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${this.apiKey}`,
				'content-type': 'application/json',
				'idempotency-key': idempotencyKey,
			},
			body: JSON.stringify({
				to: recipient,
				from: this.senderAddress,
				text: body,
				messageType: 'transactional',
				metadata: {
					source: 'tinyfat_business_os',
					customerChannelId,
					actorKind: actor.kind,
					actorId: actor.id,
				},
			}),
		});
		const responseText = await response.text();
		let parsed = {};
		try {
			parsed = responseText ? JSON.parse(responseText) : {};
		} catch {
			throw new SendlyTransportError('sendly_response_invalid');
		}
		if (!response.ok) throw new SendlyTransportError(`sendly_http_${response.status}`);
		const messageId = typeof parsed.id === 'string' ? parsed.id : '';
		if (!messageId) throw new SendlyTransportError('sendly_receipt_missing');
		return {
			messageId,
			status: typeof parsed.status === 'string' && parsed.status ? parsed.status : 'queued',
		};
	}
}
