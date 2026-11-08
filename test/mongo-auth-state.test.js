'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { useMongoAuthState } = require('../lib/mongo-auth-state');

class MemoryCollection {
  constructor() { this.docs = new Map(); }
  async createIndex() { return 'sessionId_1_key_1'; }
  async findOne(filter) {
    const doc = this.docs.get(filter.sessionId + ':' + filter.key);
    return doc ? structuredClone(doc) : null;
  }
  async updateOne(filter, update) {
    const id = filter.sessionId + ':' + filter.key;
    const old = this.docs.get(id) || { sessionId: filter.sessionId, key: filter.key };
    Object.assign(old, structuredClone(update.$set));
    this.docs.set(id, old);
    return { acknowledged: true };
  }
  find(filter) {
    return { toArray: async () => [...this.docs.values()].filter(doc =>
      doc.sessionId === filter.sessionId && filter.key.$in.includes(doc.key)
    ).map(doc => structuredClone(doc)) };
  }
  async bulkWrite(operations) {
    for (const operation of operations) {
      if (operation.deleteOne) {
        const { sessionId, key } = operation.deleteOne.filter;
        this.docs.delete(sessionId + ':' + key);
      } else if (operation.updateOne) {
        await this.updateOne(operation.updateOne.filter, operation.updateOne.update);
      }
    }
    return { acknowledged: true };
  }
  async deleteMany(filter) {
    for (const [id, doc] of this.docs) {
      if (doc.sessionId === filter.sessionId &&
          (!filter.key || doc.key.startsWith('key:'))) this.docs.delete(id);
    }
  }
}

const baileys = {
  BufferJSON: {
    replacer: (_key, value) => Buffer.isBuffer(value)
      ? { type: 'Buffer', data: [...value] } : value,
    reviver: (_key, value) => value && value.type === 'Buffer'
      ? Buffer.from(value.data) : value
  },
  proto: { Message: { AppStateSyncKeyData: { fromObject: value => ({ ...value, restored: true }) } } },
  initAuthCreds: () => ({ registered: false, noiseKey: { private: Buffer.from([1, 2]) } })
};

test('persists credentials and merges partial credential updates', async () => {
  const collection = new MemoryCollection();
  const auth = await useMongoAuthState({ collection, sessionId: 'test-session', baileys });
  assert.equal(auth.state.creds.registered, false);
  await auth.saveCreds({ registered: true });
  const stored = await collection.findOne({ sessionId: 'test-session', key: 'creds' });
  assert.equal(stored.value.registered, true);
  assert.deepEqual(stored.value.noiseKey.private, { type: 'Buffer', data: [1, 2] });
  const restored = await useMongoAuthState({ collection, sessionId: 'test-session', baileys });
  assert.equal(restored.state.creds.registered, true);
  assert.deepEqual(restored.state.creds.noiseKey.private, Buffer.from([1, 2]));
});

test('stores, restores, and deletes Signal keys in the shared key format', async () => {
  const collection = new MemoryCollection();
  const auth = await useMongoAuthState({ collection, sessionId: 'shared-id', baileys });
  await auth.state.keys.set({
    'pre-key': { '12': { keyPair: { private: Buffer.from([9]) } } },
    'app-state-sync-key': { abc: { keyData: Buffer.from([7]) } }
  });
  const restored = await useMongoAuthState({ collection, sessionId: 'shared-id', baileys });
  const keys = await restored.state.keys.get('pre-key', ['12', 'missing']);
  assert.deepEqual(keys['12'].keyPair.private, Buffer.from([9]));
  assert.equal(keys.missing, null);
  const appState = await restored.state.keys.get('app-state-sync-key', ['abc']);
  assert.equal(appState.abc.restored, true);
  await restored.state.keys.set({ 'pre-key': { '12': null } });
  const afterDelete = await restored.state.keys.get('pre-key', ['12']);
  assert.equal(afterDelete['12'], null);
});
