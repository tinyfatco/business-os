import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EncryptedJsonlAwarenessStore } from '../../tinyfat-awareness/src/index.mjs';
import {
	fileContainsGrantBearer,
	RelationshipGrantError,
	RelationshipGrantStore,
	ScopedRelationshipCollaboration,
} from './index.mjs';

const customerA = 'cus_websites_acme';
const customerB = 'cus_websites_other';
const correlationId = 'turn_slack_batman_acme';

const fixture = async () => {
	const directory = await mkdtemp(join(tmpdir(), 'tinyfat-collaboration-'));
	const databasePath = join(directory, 'grants.sqlite');
	const now = { value: new Date('2026-07-24T07:00:00.000Z') };
	const clock = () => new Date(now.value);
	const awarenessStore = new EncryptedJsonlAwarenessStore({
		rootDirectory: join(directory, 'awareness'),
		encryptionKey: Buffer.alloc(32, 31),
		clock,
	});
	const grantStore = new RelationshipGrantStore({
		path: databasePath,
		lookupKey: Buffer.alloc(32, 37),
		clock,
	});
	const collaboration = new ScopedRelationshipCollaboration({ grantStore, awarenessStore, clock });

	for (const customerChannelId of [customerA, customerB]) {
		await awarenessStore.append({
			eventId: `evt_relationship_${customerChannelId}`,
			customerChannelId,
			eventType: 'relationship.created',
			occurredAt: clock().toISOString(),
			actor: { kind: 'human', id: 'human_alex' },
			source: { surface: 'rocket-chat', ref: `room:${customerChannelId}` },
			visibility: { class: 'channel', grants: [] },
			payload: { summary: `Relationship ${customerChannelId}` },
		});
	}

	return { awarenessStore, collaboration, databasePath, grantStore, now };
};

test('Batman enters one relationship, collaborates with Manny, and cannot read another customer', async () => {
	const { awarenessStore, collaboration, databasePath, grantStore } = await fixture();
	const batman = await collaboration.issueGrant({
		id: 'grant_batman_acme',
		eventId: 'evt_grant_batman_acme',
		customerChannelId: customerA,
		subject: { kind: 'agent', id: 'agent_batman' },
		purpose: 'Help Alex and Manny with the Acme website relationship',
		allowedVisibility: ['channel', 'restricted'],
		actions: ['awareness.read', 'awareness.append', 'agent.collaborate'],
		issuedBy: 'human_alex',
		source: { surface: 'slack', ref: 'slack-thread:batman-acme' },
		token: 'batman-test-token-that-is-never-stored-in-plaintext',
	});
	assert.equal(fileContainsGrantBearer(databasePath, batman.token), false);
	assert.deepEqual(
		(await collaboration.read({ token: batman.token, customerChannelId: customerA }))
			.map(({ eventId }) => eventId),
		['evt_relationship_cus_websites_acme', 'evt_grant_batman_acme'],
	);
	await assert.rejects(
		Promise.resolve().then(() => collaboration.read({
			token: batman.token,
			customerChannelId: customerB,
		})),
		(error) => error instanceof RelationshipGrantError && error.code === 'customer_channel_scope_denied',
	);

	await collaboration.append({
		token: batman.token,
		customerChannelId: customerA,
		eventId: 'evt_batman_acme_research',
		text: 'I found the customer’s current website constraint and passed it to Manny.',
		source: { surface: 'slack', ref: 'slack-thread:batman-acme' },
		visibility: 'channel',
		correlationId,
	});

	const manny = await collaboration.issueGrant({
		id: 'grant_manny_acme',
		eventId: 'evt_grant_manny_acme',
		customerChannelId: customerA,
		subject: { kind: 'agent', id: 'agent_manny' },
		purpose: 'Continue the customer-scoped website collaboration',
		allowedVisibility: ['channel'],
		actions: ['awareness.read', 'awareness.append'],
		issuedBy: 'human_alex',
		source: { surface: 'rocket-chat', ref: 'customer-room:acme' },
		token: 'manny-test-token-that-is-never-stored-in-plaintext',
	});
	const mannyView = await collaboration.read({ token: manny.token, customerChannelId: customerA });
	assert.equal(mannyView.some(({ eventId }) => eventId === 'evt_batman_acme_research'), true);

	await collaboration.append({
		token: manny.token,
		customerChannelId: customerA,
		eventId: 'evt_manny_acme_response',
		text: 'I incorporated Batman’s research into the customer plan.',
		source: { surface: 'troublemaker', ref: 'manny-turn:acme' },
		visibility: 'channel',
		causationId: 'evt_batman_acme_research',
		correlationId,
	});
	const provenance = (await awarenessStore.read(customerA))
		.filter(({ eventId }) => ['evt_batman_acme_research', 'evt_manny_acme_response'].includes(eventId))
		.map(({ actor, source }) => ({ actor, source }));
	assert.deepEqual(provenance, [
		{
			actor: { kind: 'agent', id: 'agent_batman' },
			source: { surface: 'slack', ref: 'slack-thread:batman-acme' },
		},
		{
			actor: { kind: 'agent', id: 'agent_manny' },
			source: { surface: 'troublemaker', ref: 'manny-turn:acme' },
		},
	]);

	await collaboration.revoke({
		grantId: batman.grant.id,
		revokedBy: 'human_alex',
		source: { surface: 'slack', ref: 'slack-thread:batman-acme' },
		eventId: 'evt_revoke_batman_acme',
		correlationId,
	});
	await assert.rejects(
		Promise.resolve().then(() => collaboration.read({
			token: batman.token,
			customerChannelId: customerA,
		})),
		(error) => error instanceof RelationshipGrantError && error.code === 'grant_revoked',
	);

	grantStore.close();
});

test('expired grants fail closed', async () => {
	const { collaboration, grantStore, now } = await fixture();
	const issued = await collaboration.issueGrant({
		id: 'grant_batman_short',
		eventId: 'evt_grant_batman_short',
		customerChannelId: customerA,
		subject: { kind: 'agent', id: 'agent_batman' },
		purpose: 'One short relationship task',
		allowedVisibility: ['channel'],
		actions: ['awareness.read'],
		issuedBy: 'human_alex',
		ttlSeconds: 1,
		token: 'short-lived-batman-token-not-stored-in-plaintext',
	});
	now.value = new Date('2026-07-24T07:00:02.000Z');
	await assert.rejects(
		Promise.resolve().then(() => collaboration.read({
			token: issued.token,
			customerChannelId: customerA,
		})),
		(error) => error instanceof RelationshipGrantError && error.code === 'grant_expired',
	);
	assert.equal(grantStore.get(issued.grant.id).status, 'expired');
	grantStore.close();
});
