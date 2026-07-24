const sourceLabels = {
	'email': 'Email',
	'sms': 'SMS',
	'rocket-chat': 'Business OS',
	'slack': 'Slack',
	'troublemaker': 'Troublemaker',
	'hostd': 'Hostd',
	'web': 'Web',
	'system': 'System',
};

const eventDirection = (eventType) => {
	if (eventType === 'message.inbound.recorded') return 'inbound';
	if (eventType.startsWith('message.outbound.')) return 'outbound';
	if (eventType.startsWith('collaboration.')) return 'internal';
	return 'relationship';
};

const getBody = (event) => {
	const candidates = [event.payload.body, event.payload.text, event.payload.note, event.payload.summary, event.payload.description];
	const body = candidates.find((value) => typeof value === 'string' && value.length > 0);

	if (body) {
		return body;
	}

	if (event.eventType === 'message.outbound.delivered') {
		return 'Delivery confirmed.';
	}

	if (event.eventType === 'message.outbound.failed') {
		return 'Delivery failed.';
	}

	return event.eventType.replaceAll('.', ' ');
};

export const formatAwarenessEvent = (event) => {
	const source = sourceLabels[event.source.surface] ?? event.source.surface;
	const actor = event.actor.display ?? `${event.actor.kind}:${event.actor.id}`;
	const direction = eventDirection(event.eventType);
	const header = `**${source} · ${direction} · ${actor}**`;

	return {
		text: `${header}\n${getBody(event)}`,
		metadata: {
			schema: 1,
			kind: event.eventType,
			eventId: event.eventId,
			customerChannelId: event.customerChannelId,
			sequence: event.sequence,
			source: event.source.surface,
			actorKind: event.actor.kind,
			actorId: event.actor.id,
			visibility: event.visibility.class,
			deliveryStatus: event.eventType.startsWith('message.outbound.') ? event.eventType.slice('message.outbound.'.length) : undefined,
		},
	};
};
