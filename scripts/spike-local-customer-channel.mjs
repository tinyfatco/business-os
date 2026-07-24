import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { EncryptedJsonlAwarenessStore } from '../packages/tinyfat-awareness/src/index.mjs';
import { CustomerIdentityStore } from '../packages/tinyfat-customer-identity/src/index.mjs';
import {
	CustomerAwarenessProjector,
	RocketChatClient,
	RocketProjectionLedger,
	slugifyRoomName,
} from '../packages/tinyfat-rocket-projection/src/index.mjs';

const requiredEnvironment = ['ROCKETCHAT_URL', 'ROCKETCHAT_USER_ID', 'ROCKETCHAT_AUTH_TOKEN'];

for (const name of requiredEnvironment) {
	if (!process.env[name]) {
		throw new Error(`${name} is required`);
	}
}

const stateRoot =
	process.env.TINYFAT_SPIKE_STATE_DIR ?? join(homedir(), '.local', 'share', 'tinyfat-business-os', 'customer-channel-spike');
const keysPath = join(stateRoot, 'keys.json');

const loadOrCreateKeys = async () => {
	await mkdir(stateRoot, { recursive: true, mode: 0o700 });

	try {
		const stored = JSON.parse(await readFile(keysPath, 'utf8'));
		return {
			awarenessKey: Buffer.from(stored.awarenessKey, 'base64'),
			lookupKey: Buffer.from(stored.lookupKey, 'base64'),
		};
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}

	const generated = {
		awarenessKey: randomBytes(32),
		lookupKey: randomBytes(32),
	};
	await writeFile(
		keysPath,
		`${JSON.stringify({
			awarenessKey: generated.awarenessKey.toString('base64'),
			lookupKey: generated.lookupKey.toString('base64'),
		})}\n`,
		{ encoding: 'utf8', mode: 0o600, flag: 'wx' },
	);
	await chmod(keysPath, 0o600);
	return generated;
};

const customerChannelId = 'cus_tinyfat_websites_spike';
const contextId = 'ctx_tinyfat_websites_spike';
const contactId = 'con_tinyfat_internal_qa';
const endpointId = 'end_tinyfat_internal_qa_email';
const providerThreadId = 'gmail-thread:tinyfat-business-os-spike';
const batmanGrantId = 'grant_batman_tinyfat_websites_spike';
const occurredAt = '2026-07-23T23:30:00.000Z';

const keys = await loadOrCreateKeys();
const awarenessStore = new EncryptedJsonlAwarenessStore({
	rootDirectory: join(stateRoot, 'awareness'),
	encryptionKey: keys.awarenessKey,
});
const identityStore = new CustomerIdentityStore({
	path: join(stateRoot, 'identity.sqlite'),
	lookupKey: keys.lookupKey,
	encryptionKey: keys.awarenessKey,
});
const projectionLedger = new RocketProjectionLedger({
	path: join(stateRoot, 'rocket-projection.sqlite'),
});

try {
	if (!identityStore.getCustomerChannel(customerChannelId)) {
		identityStore.createCustomerChannel({
			id: customerChannelId,
			contextId,
			displayName: 'TinyFat Websites — internal QA',
		});
	}

	if (!identityStore.getContact(contactId)) {
		identityStore.createContact({
			id: contactId,
			displayName: 'Alex · internal QA',
		});
	}

	const { endpoint } = identityStore.observeEndpoint({
		id: endpointId,
		contactId,
		kind: 'email',
		value: 'alex@tinyfat.com',
		source: 'local-spike',
		verificationState: 'verified',
	});
	identityStore.addParticipant({
		customerChannelId,
		contactId,
		relationshipRole: 'customer-and-operator-test',
	});
	identityStore.bindProviderThread({
		id: 'pth_tinyfat_internal_qa_email',
		customerChannelId,
		endpointId: endpoint.id,
		provider: 'gmail',
		providerThreadId,
		lastEventAt: occurredAt,
	});

	await awarenessStore.append({
		eventId: 'evt_tinyfat_websites_relationship_created',
		customerChannelId,
		eventType: 'relationship.created',
		occurredAt,
		actor: { kind: 'human', id: 'human_alex', display: 'Alex' },
		source: { surface: 'rocket-chat', ref: 'local-spike:relationship' },
		visibility: { class: 'channel', grants: [] },
		payload: {
			summary: 'Internal QA relationship for the first awareness-backed TinyFat customer channel.',
		},
	});
	await awarenessStore.append({
		eventId: 'evt_tinyfat_websites_email_inbound',
		customerChannelId,
		eventType: 'message.inbound.recorded',
		occurredAt,
		actor: { kind: 'contact', id: contactId, display: 'Alex · internal QA' },
		source: { surface: 'email', ref: providerThreadId },
		visibility: { class: 'channel', grants: [] },
		payload: {
			endpointId: endpoint.id,
			providerThreadId: 'pth_tinyfat_internal_qa_email',
			body: 'Can Manny help turn this website conversation into a durable customer relationship?',
		},
	});
	await awarenessStore.append({
		eventId: 'evt_tinyfat_websites_batman_collaboration',
		customerChannelId,
		eventType: 'collaboration.message.recorded',
		occurredAt,
		actor: { kind: 'agent', id: 'agent_batman', display: 'Batman' },
		source: { surface: 'slack', ref: 'slack-thread:tinyfat-business-os-spike' },
		visibility: { class: 'restricted', grants: [batmanGrantId] },
		payload: {
			note: 'Batman opened a relationship-scoped collaboration window for this customer Manny.',
		},
	});

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
	const result = await projector.projectCustomerChannel(customerChannelId, {
		access: {
			allowedVisibility: ['customer', 'channel', 'restricted'],
			grantIds: [batmanGrantId],
		},
	});
	const events = await awarenessStore.read(customerChannelId);

	console.log(
		JSON.stringify(
			{
				customerChannelId,
				roomId: result.roomId,
				roomName: slugifyRoomName('TinyFat Websites — internal QA', customerChannelId),
				awarenessEvents: events.length,
				projectedEvents: result.events.length,
				replayedEvents: result.events.filter(({ replayed }) => replayed).length,
				stateRoot,
			},
			null,
			2,
		),
	);
} finally {
	projectionLedger.close();
	identityStore.close();
}
