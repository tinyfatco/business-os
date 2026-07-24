import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { EncryptedJsonlAwarenessStore } from '../../tinyfat-awareness/src/index.mjs';
import {
	CustomerIdentityLinkService,
	CustomerIdentityStore,
	normalizeEndpoint,
} from './index.mjs';

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

test('reveals a delivery value only for a verified endpoint in the named channel', async () => {
	const { store } = await createStore();
	const relationship = createRelationship(store);
	assert.deepEqual(
		store.getVerifiedEndpointForChannel({
			customerChannelId: relationship.channelId,
			endpointId: relationship.endpointId,
			kind: 'email',
		}),
		{
			id: relationship.endpointId,
			contactId: relationship.contactId,
			kind: 'email',
			label: 'o***@acme.example',
			value: 'owner@acme.example',
			verificationState: 'verified',
		},
	);

	store.createCustomerChannel({
		id: 'cus_other_delivery_scope',
		contextId: 'ctx_other_delivery_scope',
		displayName: 'Other delivery scope',
	});
	assert.throws(
		() => store.getVerifiedEndpointForChannel({
			customerChannelId: 'cus_other_delivery_scope',
			endpointId: relationship.endpointId,
			kind: 'email',
		}),
		/endpoint is not a participant/,
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

test('suggests without mutation and supports an audited operator-approved link', async () => {
	const { path, store } = await createStore();
	const relationship = createRelationship(store);
	assert.deepEqual(
		store.suggestEndpointLink({
			sourceEndpointId: relationship.endpointId,
			targetChannelId: relationship.channelId,
			claimedKind: 'phone',
			claimedValue: '+1 512 555 0188',
		}),
		{
			disposition: 'suggested',
			reason: 'new-endpoint',
			label: 'phone ending 0188',
			requires: 'challenge-or-operator-approval',
		},
	);
	assert.equal(
		store.resolveInbound({
			provider: 'sendly',
			providerThreadId: 'before-operator-approval',
			endpointKind: 'phone',
			endpointValue: '+1 512 555 0188',
		}).disposition,
		'unknown',
	);

	const approved = store.approveEndpointLink({
		id: 'apr_acme_phone',
		sourceEndpointId: relationship.endpointId,
		targetChannelId: relationship.channelId,
		claimedKind: 'phone',
		claimedValue: '+1 512 555 0188',
		approvedBy: 'human_alex',
		reason: 'Customer confirmed the phone during a live operator conversation.',
	});
	assert.equal(approved.disposition, 'linked');
	assert.equal(approved.endpoint.label, 'phone ending 0188');
	assert.equal(
		store.resolveInbound({
			provider: 'sendly',
			providerThreadId: 'after-operator-approval',
			endpointKind: 'phone',
			endpointValue: '+1 512 555 0188',
		}).customerChannelId,
		relationship.channelId,
	);
	assert.deepEqual(
		store.listLinkAudit(relationship.channelId).map(({ action, actorId, outcome }) => ({
			action,
			actorId,
			outcome,
		})),
		[{
			action: 'operator.approved',
			actorId: 'human_alex',
			outcome: 'linked',
		}],
	);

	store.close();
	const bytes = await readFile(path);
	assert.equal(bytes.includes(Buffer.from('+15125550188')), false);
	assert.equal(bytes.includes(Buffer.from('Customer confirmed the phone')), false);
});

test('operator approval cannot silently absorb another contact and records the merge decision', async () => {
	const { store } = await createStore();
	const acme = createRelationship(store);
	const other = createRelationship(store, {
		channelId: 'cus_other_operator',
		contextId: 'ctx_other_operator',
		contactId: 'con_other_operator',
		endpointId: 'end_other_operator_email',
		email: 'operator-other@example.net',
	});
	store.observeEndpoint({
		id: 'end_other_operator_phone',
		contactId: other.contactId,
		kind: 'phone',
		value: '+1 512 555 0177',
		source: 'sendly',
		verificationState: 'verified',
	});

	const suggestion = store.suggestEndpointLink({
		sourceEndpointId: acme.endpointId,
		targetChannelId: acme.channelId,
		claimedKind: 'phone',
		claimedValue: '+1 512 555 0177',
	});
	assert.equal(suggestion.disposition, 'review-required');
	assert.deepEqual(suggestion.conflictingCustomerChannelIds, [other.channelId]);

	const approval = store.approveEndpointLink({
		id: 'apr_collision',
		sourceEndpointId: acme.endpointId,
		targetChannelId: acme.channelId,
		claimedKind: 'phone',
		claimedValue: '+1 512 555 0177',
		approvedBy: 'human_alex',
		reason: 'Operator wants this possible collision reviewed, not auto-merged.',
	});
	assert.equal(approval.disposition, 'merge-required');
	assert.equal(store.listMergeReviews()[0].status, 'pending');
	const decision = store.resolveMergeReview({
		reviewId: approval.reviewId,
		decision: 'approved',
		decidedBy: 'human_alex',
		note: 'Evidence is sufficient, but a separate merge operation must preserve both histories.',
	});
	assert.equal(decision.disposition, 'approved-pending-merge');
	assert.equal(store.listMergeReviews()[0].decidedBy, 'human_alex');
	assert.equal(
		store.resolveInbound({
			provider: 'sendly',
			providerThreadId: 'still-other-contact',
			endpointKind: 'phone',
			endpointValue: '+1 512 555 0177',
		}).customerChannelId,
		other.channelId,
		'approval records a decision but does not silently move the endpoint',
	);
	assert.deepEqual(
		store.listLinkAudit(acme.channelId).map(({ action, outcome }) => ({ action, outcome })),
		[
			{ action: 'operator.approved', outcome: 'merge-required' },
			{ action: 'merge-review.decided', outcome: 'approved' },
		],
	);
	store.close();
});

test('link challenges stop accepting guesses at the configured attempt limit', async () => {
	const { store } = await createStore();
	const relationship = createRelationship(store);
	const challenge = store.startLinkChallenge({
		id: 'lnk_attempt_limit',
		sourceEndpointId: relationship.endpointId,
		targetChannelId: relationship.channelId,
		claimedKind: 'phone',
		claimedValue: '+1 512 555 0166',
		code: '884422',
		initiatedBy: 'human_alex',
		maxAttempts: 2,
	});
	assert.deepEqual(
		store.verifyLinkChallenge({ challengeId: challenge.id, code: '000000', verifiedBy: 'contact_acme' }),
		{ disposition: 'failed', reason: 'incorrect-code' },
	);
	assert.deepEqual(
		store.verifyLinkChallenge({ challengeId: challenge.id, code: '111111', verifiedBy: 'contact_acme' }),
		{ disposition: 'failed', reason: 'incorrect-code' },
	);
	assert.deepEqual(
		store.verifyLinkChallenge({ challengeId: challenge.id, code: '884422', verifiedBy: 'contact_acme' }),
		{ disposition: 'failed', reason: 'challenge-not-pending' },
	);
	assert.deepEqual(
		store.listLinkAudit(relationship.channelId).map(({ action, actorId, outcome }) => ({
			action,
			actorId,
			outcome,
		})),
		[
			{ action: 'challenge.started', actorId: 'human_alex', outcome: 'pending' },
			{ action: 'challenge.verified', actorId: 'contact_acme', outcome: 'incorrect-code' },
			{ action: 'challenge.verified', actorId: 'contact_acme', outcome: 'attempt-limit-reached' },
		],
	);
	store.close();
});

test('identity service writes challenge and operator decisions into the canonical awareness stream', async () => {
	const { directory, store } = await createStore();
	const relationship = createRelationship(store);
	const awarenessStore = new EncryptedJsonlAwarenessStore({
		rootDirectory: join(directory, 'awareness'),
		encryptionKey,
		clock: () => new Date(testNow),
	});
	const service = new CustomerIdentityLinkService({
		identityStore: store,
		awarenessStore,
		clock: () => new Date(testNow),
	});
	const actor = { kind: 'human', id: 'human_alex', display: 'Alex' };
	const source = { surface: 'rocket-chat', ref: 'customer-room:acme-link' };
	const started = await service.startChallenge({
		id: 'lnk_service_phone',
		sourceEndpointId: relationship.endpointId,
		targetChannelId: relationship.channelId,
		claimedKind: 'phone',
		claimedValue: '+1 512 555 0155',
		code: '551155',
		actor,
		source,
	});
	await service.verifyChallenge({
		challengeId: started.challenge.id,
		code: 'wrong',
		actor: { kind: 'contact', id: 'contact_acme' },
		source: { surface: 'web', ref: 'verification-form:acme' },
	});
	const linked = await service.verifyChallenge({
		challengeId: started.challenge.id,
		code: '551155',
		actor: { kind: 'contact', id: 'contact_acme' },
		source: { surface: 'web', ref: 'verification-form:acme' },
	});
	assert.equal(linked.disposition, 'linked');

	const approved = await service.approve({
		id: 'apr_service_email',
		sourceEndpointId: relationship.endpointId,
		targetChannelId: relationship.channelId,
		claimedKind: 'email',
		claimedValue: 'billing@acme.example',
		reason: 'Customer confirmed the billing alias with Alex.',
		actor,
		source,
	});
	assert.equal(approved.disposition, 'linked');
	assert.deepEqual(
		(await awarenessStore.read(relationship.channelId)).map(({ eventType }) => eventType),
		[
			'endpoint.challenge.started',
			'endpoint.challenge.failed',
			'endpoint.verified',
			'endpoint.linked',
			'endpoint.link.approved',
			'endpoint.linked',
		],
	);
	assert.equal(
		(await awarenessStore.read(relationship.channelId))[4].payload.reason,
		'Customer confirmed the billing alias with Alex.',
	);
	store.close();
});
