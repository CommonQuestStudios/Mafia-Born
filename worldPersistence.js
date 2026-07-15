// Simple JSON-based world persistence for Mafia Born
// What persists:
// - cityDistricts control (e.g., who controls which district)
// - cityEvents (high-level world events visible to all)
// - leaderboard snapshot (top players by reputation)
// File location:
// - Stored at project root as world-state.json
// Extensibility:
// - Future long-lived world data (factions, economy modifiers, crime heat) should be added
// to the object returned by loadWorldState() and passed to saveWorldState(). Keep it small.

const fs = require('fs');
const path = require('path');

const WORLD_STATE_PATH = path.join(process.cwd(), 'world-state.json');
const WORLD_STATE_TMP_PATH = `${WORLD_STATE_PATH}.tmp`;
const WORLD_STATE_BAK_PATH = `${WORLD_STATE_PATH}.bak`;
const SAVE_THROTTLE_MS = 5000; // Don't save more than once every 5 seconds

const DEFAULT_STATE = {
  cityDistricts: {
    downtown: { controlledBy: null, crimeLevel: 50 },
    docks: { controlledBy: null, crimeLevel: 75 },
    suburbs: { controlledBy: null, crimeLevel: 25 },
    industrial: { controlledBy: null, crimeLevel: 60 },
    redlight: { controlledBy: null, crimeLevel: 90 }
  },
  cityEvents: [
    { type: 'police_raid', district: 'industrial', description: 'Heavy police presence, high risk/reward jobs available', timeLeft: '15 min', createdAt: Date.now() },
    { type: 'market_crash', district: 'downtown', description: 'Economic instability, weapon prices fluctuating', timeLeft: '1 hour', createdAt: Date.now() },
    { type: 'gang_meeting', district: 'docks', description: 'Underground meeting, recruitment opportunities', timeLeft: '30 min', createdAt: Date.now() }
  ],
  leaderboard: [] // array of { name, reputation, territory }
};

// Throttling state
let pendingSave = null;
let saveTimer = null;

function loadWorldState() {
  try {
    if (!fs.existsSync(WORLD_STATE_PATH)) {
      console.log(' No world-state.json found, using defaults');
      return { ...DEFAULT_STATE };
    }
    const raw = fs.readFileSync(WORLD_STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    // Merge with defaults to tolerate missing fields
    const merged = {
      cityDistricts: parsed.cityDistricts || { ...DEFAULT_STATE.cityDistricts },
      cityEvents: Array.isArray(parsed.cityEvents) ? parsed.cityEvents : [...DEFAULT_STATE.cityEvents],
      leaderboard: Array.isArray(parsed.leaderboard) ? parsed.leaderboard : [],
      territories: parsed.territories || null,
      politics: parsed.politics || null,
      alliances: parsed.alliances || null,
      bounties: Array.isArray(parsed.bounties) ? parsed.bounties : [],
      marketplace: Array.isArray(parsed.marketplace) ? parsed.marketplace : [],
      season: parsed.season || null
    };
    console.log(' World state loaded from world-state.json');
    return merged;
  } catch (err) {
    console.error(' Failed to load world-state.json, using defaults:', err.message);
    return { ...DEFAULT_STATE };
  }
}

function saveWorldStateImmediate(state) {
  try {
    const data = JSON.stringify(state, null, 2);
    // Atomic pattern: write temp file first, then replace target.
    fs.writeFileSync(WORLD_STATE_TMP_PATH, data, 'utf-8');
    if (fs.existsSync(WORLD_STATE_PATH)) {
      fs.copyFileSync(WORLD_STATE_PATH, WORLD_STATE_BAK_PATH);
    }
    fs.renameSync(WORLD_STATE_TMP_PATH, WORLD_STATE_PATH);
    console.log(' World state saved to world-state.json');
  } catch (err) {
    console.error(' Error saving world-state.json:', err.message);
    try {
      if (fs.existsSync(WORLD_STATE_TMP_PATH)) fs.unlinkSync(WORLD_STATE_TMP_PATH);
    } catch (_cleanupErr) {
      // ignore temp cleanup errors
    }
  }
}

function saveWorldState(state) {
  // Store the latest state to save
  pendingSave = state;
  
  // If a save is already scheduled, don't schedule another
  if (saveTimer) {
    return;
  }
  
  // Schedule a throttled save
  saveTimer = setTimeout(() => {
    if (pendingSave) {
      saveWorldStateImmediate(pendingSave);
      pendingSave = null;
    }
    saveTimer = null;
  }, SAVE_THROTTLE_MS);
}

// Force save any pending changes (call on server shutdown)
function flushWorldState() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (pendingSave) {
    saveWorldStateImmediate(pendingSave);
    pendingSave = null;
  }
}

module.exports = {
  loadWorldState,
  saveWorldState,
  saveWorldStateImmediate,
  flushWorldState,
  WORLD_STATE_PATH
};
