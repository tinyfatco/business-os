import { createEventId } from '../../tinyfat-awareness/src/index.mjs';

const supportedSources = new Set(['slack', 'rocket-chat', 'troublemaker', 'hostd', 'web', 'system']);

const requireSource = (source) => {
	if (!source || typeof source !== 'object' || !supportedSources.has(source.surface)) {
		throw new TypeError('source must name a supported internal collaboration surface');
	}
	if (typeof source.ref !== 'string' || source.ref.length < 3) {
		throw new TypeError('source.ref must be an opaque source reference');
	}
	return source;
};

const requireText = (text) => {
	if (typeof text !== 'string' || text.trim().length === 0 || text.length > 100_000 || text.includes('\0')) {
		throw new TypeError('text must be a non-empty bounded string');
	}
	return text;
};

export class ScopedRelationshipCollaboration {
	constructor({ grantStore, awarenessStore, clock = () => new Date() }) {
		this.grantStore = grantStore;
		this.awarenessStore = awarenessStore;
		this.clock = clock;
	}

	async issueGrant(input) {
		const issued = this.grantStore.issue(input);
		await this.awarenessStore.append({
			eventId: input.eventId ?? createEventId(),
			customerChannelId: issued.grant.customerChannelId,
			eventType: 'collaboration.grant.created',
			occurredAt: this.clock().toISOString(),
			actor: {
				kind: 'human',
				id: issued.grant.issuedBy,
			},
			source: requireSource(input.source ?? { surface: 'system', ref: 'hostd:relationship-grant' }),
			visibility: { class: 'restricted', grants: [issued.grant.id] },
			correlationId: input.correlationId ?? null,
			payload: {
				grantId: issued.grant.id,
				subject: issued.grant.subject,
				purpose: issued.grant.purpose,
				allowedVisibility: issued.grant.allowedVisibility,
				allowedActions: issued.grant.allowedActions,
				expiresAt: issued.grant.expiresAt,
			},
		});
		return issued;
	}

	async read({ token, customerChannelId, afterSequence = 0 }) {
		const grant = this.grantStore.authorize({
			token,
			customerChannelId,
			action: 'awareness.read',
		});
		return this.awarenessStore.readVisible(customerChannelId, {
			allowedVisibility: grant.allowedVisibility,
			grantIds: [grant.id],
		}, { afterSequence });
	}

	async append({
		token,
		customerChannelId,
		eventId = createEventId(),
		text,
		source,
		visibility = 'channel',
		causationId = null,
		correlationId = null,
		payload = {},
	}) {
		const grant = this.grantStore.authorize({
			token,
			customerChannelId,
			action: 'awareness.append',
		});
		if (!grant.allowedVisibility.includes(visibility)) {
			throw new Error('visibility_scope_denied');
		}
		const event = await this.awarenessStore.append({
			eventId,
			customerChannelId,
			eventType: 'collaboration.message.recorded',
			occurredAt: this.clock().toISOString(),
			actor: grant.subject,
			source: requireSource(source),
			visibility: {
				class: visibility,
				grants: visibility === 'restricted' ? [grant.id] : [],
			},
			causationId,
			correlationId,
			payload: {
				...payload,
				text: requireText(text),
				grantId: grant.id,
				purpose: grant.purpose,
			},
		});
		return event;
	}

	async revoke({ grantId, revokedBy, source, eventId = createEventId(), correlationId = null }) {
		const grant = this.grantStore.revoke({ grantId, revokedBy });
		await this.awarenessStore.append({
			eventId,
			customerChannelId: grant.customerChannelId,
			eventType: 'collaboration.grant.expired',
			occurredAt: this.clock().toISOString(),
			actor: { kind: 'human', id: revokedBy },
			source: requireSource(source),
			visibility: { class: 'restricted', grants: [grant.id] },
			correlationId,
			payload: {
				grantId: grant.id,
				reason: 'revoked',
				revokedAt: grant.revokedAt,
			},
		});
		return grant;
	}
}
