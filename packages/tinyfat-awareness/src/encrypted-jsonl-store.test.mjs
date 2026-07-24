import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	AwarenessIntegrityError,
	AwarenessValidationError,
	EncryptedJsonlAwarenessStore,
} from './index.mjs';

const encryptionKey = Buffer.alloc(32, 7);
const occurredAt = '2026-07-23T22:18:00.000Z';
const recordedAt = '2026-07-23T22:18:01.000Z';

const makeInput = (overrides = {}) => ({
	eventId: 'evt_email_received',
	customerChannelId: 'cus_websites_example',
	eventType: 'message.inbound.recorded',
	occurredAt,
	actor: {
		kind: 'contact',
		id: 'con_example',
		display: 'Example Customer',
	},
	source: {
		surface: 'email',
		ref: 'gmail-thread:opaque',
	},
	visibility: {
		class: 'channel',
		grants: [],
	},
	causationId: null,
	correlationId: 'turn_example',
	payload: {
		body: 'Can you help with our website?',
		endpointId: 'end_email_example',
	},
	...overrides,
});

const createStore = async () => {
	const rootDirectory = await mkdtemp(join(tmpdir(), 'tinyfat-awareness-'));
	const store = new EncryptedJsonlAwarenessStore({
		rootDirectory,
		encryptionKey,
		clock: () => new Date(recordedAt),
	});

	return { rootDirectory, store };
};

test('appends encrypted events with strict sequence and replays them', async () => {
	const { rootDirectory, store } = await createStore();
	const first = await store.append(makeInput());
	const second = await store.append(
		makeInput({
			eventId: 'evt_agent_turn',
			eventType: 'agent.turn.requested',
			actor: { kind: 'system', id: 'sys_hostd' },
			source: { surface: 'hostd', ref: 'hostd-event:opaque' },
			payload: { reason: 'new-inbound-email' },
		}),
	);

	assert.equal(first.appended, true);
	assert.equal(first.event.sequence, 1);
	assert.equal(second.event.sequence, 2);
	assert.deepEqual(await store.read('cus_websites_example'), [first.event, second.event]);

	const persisted = await readFile(join(rootDirectory, 'cus_websites_example.jsonl'), 'utf8');
	assert.equal(persisted.includes('Can you help with our website?'), false);
	assert.equal(persisted.includes('Example Customer'), false);
	assert.match(persisted, /"algorithm":"aes-256-gcm"/);
});

test('makes producer retries idempotent and rejects event ID conflicts', async () => {
	const { store } = await createStore();
	const first = await store.append(makeInput());
	const retry = await store.append(makeInput());

	assert.equal(first.appended, true);
	assert.equal(retry.appended, false);
	assert.deepEqual(retry.event, first.event);
	assert.equal((await store.read('cus_websites_example')).length, 1);

	await assert.rejects(
		store.append(makeInput({ payload: { body: 'different content' } })),
		(error) => error instanceof AwarenessValidationError && /different content/.test(error.message),
	);
});

test('serializes concurrent appends for one customer channel', async () => {
	const { store } = await createStore();
	const results = await Promise.all(
		Array.from({ length: 20 }, (_, index) =>
			store.append(
				makeInput({
					eventId: `evt_concurrent_${index}`,
					payload: { index },
				}),
			),
		),
	);

	assert.deepEqual(
		results.map(({ event }) => event.sequence),
		Array.from({ length: 20 }, (_, index) => index + 1),
	);
});

test('filters projections by visibility class and explicit grant', async () => {
	const { store } = await createStore();
	await store.append(makeInput());
	await store.append(
		makeInput({
			eventId: 'evt_restricted_note',
			eventType: 'collaboration.message.recorded',
			visibility: { class: 'restricted', grants: ['grant_batman_example'] },
			actor: { kind: 'agent', id: 'agent_batman' },
			source: { surface: 'slack', ref: 'slack-thread:opaque' },
			payload: { note: 'Scoped operator research' },
		}),
	);

	const normalChannelView = await store.readVisible('cus_websites_example', {
		allowedVisibility: ['channel'],
		grantIds: [],
	});
	const batmanView = await store.readVisible('cus_websites_example', {
		allowedVisibility: ['channel', 'restricted'],
		grantIds: ['grant_batman_example'],
	});

	assert.deepEqual(normalChannelView.map(({ eventId }) => eventId), ['evt_email_received']);
	assert.deepEqual(batmanView.map(({ eventId }) => eventId), ['evt_email_received', 'evt_restricted_note']);
});

test('detects tampering before replaying a canonical stream', async () => {
	const { rootDirectory, store } = await createStore();
	await store.append(makeInput());
	const filePath = join(rootDirectory, 'cus_websites_example.jsonl');
	const persisted = await readFile(filePath, 'utf8');
	await writeFile(filePath, persisted.replace('"eventType":"message.inbound.recorded"', '"eventType":"message.outbound.delivered"'));

	await assert.rejects(
		store.read('cus_websites_example'),
		(error) => error instanceof AwarenessIntegrityError && /event hash/.test(error.message),
	);
});

test('rejects traversal-shaped customer identifiers', async () => {
	const { store } = await createStore();

	await assert.rejects(
		store.append(makeInput({ customerChannelId: '../another-customer' })),
		(error) => error instanceof AwarenessValidationError && /path characters/.test(error.message),
	);
});
