import { formatAwarenessEvent } from './format.mjs';

const defaultAccess = {
	allowedVisibility: ['customer', 'channel'],
	grantIds: [],
};

export class CustomerAwarenessProjector {
	#awarenessStore;
	#identityStore;
	#ledger;
	#rocketClient;
	#members;

	constructor({ awarenessStore, identityStore, ledger, rocketClient, members = [] }) {
		for (const [name, value] of Object.entries({ awarenessStore, identityStore, ledger, rocketClient })) {
			if (!value || typeof value !== 'object') {
				throw new TypeError(`${name} is required`);
			}
		}

		this.#awarenessStore = awarenessStore;
		this.#identityStore = identityStore;
		this.#ledger = ledger;
		this.#rocketClient = rocketClient;
		this.#members = [...members];
	}

	async ensureRoom(customerChannelId) {
		const existing = this.#identityStore.getRocketBinding(customerChannelId);

		if (existing) {
			return existing;
		}

		const customerChannel = this.#identityStore.getCustomerChannel(customerChannelId);

		if (!customerChannel) {
			throw new Error(`unknown customer channel ${customerChannelId}`);
		}

		const created = await this.#rocketClient.createCustomerRoom({
			customerChannelId,
			displayName: customerChannel.displayName,
			members: this.#members,
		});

		return this.#identityStore.upsertRocketBinding({
			customerChannelId,
			roomId: created.roomId,
			schemaVersion: 1,
		});
	}

	async projectCustomerChannel(customerChannelId, { access = defaultAccess } = {}) {
		const binding = await this.ensureRoom(customerChannelId);
		const events = await this.#awarenessStore.readVisible(customerChannelId, access);
		const projected = [];

		for (const event of events) {
			const existing = this.#ledger.get(event.eventId);

			if (existing) {
				projected.push({ ...existing, replayed: true });
				continue;
			}

			const formatted = formatAwarenessEvent(event);
			const message = await this.#rocketClient.postAwarenessEvent({
				roomId: binding.roomId,
				...formatted,
			});
			const ledgerEntry = this.#ledger.record({
				eventId: event.eventId,
				customerChannelId,
				sequence: event.sequence,
				roomId: binding.roomId,
				messageId: message.messageId,
			});
			projected.push({ ...ledgerEntry, replayed: false });
		}

		return {
			customerChannelId,
			roomId: binding.roomId,
			events: projected,
		};
	}
}
