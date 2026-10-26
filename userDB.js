// ==================== USER DATABASE - MONGODB PERSISTENCE ====================
// MongoDB-backed user storage for accounts & cloud saves.
// All user CRUD methods are async. Sessions stay in-memory with
// MongoDB persistence so they survive server restarts.

const crypto = require('crypto');
const { getDb } = require('./db');

// ── Password hashing (PBKDF2 — no external deps) ──────────────
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    // Constant-time comparison to prevent timing attacks
    const checkBuf = Buffer.from(check, 'hex');
    const hashBuf = Buffer.from(hash, 'hex');
    if (checkBuf.length !== hashBuf.length) return false;
    return crypto.timingSafeEqual(checkBuf, hashBuf);
}

// ── Helpers ────────────────────────────────────────────────────
function users() { return getDb().collection('users'); }
function sessionsCol() { return getDb().collection('sessions'); }

// ── Session tokens (in-memory + MongoDB backup) ────────────────
const sessions = new Map(); // token -> { username, expiresAt }
const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function restoreSessions() {
    const now = Date.now();
    const docs = await sessionsCol().find({ expiresAt: { $gt: now } }).toArray();
    let restored = 0;
    for (const doc of docs) {
        sessions.set(doc.token, { username: doc.username, expiresAt: doc.expiresAt });
        restored++;
    }
    if (restored > 0) console.log(` Restored ${restored} active session(s)`);
}

async function persistSession(token, session) {
    await sessionsCol().updateOne(
        { token },
        { $set: { token, username: session.username, expiresAt: session.expiresAt } },
        { upsert: true }
    );
}

async function removeSession(token) {
    await sessionsCol().deleteOne({ token });
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function createSession(username) {
    // Invalidate existing sessions for this user
    for (const [tok, sess] of sessions) {
        if (sess.username === username) {
            sessions.delete(tok);
            removeSession(tok).catch(() => {});
        }
    }
    const token = generateToken();
    const session = { username, expiresAt: Date.now() + TOKEN_LIFETIME_MS };
    sessions.set(token, session);
    await persistSession(token, session);
    return token;
}

function validateToken(token) {
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        removeSession(token).catch(() => {});
        return null;
    }
    return session.username;
}

async function destroySession(token) {
    sessions.delete(token);
    await removeSession(token);
}

// Periodically clean expired sessions (every 30 min)
setInterval(() => {
    const now = Date.now();
    for (const [tok, sess] of sessions) {
        if (now > sess.expiresAt) {
            sessions.delete(tok);
            removeSession(tok).catch(() => {});
        }
    }
    // Also clean MongoDB
    sessionsCol().deleteMany({ expiresAt: { $lte: now } }).catch(() => {});
}, 30 * 60 * 1000);

// ── User CRUD ──────────────────────────────────────────────────
async function createUser(username, password) {
    if (username.length < 3 || username.length > 20) return { ok: false, error: 'Username must be 3-20 characters' };
    if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters' };
    if (password.length > 128) return { ok: false, error: 'Password must be 128 characters or fewer' };
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return { ok: false, error: 'Username can only contain letters, numbers, and underscores' };

    const key = username.toLowerCase();
    // A new login name can't match another account's character name
    if (await users().findOne({ characterNameKey: key }, { projection: { _id: 1 } })) {
        return { ok: false, error: 'Username already taken' };
    }
    const doc = {
        username: key,         // lookup key (lowercase)
        displayName: username, // preserve original casing
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        saveData: null
    };
    try {
        await users().insertOne(doc);
    } catch (err) {
        if (err.code === 11000) return { ok: false, error: 'Username already taken' };
        throw err;
    }
    return { ok: true };
}

