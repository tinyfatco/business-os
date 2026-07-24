import { createHash } from 'node:crypto';

import { normalizeEndpoint } from '../../tinyfat-customer-identity/src/index.mjs';
import { verifySendlySignature } from './signature.mjs';
import { SendlyDeliveryLedger } from './ledger.mjs';

const digest = (value) => createHash('sha256').update(String(value), 'utf8').digest('hex');
const opaqueSuffix = (value) => digest(value).slice(0, 32);
const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,191}$/;
const internalSources = new Set(['slack', 'rocket-chat', 'troublemaker', 'hostd', 'web']);

const stringValue = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? '';

const requireOpaqueId = (value, label) => {
	if (typeof value !== 'string' || !opaqueIdPattern.test(value)) throw new TypeError(`${label} must be an opaque identifier`);
	return value;
};

const normalizeSendlyInbound = (rawBody, now) => {
	let parsed;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		throw new Error('sendly_webhook_json_invalid');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('sendly_webhook_object_required');
	}
	const data = parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
		? parsed.data
		: parsed;
	const eventType = stringValue(parsed.type, parsed.event, parsed.event_type, data.type, data.event);
	if (eventType !== 'message.received') throw new Error('sendly_event_ignored');
	const messageId = stringValue(data.id, data.message_id, data.messageId);
	const from = normalizeEndpoint('phone', stringValue(data.from, data.from_number, data.fromNumber));
	const to = normalizeEndpoint('phone', stringValue(data.to, data.to_number, data.toNumber));
	const body = stringValue(data.text, data.body, data.message);
	if (!messageId || !body || body.length > 3_200 || body.includes('\0')) {
		throw new Error('sendly_message_invalid');
	}
	const providerThreadId = stringValue(
		data.conversation_id,
		data.conversationId,
		data.thread_id,
		data.threadId,
	) || `direct:${to}:${from}`;
	const rawOccurredAt = stringValue(data.created_at, data.createdAt, data.timestamp);
	const occurred = rawOccurredAt ? new Date(rawOccurredAt) : new Date(now);
	if (Number.isNaN(occurred.getTime())) throw new Error('sendly_timestamp_invalid');
	return {
		messageId,
		from,
		to,
		body,
		providerThreadId,
		occurredAt: occurred.toISOString(),
	};
};

const requireAuthor = (actor) => {
	if (!actor || !['human', 'agent'].includes(actor.kind)) {
		throw new TypeError('actor must identify the human or agent who authored the SMS');
	}
	requireOpaqueId(actor.id, 'actor.id');
	return { kind: actor.kind, id: actor.id, ...(actor.display ? { display: String(actor.display) } : {}) };
};

const requireInternalSource = (source) => {
	if (!source || !internalSources.has(source.surface)) {
		throw new TypeError('outbound SMS source must be an internal human or agent surface');
	}
	requireOpaqueId(source.ref, 'source.ref');
	return source;
};

export class TinyFatSendlyBridge {
	constructor({
		identityStore,
		awarenessStore,
		ledger,
		transport,
		senderAddress,
		webhookSecret,
		clock = () => new Date(),
	}) {
		for (const [name, value] of Object.entries({ identityStore, awarenessStore, ledger, transport })) {
			if (!value || typeof value !== 'object') throw new TypeError(`${name} is required`);
		}
		if (!(ledger instanceof SendlyDeliveryLedger)) {
			throw new TypeError('ledger must be a SendlyDeliveryLedger');
		}
		if (typeof webhookSecret !== 'string' || webhookSecret.length < 16) {
			throw new TypeError('webhookSecret must contain at least 16 characters');
		}
		this.identityStore = identityStore;
		this.awarenessStore = awarenessStore;
		this.ledger = ledger;
		this.transport = transport;
		this.senderAddress = normalizeEndpoint('phone', senderAddress);
		this.webhookSecret = webhookSecret;
		this.clock = clock;
	}

	async ingestSignedWebhook({ rawBody, timestamp, signature }) {
		const now = this.clock();
		if (!verifySendlySignature({
			rawBody,
			secret: this.webhookSecret,
			timestamp,
			signature,
			now: now.getTime(),
		})) {
			return { disposition: 'rejected', reason: 'invalid-signature' };
		}
		const inbound = normalizeSendlyInbound(rawBody, now);
		if (inbound.to !== this.senderAddress) {
			return { disposition: 'rejected', reason: 'sender-route-mismatch' };
		}
		const resolution = this.identityStore.resolveInbound({
			provider: 'sendly',
			providerThreadId: inbound.providerThreadId,
			endpointKind: 'phone',
			endpointValue: inbound.from,
		});
		if (resolution.disposition !== 'resolved') return resolution;
		const binding = this.identityStore.getProviderThread('sendly', inbound.providerThreadId)
			?? this.identityStore.bindProviderThread({
				id: `pth_sendly_${opaqueSuffix(inbound.providerThreadId)}`,
				customerChannelId: resolution.customerChannelId,
				endpointId: resolution.endpointId,
				provider: 'sendly',
				providerThreadId: inbound.providerThreadId,
				lastEventAt: inbound.occurredAt,
			});
		const appended = await this.awarenessStore.append({
			eventId: `evt_sendly_in_${opaqueSuffix(inbound.messageId)}`,
			customerChannelId: resolution.customerChannelId,
			eventType: 'message.inbound.recorded',
			occurredAt: inbound.occurredAt,
			actor: { kind: 'contact', id: resolution.contactId },
			source: { surface: 'sms', ref: `sendly-event:${opaqueSuffix(inbound.messageId)}` },
			visibility: { class: 'channel', grants: [] },
			payload: {
				endpointId: resolution.endpointId,
				providerThreadId: binding.id,
				transport: 'sms',
				body: inbound.body,
				delivery: { status: 'received' },
			},
		});
		return {
			disposition: 'resolved',
			customerChannelId: resolution.customerChannelId,
			endpointId: resolution.endpointId,
			providerThreadId: binding.id,
			appended: appended.appended,
			event: appended.event,
		};
	}

