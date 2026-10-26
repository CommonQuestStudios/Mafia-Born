// ==================== MONGODB CONNECTION ====================
// Centralised MongoDB client shared by userDB.js (and future modules).
// Reads MONGODB_URI from environment variables.

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'mafiaborn';

let client = null;
let db = null;

async function connect() {
    if (!MONGODB_URI) {
        throw new Error(
            'MONGODB_URI environment variable is not set. ' +
            'Set it to your MongoDB Atlas connection string.'
        );
    }

    client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000
    });
    await client.connect();

    db = client.db(DB_NAME);
    console.log(` Connected to MongoDB (database: ${DB_NAME})`);

    // Ensure indexes for fast lookups
    const users = db.collection('users');
    await users.createIndex({ username: 1 }, { unique: true });
    await users.createIndex({ 'saveData.playerName': 1 }, { sparse: true });
    // Character names are unique across accounts (case-insensitive key)
    await users.createIndex({ characterNameKey: 1 }, { unique: true, sparse: true });

    return db;
}

function getDb() {
    if (!db) throw new Error('Database not connected. Call connect() first.');
    return db;
}

async function close() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log(' MongoDB connection closed');
    }
}

module.exports = { connect, getDb, close };
