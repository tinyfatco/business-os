import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CustomerIdentityStore, normalizeEndpoint } from './index.mjs';

const lookupKey = Buffer.alloc(32, 11);
const encryptionKey = Buffer.alloc(32, 17);
const testNow = new Date('2026-07-23T23:00:00.000Z');

const createStore = async () => {
	const directory = await mkdtemp(join(tmpdir(), 'tinyfat-identity-'));
	const path = join(directory, 'identity.sqlite');
	const store = new CustomerIdentityStore({
		path,
		lookupKey,
		encryptionKey,
		clock: () => new Date(testNow),
	});

	return { directory, path, store };
};

const createRelationship = (store, {
	channelId = 'cus_websites_acme',
	contextId = 'ctx_websites_acme',
	contactId = 'con_acme_owner',
	endpointId = 'end_acme_email',
	email = 'OWNER@ACME.EXAMPLE',
} = {}) => {
	store.createCustomerChannel({ id: channelId, contextId, displayName: 'Acme website' });
	store.createContact({ id: contactId, displayName: 'Acme Owner' });
	const observed = store.observeEndpoint({
		id: endpointId,
		contactId,
		kind: 'email',
		value: email,
		source: 'gmail',
		verificationState: 'verified',
	});
	store.addParticipant({ customerChannelId: channelId, contactId });

	return { channelId, contactId, endpointId: observed.endpoint.id };
};

test('normalizes and encrypts endpoints and contact display data', async () => {
	const { path, store } = await createStore();
	const relationship = createRelationship(store);

	assert.equal(normalizeEndpoint('email', ' OWNER@ACME.EXAMPLE '), 'owner@acme.example');
	assert.equal(normalizeEndpoint('phone', '(737) 330-0002'), '+17373300002');
	assert.equal(store.getEndpoint(relationship.endpointId).label, 'o***@acme.example');
	assert.equal(store.getEndpointValueForDelivery(relationship.endpointId), 'owner@acme.example');

	const duplicate = store.observeEndpoint({
		id: 'end_duplicate',
		kind: 'email',
		value: 'owner@acme.example',
		source: 'manual',
	});
	assert.equal(duplicate.created, false);
	assert.equal(duplicate.endpoint.id, relationship.endpointId);

	store.close();
	const bytes = await readFile(path);
	assert.equal(bytes.includes(Buffer.from('owner@acme.example')), false);
	assert.equal(bytes.includes(Buffer.from('Acme Owner')), false);
});

test('resolves a unique endpoint and then a bound provider thread', async () => {
	const { store } = await createStore();
	const relationship = createRelationship(store);

	assert.deepEqual(
		store.resolveInbound({
			provider: 'gmail',
			providerThreadId: 'thread-new',
			endpointKind: 'email',
			endpointValue: 'owner@acme.example',
		}),
		{
			disposition: 'resolved',
			reason: 'unique-endpoint',
			customerChannelId: relationship.channelId,
			contactId: relationship.contactId,
			endpointId: relationship.endpointId,
		},
	);

	const thread = store.bindProviderThread({
		id: 'pth_gmail_acme',
		customerChannelId: relationship.channelId,
		endpointId: relationship.endpointId,
		provider: 'gmail',
		providerThreadId: 'thread-native-123',
	});
	assert.equal(thread.customerChannelId, relationship.channelId);
	assert.equal(
		store.resolveInbound({
			provider: 'gmail',
			providerThreadId: 'thread-native-123',
			endpointKind: 'email',
			endpointValue: 'owner@acme.example',
		}).reason,
		'provider-thread',
	);
});

test('quarantines an unexpected sender on a known provider thread', async () => {
	const { store } = await createStore();
	const acme = createRelationship(store);
	store.bindProviderThread({
		customerChannelId: acme.channelId,
		endpointId: acme.endpointId,
		provider: 'gmail',
		providerThreadId: 'thread-native-123',
	});

	store.createContact({ id: 'con_intruder', displayName: 'Unexpected Sender' });
	store.observeEndpoint({
		id: 'end_intruder',
		contactId: 'con_intruder',
		kind: 'email',
		value: 'unexpected@example.net',
		source: 'gmail',
		verificationState: 'verified',
	});

	assert.deepEqual(
		store.resolveInbound({
			provider: 'gmail',
			providerThreadId: 'thread-native-123',
			endpointKind: 'email',
			endpointValue: 'unexpected@example.net',
		}),
		{
			disposition: 'quarantine',
			reason: 'unexpected-participant',
			customerChannelId: acme.channelId,
			endpointId: 'end_intruder',
		},
	);
});