	async sendAgentAuthored({
		customerChannelId,
		endpointId,
		body,
		actor,
		source,
		idempotencyKey,
		providerThreadId = null,
		causationId = null,
		correlationId = null,
	}) {
		requireOpaqueId(customerChannelId, 'customerChannelId');
		requireOpaqueId(endpointId, 'endpointId');
		requireOpaqueId(idempotencyKey, 'idempotencyKey');
		if (providerThreadId !== null) requireOpaqueId(providerThreadId, 'providerThreadId');
		const author = requireAuthor(actor);
		const internalSource = requireInternalSource(source);
		if (typeof body !== 'string' || !body.trim() || body.length > 3_200 || body.includes('\0')) {
			throw new TypeError('body must be agent-authored non-empty SMS text');
		}
		const endpoint = this.identityStore.getVerifiedEndpointForChannel({
			customerChannelId,
			endpointId,
			kind: 'phone',
		});
		const suffix = opaqueSuffix(idempotencyKey);
		const requestedEventId = `evt_sendly_req_${suffix}`;
		const deliveredEventId = `evt_sendly_ok_${suffix}`;
		const requestSha256 = SendlyDeliveryLedger.digestRequest({
			customerChannelId,
			endpointId,
			body,
			actor: author,
			source: internalSource,
			providerThreadId,
			causationId,
			correlationId,
		});
		let delivery = this.ledger.start({
			idempotencyKey,
			requestSha256,
			customerChannelId,
			endpointId,
			requestedEventId,
			deliveredEventId,
		});
		if (delivery.duplicate) {
			return {
				ok: true,
				duplicate: true,
				messageId: delivery.providerMessageId,
				status: delivery.providerStatus,
				deliveredEventId,
			};
		}
		if (!delivery.claimed) {
			throw new Error(delivery.status === 'failed' ? 'sendly_delivery_requires_review' : 'sendly_delivery_in_progress');
		}

		await this.awarenessStore.append({
			eventId: requestedEventId,
			customerChannelId,
			eventType: 'message.outbound.requested',
			occurredAt: this.clock().toISOString(),
			actor: author,
			source: internalSource,
			visibility: { class: 'channel', grants: [] },
			causationId,
			correlationId,
			payload: {
				endpointId,
				...(providerThreadId ? { providerThreadId } : {}),
				transport: 'sms',
				body,
			},
		});

		if (!delivery.providerMessageId) {
			try {
				const receipt = await this.transport.send({
					to: endpoint.value,
					body,
					idempotencyKey,
					customerChannelId,
					actor: author,
				});
				delivery = this.ledger.recordProviderReceipt(idempotencyKey, receipt);
			} catch (error) {
				this.ledger.fail(idempotencyKey, error instanceof Error ? error.message : String(error));
				await this.awarenessStore.append({
					eventId: `evt_sendly_fail_${suffix}`,
					customerChannelId,
					eventType: 'message.outbound.failed',
					occurredAt: this.clock().toISOString(),
					actor: { kind: 'system', id: 'system_hostd' },
					source: { surface: 'hostd', ref: `sendly-delivery:${suffix}` },
					visibility: { class: 'channel', grants: [] },
					causationId: requestedEventId,
					correlationId,
					payload: {
						endpointId,
						transport: 'sms',
						reason: error instanceof Error ? error.message.slice(0, 200) : 'sendly_delivery_failed',
					},
				});
				throw error;
			}
		}

		await this.awarenessStore.append({
			eventId: deliveredEventId,
			customerChannelId,
			eventType: 'message.outbound.delivered',
			occurredAt: this.clock().toISOString(),
			actor: { kind: 'system', id: 'system_hostd' },
			source: {
				surface: 'sms',
				ref: `sendly-message:${opaqueSuffix(delivery.providerMessageId)}`,
			},
			visibility: { class: 'channel', grants: [] },
			causationId: requestedEventId,
			correlationId,
			payload: {
				endpointId,
				...(providerThreadId ? { providerThreadId } : {}),
				transport: 'sms',
				body,
				providerStatus: delivery.providerStatus,
			},
		});
		delivery = this.ledger.complete(idempotencyKey);
		return {
			ok: true,
			duplicate: false,
			messageId: delivery.providerMessageId,
			status: delivery.providerStatus,
			deliveredEventId,
		};
	}
}

export { normalizeSendlyInbound };