async function authenticateUser(username, password) {
    const key = username.toLowerCase();
    const user = await users().findOne({ username: key });
    if (!user) return { ok: false, error: 'Invalid username or password' };
    try {
        if (!verifyPassword(password, user.passwordHash)) return { ok: false, error: 'Invalid username or password' };
    } catch (_e) {
        return { ok: false, error: 'Invalid username or password' };
    }

    await users().updateOne({ username: key }, { $set: { lastLogin: new Date().toISOString() } });
    return { ok: true, username: user.displayName };
}

async function getUserSave(username) {
    const key = username.toLowerCase();
    const user = await users().findOne({ username: key }, { projection: { saveData: 1 } });
    if (!user) return null;
    return user.saveData;
}

async function setUserSave(username, saveData) {
    const key = username.toLowerCase();
    const result = await users().updateOne({ username: key }, { $set: { saveData } });
    return result.matchedCount > 0;
}

async function clearUserSave(username) {
    const key = username.toLowerCase();
    const result = await users().updateOne({ username: key }, { $set: { saveData: null } });
    return result.matchedCount > 0;
}

async function changePassword(username, oldPassword, newPassword) {
    const key = username.toLowerCase();
    const user = await users().findOne({ username: key });
    if (!user) return { ok: false, error: 'User not found' };
    if (!verifyPassword(oldPassword, user.passwordHash)) return { ok: false, error: 'Current password is incorrect' };
    if (newPassword.length < 6) return { ok: false, error: 'New password must be at least 6 characters' };
    if (newPassword.length > 128) return { ok: false, error: 'New password must be 128 characters or fewer' };

    await users().updateOne({ username: key }, { $set: { passwordHash: hashPassword(newPassword) } });
    return { ok: true };
}

async function deleteUser(username) {
    const key = username.toLowerCase();
    const result = await users().deleteOne({ username: key });
    return result.deletedCount > 0;
}

async function getUserInfo(username) {
    const key = username.toLowerCase();
    const user = await users().findOne({ username: key });
    if (!user) return null;
    return {
        username: user.displayName,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        hasSave: !!user.saveData,
        saveDate: user.saveData ? user.saveData.saveDate : null,
        playerName: user.saveData ? (user.saveData.playerName || null) : null,
        playerLevel: user.saveData ? (user.saveData.level || null) : null
    };
}

