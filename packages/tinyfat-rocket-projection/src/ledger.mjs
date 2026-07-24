import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class RocketProjectionLedger {
	#database;
	#clock;

	constructor({ path, clock = () => new Date() }) {
		if (typeof path !== 'string' || path.length === 0) {
			throw new TypeError('path must be a non-empty string');
		}

		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		this.#database = new DatabaseSync(path);
		chmodSync(path, 0o600);
		this.#clock = clock;
		this.#database.exec(`
			PRAGMA journal_mode = WAL;
			PRAGMA busy_timeout = 5000;

			CREATE TABLE IF NOT EXISTS rocket_projections (
				event_id TEXT PRIMARY KEY,
				customer_channel_id TEXT NOT NULL,
				sequence INTEGER NOT NULL,
				room_id TEXT NOT NULL,
				message_id TEXT NOT NULL,
				projected_at TEXT NOT NULL,
				UNIQUE(customer_channel_id, sequence)
			);
		`);
	}

	close() {
		this.#database.close();
	}

	get(eventId) {
		return this.#database
			.prepare(
				`
			SELECT event_id AS eventId, customer_channel_id AS customerChannelId,
				sequence, room_id AS roomId, message_id AS messageId,
				projected_at AS projectedAt
			FROM rocket_projections WHERE event_id = ?
		`,
			)
			.get(eventId);
	}

	record({ eventId, customerChannelId, sequence, roomId, messageId }) {
		this.#database
			.prepare(
				`
			INSERT INTO rocket_projections(
				event_id, customer_channel_id, sequence, room_id, message_id, projected_at
			) VALUES (?, ?, ?, ?, ?, ?)
		`,
			)
			.run(eventId, customerChannelId, sequence, roomId, messageId, this.#clock().toISOString());

		return this.get(eventId);
	}
}
