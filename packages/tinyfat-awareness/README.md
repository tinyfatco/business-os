# `@tinyfat/customer-awareness`

This package implements the first durable form of the TinyFat customer
awareness stream.

It provides:

- a validated event envelope;
- per-customer ordering and producer idempotency;
- AES-256-GCM encryption for event payloads and actor display data;
- a hash chain for corruption detection;
- visibility-filtered reads for scoped projections;
- durable JSONL append and `fsync`.

The JSONL backend is deliberately a spike backend for hostd, which is a
single-writer process. It does not claim to coordinate writers across multiple
processes. The event contract and tests are intended to survive a later storage
backend change.

```js
import { EncryptedJsonlAwarenessStore } from '@tinyfat/customer-awareness';

const store = new EncryptedJsonlAwarenessStore({
	rootDirectory: '/host-owned/customer-awareness',
	encryptionKey: Buffer.from(process.env.AWARENESS_KEY, 'base64'),
});

await store.append({
	eventId: 'evt_example',
	customerChannelId: 'cus_example',
	eventType: 'message.inbound.recorded',
	occurredAt: new Date().toISOString(),
	actor: { kind: 'contact', id: 'con_example', display: 'Example Customer' },
	source: { surface: 'email', ref: 'gmail-thread:opaque' },
	visibility: { class: 'channel', grants: [] },
	payload: { body: 'Can you help with our website?' },
});
```

Never put provider credentials in an event. Provider references should be
opaque, and unrestricted endpoint values should remain in the host-owned
identity vault.
