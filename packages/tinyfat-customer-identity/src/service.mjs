import { createEventId } from '../../tinyfat-awareness/src/index.mjs';

const internalSurfaces = new Set(['rocket-chat', 'slack', 'troublemaker', 'hostd', 'web', 'system']);
const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,191}$/;

const requireActor = (actor) => {
	if (!actor || !['human', 'agent', 'contact', 'system'].includes(actor.kind)) {
		throw new TypeError('actor must identify the person, agent, or system performing the identity action');
	}
	if (typeof actor.id !== 'string' || !opaqueIdPattern.test(actor.id)) {
		throw new TypeError('actor.id must be an opaque identifier');
	}
	return actor;
};

const requireSource = (source) => {
	if (!source || !internalSurfaces.has(source.surface)) {
		throw new TypeError('identity action source must be an internal surface');
	}
	if (typeof source.ref !== 'string' || !opaqueIdPattern.test(source.ref)) {
		throw new TypeError('source.ref must be an opaque identifier');
	}
	return source;
};

export class CustomerIdentityLinkService {
	constructor({ identityStore, awarenessStore, clock = () => new Date() }) {
		if (!identityStore || !awarenessStore) throw new TypeError('identityStore and awarenessStore are required');
		this.identityStore = identityStore;
		this.awarenessStore = awarenessStore;
		this.clock = clock;
	}

	suggest(input) {
		return this.identityStore.suggestEndpointLink(input);
	}

	async startChallenge({ actor, source, correlationId = null, ...input }) {
		const author = requireActor(actor);
		const origin = requireSource(source);
		if (input.initiatedBy !== undefined && input.initiatedBy !== author.id) {
			throw new Error('initiatedBy must match actor.id');
		}
		const challenge = this.identityStore.startLinkChallenge({
			...input,
			initiatedBy: author.id,
		});
		const event = await this.awarenessStore.append({
			eventId: createEventId(),
			customerChannelId: challenge.targetChannelId,
			eventType: 'endpoint.challenge.started',
			occurredAt: this.clock().toISOString(),
			actor: author,
			source: origin,
			visibility: { class: 'private', grants: [] },
			correlationId,
			payload: {
				challengeId: challenge.id,
				sourceEndpointId: challenge.sourceEndpointId,
				claimedKind: challenge.claimedKind,
				expiresAt: challenge.expiresAt,
			},
		});
		return { challenge, event: event.event };
	}

	async verifyChallenge({ challengeId, code, actor, source, correlationId = null }) {
		const author = requireActor(actor);
		const origin = requireSource(source);
		const before = this.identityStore.getLinkChallenge(challengeId);
		if (!before) return { disposition: 'failed', reason: 'challenge-not-pending' };
		const result = this.identityStore.verifyLinkChallenge({
			challengeId,
			code,
			verifiedBy: author.id,
		});
		if (result.disposition === 'failed') {
			const failed = await this.awarenessStore.append({
				eventId: createEventId(),
				customerChannelId: before.targetChannelId,
				eventType: 'endpoint.challenge.failed',
				occurredAt: this.clock().toISOString(),
				actor: author,
				source: origin,
				visibility: { class: 'private', grants: [] },
				correlationId,
				payload: {
					challengeId,
					reason: result.reason,
					attempts: this.identityStore.getLinkChallenge(challengeId)?.attempts ?? before.attempts,
				},
			});
			return { ...result, events: [failed.event] };
		}

		const verified = await this.awarenessStore.append({
			eventId: createEventId(),
			customerChannelId: before.targetChannelId,
			eventType: 'endpoint.verified',
			occurredAt: this.clock().toISOString(),
			actor: author,
			source: origin,
			visibility: { class: 'channel', grants: [] },
			correlationId,
			payload: {
				challengeId,
				claimedKind: before.claimedKind,
				claimedLabel: before.claimedLabel,
				disposition: result.disposition,
				...(result.endpoint ? { endpointId: result.endpoint.id } : {}),
			},
		});
		if (result.disposition === 'merge-required') {
			const review = await this.awarenessStore.append({
				eventId: createEventId(),
				customerChannelId: before.targetChannelId,
				eventType: 'endpoint.merge.review.created',
				occurredAt: this.clock().toISOString(),
				actor: { kind: 'system', id: 'system_hostd' },
				source: { surface: 'hostd', ref: `merge-review:${result.reviewId}` },
				visibility: { class: 'channel', grants: [] },
				causationId: verified.event.eventId,
				correlationId,
				payload: {
					reviewId: result.reviewId,
					claimedEndpointId: result.claimedEndpointId,
					status: 'pending',
				},
			});
			return { ...result, events: [verified.event, review.event] };
		}
		const linked = await this.awarenessStore.append({
			eventId: createEventId(),
			customerChannelId: before.targetChannelId,
			eventType: 'endpoint.linked',
			occurredAt: this.clock().toISOString(),
			actor: { kind: 'system', id: 'system_hostd' },
			source: { surface: 'hostd', ref: `identity-link:${challengeId}` },
			visibility: { class: 'channel', grants: [] },
			causationId: verified.event.eventId,
			correlationId,
			payload: {
				challengeId,
				sourceEndpointId: before.sourceEndpointId,
				endpointId: result.endpoint.id,
				kind: result.endpoint.kind,
				label: result.endpoint.label,
			},
		});
		return { ...result, events: [verified.event, linked.event] };
	}

