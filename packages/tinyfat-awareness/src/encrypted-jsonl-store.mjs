import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AwarenessValidationError, canReadEvent, normalizeEventInput } from './event.mjs';

const algorithm = 'aes-256-gcm';
const zeroHash = '0'.repeat(64);

const hashRecord = (record) => createHash('sha256').update(JSON.stringify(record)).digest('hex');

const getAdditionalAuthenticatedData = (record) =>
	Buffer.from(`${record.customerChannelId}\0${record.eventId}\0${record.sequence}\0${record.eventType}`, 'utf8');

const encodePrivateData = (key, record, event) => {
	const iv = randomBytes(12);
	const cipher = createCipheriv(algorithm, key, iv);
	cipher.setAAD(getAdditionalAuthenticatedData(record));
	const plaintext = Buffer.from(
		JSON.stringify({
			actorDisplay: event.actor.display ?? null,
			payload: event.payload,
		}),
		'utf8',
	);
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

	return {
		algorithm,
		iv: iv.toString('base64'),
		tag: cipher.getAuthTag().toString('base64'),
		value: ciphertext.toString('base64'),
	};
};

const decodePrivateData = (key, record) => {
	if (record.privateData?.algorithm !== algorithm) {
		throw new Error(`unsupported awareness payload algorithm at sequence ${record.sequence}`);
	}

	const decipher = createDecipheriv(algorithm, key, Buffer.from(record.privateData.iv, 'base64'));
	decipher.setAAD(getAdditionalAuthenticatedData(record));
	decipher.setAuthTag(Buffer.from(record.privateData.tag, 'base64'));
	const plaintext = Buffer.concat([
		decipher.update(Buffer.from(record.privateData.value, 'base64')),
		decipher.final(),
	]);

	return JSON.parse(plaintext.toString('utf8'));
};

const publicEventFromStored = (key, record) => {
	const privateData = decodePrivateData(key, record);
	const actor = { ...record.actor };

	if (privateData.actorDisplay !== null) {
		actor.display = privateData.actorDisplay;
	}

	return {
		schema: record.schema,
		eventId: record.eventId,
		customerChannelId: record.customerChannelId,
		sequence: record.sequence,
		eventType: record.eventType,
		occurredAt: record.occurredAt,
		recordedAt: record.recordedAt,
		actor,
		source: record.source,
		visibility: record.visibility,
		causationId: record.causationId,
		correlationId: record.correlationId,
		payload: privateData.payload,
	};
};

const comparableInput = (event) => {
	const { sequence: _sequence, recordedAt: _recordedAt, ...input } = event;
	return JSON.stringify(input);
};

export class AwarenessIntegrityError extends Error {
	constructor(message) {
		super(message);
		this.name = 'AwarenessIntegrityError';
	}
}

export class EncryptedJsonlAwarenessStore {
	#rootDirectory;
	#encryptionKey;
	#clock;
	#queues = new Map();

	constructor({ rootDirectory, encryptionKey, clock = () => new Date() }) {
		if (typeof rootDirectory !== 'string' || rootDirectory.length === 0) {
			throw new AwarenessValidationError('rootDirectory must be a non-empty string');
		}

		if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== 32) {
			throw new AwarenessValidationError('encryptionKey must be a 32-byte Buffer');
		}

		if (typeof clock !== 'function') {
			throw new AwarenessValidationError('clock must be a function');
		}

