import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
	assertOpaqueId,
	createLookupHmac,
	decryptValue,
	encryptValue,
	getSafeEndpointLabel,
	normalizeEndpoint,
} from './endpoint.mjs';

const allowedChannelStatuses = new Set(['active', 'paused', 'closed', 'merged']);
const allowedVerificationStates = new Set(['observed', 'pending', 'verified', 'revoked']);

const createId = (prefix) => `${prefix}_${randomUUID()}`;

const mapChannel = (row) =>
	row && {
		id: row.id,
		contextId: row.context_id,
		displayName: row.display_name,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};

export class CustomerIdentityStore {
	#database;
	#lookupKey;
	#encryptionKey;
	#clock;

	constructor({ path, lookupKey, encryptionKey, clock = () => new Date() }) {
		if (typeof path !== 'string' || path.length === 0) {
			throw new TypeError('path must be a non-empty string');
		}

		if (!Buffer.isBuffer(lookupKey) || lookupKey.length !== 32) {
			throw new TypeError('lookupKey must be a 32-byte Buffer');
		}

		if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
			throw new TypeError('encryptionKey must be a 32-byte Buffer');
		}

		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		this.#database = new DatabaseSync(path);
		chmodSync(path, 0o600);
		this.#lookupKey = Buffer.from(lookupKey);
		this.#encryptionKey = Buffer.from(encryptionKey);
		this.#clock = clock;
		this.#database.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA foreign_keys = ON;
			PRAGMA busy_timeout = 5000;

