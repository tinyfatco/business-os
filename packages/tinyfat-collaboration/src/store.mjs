import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,191}$/;
const allowedSubjectKinds = new Set(['human', 'agent']);
const allowedVisibilityClasses = new Set(['customer', 'channel', 'restricted', 'private']);
const allowedActions = new Set(['awareness.read', 'awareness.append', 'agent.collaborate']);

const requireOpaqueId = (value, label) => {
	if (typeof value !== 'string' || !opaqueIdPattern.test(value)) {
		throw new TypeError(`${label} must be an opaque identifier`);
	}
	return value;
};

const requireText = (value, label, maximum = 500) => {
	if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`${label} must be a non-empty bounded string`);
	}
	return value.trim();
};

const normalizeStringSet = (values, label, allowed) => {
	if (!Array.isArray(values) || values.length === 0) {
		throw new TypeError(`${label} must be a non-empty array`);
	}
	const normalized = [...new Set(values.map((value) => requireText(value, label, 100)))].sort();
	for (const value of normalized) {
		if (!allowed.has(value)) throw new TypeError(`${label} contains unsupported value ${value}`);
	}
	return normalized;
};

const constantTimeEqual = (left, right) => {
	const a = Buffer.from(left, 'utf8');
	const b = Buffer.from(right, 'utf8');
	return a.length === b.length && timingSafeEqual(a, b);
};

const mapGrant = (row) =>
	row && {
		id: row.id,
		customerChannelId: row.customer_channel_id,
		subject: {
			kind: row.subject_kind,
			id: row.subject_id,
		},
		purpose: row.purpose,
		allowedVisibility: JSON.parse(row.allowed_visibility_json),
		allowedActions: JSON.parse(row.allowed_actions_json),
		issuedBy: row.issued_by,
		issuedAt: row.issued_at,
		expiresAt: row.expires_at,
		status: row.status,
		revokedAt: row.revoked_at,
		revokedBy: row.revoked_by,
	};

export class RelationshipGrantError extends Error {
	constructor(code) {
		super(code);
		this.name = 'RelationshipGrantError';
		this.code = code;
	}
}

export class RelationshipGrantStore {
	#database;
	#lookupKey;
	#clock;

