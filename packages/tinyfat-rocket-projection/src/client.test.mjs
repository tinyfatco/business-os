import assert from 'node:assert/strict';
import test from 'node:test';

import { RocketChatApiError, RocketChatClient, slugifyRoomName } from './index.mjs';

test('creates private customer rooms with TinyFat metadata and host credentials', async () => {
	const requests = [];
	const client = new RocketChatClient({
		baseUrl: 'http://127.0.0.1:3100/',
		userId: 'bridge-user',
		authToken: 'secret-token',
		fetchImpl: async (url, init) => {
			requests.push({ url, init });
			return new Response(
				JSON.stringify({
					success: true,
					group: { _id: 'room-acme', name: 'customer-acme-cus-acme' },
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		},
	});

	const created = await client.createCustomerRoom({
		customerChannelId: 'cus_acme',
		displayName: 'Acme & Sons',
		members: ['alex', 'batman'],
	});

	assert.equal(created.roomId, 'room-acme');
	assert.equal(requests[0].url, 'http://127.0.0.1:3100/api/v1/groups.create');
	assert.equal(requests[0].init.headers['X-Auth-Token'], 'secret-token');
	assert.equal(requests[0].init.headers['X-User-Id'], 'bridge-user');
	const body = JSON.parse(requests[0].init.body);
	assert.equal(body.customFields.tinyfat.customerChannelId, 'cus_acme');
	assert.deepEqual(body.members, ['alex', 'batman']);
	assert.match(body.name, /^customer-acme-sons-/);
});

test('returns sanitized API errors without credential material', async () => {
	const client = new RocketChatClient({
		baseUrl: 'http://127.0.0.1:3100',
		userId: 'bridge-user',
		authToken: 'never-print-this-token',
		fetchImpl: async () =>
			new Response(JSON.stringify({ success: false, errorType: 'error-not-allowed' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' },
			}),
	});

	await assert.rejects(
		client.postAwarenessEvent({
			roomId: 'room-acme',
			text: 'hello',
			metadata: { eventId: 'evt_example' },
		}),
		(error) => {
			assert.equal(error instanceof RocketChatApiError, true);
			assert.equal(error.status, 403);
			assert.equal(error.code, 'error-not-allowed');
			assert.equal(error.message.includes('never-print-this-token'), false);
			return true;
		},
	);
});

test('builds deterministic room slugs', () => {
	assert.equal(slugifyRoomName('Ácme Website!', 'cus_123456789'), 'customer-acme-website-cus-123456789');
});