			CREATE TABLE IF NOT EXISTS customer_channels (
				id TEXT PRIMARY KEY,
				context_id TEXT NOT NULL UNIQUE,
				display_name TEXT NOT NULL,
				status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'closed', 'merged')),
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS contacts (
				id TEXT PRIMARY KEY,
				display_name_ciphertext TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS contact_endpoints (
				id TEXT PRIMARY KEY,
				contact_id TEXT,
				kind TEXT NOT NULL CHECK(kind IN ('email', 'phone')),
				lookup_hmac TEXT NOT NULL,
				value_ciphertext TEXT NOT NULL,
				verification_state TEXT NOT NULL
					CHECK(verification_state IN ('observed', 'pending', 'verified', 'revoked')),
				verified_at TEXT,
				source TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				UNIQUE(kind, lookup_hmac),
				FOREIGN KEY(contact_id) REFERENCES contacts(id)
			);

			CREATE TABLE IF NOT EXISTS channel_participants (
				customer_channel_id TEXT NOT NULL,
				contact_id TEXT NOT NULL,
				relationship_role TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY(customer_channel_id, contact_id),
				FOREIGN KEY(customer_channel_id) REFERENCES customer_channels(id),
				FOREIGN KEY(contact_id) REFERENCES contacts(id)
			);

			CREATE TABLE IF NOT EXISTS provider_threads (
				id TEXT PRIMARY KEY,
				customer_channel_id TEXT NOT NULL,
				endpoint_id TEXT NOT NULL,
				provider TEXT NOT NULL,
				thread_lookup_hmac TEXT NOT NULL,
				thread_ciphertext TEXT NOT NULL,
				last_event_at TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				UNIQUE(provider, thread_lookup_hmac),
				FOREIGN KEY(customer_channel_id) REFERENCES customer_channels(id),
				FOREIGN KEY(endpoint_id) REFERENCES contact_endpoints(id)
			);

			CREATE TABLE IF NOT EXISTS identity_link_challenges (
				id TEXT PRIMARY KEY,
				source_endpoint_id TEXT NOT NULL,
				target_channel_id TEXT NOT NULL,
				claimed_kind TEXT NOT NULL CHECK(claimed_kind IN ('email', 'phone')),
				claimed_lookup_hmac TEXT NOT NULL,
				claimed_value_ciphertext TEXT NOT NULL,
				challenge_hash TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				verified_at TEXT,
				initiated_by TEXT NOT NULL,
				status TEXT NOT NULL CHECK(status IN ('pending', 'verified', 'expired', 'failed', 'merge_required')),
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY(source_endpoint_id) REFERENCES contact_endpoints(id),
				FOREIGN KEY(target_channel_id) REFERENCES customer_channels(id)
			);

			CREATE TABLE IF NOT EXISTS channel_merge_reviews (
				id TEXT PRIMARY KEY,
				target_channel_id TEXT NOT NULL,
				source_contact_id TEXT NOT NULL,
				conflicting_contact_id TEXT NOT NULL,
				claimed_endpoint_id TEXT NOT NULL,
				challenge_id TEXT NOT NULL UNIQUE,
				status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'completed')),
				initiated_by TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY(target_channel_id) REFERENCES customer_channels(id),
				FOREIGN KEY(source_contact_id) REFERENCES contacts(id),
				FOREIGN KEY(conflicting_contact_id) REFERENCES contacts(id),
				FOREIGN KEY(claimed_endpoint_id) REFERENCES contact_endpoints(id),
				FOREIGN KEY(challenge_id) REFERENCES identity_link_challenges(id)
			);

			CREATE TABLE IF NOT EXISTS rocket_bindings (
				customer_channel_id TEXT PRIMARY KEY,
				room_id TEXT NOT NULL UNIQUE,
				schema_version INTEGER NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				FOREIGN KEY(customer_channel_id) REFERENCES customer_channels(id)
			);
		`);
	}

	close() {
		this.#database.close();
	}

	createCustomerChannel({ id = createId('cus'), contextId, displayName, status = 'active' }) {
		assertOpaqueId(id, 'customer channel id');
		assertOpaqueId(contextId, 'contextId');

		if (typeof displayName !== 'string' || displayName.length === 0) {
			throw new TypeError('displayName must be a non-empty string');
		}

		if (!allowedChannelStatuses.has(status)) {
			throw new TypeError(`unsupported customer channel status: ${status}`);
		}

		const timestamp = this.#now();
		this.#database.prepare(`
			INSERT INTO customer_channels(id, context_id, display_name, status, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`).run(id, contextId, displayName, status, timestamp, timestamp);

		return this.getCustomerChannel(id);
	}

	getCustomerChannel(id) {
		return mapChannel(this.#database.prepare('SELECT * FROM customer_channels WHERE id = ?').get(id));
	}

	createContact({ id = createId('con'), displayName }) {
		assertOpaqueId(id, 'contact id');

		if (typeof displayName !== 'string' || displayName.length === 0) {
			throw new TypeError('displayName must be a non-empty string');
		}

		const timestamp = this.#now();
		const ciphertext = encryptValue(this.#encryptionKey, `contact:${id}:display`, displayName);
		this.#database.prepare(`
			INSERT INTO contacts(id, display_name_ciphertext, created_at, updated_at)
			VALUES (?, ?, ?, ?)
		`).run(id, ciphertext, timestamp, timestamp);

		return this.getContact(id);
	}

	getContact(id) {
		const row = this.#database.prepare('SELECT * FROM contacts WHERE id = ?').get(id);

		if (!row) {
			return undefined;
		}

		return {
			id: row.id,
			displayName: decryptValue(this.#encryptionKey, `contact:${id}:display`, row.display_name_ciphertext),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	observeEndpoint({
		id = createId('end'),
		contactId = null,
		kind,
		value,
		source,
		verificationState = 'observed',
	}) {
		assertOpaqueId(id, 'endpoint id');

		if (contactId !== null) {
			assertOpaqueId(contactId, 'contactId');
		}

		if (!allowedVerificationStates.has(verificationState)) {
			throw new TypeError(`unsupported verification state: ${verificationState}`);
		}

		if (typeof source !== 'string' || source.length === 0) {
			throw new TypeError('source must be a non-empty string');
		}

		const normalized = normalizeEndpoint(kind, value);
		const lookupHmac = createLookupHmac(this.#lookupKey, `endpoint:${kind}`, normalized);
		const existing = this.#database.prepare(`
			SELECT id FROM contact_endpoints WHERE kind = ? AND lookup_hmac = ?
		`).get(kind, lookupHmac);

		if (existing) {
			return { created: false, endpoint: this.getEndpoint(existing.id) };
		}

		const timestamp = this.#now();
		const ciphertext = encryptValue(this.#encryptionKey, `endpoint:${id}`, normalized);
		this.#database.prepare(`
			INSERT INTO contact_endpoints(
				id, contact_id, kind, lookup_hmac, value_ciphertext,
				verification_state, verified_at, source, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			id,
			contactId,
			kind,
			lookupHmac,
			ciphertext,
			verificationState,
			verificationState === 'verified' ? timestamp : null,
			source,
			timestamp,
			timestamp,
		);

		return { created: true, endpoint: this.getEndpoint(id) };
	}

	getEndpoint(id) {
		const row = this.#database.prepare('SELECT * FROM contact_endpoints WHERE id = ?').get(id);

		if (!row) {
			return undefined;
		}

		const normalized = decryptValue(this.#encryptionKey, `endpoint:${row.id}`, row.value_ciphertext);

		return {
			id: row.id,
			contactId: row.contact_id,
			kind: row.kind,
			label: getSafeEndpointLabel(row.kind, normalized),
			verificationState: row.verification_state,
			verifiedAt: row.verified_at,
			source: row.source,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	getEndpointValueForDelivery(id) {
		const row = this.#database.prepare('SELECT * FROM contact_endpoints WHERE id = ?').get(id);

		if (!row) {
			throw new Error(`unknown endpoint ${id}`);
		}

		return decryptValue(this.#encryptionKey, `endpoint:${row.id}`, row.value_ciphertext);
	}

	addParticipant({ customerChannelId, contactId, relationshipRole = 'customer' }) {
		assertOpaqueId(customerChannelId, 'customerChannelId');
		assertOpaqueId(contactId, 'contactId');

		if (typeof relationshipRole !== 'string' || relationshipRole.length === 0) {
			throw new TypeError('relationshipRole must be a non-empty string');
		}

		this.#database.prepare(`
			INSERT INTO channel_participants(customer_channel_id, contact_id, relationship_role, created_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(customer_channel_id, contact_id) DO UPDATE SET
				relationship_role = excluded.relationship_role
		`).run(customerChannelId, contactId, relationshipRole, this.#now());
	}

	bindProviderThread({
		id = createId('pth'),
		customerChannelId,
		endpointId,
		provider,
		providerThreadId,
		lastEventAt = this.#now(),
	}) {
		assertOpaqueId(id, 'provider thread id');
		const endpointRow = this.#database.prepare('SELECT * FROM contact_endpoints WHERE id = ?').get(endpointId);

		if (!endpointRow?.contact_id) {
			throw new Error('provider thread endpoint must belong to a contact');
		}

		const participant = this.#database.prepare(`
			SELECT 1 FROM channel_participants WHERE customer_channel_id = ? AND contact_id = ?
		`).get(customerChannelId, endpointRow.contact_id);

		if (!participant) {
			throw new Error('provider thread endpoint contact is not a customer-channel participant');
		}

		const normalizedThread = this.#normalizeProviderThread(provider, providerThreadId);
		const lookupHmac = createLookupHmac(this.#lookupKey, `provider-thread:${provider}`, normalizedThread);
		const timestamp = this.#now();
		const ciphertext = encryptValue(this.#encryptionKey, `provider-thread:${id}`, normalizedThread);
		this.#database.prepare(`
			INSERT INTO provider_threads(
				id, customer_channel_id, endpoint_id, provider, thread_lookup_hmac,
				thread_ciphertext, last_event_at, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(provider, thread_lookup_hmac) DO UPDATE SET
				last_event_at = excluded.last_event_at,
				updated_at = excluded.updated_at
		`).run(
			id,
			customerChannelId,
			endpointId,
			provider,
			lookupHmac,
			ciphertext,
			lastEventAt,
			timestamp,
			timestamp,
		);

		return this.getProviderThread(provider, providerThreadId);
	}

	getProviderThread(provider, providerThreadId) {
		const normalizedThread = this.#normalizeProviderThread(provider, providerThreadId);
		const lookupHmac = createLookupHmac(this.#lookupKey, `provider-thread:${provider}`, normalizedThread);
		const row = this.#database.prepare(`
			SELECT * FROM provider_threads WHERE provider = ? AND thread_lookup_hmac = ?
		`).get(provider, lookupHmac);

		if (!row) {
			return undefined;
		}

		return {
			id: row.id,
			customerChannelId: row.customer_channel_id,
			endpointId: row.endpoint_id,
			provider: row.provider,
			lastEventAt: row.last_event_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	resolveInbound({ provider, providerThreadId, endpointKind, endpointValue }) {
		const normalized = normalizeEndpoint(endpointKind, endpointValue);
		const endpointLookup = createLookupHmac(this.#lookupKey, `endpoint:${endpointKind}`, normalized);
		const endpointRow = this.#database.prepare(`
			SELECT * FROM contact_endpoints WHERE kind = ? AND lookup_hmac = ?
		`).get(endpointKind, endpointLookup);
		const thread = this.getProviderThread(provider, providerThreadId);

		if (thread) {
			if (!endpointRow?.contact_id) {
				return {
					disposition: 'quarantine',
					reason: 'unexpected-endpoint',
					customerChannelId: thread.customerChannelId,
				};
			}

			const participant = this.#database.prepare(`
				SELECT 1 FROM channel_participants
				WHERE customer_channel_id = ? AND contact_id = ?
			`).get(thread.customerChannelId, endpointRow.contact_id);

			if (!participant) {
				return {
					disposition: 'quarantine',
					reason: 'unexpected-participant',
					customerChannelId: thread.customerChannelId,
					endpointId: endpointRow.id,
				};
			}

			return {
				disposition: 'resolved',
				reason: 'provider-thread',
				customerChannelId: thread.customerChannelId,
				contactId: endpointRow.contact_id,
				endpointId: endpointRow.id,
				providerThreadId: thread.id,
			};
		}

		if (!endpointRow?.contact_id) {
			return {
				disposition: 'unknown',
				reason: endpointRow ? 'unassigned-endpoint' : 'unknown-endpoint',
			};
		}

		const candidates = this.#database.prepare(`
			SELECT participant.customer_channel_id AS customerChannelId
			FROM channel_participants participant
			JOIN customer_channels channel ON channel.id = participant.customer_channel_id
			WHERE participant.contact_id = ? AND channel.status = 'active'
			ORDER BY participant.customer_channel_id
		`).all(endpointRow.contact_id);

		if (candidates.length === 0) {
			return { disposition: 'unknown', reason: 'unassigned-contact', endpointId: endpointRow.id };
		}

		if (candidates.length > 1) {
			return {
				disposition: 'ambiguous',
				reason: 'multiple-customer-channels',
				endpointId: endpointRow.id,
				candidateCustomerChannelIds: candidates.map(({ customerChannelId }) => customerChannelId),
			};
		}

		return {
			disposition: 'resolved',
			reason: 'unique-endpoint',
			customerChannelId: candidates[0].customerChannelId,
			contactId: endpointRow.contact_id,
			endpointId: endpointRow.id,
		};
	}

	startLinkChallenge({
		id = createId('lnk'),
		sourceEndpointId,
		targetChannelId,
		claimedKind,
		claimedValue,
		code,
		initiatedBy,
		ttlSeconds = 600,
	}) {
		assertOpaqueId(id, 'challenge id');
		assertOpaqueId(initiatedBy, 'initiatedBy');
		const sourceEndpoint = this.#database.prepare('SELECT * FROM contact_endpoints WHERE id = ?').get(sourceEndpointId);

		if (!sourceEndpoint?.contact_id || sourceEndpoint.verification_state !== 'verified') {
			throw new Error('source endpoint must be verified and attached to a contact');
		}

		const participant = this.#database.prepare(`
			SELECT 1 FROM channel_participants WHERE customer_channel_id = ? AND contact_id = ?
		`).get(targetChannelId, sourceEndpoint.contact_id);

		if (!participant) {
			throw new Error('source endpoint contact is not a participant in the target channel');
		}

		if (typeof code !== 'string' || code.length < 4) {
			throw new TypeError('challenge code must contain at least four characters');
		}

		const normalizedClaim = normalizeEndpoint(claimedKind, claimedValue);
		const claimedLookup = createLookupHmac(this.#lookupKey, `endpoint:${claimedKind}`, normalizedClaim);

		if (claimedKind === sourceEndpoint.kind && claimedLookup === sourceEndpoint.lookup_hmac) {
			throw new Error('claimed endpoint is already the verified source endpoint');
		}

		const timestamp = this.#now();
		const expiresAt = new Date(this.#clock().getTime() + ttlSeconds * 1000).toISOString();
		const challengeHash = createLookupHmac(this.#lookupKey, `link-challenge:${id}`, code);
		const claimedCiphertext = encryptValue(this.#encryptionKey, `link-challenge:${id}:claim`, normalizedClaim);
		this.#database.prepare(`
			INSERT INTO identity_link_challenges(
				id, source_endpoint_id, target_channel_id, claimed_kind,
				claimed_lookup_hmac, claimed_value_ciphertext, challenge_hash,
				expires_at, initiated_by, status, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
		`).run(
			id,
			sourceEndpointId,
			targetChannelId,
			claimedKind,
			claimedLookup,
			claimedCiphertext,
			challengeHash,
			expiresAt,
			initiatedBy,
			timestamp,
			timestamp,
		);

		return {
			id,
			sourceEndpointId,
			targetChannelId,
			claimedKind,
			expiresAt,
			status: 'pending',
			initiatedBy,
		};
	}

	verifyLinkChallenge({ challengeId, code }) {
		const challenge = this.#database.prepare('SELECT * FROM identity_link_challenges WHERE id = ?').get(challengeId);

		if (!challenge || challenge.status !== 'pending') {
			return { disposition: 'failed', reason: 'challenge-not-pending' };
		}

		const timestamp = this.#now();

		if (challenge.expires_at <= timestamp) {
			this.#database.prepare(`
				UPDATE identity_link_challenges SET status = 'expired', updated_at = ? WHERE id = ?
			`).run(timestamp, challengeId);
			return { disposition: 'failed', reason: 'challenge-expired' };
		}

		const expected = Buffer.from(challenge.challenge_hash, 'utf8');
		const actual = Buffer.from(createLookupHmac(this.#lookupKey, `link-challenge:${challengeId}`, code), 'utf8');

		if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
			return { disposition: 'failed', reason: 'incorrect-code' };
		}

		const sourceEndpoint = this.#database.prepare('SELECT * FROM contact_endpoints WHERE id = ?').get(challenge.source_endpoint_id);
		const existingEndpoint = this.#database.prepare(`
			SELECT * FROM contact_endpoints WHERE kind = ? AND lookup_hmac = ?
		`).get(challenge.claimed_kind, challenge.claimed_lookup_hmac);

		if (existingEndpoint?.contact_id && existingEndpoint.contact_id !== sourceEndpoint.contact_id) {
			const reviewId = createId('mrg');
			this.#database.exec('BEGIN IMMEDIATE');
			try {
				this.#database.prepare(`
					UPDATE identity_link_challenges
					SET status = 'merge_required', verified_at = ?, updated_at = ?
					WHERE id = ?
				`).run(timestamp, timestamp, challengeId);
				this.#database.prepare(`
					INSERT INTO channel_merge_reviews(
						id, target_channel_id, source_contact_id, conflicting_contact_id,
						claimed_endpoint_id, challenge_id, status, initiated_by,
						created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
				`).run(
					reviewId,
					challenge.target_channel_id,
					sourceEndpoint.contact_id,
					existingEndpoint.contact_id,
					existingEndpoint.id,
					challengeId,
					challenge.initiated_by,
					timestamp,
					timestamp,
				);
				this.#database.exec('COMMIT');
			} catch (error) {
				this.#database.exec('ROLLBACK');
				throw error;
			}

			return {
				disposition: 'merge-required',
				reviewId,
				targetCustomerChannelId: challenge.target_channel_id,
				claimedEndpointId: existingEndpoint.id,
			};
		}

		const claimedValue = decryptValue(
			this.#encryptionKey,
			`link-challenge:${challengeId}:claim`,
			challenge.claimed_value_ciphertext,
		);
		const endpointId = existingEndpoint?.id ?? createId('end');
		this.#database.exec('BEGIN IMMEDIATE');
		try {
			if (existingEndpoint) {
				this.#database.prepare(`
					UPDATE contact_endpoints
					SET contact_id = ?, verification_state = 'verified',
						verified_at = ?, updated_at = ?
					WHERE id = ?
				`).run(sourceEndpoint.contact_id, timestamp, timestamp, existingEndpoint.id);
			} else {
				this.#database.prepare(`
					INSERT INTO contact_endpoints(
						id, contact_id, kind, lookup_hmac, value_ciphertext,
						verification_state, verified_at, source, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, 'verified', ?, 'link-challenge', ?, ?)
				`).run(
					endpointId,
					sourceEndpoint.contact_id,
					challenge.claimed_kind,
					challenge.claimed_lookup_hmac,
					encryptValue(this.#encryptionKey, `endpoint:${endpointId}`, claimedValue),
					timestamp,
					timestamp,
					timestamp,
				);
			}

			this.#database.prepare(`
				UPDATE identity_link_challenges
				SET status = 'verified', verified_at = ?, updated_at = ?
				WHERE id = ?
			`).run(timestamp, timestamp, challengeId);
			this.#database.exec('COMMIT');
		} catch (error) {
			this.#database.exec('ROLLBACK');
			throw error;
		}

		return {
			disposition: 'linked',
			targetCustomerChannelId: challenge.target_channel_id,
			contactId: sourceEndpoint.contact_id,
			endpoint: this.getEndpoint(endpointId),
		};
	}

	listMergeReviews() {
		return this.#database.prepare(`
			SELECT id, target_channel_id AS targetCustomerChannelId,
				source_contact_id AS sourceContactId,
				conflicting_contact_id AS conflictingContactId,
				claimed_endpoint_id AS claimedEndpointId,
				challenge_id AS challengeId, status, initiated_by AS initiatedBy,
				created_at AS createdAt, updated_at AS updatedAt
			FROM channel_merge_reviews ORDER BY created_at, id
		`).all();
	}

	upsertRocketBinding({ customerChannelId, roomId, schemaVersion = 1 }) {
		assertOpaqueId(customerChannelId, 'customerChannelId');
		assertOpaqueId(roomId, 'roomId');
		const timestamp = this.#now();
		this.#database.prepare(`
			INSERT INTO rocket_bindings(
				customer_channel_id, room_id, schema_version, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(customer_channel_id) DO UPDATE SET
				room_id = excluded.room_id,
				schema_version = excluded.schema_version,
				updated_at = excluded.updated_at
		`).run(customerChannelId, roomId, schemaVersion, timestamp, timestamp);

		return this.#database.prepare(`
			SELECT customer_channel_id AS customerChannelId, room_id AS roomId,
				schema_version AS schemaVersion, created_at AS createdAt,
				updated_at AS updatedAt
			FROM rocket_bindings WHERE customer_channel_id = ?
		`).get(customerChannelId);
	}

	getRocketBinding(customerChannelId) {
		return this.#database.prepare(`
			SELECT customer_channel_id AS customerChannelId, room_id AS roomId,
				schema_version AS schemaVersion, created_at AS createdAt,
				updated_at AS updatedAt
			FROM rocket_bindings WHERE customer_channel_id = ?
		`).get(customerChannelId);
	}

	#normalizeProviderThread(provider, providerThreadId) {
		if (typeof provider !== 'string' || provider.length === 0) {
			throw new TypeError('provider must be a non-empty string');
		}

		if (typeof providerThreadId !== 'string' || providerThreadId.length === 0) {
			throw new TypeError('providerThreadId must be a non-empty string');
		}

		return providerThreadId.trim();
	}

	#now() {
		return this.#clock().toISOString();
	}
}
