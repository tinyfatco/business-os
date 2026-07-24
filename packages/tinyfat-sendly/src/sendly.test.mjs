import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EncryptedJsonlAwarenessStore } from '../../tinyfat-awareness/src/index.mjs';
import { CustomerIdentityStore } from '../../tinyfat-customer-identity/src/index.mjs';
import {
	buildSendlySignature,
	SendlyDeliveryLedger,
	SendlyTransportError,
	TestScopedSendlyTransport,
	TinyFatSendlyBridge,
} from './index.mjs';

const senderAddress = '+17373300002';
const customerPhone = '+15125550199';
const webhookSecret = 'local-sendly-webhook-secret-for-tests';
const customerChannelId = 'cus_websites_acme';
const phoneEndpointId = 'end_acme_phone';
const now = new Date('2026-07-24T07:30:00.000Z');

const createFixture = async () => {
	const directory = await mkdtemp(join(tmpdir(), 'tinyfat-sendly-'));
	const identityStore = new CustomerIdentityStore({
		path: join(directory, 'identity.sqlite'),
		lookupKey: Buffer.alloc(32, 41),
		encryptionKey: Buffer.alloc(32, 43),
		clock: () => new Date(now),
	});
	const awarenessStore = new EncryptedJsonlAwarenessStore({
		rootDirectory: join(directory, 'awareness'),
		encryptionKey: Buffer.alloc(32, 47),
		clock: () => new Date(now),
	});
	const ledger = new SendlyDeliveryLedger({
		path: join(directory, 'sendly.sqlite'),
		clock: () => new Date(now),
	});
	identityStore.createCustomerChannel({
		id: customerChannelId,
		contextId: 'ctx_websites_acme',
		displayName: 'Acme website',
	});
	identityStore.createContact({ id: 'con_acme_owner', displayName: 'Acme Owner' });
	const { endpoint: emailEndpoint } = identityStore.observeEndpoint({
		id: 'end_acme_email',
		contactId: 'con_acme_owner',
		kind: 'email',
		value: 'owner@acme.example',
		source: 'gmail',
		verificationState: 'verified',
	});
	identityStore.addParticipant({ customerChannelId, contactId: 'con_acme_owner' });
	const challenge = identityStore.startLinkChallenge({
		id: 'lnk_acme_phone',
		sourceEndpointId: emailEndpoint.id,
		targetChannelId: customerChannelId,
		claimedKind: 'phone',
		claimedValue: customerPhone,
		code: '482193',
		initiatedBy: 'human_alex',
	});
	const linked = identityStore.verifyLinkChallenge({ challengeId: challenge.id, code: '482193' });
	assert.equal(linked.endpoint.id.length > 10, true);

	await awarenessStore.append({
		eventId: 'evt_acme_relationship',
		customerChannelId,
		eventType: 'relationship.created',
		occurredAt: now.toISOString(),
		actor: { kind: 'human', id: 'human_alex' },
		source: { surface: 'rocket-chat', ref: 'customer-room:acme' },
		visibility: { class: 'channel', grants: [] },
		payload: { summary: 'Acme website relationship' },
	});

	const calls = [];
	const transport = new TestScopedSendlyTransport({
		mode: 'test',
		apiKey: 'sendly-test-api-key-value',
		senderAddress,
		allowedRecipients: [customerPhone],
		fetchImpl: async (url, options) => {
			calls.push({ url, options });
			return new Response(JSON.stringify({ id: 'msg_sendly_local_001', status: 'queued' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		},
	});
	const bridge = new TinyFatSendlyBridge({
		identityStore,
		awarenessStore,
		ledger,
		transport,
		senderAddress,
		webhookSecret,
		clock: () => new Date(now),
	});
	return {
		awarenessStore,
		bridge,
		calls,
		directory,
		identityStore,
		ledger,
		linkedPhoneEndpointId: linked.endpoint.id,
		transport,
	};
};

const signedInbound = ({ body = 'Could we continue this website conversation by text?', messageId = 'msg_sendly_in_001' } = {}) => {
	const rawBody = JSON.stringify({
		type: 'message.received',
		data: {
			id: messageId,
			from: customerPhone,
			to: senderAddress,
			text: body,
			conversation_id: 'conv_sendly_acme_001',
			created_at: now.toISOString(),
		},
	});
	const timestamp = String(Math.floor(now.getTime() / 1000));
	return {
		rawBody,
		timestamp,
		signature: buildSendlySignature({ rawBody, secret: webhookSecret, timestamp }),
	};
};

test('signed Sendly inbound joins the linked email relationship without authoring a reply', async () => {
	const fixture = await createFixture();
	const first = await fixture.bridge.ingestSignedWebhook(signedInbound());
	assert.equal(first.disposition, 'resolved');
	assert.equal(first.customerChannelId, customerChannelId);
	assert.equal(first.appended, true);
	assert.equal(fixture.calls.length, 0, 'inbound recording must not auto-send');
	const replay = await fixture.bridge.ingestSignedWebhook(signedInbound());
	assert.equal(replay.appended, false);
	assert.equal(fixture.calls.length, 0);

	const events = await fixture.awarenessStore.read(customerChannelId);
	assert.deepEqual(events.map(({ eventType }) => eventType), [
		'relationship.created',
		'message.inbound.recorded',
	]);
	assert.equal(events[1].source.surface, 'sms');
	assert.equal(events[1].payload.endpointId, fixture.linkedPhoneEndpointId);
	const persisted = await readFile(join(fixture.directory, 'awareness', `${customerChannelId}.jsonl`), 'utf8');
	assert.equal(persisted.includes(customerPhone), false);
	assert.equal(persisted.includes('Could we continue'), false);

	fixture.ledger.close();
	fixture.identityStore.close();
});

test('agent-authored SMS records intent and receipt exactly once', async () => {
	const fixture = await createFixture();
	const result = await fixture.bridge.sendAgentAuthored({
		customerChannelId,
		endpointId: fixture.linkedPhoneEndpointId,
		body: 'Yes—this is Manny continuing the local cross-channel QA.',
		actor: { kind: 'agent', id: 'agent_manny', display: 'Manny' },
		source: { surface: 'troublemaker', ref: 'manny-turn:sendly-001' },
		idempotencyKey: 'sendly_manny_acme_001',
		correlationId: 'turn_manny_acme_001',
	});
	assert.equal(result.ok, true);
	assert.equal(result.duplicate, false);
	assert.equal(fixture.calls.length, 1);
	const request = JSON.parse(fixture.calls[0].options.body);
	assert.equal(request.from, senderAddress);
	assert.equal(request.to, customerPhone);
	assert.equal(request.text, 'Yes—this is Manny continuing the local cross-channel QA.');
	assert.equal(fixture.calls[0].options.headers.authorization, 'Bearer sendly-test-api-key-value');

	const replay = await fixture.bridge.sendAgentAuthored({
		customerChannelId,
		endpointId: fixture.linkedPhoneEndpointId,
		body: 'Yes—this is Manny continuing the local cross-channel QA.',
		actor: { kind: 'agent', id: 'agent_manny', display: 'Manny' },
		source: { surface: 'troublemaker', ref: 'manny-turn:sendly-001' },
		idempotencyKey: 'sendly_manny_acme_001',
		correlationId: 'turn_manny_acme_001',
	});
	assert.equal(replay.duplicate, true);
	assert.equal(fixture.calls.length, 1);
	const events = await fixture.awarenessStore.read(customerChannelId);
	assert.deepEqual(events.slice(1).map(({ eventType }) => eventType), [
		'message.outbound.requested',
		'message.outbound.delivered',
	]);
	assert.equal(events[1].actor.id, 'agent_manny');
	assert.equal(events[2].actor.id, 'system_hostd');
	assert.equal(fixture.ledger.get('sendly_manny_acme_001').status, 'completed');

	fixture.ledger.close();
	fixture.identityStore.close();
});

test('invalid signatures, cross-customer endpoints, and unapproved recipients fail closed', async () => {
	const fixture = await createFixture();
	const inbound = signedInbound();
	assert.deepEqual(
		await fixture.bridge.ingestSignedWebhook({ ...inbound, signature: `sha256=${'0'.repeat(64)}` }),
		{ disposition: 'rejected', reason: 'invalid-signature' },
	);
	fixture.identityStore.createCustomerChannel({
		id: 'cus_other_customer',
		contextId: 'ctx_other_customer',
		displayName: 'Other customer',
	});
	await assert.rejects(
		fixture.bridge.sendAgentAuthored({
			customerChannelId: 'cus_other_customer',
			endpointId: fixture.linkedPhoneEndpointId,
			body: 'This must not cross customer boundaries.',
			actor: { kind: 'agent', id: 'agent_manny' },
			source: { surface: 'troublemaker', ref: 'manny-turn:scope-denied' },
			idempotencyKey: 'sendly_scope_denied_001',
		}),
		/endpoint is not a participant/,
	);
	await assert.rejects(
		fixture.transport.send({
			to: '+15125550198',
			body: 'Not allowlisted',
			idempotencyKey: 'sendly_recipient_denied_001',
			customerChannelId,
			actor: { kind: 'agent', id: 'agent_manny' },
		}),
		(error) => error instanceof SendlyTransportError && error.code === 'sendly_test_recipient_denied',
	);
	assert.equal(fixture.calls.length, 0);

	fixture.ledger.close();
	fixture.identityStore.close();
});
