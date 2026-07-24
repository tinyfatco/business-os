import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { EncryptedJsonlAwarenessStore } from '../packages/tinyfat-awareness/src/index.mjs';
import {
	RelationshipGrantStore,
	ScopedRelationshipCollaboration,
} from '../packages/tinyfat-collaboration/src/index.mjs';
import {
	CustomerIdentityLinkService,
	CustomerIdentityStore,
} from '../packages/tinyfat-customer-identity/src/index.mjs';
import {
	CustomerAwarenessProjector,
	RocketChatClient,
	RocketProjectionLedger,
} from '../packages/tinyfat-rocket-projection/src/index.mjs';
import {
	buildSendlySignature,
	SendlyDeliveryLedger,
	TestScopedSendlyTransport,
	TinyFatSendlyBridge,
} from '../packages/tinyfat-sendly/src/index.mjs';

const requiredEnvironment = ['ROCKETCHAT_URL', 'ROCKETCHAT_USER_ID', 'ROCKETCHAT_AUTH_TOKEN'];
for (const name of requiredEnvironment) {
	if (!process.env[name]) throw new Error(`${name} is required`);
}

const stateParent = process.env.TINYFAT_SPIKE_STATE_DIR
	?? join(homedir(), '.local', 'share', 'tinyfat-business-os', 'cross-channel-spike');
await mkdir(stateParent, { recursive: true, mode: 0o700 });
const stateRoot = await mkdtemp(join(stateParent, 'run-'));
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const customerChannelId = `cus_local_cross_${runId}`;
const contextId = `ctx_local_cross_${runId}`;
const contactId = `con_local_customer_${runId}`;
const emailEndpointId = `end_local_email_${runId}`;
const senderAddress = '+17373300002';
const customerPhone = '+15125550199';
const customerEmail = 'customer@example.test';
const occurredAt = new Date().toISOString();
const webhookSecret = randomBytes(32).toString('base64url');
const lookupKey = randomBytes(32);
const encryptionKey = randomBytes(32);
const awarenessStore = new EncryptedJsonlAwarenessStore({
	rootDirectory: join(stateRoot, 'awareness'),
	encryptionKey,
});
const identityStore = new CustomerIdentityStore({
	path: join(stateRoot, 'identity.sqlite'),
	lookupKey,
	encryptionKey,
});
const collaborationGrantStore = new RelationshipGrantStore({
	path: join(stateRoot, 'collaboration.sqlite'),
	lookupKey,
});
const sendlyLedger = new SendlyDeliveryLedger({
	path: join(stateRoot, 'sendly.sqlite'),
});
const projectionLedger = new RocketProjectionLedger({
	path: join(stateRoot, 'rocket-projection.sqlite'),
});

