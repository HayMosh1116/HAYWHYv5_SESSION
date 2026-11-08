'use strict';
const { MongoClient } = require('mongodb');
let clientPromise;

function getMongoClient() {
  const uri = String(process.env.MONGODB_URI || '').trim();
  if (!uri) throw new Error('MONGODB_URI is missing. Add it in your host secret settings.');
  if (!clientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      retryWrites: true
    });
    clientPromise = client.connect().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

async function getWhatsAppAuthCollection() {
  const dbName = String(process.env.MONGODB_DB || 'haywhy_mdx').trim();
  if (!dbName) throw new Error('MONGODB_DB cannot be empty.');
  const client = await getMongoClient();
  return client.db(dbName).collection('whatsapp_auth');
}

async function closeMongoClient() {
  if (!clientPromise) return;
  const pending = clientPromise;
  clientPromise = undefined;
  const client = await pending;
  await client.close();
}

module.exports = { getMongoClient, getWhatsAppAuthCollection, closeMongoClient };