// Check if a character/player name is already used by another account: its login
// username, its chosen character name, or the name stored in its save data.
// excludeUsername: skip this account (so a player re-saving with their own name passes).
async function isPlayerNameTaken(name, excludeUsername) {
    if (!name) return false;
    const target = name.trim();
    const key = characterNameKey(target);
    const filter = {
        $or: [
            { username: key },
            { characterNameKey: key },
            { 'saveData.playerName': { $regex: new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
        ]
    };
    if (excludeUsername) {
        filter.username = { $ne: excludeUsername.toLowerCase() };
    }
    const match = await users().findOne(filter, { projection: { _id: 1 } });
    return !!match;
}

// ── Character names & paid name changes ────────────────────────
const NAME_CHANGE_BASE_PRICE = 100000;
const NAME_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const LOOKS_LIKE_GUEST = /^guest(?![a-z])/i;

function characterNameKey(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Price doubles with every change: $100k, $200k, $400k, ...
function nameChangePrice(changesMade) {
    return NAME_CHANGE_BASE_PRICE * Math.pow(2, Math.min(Math.max(changesMade || 0, 0), 40));
}

// The account's authoritative character name. Accounts created before character names existed
// adopt their last saved name (if still unique), otherwise their login name.
async function ensureCharacterName(username) {
    const key = username.toLowerCase();
    const user = await users().findOne(
        { username: key },
        { projection: { displayName: 1, characterName: 1, 'saveData.playerName': 1 } }
    );
    if (!user) return null;
    if (user.characterName) return user.characterName;

    const candidates = [];
    const legacy = user.saveData && typeof user.saveData.playerName === 'string'
        ? user.saveData.playerName.trim().replace(/\s+/g, ' ')
        : '';
    if (legacy && legacy.length <= 20 && !LOOKS_LIKE_GUEST.test(legacy) && !(await isPlayerNameTaken(legacy, key))) {
        candidates.push(legacy);
    }
    candidates.push(user.displayName);

    for (const name of candidates) {
        try {
            await users().updateOne(
                { username: key, characterName: { $exists: false } },
                { $set: { characterName: name, characterNameKey: characterNameKey(name) } }
            );
            break;
        } catch (err) {
            if (err.code !== 11000) throw err;
        }
    }
    const fresh = await users().findOne({ username: key }, { projection: { characterName: 1 } });
    return (fresh && fresh.characterName) || user.displayName;
}

async function getNameChangeInfo(username) {
    const name = await ensureCharacterName(username);
    if (!name) return null;
    const user = await users().findOne(
        { username: username.toLowerCase() },
        { projection: { nameChanges: 1, lastNameChangeAt: 1 } }
    );
    const nameChanges = (user && user.nameChanges) || 0;
    const lastNameChangeAt = (user && user.lastNameChangeAt) || 0;
    return {
        name,
        nameChanges,
        price: nameChangePrice(nameChanges),
        lastNameChangeAt,
        availableAt: lastNameChangeAt ? lastNameChangeAt + NAME_CHANGE_COOLDOWN_MS : 0
    };
}

// newName must already be validated for format/profanity by the caller.
async function changeCharacterName(username, newName, expectedPrice) {
    const key = username.toLowerCase();
    const info = await getNameChangeInfo(username);
    if (!info) return { ok: false, status: 404, error: 'Account not found' };
    if (info.availableAt > Date.now()) {
        return { ok: false, status: 429, error: 'You can only change your name once every 7 days.', availableAt: info.availableAt };
    }
    if (expectedPrice !== info.price) {
        return { ok: false, status: 409, error: 'The name change price has changed. Please try again.', price: info.price };
    }
    if (newName === info.name) return { ok: false, status: 400, error: 'That is already your name.' };
    if (await isPlayerNameTaken(newName, key)) return { ok: false, status: 409, error: 'That name is already taken.' };

    const now = Date.now();
    // Matching on the previous change time makes concurrent requests charge only once
    const filter = info.lastNameChangeAt
        ? { username: key, lastNameChangeAt: info.lastNameChangeAt }
        : { username: key, lastNameChangeAt: { $exists: false } };
    let result;
    try {
        result = await users().updateOne(filter, {
            $set: { characterName: newName, characterNameKey: characterNameKey(newName), lastNameChangeAt: now },
            $inc: { nameChanges: 1 }
        });
    } catch (err) {
        if (err.code === 11000) return { ok: false, status: 409, error: 'That name is already taken.' };
        throw err;
    }
    if (result.matchedCount === 0) {
        return { ok: false, status: 409, error: 'Your name was just changed. Please refresh and try again.' };
    }
    await users().updateOne(
        { username: key, saveData: { $type: 'object' } },
        { $set: { 'saveData.playerName': newName } }
    );
    return {
        ok: true,
        name: newName,
        oldName: info.name,
        price: info.price,
        nextPrice: nameChangePrice(info.nameChanges + 1),
        availableAt: now + NAME_CHANGE_COOLDOWN_MS
    };
}

// ── Initialization (called once after MongoDB connects) ────────
async function init() {
    await restoreSessions();
    const count = await users().countDocuments();
    console.log(` User DB ready — ${count} accounts`);
}

module.exports = {
    init,
    createUser,
    authenticateUser,
    getUserSave,
    setUserSave,
    clearUserSave,
    changePassword,
    deleteUser,
    getUserInfo,
    isPlayerNameTaken,
    ensureCharacterName,
    getNameChangeInfo,
    changeCharacterName,
    NAME_CHANGE_COOLDOWN_MS,
    createSession,
    validateToken,
    destroySession
};