		this.#rootDirectory = resolve(rootDirectory);
		this.#encryptionKey = Buffer.from(encryptionKey);
		this.#clock = clock;
	}

	async append(input) {
		const normalized = normalizeEventInput(input);
		const previous = this.#queues.get(normalized.customerChannelId) ?? Promise.resolve();
		const current = previous.catch(() => undefined).then(() => this.#appendUnlocked(normalized));
		this.#queues.set(normalized.customerChannelId, current);

		try {
			return await current;
		} finally {
			if (this.#queues.get(normalized.customerChannelId) === current) {
				this.#queues.delete(normalized.customerChannelId);
			}
		}
	}

	async read(customerChannelId, { afterSequence = 0 } = {}) {
		const records = await this.#readStored(customerChannelId);
		return records
			.filter((record) => record.sequence > afterSequence)
			.map((record) => publicEventFromStored(this.#encryptionKey, record));
	}

	async readVisible(customerChannelId, access, options = {}) {
		const events = await this.read(customerChannelId, options);
		return events.filter((event) => canReadEvent(event, access));
	}

	async #appendUnlocked(input) {
		const records = await this.#readStored(input.customerChannelId);
		const existing = records.find((record) => record.eventId === input.eventId);

		if (existing) {
			const event = publicEventFromStored(this.#encryptionKey, existing);

			if (comparableInput(event) !== comparableInput(input)) {
				throw new AwarenessValidationError(`eventId ${input.eventId} was already used for different content`);
			}

			return { appended: false, event };
		}

		const previousRecord = records.at(-1);
		const sequence = (previousRecord?.sequence ?? 0) + 1;
		const recordedAt = this.#clock().toISOString();
		const unsignedRecord = {
			schema: input.schema,
			eventId: input.eventId,
			customerChannelId: input.customerChannelId,
			sequence,
			eventType: input.eventType,
			occurredAt: input.occurredAt,
			recordedAt,
			actor: {
				kind: input.actor.kind,
				id: input.actor.id,
			},
			source: input.source,
			visibility: input.visibility,
			causationId: input.causationId,
			correlationId: input.correlationId,
			previousHash: previousRecord?.eventHash ?? zeroHash,
		};
		const privateData = encodePrivateData(this.#encryptionKey, unsignedRecord, input);
		const recordWithoutHash = { ...unsignedRecord, privateData };
		const storedRecord = { ...recordWithoutHash, eventHash: hashRecord(recordWithoutHash) };
		const filePath = this.#filePath(input.customerChannelId);

		await mkdir(this.#rootDirectory, { recursive: true, mode: 0o700 });
		const handle = await open(filePath, 'a', 0o600);

		try {
			await handle.appendFile(`${JSON.stringify(storedRecord)}\n`, 'utf8');
			await handle.sync();
		} finally {
			await handle.close();
		}

		return {
			appended: true,
			event: publicEventFromStored(this.#encryptionKey, storedRecord),
		};
	}

	async #readStored(customerChannelId) {
		normalizeEventInput({
			eventId: 'evt_validation',
			customerChannelId,
			eventType: 'relationship.created',
			occurredAt: '2000-01-01T00:00:00.000Z',
			actor: { kind: 'system', id: 'sys_validation' },
			source: { surface: 'system', ref: 'ref_validation' },
			visibility: { class: 'private', grants: [] },
			payload: {},
		});

		let contents;

		try {
			contents = await readFile(this.#filePath(customerChannelId), 'utf8');
		} catch (error) {
			if (error.code === 'ENOENT') {
				return [];
			}

			throw error;
		}

		const records = contents
			.split('\n')
			.filter(Boolean)
			.map((line, index) => {
				try {
					return JSON.parse(line);
				} catch (error) {
					throw new AwarenessIntegrityError(`invalid JSON at awareness line ${index + 1}: ${error.message}`);
				}
			});

		let expectedPreviousHash = zeroHash;

		for (const [index, record] of records.entries()) {
			if (record.customerChannelId !== customerChannelId || record.sequence !== index + 1) {
				throw new AwarenessIntegrityError(`invalid customer or sequence at awareness line ${index + 1}`);
			}

			if (record.previousHash !== expectedPreviousHash) {
				throw new AwarenessIntegrityError(`broken awareness hash chain at sequence ${record.sequence}`);
			}

			const { eventHash, ...recordWithoutHash } = record;
			const computedHash = hashRecord(recordWithoutHash);
			const actual = Buffer.from(String(eventHash), 'utf8');
			const expected = Buffer.from(computedHash, 'utf8');

			if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
				throw new AwarenessIntegrityError(`invalid awareness event hash at sequence ${record.sequence}`);
			}

			try {
				decodePrivateData(this.#encryptionKey, record);
			} catch (error) {
				throw new AwarenessIntegrityError(`unable to authenticate awareness payload at sequence ${record.sequence}: ${error.message}`);
			}

			expectedPreviousHash = eventHash;
		}

		return records;
	}

	#filePath(customerChannelId) {
		return resolve(this.#rootDirectory, `${customerChannelId}.jsonl`);
	}
}