	async approve({ actor, source, correlationId = null, ...input }) {
		const author = requireActor(actor);
		if (author.kind !== 'human') throw new Error('operator approval requires a human actor');
		const origin = requireSource(source);
		if (input.approvedBy !== undefined && input.approvedBy !== author.id) {
			throw new Error('approvedBy must match actor.id');
		}
		const suggestion = this.identityStore.suggestEndpointLink(input);
		const result = this.identityStore.approveEndpointLink({
			...input,
			approvedBy: author.id,
		});
		const approved = await this.awarenessStore.append({
			eventId: createEventId(),
			customerChannelId: result.targetCustomerChannelId,
			eventType: 'endpoint.link.approved',
			occurredAt: this.clock().toISOString(),
			actor: author,
			source: origin,
			visibility: { class: 'channel', grants: [] },
			correlationId,
			payload: {
				approvalId: result.approvalId,
				claimedKind: input.claimedKind,
				claimedLabel: suggestion.label,
				reason: input.reason,
				disposition: result.disposition,
			},
		});
		if (result.disposition === 'merge-required') {
			const review = await this.awarenessStore.append({
				eventId: createEventId(),
				customerChannelId: result.targetCustomerChannelId,
				eventType: 'endpoint.merge.review.created',
				occurredAt: this.clock().toISOString(),
				actor: { kind: 'system', id: 'system_hostd' },
				source: { surface: 'hostd', ref: `merge-review:${result.reviewId}` },
				visibility: { class: 'channel', grants: [] },
				causationId: approved.event.eventId,
				correlationId,
				payload: {
					reviewId: result.reviewId,
					claimedEndpointId: result.claimedEndpointId,
					status: 'pending',
				},
			});
			return { ...result, events: [approved.event, review.event] };
		}
		const linked = await this.awarenessStore.append({
			eventId: createEventId(),
			customerChannelId: result.targetCustomerChannelId,
			eventType: 'endpoint.linked',
			occurredAt: this.clock().toISOString(),
			actor: { kind: 'system', id: 'system_hostd' },
			source: { surface: 'hostd', ref: `identity-approval:${result.approvalId}` },
			visibility: { class: 'channel', grants: [] },
			causationId: approved.event.eventId,
			correlationId,
			payload: {
				approvalId: result.approvalId,
				sourceEndpointId: input.sourceEndpointId,
				endpointId: result.endpoint.id,
				kind: result.endpoint.kind,
				label: result.endpoint.label,
			},
		});
		return { ...result, events: [approved.event, linked.event] };
	}

	async decideMerge({ reviewId, decision, actor, source, note, correlationId = null }) {
		const author = requireActor(actor);
		if (author.kind !== 'human') throw new Error('merge review requires a human actor');
		const origin = requireSource(source);
		const result = this.identityStore.resolveMergeReview({
			reviewId,
			decision,
			decidedBy: author.id,
			note,
		});
		const event = await this.awarenessStore.append({
			eventId: createEventId(),
			customerChannelId: result.targetCustomerChannelId,
			eventType: 'endpoint.merge.review.decided',
			occurredAt: this.clock().toISOString(),
			actor: author,
			source: origin,
			visibility: { class: 'channel', grants: [] },
			correlationId,
			payload: {
				reviewId,
				decision,
				note,
				disposition: result.disposition,
				claimedEndpointId: result.claimedEndpointId,
			},
		});
		return { ...result, event: event.event };
	}
}
