import { randomUUID } from 'node:crypto';

export const actorKinds = Object.freeze(['contact', 'human', 'agent', 'system']);
export const sourceSurfaces = Object.freeze(['email', 'sms', 'rocket-chat', 'slack', 'troublemaker', 'hostd', 'web', 'system']);
export const visibilityClasses = Object.freeze(['customer', 'channel', 'restricted', 'private']);

export const eventTypes = Object.freeze([
	'relationship.created',
	'relationship.status.changed',
	'endpoint.observed',
	'endpoint.challenge.started',
	'endpoint.verified',
	'endpoint.linked',
	'endpoint.unlinked',
	'message.inbound.recorded',
	'message.outbound.requested',
	'message.outbound.delivered',
	'message.outbound.failed',
	'collaboration.message.recorded',
	'collaboration.grant.created',
	'collaboration.grant.expired',
	'agent.turn.requested',
	'agent.action.requested',
	'agent.action.completed',
	'agent.action.failed',
	'artifact.created',
	'artifact.revised',
	'artifact.published',
	'decision.recorded',
	'commitment.recorded',
	'followup.scheduled',
	'projection.applied',
	'projection.failed',
	'summary.recorded',
	'relationship.state.derived',
]);

const actorKindSet = new Set(actorKinds);
const sourceSurfaceSet = new Set(sourceSurfaces);
const visibilityClassSet = new Set(visibilityClasses);
const eventTypeSet = new Set(eventTypes);
const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,191}$/;

export class AwarenessValidationError extends Error {
	constructor(message) {
		super(message);
		this.name = 'AwarenessValidationError';
	}
}

const requireObject = (value, name) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new AwarenessValidationError(`${name} must be an object`);
	}

	return value;
};

const requireString = (value, name, { opaqueId = false, allowEmpty = false } = {}) => {
	if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
		throw new AwarenessValidationError(`${name} must be a${allowEmpty ? '' : ' non-empty'} string`);
	}

	if (opaqueId && !opaqueIdPattern.test(value)) {
		throw new AwarenessValidationError(`${name} must be an opaque identifier without path characters`);
	}

	return value;
};

const normalizeTimestamp = (value, name) => {
	requireString(value, name);
	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		throw new AwarenessValidationError(`${name} must be an ISO-8601 timestamp`);
	}

	return date.toISOString();
};

const normalizeNullableId = (value, name) => {
	if (value === undefined || value === null) {
		return null;
	}

	return requireString(value, name, { opaqueId: true });
};

const normalizePayload = (payload) => {
	requireObject(payload, 'payload');

	try {
		return JSON.parse(JSON.stringify(payload));
	} catch (error) {
		throw new AwarenessValidationError(`payload must be JSON serializable: ${error.message}`);
	}
};

export const createEventId = () => `evt_${randomUUID()}`;

export const normalizeEventInput = (input) => {
	requireObject(input, 'event');

	const eventId = requireString(input.eventId, 'eventId', { opaqueId: true });
	const customerChannelId = requireString(input.customerChannelId, 'customerChannelId', { opaqueId: true });
	const eventType = requireString(input.eventType, 'eventType');

	if (!eventTypeSet.has(eventType)) {
		throw new AwarenessValidationError(`unsupported eventType: ${eventType}`);
	}

	const actor = requireObject(input.actor, 'actor');
	const actorKind = requireString(actor.kind, 'actor.kind');

	if (!actorKindSet.has(actorKind)) {
		throw new AwarenessValidationError(`unsupported actor.kind: ${actorKind}`);
	}

	const normalizedActor = {
		kind: actorKind,
		id: requireString(actor.id, 'actor.id', { opaqueId: true }),
	};

	if (actor.display !== undefined) {
		normalizedActor.display = requireString(actor.display, 'actor.display');
	}

	const source = requireObject(input.source, 'source');
	const sourceSurface = requireString(source.surface, 'source.surface');

	if (!sourceSurfaceSet.has(sourceSurface)) {
		throw new AwarenessValidationError(`unsupported source.surface: ${sourceSurface}`);
	}

	const visibility = requireObject(input.visibility, 'visibility');
	const visibilityClass = requireString(visibility.class, 'visibility.class');

	if (!visibilityClassSet.has(visibilityClass)) {
		throw new AwarenessValidationError(`unsupported visibility.class: ${visibilityClass}`);
	}

	const grants = visibility.grants ?? [];

	if (!Array.isArray(grants)) {
		throw new AwarenessValidationError('visibility.grants must be an array');
	}

	const normalizedGrants = [...new Set(grants.map((grant, index) => requireString(grant, `visibility.grants[${index}]`, { opaqueId: true })))]
		.sort();

	return {
		schema: 1,
		eventId,
		customerChannelId,
		eventType,
		occurredAt: normalizeTimestamp(input.occurredAt, 'occurredAt'),
		actor: normalizedActor,
		source: {
			surface: sourceSurface,
			ref: requireString(source.ref, 'source.ref', { opaqueId: true }),
		},
		visibility: {
			class: visibilityClass,
			grants: normalizedGrants,
		},
		causationId: normalizeNullableId(input.causationId, 'causationId'),
		correlationId: normalizeNullableId(input.correlationId, 'correlationId'),
		payload: normalizePayload(input.payload),
	};
};

export const normalizeAccessGrant = (access) => {
	requireObject(access, 'access');
	const allowedVisibility = access.allowedVisibility ?? [];
	const grantIds = access.grantIds ?? [];

	if (!Array.isArray(allowedVisibility) || !Array.isArray(grantIds)) {
		throw new AwarenessValidationError('access.allowedVisibility and access.grantIds must be arrays');
	}

	const normalizedVisibility = new Set(
		allowedVisibility.map((value, index) => {
			requireString(value, `access.allowedVisibility[${index}]`);

			if (!visibilityClassSet.has(value)) {
				throw new AwarenessValidationError(`unsupported access visibility: ${value}`);
			}

			return value;
		}),
	);

	const normalizedGrantIds = new Set(
		grantIds.map((value, index) => requireString(value, `access.grantIds[${index}]`, { opaqueId: true })),
	);

	return { allowedVisibility: normalizedVisibility, grantIds: normalizedGrantIds };
};

export const canReadEvent = (event, access) => {
	const normalizedAccess = normalizeAccessGrant(access);

	if (!normalizedAccess.allowedVisibility.has(event.visibility.class)) {
		return false;
	}

	if (event.visibility.grants.length === 0) {
		return true;
	}

	return event.visibility.grants.some((grantId) => normalizedAccess.grantIds.has(grantId));
};
