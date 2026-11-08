'use strict';

async function useMongoAuthState({ collection, sessionId, baileys = require('prince-baileys') }) {
  if (!collection) throw new Error('MongoDB auth collection is required');
  if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error('A session ID is required');

  const { BufferJSON, proto, initAuthCreds } = baileys || {};
  if (!BufferJSON?.replacer || !BufferJSON?.reviver || typeof initAuthCreds !== 'function') {
    throw new Error('Pinned prince-baileys is missing BufferJSON or initAuthCreds exports');
  }

  await collection.createIndex({ sessionId: 1, key: 1 }, { unique: true });
  const encode = value => JSON.parse(JSON.stringify(value, BufferJSON.replacer));
  const decode = value => JSON.parse(JSON.stringify(value), BufferJSON.reviver);
  const read = async key => {
    const doc = await collection.findOne({ sessionId, key });
    return doc ? decode(doc.value) : null;
  };
  const write = async (key, value) => collection.updateOne(
    { sessionId, key },
    { $set: { value: encode(value), updatedAt: new Date() } },
    { upsert: true, writeConcern: { w: 'majority' } }
  );

  let creds = await read('creds');
  if (!creds) {
    creds = initAuthCreds();
    await write('creds', creds);
  }

  const keys = {
    async get(type, ids) {
      if (!Array.isArray(ids) || !ids.length) return {};
      const prefix = `key:${type}:`;
      const docs = await collection.find({
        sessionId,
        key: { $in: ids.map(id => prefix + id) }
      }).toArray();
      const result = Object.fromEntries(ids.map(id => [id, null]));
      for (const doc of docs) {
        const id = doc.key.slice(prefix.length);
        let value = decode(doc.value);
        if (type === 'app-state-sync-key' && value && proto?.Message?.AppStateSyncKeyData) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        }
        result[id] = value;
      }
      return result;
    },
    async set(data) {
      const operations = [];
      for (const [type, entries] of Object.entries(data || {})) {
        for (const [id, value] of Object.entries(entries || {})) {
          const key = `key:${type}:${id}`;
          if (value == null) operations.push({ deleteOne: { filter: { sessionId, key } } });
          else operations.push({
            updateOne: {
              filter: { sessionId, key },
              update: { $set: { value: encode(value), updatedAt: new Date() } },
              upsert: true
            }
          });
        }
      }
      if (operations.length) await collection.bulkWrite(operations, {
        ordered: true,
        writeConcern: { w: 'majority' }
      });
    }
  };

  return {
    state: { creds, keys },
    async saveCreds(update = {}) {
      if (update && typeof update === 'object') Object.assign(creds, update);
      await write('creds', creds);
    }
  };
}

module.exports = { useMongoAuthState };
