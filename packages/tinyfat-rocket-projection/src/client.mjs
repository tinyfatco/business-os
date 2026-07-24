const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

const slugifyRoomName = (displayName, customerChannelId) => {
	const base =
		displayName
			.normalize('NFKD')
			.replace(/\p{M}+/gu, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 55) || 'customer';
	const suffix = customerChannelId
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(-18);
	return `customer-${base}-${suffix}`;
};

export class RocketChatApiError extends Error {
	constructor(message, { status, endpoint, code } = {}) {
		super(message);
		this.name = 'RocketChatApiError';
		this.status = status;
		this.endpoint = endpoint;
		this.code = code;
	}
}

export class RocketChatClient {
	#baseUrl;
	#userId;
	#authToken;
	#fetch;

	constructor({ baseUrl, userId, authToken, fetchImpl = globalThis.fetch }) {
		if (typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl)) {
			throw new TypeError('baseUrl must be an HTTP(S) URL');
		}

		if (typeof userId !== 'string' || userId.length === 0) {
			throw new TypeError('userId must be a non-empty string');
		}

		if (typeof authToken !== 'string' || authToken.length === 0) {
			throw new TypeError('authToken must be a non-empty string');
		}

		if (typeof fetchImpl !== 'function') {
			throw new TypeError('fetchImpl must be a function');
		}

		this.#baseUrl = trimTrailingSlash(baseUrl);
		this.#userId = userId;
		this.#authToken = authToken;
		this.#fetch = fetchImpl;
	}

	async createCustomerRoom({ customerChannelId, displayName, members = [] }) {
		const roomName = slugifyRoomName(displayName, customerChannelId);
		const response = await this.#request('/api/v1/groups.create', {
			method: 'POST',
			body: {
				name: roomName,
				members,
				readOnly: false,
				customFields: {
					tinyfat: {
						schema: 1,
						kind: 'customer-channel',
						customerChannelId,
						displayName,
						status: 'active',
					},
				},
				extraData: {
					broadcast: false,
					encrypted: false,
					topic: `Customer relationship: ${displayName}`,
				},
			},
		});

		if (!response.group?._id) {
			throw new RocketChatApiError('Rocket.Chat did not return the created private room', {
				endpoint: '/api/v1/groups.create',
			});
		}

		return {
			roomId: response.group._id,
			roomName: response.group.name ?? roomName,
		};
	}

	async postAwarenessEvent({ roomId, text, metadata }) {
		const response = await this.#request('/api/v1/chat.postMessage', {
			method: 'POST',
			body: {
				roomId,
				text,
				customFields: {
					tinyfat: metadata,
				},
			},
		});

		if (!response.message?._id) {
			throw new RocketChatApiError('Rocket.Chat did not return the projected message', {
				endpoint: '/api/v1/chat.postMessage',
			});
		}

		return {
			messageId: response.message._id,
			roomId: response.message.rid ?? roomId,
		};
	}

	async #request(endpoint, { method, body }) {
		const response = await this.#fetch(`${this.#baseUrl}${endpoint}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				'X-Auth-Token': this.#authToken,
				'X-User-Id': this.#userId,
			},
			body: JSON.stringify(body),
		});
		let payload;

		try {
			payload = await response.json();
		} catch {
			throw new RocketChatApiError(`Rocket.Chat returned a non-JSON response for ${endpoint}`, {
				status: response.status,
				endpoint,
			});
		}

		if (!response.ok || payload.success !== true) {
			throw new RocketChatApiError(`Rocket.Chat request failed for ${endpoint}`, {
				status: response.status,
				endpoint,
				code: payload.errorType ?? payload.error,
			});
		}

		return payload;
	}
}

export { slugifyRoomName };
