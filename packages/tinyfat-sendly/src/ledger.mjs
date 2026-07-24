import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const bounded = (value, label, maximum = 256) => {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.includes('\0')) {
		throw new TypeError(`${label} must be a non-empty bounded string`);
	}
	return value;
};

const requestDigest = (value) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

const mapRow = (row) =>
	row && {
		idempotencyKey: row.idempotency_key,
		requestSha256: row.request_sha256,
		customerChannelId: row.customer_channel_id,
		endpointId: row.endpoint_id,
		status: row.status,
		providerMessageId: row.provider_message_id,
		providerStatus: row.provider_status,
		requestedEventId: row.requested_event_id,
		deliveredEventId: row.delivered_event_id,
		lastError: row.last_error,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		completedAt: row.completed_at,
	};

export class SendlyDeliveryLedger {
	#database;
	#clock;

	constructor({ path, clock = () => new Date() }) {
		if (typeof path !== 'string' || path.length === 0) throw new TypeError('path must be a non-empty string');
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		this.#database = new DatabaseSync(path);
		chmodSync(path, 0o600);
		this.#clock = clock;
		this.#database.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA busy_timeout = 5000;

			CREATE TABLE IF NOT EXISTS sendly_deliveries (
				idempotency_key TEXT PRIMARY KEY,
				request_sha256 TEXT NOT NULL,
				customer_channel_id TEXT NOT NULL,
				endpoint_id TEXT NOT NULL,
				status TEXT NOT NULL
					CHECK(status IN ('running', 'provider_accepted', 'completed', 'failed')),
				provider_message_id TEXT,
				provider_status TEXT,
				requested_event_id TEXT NOT NULL,
				delivered_event_id TEXT NOT NULL,
				last_error TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				completed_at TEXT
			);
		`);
	}

	close() {
		this.#database.close();
	}

	static digestRequest(value) {
		return requestDigest(value);
	}

	start({
		idempotencyKey,
		requestSha256,
		customerChannelId,
		endpointId,
		requestedEventId,
		deliveredEventId,
	}) {
		for (const [label, value] of Object.entries({
			idempotencyKey,
			requestSha256,
			customerChannelId,
			endpointId,
			requestedEventId,
			deliveredEventId,
		})) {
			bounded(value, label);
		}
		const existing = this.get(idempotencyKey);
		if (existing) {
			if (
				existing.requestSha256 !== requestSha256
				|| existing.customerChannelId !== customerChannelId
				|| existing.endpointId !== endpointId
				|| existing.requestedEventId !== requestedEventId
				|| existing.deliveredEventId !== deliveredEventId
			) {
				throw new Error('sendly_idempotency_conflict');
			}
			return {
				...existing,
				claimed: existing.status === 'provider_accepted',
				recoverReceipt: existing.status === 'provider_accepted',
				duplicate: existing.status === 'completed',
			};
		}
		const timestamp = this.#now();
		this.#database.prepare(`
			INSERT INTO sendly_deliveries(
				idempotency_key, request_sha256, customer_channel_id, endpoint_id,
				status, requested_event_id, delivered_event_id, created_at, updated_at
			) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)
		`).run(
			idempotencyKey,
			requestSha256,
			customerChannelId,
			endpointId,
			requestedEventId,
			deliveredEventId,
			timestamp,
			timestamp,
		);
		return { ...this.get(idempotencyKey), claimed: true, recoverReceipt: false, duplicate: false };
	}

	get(idempotencyKey) {
		bounded(idempotencyKey, 'idempotencyKey');
		return mapRow(this.#database.prepare(`
			SELECT * FROM sendly_deliveries WHERE idempotency_key = ?
		`).get(idempotencyKey));
	}

	recordProviderReceipt(idempotencyKey, { messageId, status }) {
		bounded(messageId, 'messageId');
		bounded(status, 'status', 100);
		const existing = this.get(idempotencyKey);
		if (!existing || !['running', 'provider_accepted'].includes(existing.status)) {
			throw new Error('sendly_delivery_not_running');
		}
		if (existing.providerMessageId && existing.providerMessageId !== messageId) {
			throw new Error('sendly_provider_receipt_conflict');
		}
		this.#database.prepare(`
			UPDATE sendly_deliveries
			SET status = 'provider_accepted', provider_message_id = ?,
				provider_status = ?, last_error = NULL, updated_at = ?
			WHERE idempotency_key = ?
		`).run(messageId, status, this.#now(), idempotencyKey);
		return this.get(idempotencyKey);
	}

	complete(idempotencyKey) {
		const existing = this.get(idempotencyKey);
		if (!existing?.providerMessageId || existing.status !== 'provider_accepted') {
			throw new Error('sendly_provider_receipt_required');
		}
		const timestamp = this.#now();
		this.#database.prepare(`
			UPDATE sendly_deliveries
			SET status = 'completed', completed_at = ?, updated_at = ?
			WHERE idempotency_key = ?
		`).run(timestamp, timestamp, idempotencyKey);
		return this.get(idempotencyKey);
	}

	fail(idempotencyKey, error) {
		const existing = this.get(idempotencyKey);
		if (!existing || existing.status !== 'running') return existing;
		const message = String(error || 'sendly_delivery_failed').replaceAll(/[\r\n\0]+/g, ' ').slice(0, 500);
		this.#database.prepare(`
			UPDATE sendly_deliveries
			SET status = 'failed', last_error = ?, updated_at = ?
			WHERE idempotency_key = ?
		`).run(message, this.#now(), idempotencyKey);
		return this.get(idempotencyKey);
	}

	#now() {
		return this.#clock().toISOString();
	}
}