	constructor({ path, lookupKey, clock = () => new Date() }) {
		if (typeof path !== 'string' || path.length === 0) {
			throw new TypeError('path must be a non-empty string');
		}
		if (!Buffer.isBuffer(lookupKey) || lookupKey.length !== 32) {
			throw new TypeError('lookupKey must be a 32-byte Buffer');
		}
		if (typeof clock !== 'function') throw new TypeError('clock must be a function');

		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		this.#database = new DatabaseSync(path);
		chmodSync(path, 0o600);
		this.#lookupKey = Buffer.from(lookupKey);
		this.#clock = clock;
		this.#database.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA foreign_keys = ON;
			PRAGMA busy_timeout = 5000;

			CREATE TABLE IF NOT EXISTS relationship_grants (
				id TEXT PRIMARY KEY,
				customer_channel_id TEXT NOT NULL,
				subject_kind TEXT NOT NULL CHECK(subject_kind IN ('human', 'agent')),
				subject_id TEXT NOT NULL,
				purpose TEXT NOT NULL,
				allowed_visibility_json TEXT NOT NULL,
				allowed_actions_json TEXT NOT NULL,
				token_lookup_hmac TEXT NOT NULL UNIQUE,
				issued_by TEXT NOT NULL,
				issued_at TEXT NOT NULL,
				expires_at TEXT NOT NULL,
				status TEXT NOT NULL CHECK(status IN ('active', 'expired', 'revoked')),
				revoked_at TEXT,
				revoked_by TEXT
			);

			CREATE INDEX IF NOT EXISTS relationship_grants_channel
				ON relationship_grants(customer_channel_id, status, expires_at);
		`);
	}

	close() {
		this.#database.close();
	}

	issue({
		id = `grant_${randomUUID()}`,
		customerChannelId,
		subject,
		purpose,
		allowedVisibility = ['channel'],
		actions = ['awareness.read'],
		issuedBy,
		ttlSeconds = 900,
		token = randomBytes(32).toString('base64url'),
	}) {
		requireOpaqueId(id, 'grant id');
		requireOpaqueId(customerChannelId, 'customerChannelId');
		if (!subject || typeof subject !== 'object' || Array.isArray(subject)) {
			throw new TypeError('subject must be an object');
		}
		if (!allowedSubjectKinds.has(subject.kind)) {
			throw new TypeError(`unsupported subject kind ${subject.kind}`);
		}
		requireOpaqueId(subject.id, 'subject.id');
		requireOpaqueId(issuedBy, 'issuedBy');
		requireText(purpose, 'purpose');
		const visibility = normalizeStringSet(allowedVisibility, 'allowedVisibility', allowedVisibilityClasses);
		const normalizedActions = normalizeStringSet(actions, 'actions', allowedActions);
		if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86_400) {
			throw new TypeError('ttlSeconds must be an integer from 1 to 86400');
		}
		if (typeof token !== 'string' || token.length < 32 || token.length > 512 || token.includes('\0')) {
			throw new TypeError('token must be a strong bounded bearer value');
		}

		const issuedAt = this.#now();
		const expiresAt = new Date(this.#clock().getTime() + ttlSeconds * 1000).toISOString();
		this.#database.prepare(`
			INSERT INTO relationship_grants(
				id, customer_channel_id, subject_kind, subject_id, purpose,
				allowed_visibility_json, allowed_actions_json, token_lookup_hmac,
				issued_by, issued_at, expires_at, status
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
		`).run(
			id,
			customerChannelId,
			subject.kind,
			subject.id,
			purpose.trim(),
			JSON.stringify(visibility),
			JSON.stringify(normalizedActions),
			this.#tokenLookup(token),
			issuedBy,
			issuedAt,
			expiresAt,
		);

		return { token, grant: this.get(id) };
	}

	get(id) {
		requireOpaqueId(id, 'grant id');
		return mapGrant(this.#database.prepare('SELECT * FROM relationship_grants WHERE id = ?').get(id));
	}

	authorize({ token, customerChannelId, action }) {
		requireOpaqueId(customerChannelId, 'customerChannelId');
		if (!allowedActions.has(action)) throw new RelationshipGrantError('action_not_allowed');
		if (typeof token !== 'string' || token.length < 32 || token.length > 512) {
			throw new RelationshipGrantError('grant_invalid');
		}
		const lookup = this.#tokenLookup(token);
		const row = this.#database.prepare(`
			SELECT * FROM relationship_grants WHERE token_lookup_hmac = ?
		`).get(lookup);
		if (!row || !constantTimeEqual(row.token_lookup_hmac, lookup)) {
			throw new RelationshipGrantError('grant_invalid');
		}
		if (row.status !== 'active') throw new RelationshipGrantError(`grant_${row.status}`);
		const now = this.#now();
		if (row.expires_at <= now) {
			this.#database.prepare(`
				UPDATE relationship_grants SET status = 'expired' WHERE id = ? AND status = 'active'
			`).run(row.id);
			throw new RelationshipGrantError('grant_expired');
		}
		if (row.customer_channel_id !== customerChannelId) {
			throw new RelationshipGrantError('customer_channel_scope_denied');
		}
		const grant = mapGrant(row);
		if (!grant.allowedActions.includes(action)) throw new RelationshipGrantError('action_not_allowed');
		return grant;
	}

	revoke({ grantId, revokedBy }) {
		requireOpaqueId(grantId, 'grantId');
		requireOpaqueId(revokedBy, 'revokedBy');
		const existing = this.get(grantId);
		if (!existing) throw new RelationshipGrantError('grant_not_found');
		if (existing.status !== 'active') return existing;
		const revokedAt = this.#now();
		this.#database.prepare(`
			UPDATE relationship_grants
			SET status = 'revoked', revoked_at = ?, revoked_by = ?
			WHERE id = ? AND status = 'active'
		`).run(revokedAt, revokedBy, grantId);
		return this.get(grantId);
	}

	#tokenLookup(token) {
		return createHmac('sha256', this.#lookupKey).update(`relationship-grant\0${token}`, 'utf8').digest('hex');
	}

	#now() {
		return this.#clock().toISOString();
	}
}

export const fileContainsGrantBearer = (path, token) => readFileSync(path).includes(Buffer.from(token, 'utf8'));