test('fails closed when one contact participates in multiple active customer channels', async () => {
	const { store } = await createStore();
	const relationship = createRelationship(store);
	store.createCustomerChannel({
		id: 'cus_acme_second_project',
		contextId: 'ctx_acme_second_project',
		displayName: 'Acme second project',
	});
	store.addParticipant({
		customerChannelId: 'cus_acme_second_project',
		contactId: relationship.contactId,
	});

	assert.deepEqual(
		store.resolveInbound({
			provider: 'gmail',
			providerThreadId: 'unknown-thread',
			endpointKind: 'email',
			endpointValue: 'owner@acme.example',
		}),
		{
			disposition: 'ambiguous',
			reason: 'multiple-customer-channels',
			endpointId: relationship.endpointId,
			candidateCustomerChannelIds: ['cus_acme_second_project', 'cus_websites_acme'],
		},
	);
});

test('links a newly verified phone endpoint to the existing customer relationship', async () => {
	const { store } = await createStore();
	const relationship = createRelationship(store);
	const challenge = store.startLinkChallenge({
		id: 'lnk_acme_phone',
		sourceEndpointId: relationship.endpointId,
		targetChannelId: relationship.channelId,
		claimedKind: 'phone',
		claimedValue: '(737) 330-0002',
		code: '482193',
		initiatedBy: 'human_alex',
	});

	assert.equal(challenge.status, 'pending');
	assert.deepEqual(store.verifyLinkChallenge({ challengeId: challenge.id, code: 'wrong-code' }), {
		disposition: 'failed',
		reason: 'incorrect-code',
	});

	const verified = store.verifyLinkChallenge({ challengeId: challenge.id, code: '482193' });
	assert.equal(verified.disposition, 'linked');
	assert.equal(verified.contactId, relationship.contactId);
	assert.equal(verified.endpoint.kind, 'phone');
	assert.equal(verified.endpoint.label, 'phone ending 0002');
	assert.equal(
		store.resolveInbound({
			provider: 'sendly',
			providerThreadId: 'new-sendly-conversation',
			endpointKind: 'phone',
			endpointValue: '+1 737 330 0002',
		}).customerChannelId,
		relationship.channelId,
	);
});

test('requires merge review when a verified endpoint belongs to another contact', async () => {
	const { store } = await createStore();
	const acme = createRelationship(store);
	const other = createRelationship(store, {
		channelId: 'cus_other_company',
		contextId: 'ctx_other_company',
		contactId: 'con_other_owner',
		endpointId: 'end_other_email',
		email: 'other@example.net',
	});
	store.observeEndpoint({
		id: 'end_other_phone',
		contactId: other.contactId,
		kind: 'phone',
		value: '+1 512 555 0199',
		source: 'sendly',
		verificationState: 'verified',
	});

	const challenge = store.startLinkChallenge({
		id: 'lnk_collision',
		sourceEndpointId: acme.endpointId,
		targetChannelId: acme.channelId,
		claimedKind: 'phone',
		claimedValue: '+1 512 555 0199',
		code: '550122',
		initiatedBy: 'human_alex',
	});
	const result = store.verifyLinkChallenge({ challengeId: challenge.id, code: '550122' });

	assert.equal(result.disposition, 'merge-required');
	assert.equal(result.targetCustomerChannelId, acme.channelId);
	assert.equal(store.listMergeReviews().length, 1);
	assert.equal(
		store.resolveInbound({
			provider: 'sendly',
			providerThreadId: 'unbound-sendly-thread',
			endpointKind: 'phone',
			endpointValue: '+1 512 555 0199',
		}).customerChannelId,
		other.channelId,
	);
});