try {
	identityStore.createCustomerChannel({
		id: customerChannelId,
		contextId,
		displayName: `Local cross-channel customer ${runId}`,
	});
	identityStore.createContact({ id: contactId, displayName: 'Example Customer' });
	const { endpoint: emailEndpoint } = identityStore.observeEndpoint({
		id: emailEndpointId,
		contactId,
		kind: 'email',
		value: customerEmail,
		source: 'local-cross-channel-spike',
		verificationState: 'verified',
	});
	identityStore.addParticipant({ customerChannelId, contactId });

	await awarenessStore.append({
		eventId: `evt_relationship_${runId}`,
		customerChannelId,
		eventType: 'relationship.created',
		occurredAt,
		actor: { kind: 'human', id: 'human_alex', display: 'Alex' },
		source: { surface: 'rocket-chat', ref: `local-spike:${runId}` },
		visibility: { class: 'channel', grants: [] },
		payload: { summary: 'One local customer relationship spanning email, SMS, Slack, and Troublemaker.' },
	});
	await awarenessStore.append({
		eventId: `evt_email_${runId}`,
		customerChannelId,
		eventType: 'message.inbound.recorded',
		occurredAt,
		actor: { kind: 'contact', id: contactId, display: 'Example Customer' },
		source: { surface: 'email', ref: `gmail-thread:${runId}` },
		visibility: { class: 'channel', grants: [] },
		payload: {
			endpointId: emailEndpoint.id,
			providerThreadId: `pth_gmail_${runId}`,
			body: 'Can we keep the same website conversation going by text?',
		},
	});

	const challengeId = `lnk_phone_${runId}`;
	const challengeCode = '482193';
	const identityLinks = new CustomerIdentityLinkService({
		identityStore,
		awarenessStore,
	});
	await identityLinks.startChallenge({
		id: challengeId,
		sourceEndpointId: emailEndpoint.id,
		targetChannelId: customerChannelId,
		claimedKind: 'phone',
		claimedValue: customerPhone,
		code: challengeCode,
		actor: { kind: 'human', id: 'human_alex', display: 'Alex' },
		source: { surface: 'hostd', ref: `identity-challenge:${runId}` },
	});
	const linked = await identityLinks.verifyChallenge({
		challengeId,
		code: challengeCode,
		actor: { kind: 'contact', id: contactId, display: 'Example Customer' },
		source: { surface: 'web', ref: `verification-form:${runId}` },
	});
	if (linked.disposition !== 'linked') throw new Error(`local link failed: ${linked.disposition}`);

	const fakeProviderCalls = [];
	const sendlyTransport = new TestScopedSendlyTransport({
		mode: 'test',
		apiKey: 'local-spike-key-never-used-on-network',
		senderAddress,
		allowedRecipients: [customerPhone],
		fetchImpl: async (url, options) => {
			fakeProviderCalls.push({ url, options });
			return new Response(JSON.stringify({
				id: `msg_sendly_fake_${runId}`,
				status: 'queued',
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		},
	});
	const sendlyBridge = new TinyFatSendlyBridge({
		identityStore,
		awarenessStore,
		ledger: sendlyLedger,
		transport: sendlyTransport,
		senderAddress,
		webhookSecret,
	});
	const inboundBody = JSON.stringify({
		type: 'message.received',
		data: {
			id: `msg_sendly_in_${runId}`,
			from: customerPhone,
			to: senderAddress,
			text: 'Texting the same TinyFat website relationship now.',
			conversation_id: `conv_sendly_${runId}`,
			created_at: occurredAt,
		},
	});
	const inboundTimestamp = String(Math.floor(Date.now() / 1000));
	const inbound = await sendlyBridge.ingestSignedWebhook({
		rawBody: inboundBody,
		timestamp: inboundTimestamp,
		signature: buildSendlySignature({
			rawBody: inboundBody,
			secret: webhookSecret,
			timestamp: inboundTimestamp,
		}),
	});
	if (inbound.disposition !== 'resolved' || fakeProviderCalls.length !== 0) {
		throw new Error('signed inbound SMS did not resolve without an automatic reply');
	}

	const collaboration = new ScopedRelationshipCollaboration({
		grantStore: collaborationGrantStore,
		awarenessStore,
	});
	const batman = await collaboration.issueGrant({
		id: `grant_batman_${runId}`,
		eventId: `evt_grant_batman_${runId}`,
		customerChannelId,
		subject: { kind: 'agent', id: 'agent_batman' },
		purpose: 'Help Alex and Manny with this one website relationship',
		allowedVisibility: ['channel', 'restricted'],
		actions: ['awareness.read', 'awareness.append', 'agent.collaborate'],
		issuedBy: 'human_alex',
		source: { surface: 'slack', ref: `slack-thread:${runId}` },
	});
	await collaboration.append({
		token: batman.token,
		customerChannelId,
		eventId: `evt_batman_${runId}`,
		text: 'Batman connected the email and SMS context for this customer’s Manny.',
		source: { surface: 'slack', ref: `slack-thread:${runId}` },
		visibility: 'channel',
		correlationId: `turn_cross_${runId}`,
	});
	const manny = await collaboration.issueGrant({
		id: `grant_manny_${runId}`,
		eventId: `evt_grant_manny_${runId}`,
		customerChannelId,
		subject: { kind: 'agent', id: 'agent_manny' },
		purpose: 'Continue the customer relationship after Batman’s scoped handoff',
		allowedVisibility: ['channel'],
		actions: ['awareness.read', 'awareness.append'],
		issuedBy: 'human_alex',
		source: { surface: 'rocket-chat', ref: `customer-room:${runId}` },
	});
	const mannyView = await collaboration.read({ token: manny.token, customerChannelId });
	if (!mannyView.some(({ eventId }) => eventId === `evt_batman_${runId}`)) {
		throw new Error('Manny could not read Batman’s channel-scoped handoff');
	}
	await collaboration.append({
		token: manny.token,
		customerChannelId,
		eventId: `evt_manny_${runId}`,
		text: 'Manny accepted the scoped handoff and chose the SMS reply.',
		source: { surface: 'troublemaker', ref: `manny-turn:${runId}` },
		visibility: 'channel',
		causationId: `evt_batman_${runId}`,
		correlationId: `turn_cross_${runId}`,
	});
	await sendlyBridge.sendAgentAuthored({
		customerChannelId,
		endpointId: linked.endpoint.id,
		body: 'Local TinyFat Business OS spike: this SMS was agent-authored and delivered only to a fake provider.',
		actor: { kind: 'agent', id: 'agent_manny', display: 'Manny' },
		source: { surface: 'troublemaker', ref: `manny-turn:${runId}` },
		idempotencyKey: `sendly_spike_${runId}`,
		providerThreadId: inbound.providerThreadId,
		causationId: `evt_manny_${runId}`,
		correlationId: `turn_cross_${runId}`,
	});
	if (fakeProviderCalls.length !== 1) throw new Error('fake Sendly delivery was not exactly once');

	const rocketClient = new RocketChatClient({
		baseUrl: process.env.ROCKETCHAT_URL,
		userId: process.env.ROCKETCHAT_USER_ID,
		authToken: process.env.ROCKETCHAT_AUTH_TOKEN,
	});
	const projector = new CustomerAwarenessProjector({
		awarenessStore,
		identityStore,
		ledger: projectionLedger,
		rocketClient,
	});
	const access = {
		allowedVisibility: ['customer', 'channel', 'restricted'],
		grantIds: [batman.grant.id, manny.grant.id],
	};
	const projected = await projector.projectCustomerChannel(customerChannelId, { access });
	const replayed = await projector.projectCustomerChannel(customerChannelId, { access });
	const events = await awarenessStore.read(customerChannelId);
	const sources = [...new Set(events.map(({ source }) => source.surface))].sort();
	const sequences = events.map(({ sequence }) => sequence);
	if (!sequences.every((sequence, index) => sequence === index + 1)) {
		throw new Error('awareness sequence is not contiguous');
	}
	for (const required of ['email', 'sms', 'slack', 'troublemaker']) {
		if (!sources.includes(required)) throw new Error(`missing ${required} awareness source`);
	}

	console.log(JSON.stringify({
		ok: true,
		customerChannelId,
		roomId: projected.roomId,
		awarenessEvents: events.length,
		sources,
		emailEndpointId: emailEndpoint.id,
		linkedPhoneEndpointId: linked.endpoint.id,
		senderAddress,
		sendlyMode: 'fake-fetch-test-only',
		fakeProviderCalls: fakeProviderCalls.length,
		firstProjectionPosts: projected.events.filter(({ replayed: value }) => !value).length,
		replayDuplicates: replayed.events.filter(({ replayed: value }) => value).length,
		stateRoot,
	}, null, 2));
} finally {
	projectionLedger.close();
	sendlyLedger.close();
	collaborationGrantStore.close();
	identityStore.close();
}
