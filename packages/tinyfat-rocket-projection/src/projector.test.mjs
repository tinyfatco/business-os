import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EncryptedJsonlAwarenessStore } from '../../tinyfat-awareness/src/index.mjs';
import { CustomerIdentityStore } from '../../tinyfat-customer-identity/src/index.mjs';
import { CustomerAwarenessProjector, RocketProjectionLedger } from './index.mjs';

const encryptionKey = Buffer.alloc(32, 23);
const lookupKey = Buffer.alloc(32, 29);
const now = '2026-07-23T23:30:00.000Z';

const createHarness = async () => {
	const directory = await mkdtemp(join(tmpdir(), 'tinyfat-projector-'));
	const awarenessStore = new EncryptedJsonlAwarenessStore({
		rootDirectory: join(directory, 'awareness'),
		encryptionKey,
		clock: () => new Date(now),
	});
	const identityStore = new CustomerIdentityStore({
		path: join(directory, 'identity.sqlite'),
		lookupKey,
		encryptionKey,
		clock: () => new Date(now),
	});
	const ledger = new RocketProjectionLedger({
		path: join(directory, 'projection.sqlite'),
		clock: () => new Date(now),
	});
	const calls = { rooms: [], messages: [] };
	let failNextMessage = false;
	const rocketClient = {
		async createCustomerRoom(input) {
			calls.rooms.push(input);
			return { roomId: 'room_acme', roomName: 'customer-acme' };
		},
		async postAwarenessEvent(input) {
			calls.messages.push(input);

			if (failNextMessage) {
				failNextMessage = false;
				throw new Error('simulated Rocket.Chat outage');
			}

			return { roomId: input.roomId, messageId: `message_${calls.messages.length}` };
		},
	};

	identityStore.createCustomerChannel({
		id: 'cus_acme',
		contextId: 'ctx_acme',
		displayName: 'Acme website',
	});

	return {
		awarenessStore,
		identityStore,
		ledger,
		calls,
		failNext: () => {
			failNextMessage = true;
		},
		projector: new CustomerAwarenessProjector({
			awarenessStore,
			identityStore,
			ledger,
			rocketClient,
			members: ['alex', 'batman'],
		}),
	};
};

const appendEvent = (store, overrides = {}) =>
	store.append({
		eventId: 'evt_email_inbound',
		customerChannelId: 'cus_acme',
		eventType: 'message.inbound.recorded',
		occurredAt: now,
		actor: { kind: 'contact', id: 'con_acme', display: 'Acme Owner' },
		source: { surface: 'email', ref: 'gmail-thread:opaque' },
		visibility: { class: 'channel', grants: [] },
		payload: { body: 'Can you help with our website?' },
		...overrides,
	});

test('creates one private room and idempotently projects awareness replay', async () => {
	const harness = await createHarness();
	await appendEvent(harness.awarenessStore);
	await appendEvent(harness.awarenessStore, {
		eventId: 'evt_batman_note',
		eventType: 'collaboration.message.recorded',
		actor: { kind: 'agent', id: 'agent_batman', display: 'Batman' },
		source: { surface: 'slack', ref: 'slack-thread:opaque' },
		payload: { note: 'I found the existing domain and archived site.' },
	});

	const first = await harness.projector.projectCustomerChannel('cus_acme');
	const replay = await harness.projector.projectCustomerChannel('cus_acme');

	assert.equal(first.roomId, 'room_acme');
	assert.equal(harness.calls.rooms.length, 1);
	assert.equal(harness.calls.messages.length, 2);
	assert.equal(
		replay.events.every(({ replayed }) => replayed),
		true,
	);
	assert.equal(harness.identityStore.getRocketBinding('cus_acme').roomId, 'room_acme');
	assert.match(harness.calls.messages[0].text, /Email · inbound · Acme Owner/);
	assert.equal(harness.calls.messages[0].metadata.eventId, 'evt_email_inbound');
	assert.match(harness.calls.messages[1].text, /Slack · internal · Batman/);
});

test('projects restricted collaboration only with its explicit grant', async () => {
	const harness = await createHarness();
	await appendEvent(harness.awarenessStore, {
		eventId: 'evt_private_batman_note',
		eventType: 'collaboration.message.recorded',
		actor: { kind: 'agent', id: 'agent_batman', display: 'Batman' },
		source: { surface: 'slack', ref: 'slack-thread:restricted' },
		visibility: { class: 'restricted', grants: ['grant_batman_acme'] },
		payload: { note: 'Scoped operator note.' },
	});

	const normal = await harness.projector.projectCustomerChannel('cus_acme');
	assert.equal(normal.events.length, 0);
	assert.equal(harness.calls.messages.length, 0);

	const granted = await harness.projector.projectCustomerChannel('cus_acme', {
		access: {
			allowedVisibility: ['channel', 'customer', 'restricted'],
			grantIds: ['grant_batman_acme'],
		},
	});
	assert.equal(granted.events.length, 1);
	assert.equal(harness.calls.messages.length, 1);
});

test('does not record a projection until Rocket.Chat accepts the message', async () => {
	const harness = await createHarness();
	await appendEvent(harness.awarenessStore);
	harness.failNext();

	await assert.rejects(harness.projector.projectCustomerChannel('cus_acme'), /simulated Rocket.Chat outage/);
	assert.equal(harness.ledger.get('evt_email_inbound'), undefined);

	const retry = await harness.projector.projectCustomerChannel('cus_acme');
	assert.equal(retry.events[0].replayed, false);
	assert.equal(harness.ledger.get('evt_email_inbound').roomId, 'room_acme');
});
