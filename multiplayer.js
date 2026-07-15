// ==================== THE COMMISSION SYSTEM ====================

// Online world configuration
const onlineWorld = {
    maxPlayersPerServer: 100,
    // WebSocket server URL
    // Local dev -> ws://localhost:3000
    // Production -> Render.com (serves both game files and WebSocket)
    serverUrl: (function(){
        try {
            if (window.__MULTIPLAYER_SERVER_URL__) return window.__MULTIPLAYER_SERVER_URL__;
            const hostname = window.location.hostname;
            const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
            if (isLocal) return 'ws://localhost:3000';
            // Production: always connect to Render for WebSocket/multiplayer
            return 'wss://mafia-born.onrender.com';
        } catch (e) {
            return 'wss://mafia-born.onrender.com';
        }
    })(),
    updateInterval: 2000, // 2 second update interval for world state
    reconnectInterval: 5000, // 5 seconds between reconnect attempts
    events: {
        PLAYER_CONNECT: 'player_connect',
        PLAYER_DISCONNECT: 'player_disconnect',
        WORLD_UPDATE: 'world_update',
        JOB_COMPLETE: 'job_complete',
        TERRITORY_TAKEN: 'territory_taken',
        GANG_WAR_STARTED: 'gang_war_started',
        GLOBAL_CHAT: 'global_chat',
        HEIST_BROADCAST: 'heist_broadcast',
        PLAYER_RANKED: 'player_ranked',
        CITY_EVENT: 'city_event'
    }
};

// Log resolved server URL for debugging so uploader can see what client will attempt to connect to
try {
    // Server URL resolved
} catch (e) {}


// Online world state
let onlineWorldState = {
    isConnected: false,
    connectionStatus: 'disconnected', // 'connecting', 'connected', 'disconnected', 'error'
    socket: null,
    playerId: null,
    serverInfo: {
        playerCount: 0,
        serverName: 'Mafia Born - The Commission',
        cityEvents: [],
        globalLeaderboard: []
    },
    nearbyPlayers: [],
    globalChat: [],
    crewChat: [],
    allianceChat: [],
    privateChats: {},  // { playerName: [ {player, message, time, color} ] }
    privateChatAll: [], // combined DM thread (all conversations merged chronologically)
    activeChatChannel: 'world', // 'world', 'crew', 'alliance', 'private'
    activePrivateChatTarget: null, // name of the player we're DMing
    // Multiplayer area-control zones — controlled by real players or NPC gangs.
    // These are broad city zones for PvP territory control, separate from the
    // economic districtTypes in game.js (single-player neighborhoods) and the
    // EXPANDED_TERRITORIES in game.js (single-player gang war zones).
    cityDistricts: {
        downtown: { 
            controlledBy: null, 
            controllerType: 'npc', // 'npc' or 'player'
            npcGang: 'The Street Kings',
            crimeLevel: 50,
            defenseRating: 100,
            weeklyIncome: 15000,
            assignedMembers: 0,
            assignedCars: 0,
            assignedWeapons: 0
        },
        docks: { 
            controlledBy: null, 
            controllerType: 'npc',
            npcGang: 'The Longshoremen',
            crimeLevel: 75,
            defenseRating: 150,
            weeklyIncome: 25000,
            assignedMembers: 0,
            assignedCars: 0,
            assignedWeapons: 0
        },
        suburbs: { 
            controlledBy: null, 
            controllerType: 'npc',
            npcGang: 'The Neighborhood Watch',
            crimeLevel: 25,
            defenseRating: 50,
            weeklyIncome: 8000,
            assignedMembers: 0,
            assignedCars: 0,
            assignedWeapons: 0
        },
        industrial: { 
            controlledBy: null, 
            controllerType: 'npc',
            npcGang: 'The Factory Boys',
            crimeLevel: 60,
            defenseRating: 120,
            weeklyIncome: 18000,
            assignedMembers: 0,
            assignedCars: 0,
            assignedWeapons: 0
        },
        redlight: { 
            controlledBy: null, 
            controllerType: 'npc',
            npcGang: 'The Vice Lords',
            crimeLevel: 90,
            defenseRating: 200,
            weeklyIncome: 35000,
            assignedMembers: 0,
            assignedCars: 0,
            assignedWeapons: 0
        }
    },
    activeHeists: [],
    gangWars: [],
    territories: {},   // Phase 1 unified territory state (synced from server)
    politics: null,    // Political system state (synced from server)
    jailRoster: { realPlayers: [], bots: [], totalOnlineInJail: 0 },
    lastUpdate: null
};

// Territory income tracking
let territoryIncomeNextCollection = Date.now() + (7 * 24 * 60 * 60 * 1000); // Next weekly collection
const pendingHeistJoins = new Set();

// Safe wrappers — game.js module may not be loaded when early WebSocket messages arrive
const _safeUpdateUI = () => { if (typeof updateUI === 'function') updateUI(); };
const _safeLogAction = (...args) => { if (typeof logAction === 'function') logAction(...args); };

/**
 * Show a toast notification at the top of the screen.
 * Auto-dismisses after `duration` ms.
 */
function showMPToast(text, color, duration) {
    duration = duration || 4000;
    color = color || '#c0a062';
    let container = document.getElementById('mp-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'mp-toast-container';
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.style.cssText = `background:rgba(0,0,0,0.92);border:1px solid ${color};color:${color};padding:12px 20px;border-radius:8px;font-family:Georgia,serif;font-size:0.95em;box-shadow:0 4px 15px rgba(0,0,0,0.5);pointer-events:auto;opacity:0;transform:translateX(30px);transition:opacity 0.3s,transform 0.3s;max-width:350px;`;
    toast.textContent = text;
    container.appendChild(toast);
    // Animate in
    requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; });
    setTimeout(() => {
        toast.style.opacity = '0'; toast.style.transform = 'translateX(30px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ==================== MISSING FUNCTION IMPLEMENTATIONS ====================

// Sync server territory data to local player object
function syncMultiplayerTerritoriesToPlayer() {
    // If connected to server, territories come from server state
    // Otherwise use local player.turf.owned
    if (onlineWorldState.isConnected && onlineWorldState.territories) {
        // Server territories override local
    }
    // No-op if offline — local territories are already on player object
}

// Count territories the player controls
function countControlledTerritories() {
    if (typeof player !== 'undefined' && player.turf && player.turf.owned) {
        return player.turf.owned.length;
    }
    return 0;
}

// Calculate weekly income from multiplayer territories
function calculateMultiplayerTerritoryWeeklyIncome() {
    if (typeof player !== 'undefined' && player.territoryIncome) {
        return player.territoryIncome;
    }
    return 0;
}

// Show the "Whack Rival Don" high-risk PvP challenge
function showWhackRivalDon() {
    if (!onlineWorldState.isConnected) {
        window.ui.toast('You must be connected to the online world to challenge a rival Don.', 'error');
        return;
    }
    const content = document.getElementById('multiplayer-content');
    if (!content) return;
    
    content.innerHTML = `
        <div style="background: rgba(0,0,0,0.95); padding: 30px; border-radius: 15px; border: 3px solid #c0a062;">
            <h2 style="color: #c0a062; text-align: center; font-family: 'Georgia', serif;">Whack Rival Don</h2>
            <p style="color: #ccc; text-align: center; font-style: italic;">A casual PvP brawl between Dons. No permadeath — just bragging rights.</p>
            <div style="background: rgba(192, 160, 98, 0.1); padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #c0a062;">
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; text-align: center;">
                    <div>
                        <div style="color: #c0a040; font-weight: bold;">Don Respect</div>
                        <div style="color: #888; font-size: 0.8em;">Win = +Respect / Lose = -Respect</div>
                    </div>
                    <div>
                        <div style="color: #e67e22; font-weight: bold;">Health</div>
                        <div style="color: #888; font-size: 0.8em;">Both fighters take damage</div>
                    </div>
                </div>
            </div>
            <p style="color: #888; text-align: center; font-size: 0.85em; margin: 5px 0 15px 0;">Don Respect is for fun & ranking only -- pick a fight and see who's tougher!</p>
            <div id="online-player-list" style="margin: 20px 0;">
                <p style="color: #888; text-align: center;">Loading online players...</p>
            </div>
            <div style="text-align: center; margin-top: 20px;">
                <button onclick="showOnlineWorld()" style="background: #333; color: #c0a062; padding: 12px 25px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif;">? Back to Commission</button>
            </div>
        </div>
    `;
    updateOnlinePlayerList();
}

// ==================== HEIST SYSTEM ====================

// Heist target definitions with difficulty, reward, and requirements
const HEIST_TARGETS = [
    { id: 'jewelry_store', name: 'Jewelry Store', difficulty: 'Easy', reward: 50000, minReputation: 0, minCrew: 1, maxCrew: 3, successBase: 75 },
    { id: 'bank_vault', name: 'Bank Vault', difficulty: 'Medium', reward: 150000, minReputation: 25, minCrew: 2, maxCrew: 4, successBase: 60 },
    { id: 'armored_truck', name: 'Armored Truck', difficulty: 'Medium', reward: 200000, minReputation: 50, minCrew: 2, maxCrew: 4, successBase: 55 },
    { id: 'casino_heist', name: 'Casino Vault', difficulty: 'Hard', reward: 400000, minReputation: 100, minCrew: 3, maxCrew: 5, successBase: 40 },
    { id: 'art_museum', name: 'Art Museum', difficulty: 'Hard', reward: 350000, minReputation: 75, minCrew: 2, maxCrew: 4, successBase: 45 },
    { id: 'federal_reserve', name: 'Federal Reserve', difficulty: 'Extreme', reward: 800000, minReputation: 225, minCrew: 4, maxCrew: 6, successBase: 25 },
    { id: 'drug_cartel', name: 'Cartel Warehouse', difficulty: 'Extreme', reward: 600000, minReputation: 150, minCrew: 3, maxCrew: 5, successBase: 30 },
];

// Show active heists available to join + create new heist
function showActiveHeists() {
    const content = document.getElementById('multiplayer-content');
    if (!content) return;
    
    content.dataset.activeScreen = 'heists';
    if (typeof hideAllScreens === 'function') hideAllScreens();
    const mpScreen = document.getElementById('multiplayer-screen');
    if (mpScreen) mpScreen.style.display = 'block';
    
    const heists = onlineWorldState.activeHeists || [];
    const myPlayerId = onlineWorldState.playerId;
    
    // Check if player already has an active heist
    const myHeist = heists.find(h => h.organizerId === myPlayerId);
    
    let heistListHTML;
    if (heists.length > 0) {
        // Filter: show open heists + your own + heists you joined
        const visibleHeists = heists.filter(h => h.open !== false || h.organizerId === myPlayerId || (Array.isArray(h.participants) && h.participants.includes(myPlayerId)));
        heistListHTML = visibleHeists.map(h => {
            const participantCount = Array.isArray(h.participants) ? h.participants.length : (h.participants || 0);
            const maxCount = h.maxParticipants || 4;
            const isMyHeist = h.organizerId === myPlayerId;
            const alreadyJoined = Array.isArray(h.participants) && h.participants.includes(myPlayerId);
            const isFull = participantCount >= maxCount;
            const diffColor = h.difficulty === 'Easy' ? '#8a9a6a' : h.difficulty === 'Medium' ? '#c0a040' : h.difficulty === 'Hard' ? '#8b3a3a' : '#ff00ff';
            const isOpen = h.open !== false;
            const roles = h.roles || {};
            
            // Get participant names + roles from playerStates
            let crewInfo = '';
            if (Array.isArray(h.participants)) {
                const entries = h.participants.map(pid => {
                    const ps = Object.values(onlineWorldState.playerStates || {}).find(p => p.playerId === pid);
                    const name = ps ? escapeHTML(ps.name) : 'Unknown';
                    const role = roles[pid] ? roles[pid].charAt(0).toUpperCase() + roles[pid].slice(1) : '';
                    return role ? `${name} <span style="color:#8a7a5a;font-size:0.8em;">(${role})</span>` : name;
                });
                crewInfo = entries.join(', ');
            }
            
            return `
            <div style="background: rgba(0,0,0,0.6); padding: 18px; border-radius: 10px; margin: 12px 0; border: 1px solid ${isMyHeist ? '#c0a062' : '#5a0000'};">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px;">
                    <div style="flex: 1; min-width: 200px;">
                        <div style="color: #c0a062; font-weight: bold; font-size: 1.1em; font-family: 'Georgia', serif;">${escapeHTML(h.target || 'Unknown Heist')}
                            <span style="color:${isOpen ? '#27ae60' : '#8b3a3a'};font-size:0.75em;margin-left:8px;padding:2px 6px;border:1px solid ${isOpen ? '#27ae60' : '#8b3a3a'};border-radius:4px;">${isOpen ? 'Open' : 'Private'}</span>
                        </div>
                        <div style="margin-top: 6px;">
                            <span style="color: ${diffColor}; font-size: 0.85em; padding: 2px 8px; border: 1px solid ${diffColor}; border-radius: 4px;">${escapeHTML(h.difficulty || 'Unknown')}</span>
                            <span style="color: #8a9a6a; margin-left: 10px; font-size: 0.9em;">$${(h.reward || 0).toLocaleString()}</span>
                        </div>
                        <div style="color: #ccc; font-size: 0.85em; margin-top: 8px;">
                            Crew: ${participantCount}/${maxCount} ${crewInfo ? '&mdash; ' + crewInfo : ''}
                        </div>
                        <div style="color: #888; font-size: 0.8em; margin-top: 4px;">Organized by: ${escapeHTML(h.organizer || 'Unknown')}</div>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 6px; min-width: 130px;">
                        ${isMyHeist ? `
                            <button onclick="manageHeist('${h.id}')" style="background: linear-gradient(180deg, #c0a062, #8b7340); color: #000; padding: 10px 18px; border:1px solid #c0a062; border-radius: 6px; cursor: pointer; font-family: 'Georgia', serif; font-weight: bold;">
                                Manage
                            </button>
                            ${participantCount >= (h.minCrew || 1) ? `
                            <button onclick="forceStartHeist('${h.id}')" style="background: linear-gradient(180deg, #7a8a5a, #1a7a40); color: #fff; padding: 10px 18px; border:1px solid #c0a062; border-radius: 6px; cursor: pointer; font-family: 'Georgia', serif; font-weight: bold;">
                                Launch!
                            </button>` : `
                            <div style="color: #ff8800; font-size: 0.8em; text-align: center;">Need ${h.minCrew || 1}+ crew</div>`}
                        ` : alreadyJoined ? `
                            <div style="color: #8a9a6a; padding: 10px; text-align: center; font-weight: bold;">Joined</div>
                            <button onclick="leaveHeist('${h.id}')" style="background: #333; color: #ff4444; padding: 8px 15px; border: 1px solid #8b3a3a; border-radius: 6px; cursor: pointer; font-size: 0.85em;">
                                Leave
                            </button>
                        ` : isFull ? `
                            <div style="color: #888; padding: 10px; text-align: center;">Crew Full</div>
                        ` : `
                            <button onclick="showJoinHeistRolePicker('${h.id}')" style="background: linear-gradient(180deg, #8b0000, #3a0000); color: #ff4444; padding: 10px 18px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif; font-weight: bold;">
                                Join Crew
                            </button>
                        `}
                    </div>
                </div>
            </div>`;
        }).join('');
    } else {
        heistListHTML = '<p style="color: #888; text-align: center; font-style: italic; padding: 20px;">No active heists right now. Plan one yourself!</p>';
    }
    
    content.innerHTML = `
        <div style="background: rgba(0,0,0,0.95); padding: 30px; border-radius: 15px; border: 3px solid #8b0000;">
            <div style="text-align: center; margin-bottom: 25px;">
                <div style="font-size: 3em;"></div>
                <h2 style="color: #c0a062; font-family: 'Georgia', serif; font-size: 2em; margin: 10px 0 5px 0;">Big Scores</h2>
                <p style="color: #ccc; font-style: italic; margin: 0;">Plan heists, recruit crew, and hit high-value targets together.</p>
            </div>

            <!-- Create Heist Button -->
            <div style="text-align: center; margin-bottom: 20px;">
                ${myHeist
                    ? '<div style="color: #ff8800; font-size: 0.9em;">You already have an active heist. Manage or complete it first.</div>'
                    : `<button onclick="showCreateHeist()" style="background: linear-gradient(180deg, #c0a062, #8b7340); color: #000; padding: 14px 30px; border:1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif; font-size: 1.1em; font-weight: bold;">
                        Plan a Heist
                    </button>`
                }
            </div>

            <!-- Active Heists List -->
            <div style="background: rgba(0,0,0,0.4); padding: 15px; border-radius: 10px; border: 1px solid #555;">
                <h3 style="color: #c0a062; margin: 0 0 10px 0; font-family: 'Georgia', serif;">Active Heists</h3>
                ${heistListHTML}
            </div>

            <div style="text-align: center; margin-top: 20px;">
                <button onclick="goBackToMainMenu()" style="background: #333; color: #c0a062; padding: 12px 25px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif;">Back</button>
            </div>
        </div>
    `;
}

// Show heist creation screen — pick a target
function showCreateHeist() {
    if (!onlineWorldState.isConnected) {
        window.ui.toast('You must be connected to the online world to plan a heist.', 'error');
        return;
    }

    const content = document.getElementById('multiplayer-content');
    if (!content) return;

    const playerRep = player.reputation || 0;

    const targetsHTML = HEIST_TARGETS.map(t => {
        const locked = playerRep < t.minReputation;
        const diffColor = t.difficulty === 'Easy' ? '#8a9a6a' : t.difficulty === 'Medium' ? '#c0a040' : t.difficulty === 'Hard' ? '#8b3a3a' : '#ff00ff';
        
        return `
        <div style="background: rgba(0,0,0,0.6); padding: 16px; border-radius: 10px; margin: 10px 0; border: 1px solid ${locked ? '#333' : diffColor}; opacity: ${locked ? '0.5' : '1'};">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <div style="flex: 1; min-width: 200px;">
                    <div style="color: ${locked ? '#666' : '#c0a062'}; font-weight: bold; font-size: 1.05em;">${t.name}</div>
                    <div style="margin-top: 6px; display: flex; gap: 10px; flex-wrap: wrap;">
                        <span style="color: ${diffColor}; font-size: 0.8em; padding: 2px 6px; border: 1px solid ${diffColor}; border-radius: 4px;">${t.difficulty}</span>
                        <span style="color: #8a9a6a; font-size: 0.85em;">$${t.reward.toLocaleString()}</span>
                        <span style="color: #ccc; font-size: 0.85em;">${t.minCrew}-${t.maxCrew} crew</span>
                    </div>
                    <div style="color: #888; font-size: 0.8em; margin-top: 4px;">Base success: ${t.successBase}% | Requires ${t.minReputation}+ Respect</div>
                </div>
                <div>
                    ${locked 
                        ? `<div style="color: #666; font-size: 0.85em;">${t.minReputation} Respect</div>`
                        : `<button onclick="createHeist('${t.id}')" style="background: linear-gradient(180deg, #8b0000, #3a0000); color: #ff4444; padding: 10px 20px; border: 1px solid #c0a062; border-radius: 6px; cursor: pointer; font-family: 'Georgia', serif; font-weight: bold;">
                            Plan This
                        </button>`
                    }
                </div>
            </div>
        </div>`;
    }).join('');

    content.innerHTML = `
        <div style="background: rgba(0,0,0,0.95); padding: 30px; border-radius: 15px; border: 3px solid #c0a062;">
            <div style="text-align: center; margin-bottom: 20px;">
                <div style="font-size: 3em;"></div>
                <h2 style="color: #c0a062; font-family: 'Georgia', serif; font-size: 1.8em; margin: 10px 0 5px 0;">Plan a Heist</h2>
                <p style="color: #ccc; font-style: italic; margin: 0;">Choose a target. Harder targets need bigger crews but pay more.</p>
            </div>

            ${targetsHTML}

            <div style="text-align: center; margin-top: 20px;">
                <button onclick="showActiveHeists()" style="background: #333; color: #c0a062; padding: 12px 25px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif;">Back to Big Scores</button>
            </div>
        </div>
    `;
}

// Create a heist and send to server
async function createHeist(targetId) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) {
        window.ui.toast('Not connected to the server!', 'error');
        return;
    }

    const target = HEIST_TARGETS.find(t => t.id === targetId);
    if (!target) return;

    // Crew check for heists
    if (typeof window.checkCrewBeforeAction === 'function') {
        const canSolo = target.minCrew <= 1;
        const choice = await window.checkCrewBeforeAction(`a heist on ${target.name}`, canSolo);
        if (choice === 'crew' || choice === 'cancel') return;
    }

    if ((player.reputation || 0) < target.minReputation) {
        window.ui.toast(`You need ${target.minReputation}+ respect to plan this heist.`, 'error');
        return;
    }

    // Check if already organizing a heist
    const existingHeist = (onlineWorldState.activeHeists || []).find(h => h.organizerId === onlineWorldState.playerId);
    if (existingHeist) {
        window.ui.toast('You already have an active heist! Complete or cancel it first.', 'error');
        return;
    }

    // Show heist setup screen
    showHeistSetup(target);
}

// Heist setup screen: pick role and open/private
function showHeistSetup(target) {
    const content = document.getElementById('multiplayer-content');
    if (!content) return;

    const diffColor = target.difficulty === 'Easy' ? '#8a9a6a' : target.difficulty === 'Medium' ? '#c0a040' : target.difficulty === 'Hard' ? '#8b3a3a' : '#ff00ff';

    const roleDescriptions = {
        driver: { label: 'Driver', desc: '+5% success, less respect loss on failure', color: '#3498db' },
        hacker: { label: 'Hacker', desc: '+8% success chance', color: '#9b59b6' },
        muscle: { label: 'Muscle', desc: '+5% success, +15% reward bonus', color: '#e74c3c' },
        lookout: { label: 'Lookout', desc: '+5% success, -50% respect loss on failure', color: '#2ecc71' }
    };

    let rolesHTML = Object.entries(roleDescriptions).map(([key, r]) => `
        <label style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(0,0,0,0.4);border-radius:8px;border:1px solid #333;cursor:pointer;" onclick="document.getElementById('heist-role-${key}').checked=true">
            <input type="radio" name="heist-role" id="heist-role-${key}" value="${key}" ${key === 'muscle' ? 'checked' : ''} style="accent-color:${r.color};">
            <div>
                <span style="color:${r.color};font-weight:bold;">${r.label}</span>
                <span style="color:#8a7a5a;font-size:0.85em;margin-left:6px;">${r.desc}</span>
            </div>
        </label>
    `).join('');

    content.innerHTML = `
        <div style="background: rgba(0,0,0,0.95); padding: 30px; border-radius: 15px; border: 3px solid #c0a062;">
            <h2 style="color: #c0a062; font-family: 'Georgia', serif; text-align:center; margin: 0 0 5px 0;">Heist Setup</h2>
            <p style="color: #ccc; text-align:center; margin: 0 0 20px 0;">${escapeHTML(target.name)} &mdash; <span style="color:${diffColor};">${target.difficulty}</span></p>

            <div style="background:rgba(0,0,0,0.5);padding:15px;border-radius:10px;margin-bottom:20px;border:1px solid #555;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div style="color:#ccc;">Reward: <span style="color:#8a9a6a;font-weight:bold;">$${target.reward.toLocaleString()}</span></div>
                    <div style="color:#ccc;">Crew: <span style="color:#d4c4a0;">${target.minCrew}-${target.maxCrew}</span></div>
                    <div style="color:#ccc;">Base success: <span style="color:#c0a040;">${target.successBase}%</span></div>
                </div>
            </div>

            <h3 style="color:#c0a062;margin:0 0 10px 0;">Your Role</h3>
            <p style="color:#8a7a5a;font-size:0.9em;margin:0 0 10px 0;">Pick a role for the heist. A balanced crew (all 4 roles) gets a +10% bonus.</p>
            <div style="display:grid;gap:8px;margin-bottom:20px;">${rolesHTML}</div>

            <h3 style="color:#c0a062;margin:0 0 10px 0;">Lobby Type</h3>
            <div style="display:flex;gap:12px;margin-bottom:25px;">
                <label style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:rgba(0,0,0,0.4);border-radius:8px;border:1px solid #333;cursor:pointer;">
                    <input type="radio" name="heist-lobby" id="heist-lobby-open" value="open" checked style="accent-color:#27ae60;">
                    <div><span style="color:#27ae60;font-weight:bold;">Open Lobby</span><br><span style="color:#8a7a5a;font-size:0.85em;">Anyone can join from the heist board</span></div>
                </label>
                <label style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:rgba(0,0,0,0.4);border-radius:8px;border:1px solid #333;cursor:pointer;">
                    <input type="radio" name="heist-lobby" id="heist-lobby-private" value="private" style="accent-color:#8b3a3a;">
                    <div><span style="color:#8b3a3a;font-weight:bold;">Private</span><br><span style="color:#8a7a5a;font-size:0.85em;">Invite-only, hidden from the board</span></div>
                </label>
            </div>

            <div style="display:flex;justify-content:center;gap:12px;">
                <button onclick="confirmCreateHeist('${target.id}')" style="background:linear-gradient(180deg,#8b0000,#3a0000);color:#ff4444;padding:14px 30px;border:1px solid #c0a062;border-radius:8px;cursor:pointer;font-family:'Georgia',serif;font-weight:bold;font-size:1.05em;">Create Heist</button>
                <button onclick="showCreateHeist()" style="background:#333;color:#c0a062;padding:14px 25px;border:1px solid #c0a062;border-radius:8px;cursor:pointer;font-family:'Georgia',serif;">Back</button>
            </div>
        </div>
    `;
}

// Confirm and send heist creation to server
function confirmCreateHeist(targetId) {
    const target = HEIST_TARGETS.find(t => t.id === targetId);
    if (!target) return;

    const roleEl = document.querySelector('input[name="heist-role"]:checked');
    const lobbyEl = document.querySelector('input[name="heist-lobby"]:checked');
    const role = roleEl ? roleEl.value : 'muscle';
    const isOpen = lobbyEl ? lobbyEl.value === 'open' : true;

    onlineWorldState.socket.send(JSON.stringify({
        type: 'heist_create',
        target: target.name,
        targetId: target.id,
        reward: target.reward,
        difficulty: target.difficulty,
        maxParticipants: target.maxCrew,
        minCrew: target.minCrew,
        successBase: target.successBase,
        role: role,
        open: isOpen,
        equipment: getEquipmentSummary()
    }));

    _safeLogAction(`Planning heist: ${target.name}. Looking for crew...`);
    setTimeout(() => showActiveHeists(), 500);
}

// Manage your own heist
function manageHeist(heistId) {
    const heist = (onlineWorldState.activeHeists || []).find(h => h.id === heistId);
    if (!heist) {
        window.ui.toast('Heist not found!', 'error');
        return;
    }

    const content = document.getElementById('multiplayer-content');
    if (!content) return;

    const participantCount = Array.isArray(heist.participants) ? heist.participants.length : 0;
    const maxCount = heist.maxParticipants || 4;
    const minCrew = heist.minCrew || 1;
    const canLaunch = participantCount >= minCrew;
    const diffColor = heist.difficulty === 'Easy' ? '#8a9a6a' : heist.difficulty === 'Medium' ? '#c0a040' : heist.difficulty === 'Hard' ? '#8b3a3a' : '#ff00ff';

    const roleColors = { driver: '#3498db', hacker: '#9b59b6', muscle: '#e74c3c', lookout: '#2ecc71' };
    const roleLabels = { driver: 'Driver', hacker: 'Hacker', muscle: 'Muscle', lookout: 'Lookout' };
    const roles = heist.roles || {};
    const heistEquipment = heist.equipment || {};

    // Count unique roles for balance indicator
    const uniqueRoles = new Set(Object.values(roles));
    const isBalanced = uniqueRoles.size >= 4;

    // Build crew list
    let crewHTML = '';
    if (Array.isArray(heist.participants)) {
        crewHTML = heist.participants.map((pid, index) => {
            const ps = Object.values(onlineWorldState.playerStates || {}).find(p => p.playerId === pid);
            const name = ps ? escapeHTML(ps.name) : 'Unknown';
            const level = ps ? ps.level || 1 : '?';
            const isOrganizer = pid === heist.organizerId;
            const isMe = pid === onlineWorldState.playerId;
            const pRole = roles[pid];
            const roleColor = pRole ? roleColors[pRole] || '#888' : '#555';
            const roleLabel = pRole ? roleLabels[pRole] || pRole : 'No Role';

            // Equipment display
            const eq = heistEquipment[pid] || {};
            let eqParts = [];
            if (eq.weapon) eqParts.push(`<span style="color:#e74c3c;" title="Weapon: Power ${eq.weapon.power}">${escapeHTML(eq.weapon.name)}</span>`);
            if (eq.armor) eqParts.push(`<span style="color:#3498db;" title="Armor: Power ${eq.armor.power}">${escapeHTML(eq.armor.name)}</span>`);
            if (eq.vehicle) eqParts.push(`<span style="color:#f39c12;" title="Vehicle: Power ${eq.vehicle.power}">${escapeHTML(eq.vehicle.name)}</span>`);
            const eqHTML = eqParts.length > 0
                ? `<div style="font-size:0.78em;color:#888;margin-top:3px;">Gear: ${eqParts.join(' / ')}</div>`
                : '<div style="font-size:0.78em;color:#555;margin-top:3px;">No equipment</div>';
            
            return `
            <div style="padding: 10px; margin: 6px 0; background: rgba(${isOrganizer ? '192,160,98' : '139,0,0'},0.15); border-radius: 6px; border: 1px solid ${isOrganizer ? '#c0a062' : '#3a0000'};">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="color: ${isOrganizer ? '#c0a062' : '#ff4444'}; font-weight: bold;">${name}</span>
                        <span style="color: #888; font-size: 0.85em;"> Lvl ${level}</span>
                        <span style="color: ${roleColor}; font-size: 0.8em; margin-left: 8px; border: 1px solid ${roleColor}; padding: 1px 6px; border-radius: 3px;">${roleLabel}</span>
                        ${isOrganizer ? '<span style="color: #c0a062; font-size: 0.8em; margin-left: 6px;">Leader</span>' : ''}
                        ${isMe && !isOrganizer ? '<span style="color: #8a9a6a; font-size: 0.8em; margin-left: 6px;">(You)</span>' : ''}
                    </div>
                    <div style="display:flex;gap:6px;">
                        ${isMe ? `<button onclick="showChangeRolePopup('${heistId}')" style="background:#222;color:${roleColor};padding:5px 10px;border:1px solid ${roleColor};border-radius:4px;cursor:pointer;font-size:0.8em;">Change Role</button>` : ''}
                        ${!isOrganizer && isMe ? `<button onclick="leaveHeist('${heistId}')" style="background:#333;color:#ff4444;padding:5px 12px;border:1px solid #8b3a3a;border-radius:4px;cursor:pointer;font-size:0.85em;">Leave</button>` : ''}
                    </div>
                </div>
                ${eqHTML}
            </div>`;
        }).join('');
    }

    // Empty slots
    for (let i = participantCount; i < maxCount; i++) {
        crewHTML += `
        <div style="display: flex; justify-content: center; align-items: center; padding: 10px; margin: 6px 0; background: rgba(255,255,255,0.03); border-radius: 6px; border: 1px dashed #333;">
            <span style="color: #555; font-style: italic;">Empty slot</span>
        </div>`;
    }

    content.innerHTML = `
        <div style="background: rgba(0,0,0,0.95); padding: 30px; border-radius: 15px; border: 3px solid #c0a062;">
            <div style="text-align: center; margin-bottom: 20px;">
                <div style="font-size: 3em;"></div>
                <h2 style="color: #c0a062; font-family: 'Georgia', serif; font-size: 1.8em; margin: 10px 0 5px 0;">Heist Management</h2>
                <div style="color: #ccc; font-size: 1.1em; margin-top: 5px;">${escapeHTML(heist.target || 'Unknown')}</div>
            </div>

            <!-- Heist Details -->
            <div style="background: rgba(0,0,0,0.5); padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #555;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div style="color: #ccc;">Difficulty: <span style="color: ${diffColor}; font-weight: bold;">${escapeHTML(heist.difficulty || 'Unknown')}</span></div>
                    <div style="color: #ccc;">Reward: <span style="color: #8a9a6a; font-weight: bold;">$${(heist.reward || 0).toLocaleString()}</span></div>
                    <div style="color: #ccc;">Per person: <span style="color: #8a9a6a;">~$${participantCount > 0 ? Math.floor((heist.reward || 0) / participantCount).toLocaleString() : '?'}</span></div>
                    <div style="color: #ccc;">Base success: <span style="color: #c0a040;">${heist.successBase || 60}%</span></div>
                    <div style="color: #ccc;">Lobby: <span style="color: ${heist.open !== false ? '#2ecc71' : '#e74c3c'};">${heist.open !== false ? 'Open' : 'Private'}</span></div>
                    <div style="color: #ccc;">Crew balance: <span style="color: ${isBalanced ? '#2ecc71' : '#c0a040'};">${isBalanced ? 'Balanced (+10%)' : uniqueRoles.size + '/4 roles'}</span></div>
                </div>
            </div>

            <!-- Crew -->
            <div style="background: rgba(0,0,0,0.4); padding: 15px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #555;">
                <h3 style="color: #c0a062; margin: 0 0 10px 0; font-family: 'Georgia', serif;">Crew (${participantCount}/${maxCount})</h3>
                ${crewHTML}
            </div>

            <!-- Actions -->
            <div style="display: flex; justify-content: center; gap: 10px; flex-wrap: wrap;">
                ${heist.organizerId === onlineWorldState.playerId ? `
                    ${canLaunch ? `
                        <button onclick="forceStartHeist('${heistId}')" style="background: linear-gradient(180deg, #7a8a5a, #1a7a40); color: #fff; padding: 14px 25px; border:1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif; font-weight: bold; font-size: 1.05em;">
                            Launch Heist!
                        </button>
                    ` : `
                        <div style="color: #ff8800; padding: 14px; text-align: center;">Need at least ${minCrew} crew member${minCrew > 1 ? 's' : ''} to launch</div>
                    `}
                    <button onclick="cancelHeist('${heistId}')" style="background: #333; color: #ff4444; padding: 14px 20px; border: 1px solid #8b3a3a; border-radius: 6px; cursor: pointer; font-family: 'Georgia', serif;">
                        ? Cancel Heist
                    </button>
                ` : `
                    <button onclick="leaveHeist('${heistId}')" style="background: #333; color: #ff4444; padding: 14px 20px; border: 1px solid #8b3a3a; border-radius: 6px; cursor: pointer; font-family: 'Georgia', serif;">
                        Leave Crew
                    </button>
                `}
                <button onclick="showActiveHeists()" style="background: #333; color: #c0a062; padding: 14px 20px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif;">
                    ? Back
                </button>
            </div>
        </div>
    `;
}

// Show a role change popup for an active heist
function showChangeRolePopup(heistId) {
    const existing = document.getElementById('heist-role-picker-overlay');
    if (existing) existing.remove();

    const roleDescs = {
        driver:  { label: 'Driver',  desc: '+5% success, less respect loss',  color: '#3498db' },
        hacker:  { label: 'Hacker',  desc: '+8% success chance',          color: '#9b59b6' },
        muscle:  { label: 'Muscle',  desc: '+5% success, +15% reward',    color: '#e74c3c' },
        lookout: { label: 'Lookout', desc: '+5% success, -50% respect loss',  color: '#2ecc71' }
    };

    let btns = Object.entries(roleDescs).map(([key, r]) => `
        <button onclick="changeHeistRole('${heistId}','${key}')" style="display:block;width:100%;text-align:left;padding:10px 14px;background:rgba(0,0,0,0.6);border:1px solid ${r.color};border-radius:6px;cursor:pointer;color:#d4c4a0;margin:6px 0;">
            <span style="color:${r.color};font-weight:bold;">${r.label}</span> &mdash; <span style="font-size:0.9em;color:#8a7a5a;">${r.desc}</span>
        </button>
    `).join('');

    const overlay = document.createElement('div');
    overlay.id = 'heist-role-picker-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#1a1810;border:2px solid #c0a062;border-radius:12px;padding:25px;max-width:400px;width:90%;">
            <h3 style="color:#c0a062;margin:0 0 12px 0;">Change Your Role</h3>
            ${btns}
            <button onclick="document.getElementById('heist-role-picker-overlay').remove()" style="margin-top:10px;background:#333;color:#c0a062;border:1px solid #c0a062;padding:8px 18px;border-radius:6px;cursor:pointer;width:100%;">Cancel</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

// Send role change to server
function changeHeistRole(heistId, role) {
    const picker = document.getElementById('heist-role-picker-overlay');
    if (picker) picker.remove();

    if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        onlineWorldState.socket.send(JSON.stringify({ type: 'heist_set_role', heistId, role }));
        // Optimistic update
        const heist = (onlineWorldState.activeHeists || []).find(h => h.id === heistId);
        if (heist) {
            if (!heist.roles) heist.roles = {};
            heist.roles[onlineWorldState.playerId] = role;
            manageHeist(heistId);
        }
    }
}

// Force start a heist (organizer only)
async function forceStartHeist(heistId) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) {
        window.ui.toast('Not connected!', 'error');
        return;
    }

    const heist = (onlineWorldState.activeHeists || []).find(h => h.id === heistId);
    if (!heist) return;

    if (heist.organizerId !== onlineWorldState.playerId) {
        window.ui.toast('Only the organizer can launch the heist!', 'error');
        return;
    }

    if (!await window.ui.confirm(`Launch the heist on ${heist.target}?\n\nThis cannot be undone. Your crew will move in immediately.`)) {
        return;
    }

    onlineWorldState.socket.send(JSON.stringify({
        type: 'heist_start',
        heistId: heistId
    }));

    _safeLogAction(`Launching heist on ${heist.target}!`);
}

// Leave a heist you joined
function leaveHeist(heistId) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) {
        window.ui.toast('Not connected!', 'error');
        return;
    }

    onlineWorldState.socket.send(JSON.stringify({
        type: 'heist_leave',
        heistId: heistId
    }));

    // Optimistic local update
    const heist = (onlineWorldState.activeHeists || []).find(h => h.id === heistId);
    if (heist && Array.isArray(heist.participants)) {
        heist.participants = heist.participants.filter(pid => pid !== onlineWorldState.playerId);
    }

    _safeLogAction('Left the heist crew.');
    showActiveHeists();
}

// Cancel a heist (organizer only)
async function cancelHeist(heistId) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) {
        window.ui.toast('Not connected!', 'error');
        return;
    }

    if (!await window.ui.confirm('Cancel this heist? All crew members will be dismissed.')) return;

    onlineWorldState.socket.send(JSON.stringify({
        type: 'heist_cancel',
        heistId: heistId
    }));

    // Optimistic local removal
    onlineWorldState.activeHeists = (onlineWorldState.activeHeists || []).filter(h => h.id !== heistId);
    _safeLogAction('? Heist cancelled.');
    showActiveHeists();
}

// Invite a specific player to your active heist
function inviteToHeist(playerName) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) {
        window.ui.toast('You need to be connected to the online world!', 'error');
        return;
    }

    // Check if player has an active heist
    const myHeist = (onlineWorldState.activeHeists || []).find(h => h.organizerId === onlineWorldState.playerId);
    if (!myHeist) {
        window.ui.toast('You don\'t have an active heist! Go to Big Scores and plan one first.', 'error');
        return;
    }

    const participantCount = Array.isArray(myHeist.participants) ? myHeist.participants.length : 0;
    if (participantCount >= (myHeist.maxParticipants || 4)) {
        window.ui.toast('Your heist crew is already full!', 'error');
        return;
    }

    onlineWorldState.socket.send(JSON.stringify({
        type: 'heist_invite',
        heistId: myHeist.id,
        targetPlayer: playerName
    }));

    _safeLogAction(`Sent heist invitation to ${playerName} for ${myHeist.target}`);
    if (typeof showBriefNotification === 'function') {
        showBriefNotification(`Heist invite sent to ${playerName}!`, 3000);
    } else {
        window.ui.toast(`Heist invitation sent to ${playerName}!`, 'success');
    }
}

// Join any heist by ID
// Role picker popup before joining a heist
function showJoinHeistRolePicker(heistId) {
    const heist = (onlineWorldState.activeHeists || []).find(h => h.id === heistId);
    if (!heist) { window.ui.toast('Heist not found!', 'error'); return; }

    // Remove existing picker if any
    const existing = document.getElementById('heist-role-picker-overlay');
    if (existing) existing.remove();

    const roleDescs = {
        driver:  { label: 'Driver',  desc: '+5% success, less respect loss',  color: '#3498db' },
        hacker:  { label: 'Hacker',  desc: '+8% success chance',          color: '#9b59b6' },
        muscle:  { label: 'Muscle',  desc: '+5% success, +15% reward',    color: '#e74c3c' },
        lookout: { label: 'Lookout', desc: '+5% success, -50% respect loss',  color: '#2ecc71' }
    };

    let btns = Object.entries(roleDescs).map(([key, r]) => `
        <button onclick="joinHeist('${heistId}','${key}')" style="display:block;width:100%;text-align:left;padding:10px 14px;background:rgba(0,0,0,0.6);border:1px solid ${r.color};border-radius:6px;cursor:pointer;color:#d4c4a0;margin:6px 0;">
            <span style="color:${r.color};font-weight:bold;">${r.label}</span> &mdash; <span style="font-size:0.9em;color:#8a7a5a;">${r.desc}</span>
        </button>
    `).join('');

    const overlay = document.createElement('div');
    overlay.id = 'heist-role-picker-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#1a1810;border:2px solid #c0a062;border-radius:12px;padding:25px;max-width:400px;width:90%;">
            <h3 style="color:#c0a062;margin:0 0 6px 0;">Choose Your Role</h3>
            <p style="color:#8a7a5a;font-size:0.9em;margin:0 0 12px 0;">Pick a role for the ${escapeHTML(heist.target)} heist. A balanced crew gets a +10% bonus.</p>
            ${btns}
            <button onclick="document.getElementById('heist-role-picker-overlay').remove()" style="margin-top:10px;background:#333;color:#c0a062;border:1px solid #c0a062;padding:8px 18px;border-radius:6px;cursor:pointer;width:100%;">Cancel</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

function joinHeist(heistId, role) {
    // Remove role picker overlay if present
    const picker = document.getElementById('heist-role-picker-overlay');
    if (picker) picker.remove();

    const heist = (onlineWorldState.activeHeists || []).find(h => h.id === heistId);
    if (!heist) {
        window.ui.toast('Heist not found!', 'error');
        return;
    }
    
    const participantCount = Array.isArray(heist.participants) ? heist.participants.length : 0;
    const maxCount = heist.maxParticipants || 4;
    
    if (participantCount >= maxCount) {
        window.ui.toast('This heist crew is full!', 'error');
        return;
    }
    
    if (Array.isArray(heist.participants) && heist.participants.includes(onlineWorldState.playerId)) {
        window.ui.toast('You already joined this heist!', 'error');
        return;
    }

    if (pendingHeistJoins.has(heistId)) {
        window.ui.toast('Join request already sent. Waiting for server confirmation...', 'warning');
        return;
    }
    
    if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        const msg = { type: 'heist_join', heistId: heistId, equipment: getEquipmentSummary() };
        if (role) msg.role = role;
        onlineWorldState.socket.send(JSON.stringify(msg));
        pendingHeistJoins.add(heistId);
        _safeLogAction(`Requested to join heist: ${heist.target} as ${role || 'unassigned'}`);
        showMPToast('Join request sent. Waiting for server confirmation...', '#c0a040', 2200);
        showActiveHeists();
    } else {
        window.ui.toast('Not connected to the server!', 'error');
    }
}

// Show heist result popup
function showHeistResult(result) {
    // Remove any existing heist result modal
    const existing = document.getElementById('heist-result-modal');
    if (existing) existing.remove();
    
    const isSuccess = result.success;
    
    const modal = document.createElement('div');
    modal.id = 'heist-result-modal';
    modal.className = 'popup-overlay';
    
    modal.innerHTML = `
        <div class="popup-card ${isSuccess ? 'popup-success' : 'popup-danger'}" style="max-width:450px;">
            <div style="font-size:4em;margin-bottom:15px;text-align:center;">${isSuccess ? '' : ''}</div>
            <h2 class="popup-title">${isSuccess ? 'HEIST SUCCESSFUL!' : 'HEIST FAILED!'}</h2>
            <p class="popup-subtitle">Target: ${escapeHTML(result.target || 'Unknown')}</p>
            
            <div class="popup-section">
                ${isSuccess ? `
                    <div class="popup-stat-value" style="color:#8a9a6a;font-size:1.3em;margin-bottom:8px;">
                        +$${(result.reward || 0).toLocaleString()}
                    </div>
                    <div style="color:#c0a040;font-size:1em;">
                        +${result.repGain || 0} Respect
                    </div>
                ` : `
                    <div class="popup-stat-value" style="color:#8b3a3a;font-size:1.3em;margin-bottom:8px;">
                        No Payout
                    </div>
                    <div style="color:#8b3a3a;font-size:1em;">
                        -${result.repLoss || 0} Respect
                    </div>
                `}
                <div style="color:#888;font-size:0.85em;margin-top:10px;">
                    Crew size: ${result.crewSize || '?'}
                </div>
                ${result.driverVehicle ? `<div style="color:#f39c12;font-size:0.9em;margin-top:8px;">Getaway Vehicle: ${escapeHTML(result.driverVehicle)}</div>` : ''}
            </div>
            
            ${Array.isArray(result.roles) && result.roles.length > 0 ? `
            <div class="popup-section" style="margin-top:10px;">
                <h3 style="color:#c0a062;font-size:0.95em;margin-bottom:8px;">Crew Loadout</h3>
                ${result.roles.map(r => {
                    const roleLabelsLocal = { driver: 'Driver', hacker: 'Hacker', muscle: 'Muscle', lookout: 'Lookout' };
                    const roleColorsLocal = { driver: '#3498db', hacker: '#9b59b6', muscle: '#e74c3c', lookout: '#2ecc71' };
                    const eq = r.equipment || {};
                    let gear = [];
                    if (eq.weapon) gear.push(`<span style="color:#e74c3c;">${escapeHTML(eq.weapon.name)}</span>`);
                    if (eq.armor) gear.push(`<span style="color:#3498db;">${escapeHTML(eq.armor.name)}</span>`);
                    if (eq.vehicle) gear.push(`<span style="color:#f39c12;">${escapeHTML(eq.vehicle.name)}</span>`);
                    const gearStr = gear.length > 0 ? gear.join(' / ') : '<span style="color:#555;">No gear</span>';
                    const rLabel = r.role ? (roleLabelsLocal[r.role] || r.role) : 'No Role';
                    const rColor = r.role ? (roleColorsLocal[r.role] || '#888') : '#555';
                    return `<div style="font-size:0.82em;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                        <span style="color:#ccc;">${escapeHTML(r.playerName || 'Unknown')}</span>
                        <span style="color:${rColor};margin-left:6px;">[${rLabel}]</span>
                        <div style="margin-left:10px;color:#888;">${gearStr}</div>
                    </div>`;
                }).join('')}
            </div>
            ` : ''}
            
            <div class="popup-actions">
                <button onclick="document.getElementById('heist-result-modal').remove()" class="popup-btn ${isSuccess ? 'popup-btn-success' : 'popup-btn-danger'}">
                    ${isSuccess ? 'Collect & Continue' : 'Walk Away'}
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Sync player money/rep from server
    // Server already credited the reward server-side; apply delta to local state
    // so the UI updates immediately while waiting for the next full sync.
    if (isSuccess && result.reward) {
        if (typeof player !== 'undefined') {
            // Only update if server sent explicit new totals, otherwise apply delta
            if (result.newMoney !== undefined) {
                player.money = result.newMoney;
                player.reputation = result.newReputation || player.reputation;
            } else {
                player.money = (player.money || 0) + result.reward;
                player.reputation = (player.reputation || 0) + (result.repGain || 0);
            }
            if (typeof updateUI === 'function') updateUI();
        }
    } else if (!isSuccess && result.repLoss) {
        if (typeof player !== 'undefined') {
            if (result.newReputation !== undefined) {
                player.reputation = result.newReputation;
            } else {
                player.reputation = Math.max(0, (player.reputation || 0) - (result.repLoss || 0));
            }
            if (typeof updateUI === 'function') updateUI();
        }
    }
}

// showGangWars removed — replaced by Horse Betting in casino

// Show nearby players list
function showNearbyPlayers() {
    const content = document.getElementById('multiplayer-content');
    if (!content) return;
    
    if (typeof hideAllScreens === 'function') hideAllScreens();
    const mpScreen = document.getElementById('multiplayer-screen');
    if (mpScreen) mpScreen.style.display = 'block';
    
    const players = onlineWorldState.nearbyPlayers || [];
    let playersHTML = players.length > 0
        ? players.map(p => `
            <div style="background: rgba(0,0,0,0.6); padding: 12px; border-radius: 8px; margin: 8px 0; border: 1px solid #c0a040; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <span style="color: #c0a040; font-weight: bold;">${escapeHTML(p.name || 'Unknown')}</span>
                    <span style="color: #888; font-size: 0.85em;"> Lvl ${p.level || 1}</span>
                </div>
                <div>
                    <button onclick="challengePlayer('${escapeHTML(p.name)}')" style="background: #8b0000; color: #fff; padding: 5px 12px; border:1px solid #c0a062; border-radius: 4px; cursor: pointer; margin: 0 3px;">Fight</button>
                </div>
            </div>
        `).join('')
        : '<p style="color: #888; text-align: center; font-style: italic;">No players nearby. Try exploring different districts.</p>';
    
    content.innerHTML = `
        <div style="background: rgba(0,0,0,0.95); padding: 30px; border-radius: 15px; border: 3px solid #c0a040;">
            <h2 style="color: #c0a040; text-align: center; font-family: 'Georgia', serif;"> Local Crew</h2>
            <p style="color: #ccc; text-align: center;">Players in your area. Challenge or recruit them.</p>
            ${playersHTML}
            <div style="text-align: center; margin-top: 20px;">
                <button onclick="goBackToMainMenu()" style="background: #333; color: #c0a062; padding: 12px 25px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif;">Back</button>
            </div>
        </div>
    `;
}

// View territory details for a specific district
function viewTerritoryDetails(district) {
    const content = document.getElementById('multiplayer-content');
    if (!content) return;
    
    const territories = onlineWorldState.territories || {};
    const info = territories[district] || { controlledBy: 'Unclaimed', power: 0 };
    
    content.innerHTML = `
        <div style="background: rgba(0,0,0,0.95); padding: 30px; border-radius: 15px; border: 3px solid #c0a062;">
            <h2 style="color: #c0a062; text-align: center; font-family: 'Georgia', serif;"> ${escapeHTML(district)}</h2>
            <div style="background: rgba(0,0,0,0.5); padding: 15px; border-radius: 10px; margin: 15px 0;">
                <p style="color: #ccc;">Controlled by: <span style="color: #c0a040; font-weight: bold;">${escapeHTML(info.controlledBy)}</span></p>
                <p style="color: #ccc;">Defense Power: <span style="color: #8b3a3a;">${info.power || 0}</span></p>
            </div>
            <div style="text-align: center; margin-top: 15px;">
                <button onclick="challengeForTerritory('${escapeHTML(district)}')" style="background: #8b0000; color: #fff; padding: 10px 20px; border:1px solid #c0a062; border-radius: 6px; cursor: pointer; margin: 5px;">Attack</button>
                <button onclick="showOnlineWorld()" style="background: #333; color: #c0a062; padding: 10px 20px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; margin: 5px;">Back</button>
            </div>
        </div>
    `;
}

// Challenge for a territory (sends to server if connected)
function challengeForTerritory(district) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket) {
        window.ui.toast('You must be connected to the online world to challenge for territory.', 'error');
        return;
    }

    const gangCount = (player.gang && player.gang.members) || 0;
    if (gangCount < 5) {
        window.ui.toast('You need at least 5 gang members to wage a territory war!', 'error');
        return;
    }

    onlineWorldState.socket.send(JSON.stringify({
        type: 'territory_war',
        district: district,
        gangMembers: gangCount,
        power: player.power || 0,
        gangLoyalty: (player.gang && player.gang.loyalty) || 100
    }));
    
    _safeLogAction(`\u2694\uFE0F Challenging for control of ${district}...`);
}

// Start a heist in a specific district — redirects to heist creation
function startDistrictHeist(districtName) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket) {
        window.ui.toast('You must be connected to the online world to start a heist.', 'error');
        return;
    }
    
    // Check if already organizing
    const existingHeist = (onlineWorldState.activeHeists || []).find(h => h.organizerId === onlineWorldState.playerId);
    if (existingHeist) {
        window.ui.toast('You already have an active heist! Complete or cancel it first.', 'error');
        showActiveHeists();
        return;
    }
    
    showCreateHeist();
}

// ==================== CORE ONLINE WORLD FUNCTIONS ====================

// Initialize online world connection
function initializeOnlineWorld() {
    setupOnlineWorldUI();
    
    // Don't auto-connect immediately - wait for game to be loaded or started
    // The connection will be made when a game is loaded or started
    
    // Load saved player data
    if (typeof(Storage) !== 'undefined') {
        const savedWorldData = localStorage.getItem('onlineWorldData');
        if (savedWorldData) {
            const data = JSON.parse(savedWorldData);
            onlineWorldState = { ...onlineWorldState, ...data };
        }
    }
    
    // Set up periodic state sync (only once)
    if (!window._syncIntervalStarted) {
        window._syncIntervalStarted = true;
        setInterval(() => {
            if (onlineWorldState.isConnected) {
                syncPlayerState();
            }
        }, 5000); // Sync every 5 seconds
    }
}

// Function to connect to multiplayer after game is loaded/started
function connectMultiplayerAfterGame() {
    if (!onlineWorldState.isConnected) {
        connectToOnlineWorld();
    }
}

// Connect to the online world
function connectToOnlineWorld() {
    if (onlineWorldState.isConnected) {
        return;
    }
    // Don't reconnect if session was blocked (duplicate login)
    if (onlineWorldState.connectionStatus === 'blocked') {
        return;
    }
    
    onlineWorldState.connectionStatus = 'connecting';
    updateConnectionStatus();
    
    try {
        // Try to connect to real WebSocket server
        const serverUrl = onlineWorld.serverUrl;
        _safeLogAction(' Connecting to online world...', 'chat');
        
        onlineWorldState.socket = new WebSocket(serverUrl);
        
        onlineWorldState.socket.onopen = function(event) {
            onlineWorldState.isConnected = true;
            onlineWorldState.connectionStatus = 'connected';
            onlineWorldState.playerId = generatePlayerId();
            
            // Don't prompt for name on connection - only when actually needed
            // Try to get saved name first, fallback to anonymous if none found
            let playerName = ensurePlayerName();
            if (!playerName) {
                playerName = 'Anonymous_' + Math.floor(Math.random() * 1000);
            }
            
            // Send initial player data to server
            const playerData = {
                type: 'player_connect',
                playerId: onlineWorldState.playerId,
                playerName: playerName, // Use saved name or default
                authToken: localStorage.getItem('mb_auth_token') || null,
                playerStats: {
                    money: player.money,
                    reputation: player.reputation,
                    territory: player.territory,
                    currentTerritory: player.currentTerritory || null,
                    lastTerritoryMove: player.lastTerritoryMove || 0,
                    level: player.level || 1
                }
            };
            
            onlineWorldState.socket.send(JSON.stringify(playerData));
            
            updateConnectionStatus();
            initializeWorldData();
            startWorldUpdates();
            
            // Fetch crew info early so _myCrewSize is available for job bonuses
            if (player.crewId) {
                sendMP({ type: 'crew_info' });
            }
            
            _safeLogAction(` Connected to online world! Player ID: ${onlineWorldState.playerId}`, 'chat');
            showWelcomeMessage();
            
            // Deferred name correction: once player data fully loads, re-send with the real name
            // This fixes the wrong name appearing briefly after login
            _scheduleNameCorrection();
        };
        
        onlineWorldState.socket.onmessage = function(event) {
            handleServerMessage(JSON.parse(event.data));
        };
        
        onlineWorldState.socket.onclose = function(event) {
            onlineWorldState.isConnected = false;
            // Only reconnect if we were previously connected (not if we failed to connect)
            if (onlineWorldState.connectionStatus === 'connected') {
                onlineWorldState.connectionStatus = 'disconnected';
                updateConnectionStatus();
                _safeLogAction(' Disconnected from online world', 'chat');
                // Attempt to reconnect
                setTimeout(() => {
                    connectToOnlineWorld();
                }, onlineWorld.reconnectInterval);
            }
            // If status is 'error' or 'demo', don't loop — let demo mode handle it
        };
        
        onlineWorldState.socket.onerror = function(error) {
            onlineWorldState.connectionStatus = 'error';
            updateConnectionStatus();
            _safeLogAction(' Failed to connect to online world. Retrying...', 'chat');
            
            // Fallback to local demo mode
            setTimeout(() => {
                connectToLocalDemo();
            }, 3000);
        };
        
    } catch (error) {
        onlineWorldState.connectionStatus = 'error';
        updateConnectionStatus();
        _safeLogAction(' Failed to connect to online world. Retrying...', 'chat');
        
        setTimeout(() => {
            connectToLocalDemo();
        }, onlineWorld.reconnectInterval);
    }
}

// Fallback when server is unavailable — just update status, no fake data
function connectToLocalDemo() {
    onlineWorldState.isConnected = false;
    onlineWorldState.connectionStatus = 'offline';
    onlineWorldState.serverInfo.playerCount = 0;
    updateConnectionStatus();
    _safeLogAction('Server unavailable — World Chat is offline. Will retry automatically.', 'chat');
}

// Handle messages from the server
async function handleServerMessage(message) {
    switch(message.type) {
        case 'session_blocked':
            // Another active session exists for this account — stop reconnecting
            onlineWorldState.connectionStatus = 'blocked';
            onlineWorldState.isConnected = false;
            if (onlineWorldState.socket) {
                try { onlineWorldState.socket.onclose = null; } catch(_) {} // prevent auto-reconnect
                try { onlineWorldState.socket.close(); } catch(_) {}
                onlineWorldState.socket = null;
            }
            updateConnectionStatus();
            if (typeof showBriefNotification === 'function') {
                showBriefNotification(message.message || 'Account already logged in on another session.', 'error');
            }
            _safeLogAction(message.message || 'Session blocked: account is active in another window.', 'chat');
            // Show a modal so it's unmissable
            const blockedOverlay = document.createElement('div');
            blockedOverlay.className = 'popup-overlay';
            blockedOverlay.id = 'session-blocked-modal';
            blockedOverlay.innerHTML = `
                <div class="popup-card popup-danger" style="max-width:420px;">
                    <h2 class="popup-title" style="color:#e74c3c;">Session Already Active</h2>
                    <p style="color:#d4c4a0;margin:15px 0;">This account is already playing in another browser tab or window. Only one session per account is allowed.</p>
                    <p style="color:#888;font-size:0.9em;">Close the other session first, then refresh this page to connect.</p>
                    <div class="popup-actions" style="margin-top:20px;">
                        <button onclick="location.reload()" class="popup-btn popup-btn-danger">Refresh Page</button>
                    </div>
                </div>`;
            document.body.appendChild(blockedOverlay);
            return;

        case 'world_update':
            onlineWorldState.serverInfo.playerCount = message.playerCount;
            onlineWorldState.lastUpdate = new Date().toLocaleTimeString();
            
            // Sync weather from server
            if (message.weather && typeof window.applyServerWeather === 'function') {
                window.applyServerWeather(message.weather, message.season);
            }
            
            // Sync territory state from server
            if (message.territories) {
                onlineWorldState.territories = message.territories;
            }

            // Sync politics state from server
            if (message.politics) {
                onlineWorldState.politics = message.politics;
            }

            // Update player states including jail status
            if (message.playerStates) {
                onlineWorldState.playerStates = message.playerStates;
                updateJailVisibility();
                updateOnlinePlayerList();

                // Also refresh the chat player list and nearby players for faster sync
                const allPlayers = Object.values(message.playerStates);
                onlineWorldState.nearbyPlayers = allPlayers.map(p => ({
                    name: p.name,
                    level: p.level || 1,
                    color: p.playerId === onlineWorldState.playerId ? '#c0a062' : '#c0a062',
                    playerId: p.playerId
                }));
                const chatPlayerList = document.getElementById('chat-player-list');
                if (chatPlayerList) {
                    chatPlayerList.innerHTML = generateOnlinePlayersHTML();
                }

                // SERVER-AUTHORITATIVE SYNC: only sync jail/wanted state from
                // the server. Money, reputation, level, territory are owned by
                // the local (single-player) game engine and must NOT be
                // overwritten by the multiplayer world-update snapshot.
                const selfPs = onlineWorldState.playerStates[onlineWorldState.playerId];
                if (selfPs) {
                    if (window._jailTimerActive) {
                        // Local timer is running — only sync if server value
                        // differs by more than 2s to avoid fighting the local
                        // countdown (which causes visible flicker every 5s).
                        if (typeof selfPs.jailTime === 'number') {
                            const drift = Math.abs(player.jailTime - selfPs.jailTime);
                            if (drift > 2) {
                                player.jailTime = selfPs.jailTime;
                            }
                        }
                        // If server says we're no longer in jail, honour that
                        if (!selfPs.inJail) {
                            player.inJail = false;
                            player.jailTime = 0;
                            if (typeof stopJailTimer === 'function') stopJailTimer();
                            window._jailTimerActive = false;
                            if (window.EventBus) {
                                try { EventBus.emit('jailStatusChanged', { inJail: false, jailTime: 0 }); } catch(e) {}
                            }
                        }
                    } else {
                        // No local timer — accept server state, but respect
                        // the grace period after a local breakout/bribe/rescue
                        // so we don't re-jail the player before the server has
                        // processed the release sync.
                        const graceActive = window._jailReleaseGrace && (Date.now() - window._jailReleaseGrace < 10000);
                        if (graceActive && !player.inJail) {
                            // Skip — local release is authoritative during grace
                        } else {
                            player.inJail = !!selfPs.inJail;
                            player.jailTime = selfPs.jailTime || 0;
                        }
                    }
                    // Heat is NOT synced from world_update — it's managed locally
                    // (jobs, admin panel, skills, turf, etc.) and would be overwritten
                    // with a stale server value here.  Server-authoritative heat changes
                    // from specific actions (job_result, territory_war_result, etc.) are
                    // still applied via their dedicated handlers.
                    _safeUpdateUI(); // reflect authoritative corrections
                }
            }
            
            updateConnectionStatus();
            break;
            
        case 'global_chat':
            const chatMessage = {
                player: message.playerName,
                message: message.message,
                time: new Date(message.timestamp).toLocaleTimeString() || 'Just now',
                color: message.color || (message.playerId === onlineWorldState.playerId ? '#8a9a6a' : '#c0a062'),
                playerId: message.playerId
            };
            onlineWorldState.globalChat.push(chatMessage);
            
            // Keep only last 50 messages
            if (onlineWorldState.globalChat.length > 50) {
                onlineWorldState.globalChat = onlineWorldState.globalChat.slice(-50);
            }

            // Log chat message to The Ledger under 'chat' category
            // Skip ledger logging for the local player's own arrest messages
            // (they already have a clickable newspaper link from sendToJail)
            const isOwnArrestMsg = typeof player !== 'undefined' && player.name &&
                (chatMessage.message.includes('was arrested') || chatMessage.message.includes('ARRESTED!')) &&
                chatMessage.message.includes(player.name);
            if (typeof logAction === 'function' && !isOwnArrestMsg) {
                _safeLogAction(`[Chat] ${escapeHTML(chatMessage.player)}: ${escapeHTML(chatMessage.message)}`, 'chat');
            }
            
            // Update chat if visible
            const chatArea = document.getElementById('global-chat-area');
            if (chatArea) {
                const messageDiv = document.createElement('div');
                // Check if this is a death newspaper announcement
                const isDeathAnnouncement = chatMessage.player === 'The Daily Racketeer' && chatMessage.message.includes('EXTRA!');
                // Check if this is an arrest newspaper announcement
                const isArrestAnnouncement = chatMessage.player === 'The Daily Racketeer' && chatMessage.message.includes('ARRESTED!');
                if (isArrestAnnouncement) {
                    messageDiv.className = 'newspaper-chat-card';
                    messageDiv.style.cssText = 'margin: 8px 0; padding: 10px; background: rgba(30, 26, 16, 0.6); border-radius: 2px; border: 1px solid #8b7355; border-left: 3px solid #8b0000; cursor: pointer;';
                    messageDiv.innerHTML = `
                        <div style="font-family: var(--font-heading); color: #c0a040; font-size: 1.05em; letter-spacing: 1px;">THE DAILY RACKETEER</div>
                        <div style="color: #f5e6c8; margin: 4px 0;">${escapeHTML(chatMessage.message.replace(/ — Click to read the headlines!/, ''))}</div>
                        <div class="newspaper-chat-link" style="margin-top: 4px;">Click to read the headlines</div>
                        <small style="color: #8a7a5a; float: right;">${chatMessage.time}</small>
                    `;
                    messageDiv.onclick = function() {
                        if (lastReceivedJailNewspaper && typeof showJailNewspaper === 'function') {
                            showJailNewspaper(lastReceivedJailNewspaper);
                        } else if (typeof window.showLastJailNewspaper === 'function') {
                            window.showLastJailNewspaper();
                        }
                    };
                } else if (isDeathAnnouncement) {
                    messageDiv.className = 'newspaper-chat-card';
                    messageDiv.style.cssText = 'margin: 8px 0; padding: 10px; background: rgba(30, 26, 16, 0.6); border-radius: 2px; border: 1px solid #8b7355; border-left: 3px solid #c0a040; cursor: pointer;';
                    messageDiv.innerHTML = `
                        <div style="font-family: var(--font-heading); color: #c0a040; font-size: 1.05em; letter-spacing: 1px;">THE DAILY RACKETEER</div>
                        <div style="color: #f5e6c8; margin: 4px 0;">${escapeHTML(chatMessage.message.replace(/ — Click to read the full story!/, ''))}</div>
                        <div class="newspaper-chat-link" style="margin-top: 4px;">Click to read the full obituary</div>
                        <small style="color: #8a7a5a; float: right;">${chatMessage.time}</small>
                    `;
                    messageDiv.onclick = function() {
                        if (lastReceivedDeathNewspaper && typeof showDeathNewspaper === 'function') {
                            showDeathNewspaper(lastReceivedDeathNewspaper);
                        } else if (typeof window.showLastDeathNewspaper === 'function') {
                            window.showLastDeathNewspaper();
                        }
                    };
                } else {
                    const safeChatColor = sanitizeColor(chatMessage.color, '#c0a062');
                    messageDiv.style.cssText = 'margin: 8px 0; padding: 8px; background: rgba(20, 18, 10, 0.3); border-radius: 5px; border-left: 3px solid ' + safeChatColor + ';';
                    messageDiv.innerHTML = `<strong style="color: ${safeChatColor};">${escapeHTML(chatMessage.player)}:</strong> ${escapeHTML(chatMessage.message)} <small style="color: #8a7a5a; float: right;">${chatMessage.time}</small>`;
                }
                chatArea.appendChild(messageDiv);
                chatArea.scrollTop = chatArea.scrollHeight;
            }
            
            // Update quick chat display
            updateQuickChatDisplay();
            
            // Update mobile action log if available
            if (typeof updateMobileActionLog === 'function') {
                updateMobileActionLog();
            }
            break;

        case 'chat_history': {
            // Restore persisted chat history on login
            const myName = message.playerName || onlineWorldState.playerId;

            if (Array.isArray(message.crewChat) && message.crewChat.length) {
                onlineWorldState.crewChat = message.crewChat.map(m => ({
                    player: m.playerName, message: m.message,
                    time: new Date(m.timestamp).toLocaleTimeString(), color: '#3498db'
                }));
                updateChannelChatDisplay('crew');
            }

            if (Array.isArray(message.allianceChat) && message.allianceChat.length) {
                onlineWorldState.allianceChat = message.allianceChat.map(m => ({
                    player: m.playerName, message: m.message,
                    time: new Date(m.timestamp).toLocaleTimeString(), color: '#9b59b6'
                }));
                updateChannelChatDisplay('alliance');
            }

            if (message.privateChats && typeof message.privateChats === 'object') {
                for (const [key, msgs] of Object.entries(message.privateChats)) {
                    if (!Array.isArray(msgs)) continue;
                    for (const m of msgs) {
                        const isMine = m.fromName === myName;
                        const otherName = isMine ? m.toName : m.fromName;
                        const pmMsg = {
                            player: isMine ? 'You' : m.fromName,
                            message: m.message,
                            time: new Date(m.timestamp).toLocaleTimeString(),
                            color: isMine ? '#c0a062' : '#e67e22',
                            toName: isMine ? m.toName : undefined
                        };
                        if (!onlineWorldState.privateChats[otherName]) onlineWorldState.privateChats[otherName] = [];
                        onlineWorldState.privateChats[otherName].push(pmMsg);
                        onlineWorldState.privateChatAll.push(pmMsg);
                    }
                }
                // Trim
                onlineWorldState.privateChatAll = onlineWorldState.privateChatAll.slice(-100);
                for (const name of Object.keys(onlineWorldState.privateChats)) {
                    if (onlineWorldState.privateChats[name].length > 50) {
                        onlineWorldState.privateChats[name] = onlineWorldState.privateChats[name].slice(-50);
                    }
                }
                updateChannelChatDisplay('private');
            }
            break;
        }

        case 'crew_chat': {
            const crewMsg = { player: message.playerName, message: message.message, time: new Date(message.timestamp).toLocaleTimeString(), color: '#3498db' };
            onlineWorldState.crewChat.push(crewMsg);
            if (onlineWorldState.crewChat.length > 50) onlineWorldState.crewChat = onlineWorldState.crewChat.slice(-50);
            updateChannelChatDisplay('crew');
            break;
        }

        case 'alliance_chat': {
            const allyMsg = { player: message.playerName, message: message.message, time: new Date(message.timestamp).toLocaleTimeString(), color: '#9b59b6' };
            onlineWorldState.allianceChat.push(allyMsg);
            if (onlineWorldState.allianceChat.length > 50) onlineWorldState.allianceChat = onlineWorldState.allianceChat.slice(-50);
            updateChannelChatDisplay('alliance');
            break;
        }

        case 'private_chat': {
            const fromName = message.fromName || message.playerName || 'Unknown';
            const pmMsg = { player: fromName, message: message.message, time: new Date(message.timestamp).toLocaleTimeString(), color: '#e67e22' };
            if (!onlineWorldState.privateChats[fromName]) onlineWorldState.privateChats[fromName] = [];
            onlineWorldState.privateChats[fromName].push(pmMsg);
            if (onlineWorldState.privateChats[fromName].length > 50) onlineWorldState.privateChats[fromName] = onlineWorldState.privateChats[fromName].slice(-50);
            onlineWorldState.privateChatAll.push(pmMsg);
            if (onlineWorldState.privateChatAll.length > 100) onlineWorldState.privateChatAll = onlineWorldState.privateChatAll.slice(-100);
            updateChannelChatDisplay('private');
            if (onlineWorldState.activeChatChannel !== 'private') {
                showMPToast(`DM from ${fromName}: ${message.message.substring(0, 40)}`, '#e67e22');
            }
            break;
        }

        case 'private_chat_sent': {
            const toName = message.toName;
            const sentMsg = { player: 'You', message: message.message, time: new Date(message.timestamp).toLocaleTimeString(), color: '#c0a062', toName };
            if (!onlineWorldState.privateChats[toName]) onlineWorldState.privateChats[toName] = [];
            onlineWorldState.privateChats[toName].push(sentMsg);
            if (onlineWorldState.privateChats[toName].length > 50) onlineWorldState.privateChats[toName] = onlineWorldState.privateChats[toName].slice(-50);
            onlineWorldState.privateChatAll.push(sentMsg);
            if (onlineWorldState.privateChatAll.length > 100) onlineWorldState.privateChatAll = onlineWorldState.privateChatAll.slice(-100);
            updateChannelChatDisplay('private');
            break;
        }

        case 'player_death_newspaper':
            // Another player died — store the newspaper data for the clickable chat card
            if (message.newspaperData) {
                lastReceivedDeathNewspaper = message.newspaperData;
                if (typeof logAction === 'function') {
                    _safeLogAction(`EXTRA! EXTRA! ${message.newspaperData.name} is DEAD! "${message.newspaperData.causeOfDeath}" — Click the chat message to read the full obituary!`, 'chat');
                }
            }
            break;

        case 'crew_death_newspaper':
            // A crew or alliance member died — show the newspaper immediately
            if (message.newspaperData) {
                lastReceivedDeathNewspaper = message.newspaperData;
                const groupLabel = message.context === 'alliance' ? 'Alliance' : 'Crew';
                const groupTag = message.groupTag ? `[${message.groupTag}]` : '';
                showMPToast(`${groupLabel} ${groupTag} member ${message.newspaperData.name} has been killed!`, '#8b0000', 5000);
                if (typeof window.showDeathNewspaper === 'function') {
                    window.showDeathNewspaper(message.newspaperData);
                }
                if (typeof logAction === 'function') {
                    _safeLogAction(`${groupLabel} ${groupTag} DEATH: ${message.newspaperData.name} is dead! "${message.newspaperData.causeOfDeath}"`, 'chat');
                }
            }
            break;

        case 'pending_death_newspapers':
            // Queued death newspapers from crew/alliance members who died while we were offline
            if (Array.isArray(message.newspapers) && message.newspapers.length > 0) {
                const papers = message.newspapers;
                showMPToast(`You have ${papers.length} death report${papers.length > 1 ? 's' : ''} from while you were away.`, '#c0a040', 5000);
                // Show the most recent one immediately, log all
                for (let i = 0; i < papers.length; i++) {
                    const entry = papers[i];
                    if (entry.newspaperData) {
                        const groupLabel = entry.context === 'alliance' ? 'Alliance' : 'Crew';
                        const groupTag = entry.groupTag ? `[${entry.groupTag}]` : '';
                        if (typeof logAction === 'function') {
                            _safeLogAction(`${groupLabel} ${groupTag} DEATH: ${entry.newspaperData.name} is dead! "${entry.newspaperData.causeOfDeath}"`, 'chat');
                        }
                    }
                }
                // Show the most recent newspaper popup
                const latest = papers[papers.length - 1];
                if (latest.newspaperData) {
                    lastReceivedDeathNewspaper = latest.newspaperData;
                    if (typeof window.showDeathNewspaper === 'function') {
                        window.showDeathNewspaper(latest.newspaperData);
                    }
                }
            }
            break;

        case 'admin_killed':
            // Admin has executed this player — trigger full permadeath
            console.log('You have been killed by admin:', message.causeOfDeath);
            if (typeof showDeathScreen === 'function') {
                showDeathScreen(message.causeOfDeath || 'Executed by order of the Don');
            } else if (typeof window.showDeathScreen === 'function') {
                window.showDeathScreen(message.causeOfDeath || 'Executed by order of the Don');
            } else {
                // Fallback: at minimum show newspaper if death screen unavailable
                console.error('showDeathScreen not available — showing newspaper fallback');
                if (typeof window.generateDeathNewspaperData === 'function' && typeof window.showDeathNewspaper === 'function') {
                    const nd = window.generateDeathNewspaperData(message.causeOfDeath || 'Executed by order of the Don');
                    window.showDeathNewspaper(nd);
                }
            }
            break;
        
        case 'player_jail_update':
            // Handle jail status updates for other players
            if (message.playerId !== onlineWorldState.playerId) {
                updatePlayerJailStatus(message.playerId, message.playerName, message.jailStatus);
            }
            break;
            
        case 'jailbreak_attempt':
            // Notify about jailbreak attempts by other players
            const jailbreakMsg = ` ${message.playerName} ${message.success ? 'successfully broke out of jail!' : 'failed a jailbreak attempt!'}`;
            addWorldEvent(jailbreakMsg);
            
            if (document.getElementById('global-chat-area')) {
                showSystemMessage(jailbreakMsg, message.success ? '#c0a062' : '#8b0000');
            }
            break;
            
        case 'player_arrested':
            // Notify when another player gets arrested
            const arrestMsg = ` ${message.playerName} was arrested and sent to jail!`;
            addWorldEvent(arrestMsg);
            
            if (document.getElementById('global-chat-area')) {
                showSystemMessage(arrestMsg, '#8b0000');
            }
            break;

        case 'player_jail_newspaper':
            // Another player was arrested — store the newspaper data for the clickable chat card
            if (message.newspaperData) {
                lastReceivedJailNewspaper = message.newspaperData;
                if (typeof logAction === 'function') {
                    _safeLogAction(`ARRESTED! ${message.newspaperData.name} has been sent to jail for "${message.newspaperData.crimeName}" — <span class="newspaper-chat-link" onclick="_showReceivedJailNewspaper()">Read the Headlines!</span>`, 'chat');
                }
            }
            break;
            
        case 'territory_taken':
            onlineWorldState.cityDistricts[message.district].controlledBy = message.playerName;
            addWorldEvent(` ${message.playerName} claimed ${message.district} district!`);
            // If this was our claim, apply authoritative money & territory
            if (message.playerId === onlineWorldState.playerId) {
                if (typeof message.money === 'number') player.money = message.money;
                if (typeof message.territory === 'number') player.territory = message.territory;
                showMPToast(`\uD83D\uDC51 You claimed ${message.district}!`, '#7a8a5a');
                _safeUpdateUI();
            } else {
                showMPToast(`${message.playerName} claimed ${message.district}!`, '#c0a040');
            }
            break;

        // -- Phase 1 Territory System ----------------------------------
        case 'territory_spawn_result':
            if (message.success) {
                player.currentTerritory = message.district;
                _safeLogAction(`Spawned in ${message.district}.`);
            } else {
                _safeLogAction(`Territory spawn failed: ${message.error}`);
            }
            break;

        case 'territory_move_result':
            if (message.success) {
                player.currentTerritory = message.district;
                if (typeof message.money === 'number') player.money = message.money;
                player.lastTerritoryMove = Date.now();
                _safeLogAction(`Relocated to ${message.district}.`);
                _safeUpdateUI();
            } else {
                // Revert local state on failure
                _safeLogAction(`Relocation failed: ${message.error}`);
                if (window.ui) window.ui.toast(message.error || 'Move failed.', 'error');
            }
            break;

        case 'territory_population_update':
            // Another player moved — update cached territory data
            if (onlineWorldState.territories) {
                onlineWorldState.territories = message.territories || onlineWorldState.territories;
            }
            break;

        case 'territory_info':
            // Full territory state response — cache it
            onlineWorldState.territories = message.territories || {};
            // Refresh territories management screen if visible
            if (typeof renderTerritoriesScreen === 'function') {
                const terrScreen = document.getElementById('territories-screen');
                if (terrScreen && terrScreen.style.display === 'block') {
                    renderTerritoriesScreen();
                }
            }
            // Refresh alliance territories tab if visible
            if (typeof renderAllianceTerritoriesTab === 'function') {
                const allianceTerr = document.getElementById('alliance-territories-tab-content');
                if (allianceTerr) renderAllianceTerritoriesTab();
            }
            break;

        case 'territory_ownership_changed':
            onlineWorldState.territories = message.territories || onlineWorldState.territories;
            if (message.method === 'assassination') {
                addWorldEvent(`\uD83C\uDFAF ${message.attacker} seized ${message.seized.join(', ')} from ${message.defender} via assassination!`);
                showMPToast(`\uD83C\uDFAF ${message.attacker} seized territory via assassination!`, '#8b0000', 6000);
            } else if (message.method === 'war') {
                addWorldEvent(`\u2694\uFE0F ${message.attacker} conquered ${message.seized.join(', ')} from ${message.defender} in a gang war!`);
                showMPToast(`\u2694\uFE0F ${message.attacker} conquered territory in a war!`, '#8b0000', 6000);
            } else {
                addWorldEvent(`\uD83D\uDC51 ${message.attacker} claimed ${message.seized.join(', ')}!`);
            }
            break;

        case 'territory_war_result':
            if (message.victory) {
                onlineWorldState.territories = message.territories || onlineWorldState.territories;
                _safeLogAction(`\u2694\uFE0F Victory! Conquered ${message.district} from ${message.oldOwner}. Rep +${message.repGain}, lost ${message.gangMembersLost} members, HP -${message.healthDamage}.`);
                showMPToast(`\u2694\uFE0F Victory! You conquered ${message.district}!`, '#8a9a6a', 5000);
                if (typeof message.heat === 'number') player.heat = message.heat;
                if (typeof message.newHealth === 'number') player.health = message.newHealth;
            } else {
                _safeLogAction(`\u2694\uFE0F Defeat! Failed to take ${message.district}. Lost ${message.gangMembersLost} members, HP -${message.healthDamage}.${message.jailed ? ' Arrested!' : ''}`);
                showMPToast(`\u2694\uFE0F Defeat! Failed to take ${message.district}.`, '#8b3a3a', 5000);
                if (typeof message.heat === 'number') player.heat = message.heat;
                if (typeof message.newHealth === 'number') player.health = message.newHealth;
                if (message.jailed) {
                    player.inJail = true;
                    player.jailTime = message.jailTime || 0;
                }
            }
            _safeUpdateUI();
            break;

        case 'territory_war_defense_lost':
            onlineWorldState.territories = message.territories || onlineWorldState.territories;
            _safeLogAction(`\u2694\uFE0F ${message.attackerName} conquered your territory ${message.district}!`);
            showMPToast(`\u2694\uFE0F ${message.attackerName} seized your territory!`, '#8b3a3a', 6000);
            if (window.ui) window.ui.toast(`${message.attackerName} seized ${message.district.replace(/_/g, ' ')} from you! \u2694\uFE0F`, 'error');
            break;

        case 'territory_war_defense_held':
            _safeLogAction(`\u2694\uFE0F ${message.attackerName} attacked your territory ${message.district} but your defenses held!`);
            showMPToast(`\uD83D\uDEE1\uFE0F Defended ${message.district} from ${message.attackerName}!`, '#8a9a6a', 5000);
            if (window.ui) window.ui.toast(`You repelled ${message.attackerName}'s attack on ${message.district.replace(/_/g, ' ')}! \uD83D\uDEE1\uFE0F`, 'success');
            break;

        case 'territory_tax_income':
            if (typeof message.amount === 'number') {
                if (typeof message.newMoney === 'number') player.money = message.newMoney;
                const taxSource = message.source === 'business' ? 'business income' : 'job';
                _safeLogAction(`\uD83D\uDCB0 Tax income: $${message.amount.toLocaleString()} from ${message.from}'s ${taxSource} (${message.district.replace(/_/g, ' ')}).`);
                showMPToast(`\uD83D\uDCB0 +$${message.amount.toLocaleString()} tax from ${message.from}`, '#7a8a5a', 3000);
                _safeUpdateUI();
            }
            break;

        case 'business_income_tax_result':
            // Server confirmed business income tax was processed
            if (message.success) {
                // Business tax processed
            }
            break;

        case 'job_result':
            // SERVER-AUTHORITATIVE job outcome (sent only to requesting client)
            if (message.success) {
                if (typeof message.money === 'number') player.money = message.money;
                if (typeof message.reputation === 'number') player.reputation = message.reputation;
                if (typeof message.heat === 'number') player.heat = message.heat;
                player.inJail = message.jailed ? true : player.inJail;
                if (message.jailed) player.jailTime = message.jailTime || player.jailTime;
                // Log outcome
                const earningsStr = message.earnings ? `+$${message.earnings.toLocaleString()}` : '';
                let taxStr = '';
                if (message.taxAmount > 0) {
                    taxStr = ` (Tax: -$${message.taxAmount.toLocaleString()} to ${message.taxOwnerName})`;
                }
                _safeLogAction(` Job '${message.jobId}' completed ${earningsStr}${taxStr} (Rep +${message.repGain || 0}, Wanted +${message.wantedAdded || 0})`);
                if (message.jailed) {
                    _safeLogAction(` Arrested during job. Jail Time: ${player.jailTime}s`);
                    addWorldEvent(` Arrested during ${message.jobId} job.`);
                }
            } else {
                _safeLogAction(` Job '${message.jobId}' failed: ${message.error || 'Unknown error'}`);
            }
            _safeUpdateUI();
            break;

        case 'jailbreak_success':
            // We were freed from jail by another player!
            player.inJail = false;
            player.jailTime = 0;
            if (typeof stopJailTimer === 'function') stopJailTimer();
            if (window.EventBus) EventBus.emit('jailStatusChanged', { inJail: false, jailTime: 0 });
            syncJailStatus(false, 0);
            _safeUpdateUI();
            if (typeof goBackToMainMenu === 'function') goBackToMainMenu();
            // Show the freed popup with gift option
            showFreedFromJailPopup(message.helperName, message.helperId);
            break;

        case 'jailbreak_failed_arrested':
            // We got arrested during jailbreak attempt — go straight to jail
            player.inJail = true;
            player.jailTime = message.jailTime || 15;
            player.breakoutAttempts = 3;
            if (window.EventBus) EventBus.emit('jailStatusChanged', { inJail: true, jailTime: player.jailTime });
            if (typeof updateJailTimer === 'function') updateJailTimer();
            if (typeof generateJailPrisoners === 'function') generateJailPrisoners();
            syncJailStatus(true, player.jailTime);
            _safeUpdateUI();
            if (typeof showJailScreen === 'function') showJailScreen();
            showSystemMessage(message.message || 'Jailbreak failed and you were arrested!', '#8b0000');
            break;
            
        case 'connection_established':
            // Store initial server data (leaderboard, events, etc.)
            if (message.serverInfo) {
                if (message.serverInfo.globalLeaderboard) {
                    onlineWorldState.serverInfo.globalLeaderboard = message.serverInfo.globalLeaderboard;
                }
                if (message.serverInfo.cityEvents) {
                    onlineWorldState.serverInfo.cityEvents = message.serverInfo.cityEvents;
                }
            }
            if (message.playerId) {
                onlineWorldState.playerId = message.playerId;
            }
            loadGlobalLeaderboard();
            // Request current bullet stock from server
            if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
                onlineWorldState.socket.send(JSON.stringify({ type: 'get_bullet_stock' }));
            }
            break;

        case 'heist_broadcast':
            onlineWorldState.activeHeists.push(message.heist);
            addWorldEvent(`${message.playerName} is organizing a heist: ${message.heist ? message.heist.target : 'Unknown'}`);
            break;

        case 'heist_update':
            // Server updated a heist (player joined, left, etc.)
            if (message.heist) {
                const hIdx = onlineWorldState.activeHeists.findIndex(h => h.id === message.heist.id);
                if (hIdx >= 0) {
                    onlineWorldState.activeHeists[hIdx] = message.heist;
                } else {
                    onlineWorldState.activeHeists.push(message.heist);
                }

                // Clear pending join once authoritative participant list includes this player
                if (Array.isArray(message.heist.participants) && message.heist.participants.includes(onlineWorldState.playerId)) {
                    pendingHeistJoins.delete(message.heist.id);
                }
            }
            // Refresh heists screen if it's currently shown
            if (document.getElementById('multiplayer-content')?.dataset.activeScreen === 'heists') {
                showActiveHeists();
            }
            break;

        case 'heist_cancelled':
            // Heist was removed (cancelled or completed)
            if (message.heistId) {
                onlineWorldState.activeHeists = onlineWorldState.activeHeists.filter(h => h.id !== message.heistId);
                pendingHeistJoins.delete(message.heistId);
            }
            if (message.message) {
                addWorldEvent(message.message);
            }
            // Refresh heists screen if shown
            if (document.getElementById('multiplayer-content')?.dataset.activeScreen === 'heists') {
                showActiveHeists();
            }
            break;

        case 'heist_completed':
            // Heist finished — show results
            if (message.heistId) {
                onlineWorldState.activeHeists = onlineWorldState.activeHeists.filter(h => h.id !== message.heistId);
                pendingHeistJoins.delete(message.heistId);
            }
            addWorldEvent(message.worldMessage || (message.success ? '\uD83D\uDCB0 A heist was successful!' : '\uD83D\uDE94 A heist has failed!'));
            // Show result popup if player was involved
            if (message.involved) {
                showHeistResult(message);
            } else {
                showMPToast(message.worldMessage || 'A heist just went down!', message.success ? '#8a9a6a' : '#8b3a3a');
            }
            // Refresh heists screen if shown
            if (document.getElementById('multiplayer-content')?.dataset.activeScreen === 'heists') {
                showActiveHeists();
            }
            break;

        case 'heist_invite':
            // Someone invited you to a heist
            if (message.heistId && message.inviterName) {
                showMPToast(`\uD83D\uDCB0 ${message.inviterName} invited you to a heist!`, '#c0a040', 8000);
                const acceptInvite = await window.ui.confirm(`${message.inviterName} invited you to a heist: ${message.target || 'Unknown'}!\n\nReward: $${(message.reward || 0).toLocaleString()}\nDifficulty: ${message.difficulty || 'Unknown'}\n\nJoin their crew?`);
                if (acceptInvite && onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
                    onlineWorldState.socket.send(JSON.stringify({
                        type: 'heist_join',
                        heistId: message.heistId
                    }));
                    _safeLogAction(`Accepted heist invitation from ${message.inviterName}`);
                }
            }
            break;
            
        case 'player_ranked':
            // Store server leaderboard data and refresh UI
            if (message.leaderboard) {
                onlineWorldState.serverInfo.globalLeaderboard = message.leaderboard;
            }
            loadGlobalLeaderboard();
            break;
            
        case 'system_message':
            const systemMsg = {
                player: 'System',
                message: message.message,
                time: new Date().toLocaleTimeString(),
                color: message.color || '#8b3a3a',
                playerId: 'system'
            };
            onlineWorldState.globalChat.push(systemMsg);
            
            // Update chat if visible
            const chatAreaSys = document.getElementById('global-chat-area');
            if (chatAreaSys) {
                const messageDiv = document.createElement('div');
                const safeSysColor = sanitizeColor(systemMsg.color, '#8e44ad');
                messageDiv.style.cssText = 'margin: 8px 0; padding: 8px; background: rgba(20, 18, 10, 0.3); border-radius: 5px; border-left: 3px solid ' + safeSysColor + ';';
                messageDiv.innerHTML = `<strong style="color: ${safeSysColor};">System:</strong> ${escapeHTML(systemMsg.message)} <small style="color: #8a7a5a; float: right;">${systemMsg.time}</small>`;
                chatAreaSys.appendChild(messageDiv);
                chatAreaSys.scrollTop = chatAreaSys.scrollHeight;
            }
            
            // Also show as a toast if UI system is available
            if (typeof ui !== 'undefined' && ui.toast) {
                ui.toast(message.message, 'warning');
            }
            break;
            
        case 'assassination_result':
            handleAssassinationResult(message);
            break;

        case 'assassination_victim':
            handleAssassinationVictim(message);
            showMPToast(`\uD83C\uDFAF ${message.attackerName} ordered a hit on you!`, '#8b3a3a', 6000);
            break;

        case 'assassination_survived':
            handleAssassinationSurvived(message);
            showMPToast('\uD83D\uDEE1\uFE0F You survived an assassination attempt!', '#8a9a6a', 5000);
            break;

        case 'combat_result':
            // Server-authoritative PvP combat outcome — show result modal
            if (message.error) {
                showSystemMessage(message.error, '#8b3a3a');
                break;
            }
            const isWinner = message.winner === (player.name || '');
            const isLoser = message.loser === (player.name || '');
            if (isWinner || isLoser) {
                showPvpResultModal(message, isWinner);
                // Sync health damage from server
                if (message.healthDamage) {
                    const myDmg = isWinner ? message.healthDamage.winner : message.healthDamage.loser;
                    if (myDmg) {
                        player.health = Math.max(0, (player.health || 100) - myDmg);
                        if (player.health <= 0 && typeof window.showDeathScreen === 'function') {
                            window.showDeathScreen(`Killed in PvP by ${isWinner ? message.loser : message.winner}`);
                            return;
                        }
                    }
                }
                // Show bounty claim toast
                if (isWinner && message.bountyClaimed) {
                    showMPToast(`Bounty collected! +$${message.bountyClaimed.reward.toLocaleString()}`, '#ff6600', 5000);
                    player.money = (player.money || 0) + message.bountyClaimed.reward;
                }
                // Show ELO change
                if (message.eloChange && isWinner) {
                    showMPToast(`${message.eloChange.icon} Ranked: ${message.eloChange.elo} Rating (${message.eloChange.tier})`, '#c0a062', 4000);
                }
            } else {
                // Spectator — show toast
                showMPToast(`\u2694\uFE0F ${message.winner} defeated ${message.loser}!`, '#8b0000');
            }
            // Always log in world feed for other spectators
            addWorldEvent(`\u2694\uFE0F ${message.winner} defeated ${message.loser} in combat!`);
            // Stats sync happens via next world_update
            break;

        case 'jail_roster':
            // Server-sent jail roster: real players in jail + bots
            onlineWorldState.jailRoster = {
                realPlayers: message.realPlayers || [],
                bots: message.bots || [],
                totalOnlineInJail: message.totalOnlineInJail || 0
            };
            updateJailVisibility();
            // Also update the game.js prisoner lists if they exist
            if (typeof updatePrisonerList === 'function') updatePrisonerList();
            if (typeof updateJailbreakPrisonerList === 'function') updateJailbreakPrisonerList();
            break;

        case 'jailbreak_bot_result':
            // Result of attempting to break out a jail bot
            if (message.success) {
                _safeLogAction(`${message.message}`);
                if (message.expReward && typeof gainExperience === 'function') gainExperience(message.expReward * 0.1);
                if (message.cashReward) player.money += message.cashReward;
                showSystemMessage(`${message.message}`, '#8a9a6a');
                _safeUpdateUI();
                if (typeof updateJailbreakPrisonerList === 'function') updateJailbreakPrisonerList();
                // Show visible alert so user sees the result
                if (window.ui) {
                    window.ui.alert(`${message.message}`, 'Jailbreak Successful');
                } else {
                    showSystemMessage(`${message.message}`, '#8a9a6a');
                }
            } else {
                _safeLogAction(`${message.message}`);
                if (message.arrested) {
                    // Got caught — go straight to jail, no more breakout attempts
                    player.inJail = true;
                    player.jailTime = message.jailTime || 15;
                    player.breakoutAttempts = 3;
                    if (window.EventBus) EventBus.emit('jailStatusChanged', { inJail: true, jailTime: player.jailTime });
                    if (typeof updateJailTimer === 'function') updateJailTimer();
                    if (typeof generateJailPrisoners === 'function') generateJailPrisoners();
                    syncJailStatus(true, player.jailTime);
                    _safeUpdateUI();
                    if (typeof showJailScreen === 'function') showJailScreen();
                    showSystemMessage(`${message.message}`, '#8b3a3a');
                } else {
                    showSystemMessage(`${message.message}`, '#c0a040');
                    _safeUpdateUI();
                    if (typeof updateJailbreakPrisonerList === 'function') updateJailbreakPrisonerList();
                    // Show visible alert so user sees the failure
                    if (window.ui) {
                        window.ui.alert(`${message.message}`, 'Jailbreak Failed');
                    } else {
                        showSystemMessage(`${message.message}`, '#8b3a3a');
                    }
                }
            }
            break;

        case 'gift_received':
            // Someone sent us money
            if (message.amount) {
                player.money += message.amount;
                showSystemMessage(message.message || `You received a $${message.amount.toLocaleString()} gift!`, '#c0a062');
                _safeLogAction(`${message.senderName || 'Someone'} sent you $${message.amount.toLocaleString()}!`);
                _safeUpdateUI();
            }
            break;

        // ==================== PHASE C: COMPETITIVE FEATURE HANDLERS ====================
        case 'alliance_result':
            handleAllianceResult(message);
            break;

        case 'alliance_invite':
            handleAllianceInviteReceived(message);
            break;

        case 'alliance_discipline_result':
            handleAllianceDisciplineResult(message);
            break;

        case 'politics_info_result':
            handlePoliticsInfoResult(message);
            break;
        case 'politics_policy_result':
            handlePoliticsPolicyResult(message);
            break;
        case 'politics_submit_result':
            handlePoliticsSubmitResult(message);
            break;
        case 'politics_newspaper':
            showPolicyNewspaper(message);
            break;
        case 'politics_update':
            if (message.politics) {
                onlineWorldState.politics = message.politics;
                refreshPoliticsTab();
            }
            break;

        case 'alliance_info_result':
            // Merge alliance territory data into cached territories
            if (message.allianceTerritories) {
                if (!onlineWorldState.territories) onlineWorldState.territories = {};
                for (const [distId, data] of Object.entries(message.allianceTerritories)) {
                    onlineWorldState.territories[distId] = Object.assign(onlineWorldState.territories[distId] || {}, data);
                }
            }
            handleAllianceInfoResult(message);
            break;

        case 'bounty_result':
            handleBountyResult(message);
            break;

        case 'bounty_alert':
            handleBountyAlert(message);
            break;

        case 'bounty_expired':
            if (message.newMoney != null) player.money = message.newMoney;
            showMPToast(message.message || 'A bounty you posted has expired and been refunded.', '#e67e22', 6000);
            if (typeof updateUI === 'function') updateUI();
            break;

        case 'bounty_list_result':
            handleBountyListResult(message);
            break;

        case 'season_info_result':
            handleSeasonInfoResult(message);
            break;

        case 'season_reset':
            showMPToast(`Season ${message.seasonNumber} has begun!${message.champion ? ` Last champion: ${message.champion.name}` : ''}`, '#ffd700', 8000);
            break;

        case 'player_released':
            // Server says our sentence is served
            if (message.playerId === onlineWorldState.playerId) {
                // Guard against duplicate release (local timer may have already freed us)
                if (!player.inJail) break;
                if (typeof stopJailTimer === 'function') stopJailTimer();
                window._jailTimerActive = false;
                player.inJail = false;
                player.jailTime = 0;
                if (window.EventBus) {
                    try { EventBus.emit('jailStatusChanged', { inJail: false, jailTime: 0 }); } catch(e) {}
                }
                if (typeof updateUI === 'function') updateUI();
                if (typeof showToast === 'function') {
                    showToast('You served your sentence and are now free.', 'success');
                }
                if (typeof goBackToMainMenu === 'function') goBackToMainMenu();
            }
            break;

        // -- Unified Player Market messages --
        case 'market_listings':
        case 'market_listed':
        case 'market_sold':
        case 'market_purchased':
        case 'market_cancelled':
        case 'market_error':
            handlePlayerMarketMessage(message);
            break;

        // -- Bullet Shop messages (store purchase, not player market) --
        case 'bullets_purchased':
        case 'bullets_error':
        case 'bullet_stock_update':
            handleBulletShopMessage(message);
            break;

        // -- Player connect / disconnect notifications --
        case 'player_connect':
            // Player list will be refreshed by the subsequent player_states broadcast
            break;

        case 'player_disconnect':
            // Player list will be refreshed by the subsequent player_states broadcast
            break;

        // -- Server-synced weather --
        case 'weather_update':
            if (typeof window.applyServerWeather === 'function') {
                window.applyServerWeather(message.weather, message.season);
            }
            break;

        // ==================== NEW SYSTEM MESSAGES ====================
        // Friends & Social
        case 'friend_result':
            handleFriendResult(message);
            break;
        case 'friend_request':
            handleFriendRequest(message);
            break;
        case 'block_result':
            handleBlockResult(message);
            break;
        case 'friends_list_result':
            handleFriendsListResult(message);
            break;

        // Server-side leaderboards
        case 'leaderboards_result':
            handleLeaderboardsResult(message);
            break;

        // Heist matchmaking queue
        case 'heist_queue_result':
            handleHeistQueueResult(message);
            break;
        case 'heist_queue_matched':
            handleHeistQueueMatched(message);
            break;

        // Crews
        case 'crew_result':
            handleCrewResult(message);
            break;
        case 'crew_invite':
            handleCrewInviteReceived(message);
            break;
        case 'crew_info_result':
            handleCrewInfoResult(message);
            break;
        case 'crew_member_joined':
            if (typeof showBriefNotification === 'function') showBriefNotification(`${message.playerName} joined your crew!`, 'success');
            break;
        case 'crew_kicked':
            if (typeof showBriefNotification === 'function') showBriefNotification(`You were kicked from ${message.crewName}.`, 'error');
            player.crewId = null;
            player.crewRole = null;
            window._myCrewSize = 0;
            break;
        case 'crew_job_share_reward':
            if (typeof player !== 'undefined') player.money += message.amount;
            if (typeof showBriefNotification === 'function') showBriefNotification(`Crew cut: +$${message.amount.toLocaleString()} from ${message.fromPlayer}'s ${message.jobName}!`, 'success');
            if (typeof logAction === 'function') _safeLogAction(`Your crew member ${message.fromPlayer} completed ${message.jobName} -- your cut: $${message.amount.toLocaleString()}.`, 'income');
            if (typeof updateUI === 'function') updateUI();
            break;
        case 'crew_job_share_sent':
            if (typeof showBriefNotification === 'function') showBriefNotification(`Crew share: $${message.amountEach.toLocaleString()} sent to ${message.sharedWith} crew member${message.sharedWith > 1 ? 's' : ''}.`, 'success');
            break;

        // Player gambling
        case 'gambling_result':
            handleGamblingResult(message);
            break;
        case 'gambling_resolved':
            handleGamblingResolved(message);
            break;
        case 'gambling_tables_list':
            handleGamblingTablesList(message);
            break;
        case 'gambling_table_update':
            // A new table was created — refresh if gambling screen is open
            if (document.getElementById('player-gambling-content')?.innerHTML) {
                sendMP({ type: 'gambling_list_tables' });
            }
            break;

        // Superboss
        case 'superboss_result':
            handleSuperbossResult(message);
            break;
        case 'superboss_invite':
            handleSuperbossInviteReceived(message);
            break;
        case 'superboss_update':
        case 'superboss_attack_result':
            handleSuperbossUpdate(message);
            break;
        case 'superboss_victory':
            handleSuperbossVictory(message);
            break;
        case 'superboss_defeat':
            handleSuperbossDefeat(message);
            break;
        case 'superboss_list_result':
            handleSuperbossListResult(message);
            break;

        // Seasonal events
        case 'seasonal_event_result':
            handleSeasonalEventResult(message);
            break;
        case 'seasonal_event_started':
            if (typeof showBriefNotification === 'function') showBriefNotification(`${message.event.name} has begun!`, 'success');
            if (typeof logAction === 'function') _safeLogAction(`SEASONAL EVENT: ${message.event.name} — ${message.event.description}`, 'event');
            break;
        case 'seasonal_objective_complete':
            if (typeof showBriefNotification === 'function') showBriefNotification(`Seasonal objective complete! +$${(message.reward?.money || 0).toLocaleString()}`, 'success');
            if (message.reward) {
                player.money += message.reward.money || 0;
                if (typeof gainExperience === 'function') gainExperience(message.reward.xp || 0);
                _safeUpdateUI();
            }
            break;

        // Daily login
        case 'daily_login_result':
            if (message.success && typeof showBriefNotification === 'function') {
                showBriefNotification(`Daily login claimed! Streak: ${message.streak} days`, 'success');
            }
            break;

        default:
            console.log('Unknown message type:', message.type);
    }
}

// ==================== UNIFIED PLAYER MARKET MESSAGE HANDLER ====================

function handlePlayerMarketMessage(message) {
    switch (message.type) {
        case 'market_listings':
            playerMarketListings = message.listings || [];
            // Refresh market tab if active
            if (document.querySelector('[onclick="showOnlineWorld(\'market\')"]')?.style?.background?.includes('#c0a062')) {
                showOnlineWorld('market');
            }
            break;

        case 'market_listed':
            if (typeof showBriefNotification === 'function') showBriefNotification(`${message.itemName} listed on the Player Market!`, 'success');
            playerMarketListings = message.listings || playerMarketListings;
            window._pendingMarketListing = null;
            if (typeof updateUI === 'function') updateUI();
            break;

        case 'market_sold':
            // We sold something — receive money
            player.money += message.amount;
            if (typeof showBriefNotification === 'function') showBriefNotification(`${message.buyerName} bought your ${message.itemName} for $${message.amount.toLocaleString()}!`, 'success');
            if (typeof logAction === 'function') logAction(`${message.buyerName} purchased your ${message.itemName} from the Player Market for $${message.amount.toLocaleString()}!`);
            playerMarketListings = message.listings || playerMarketListings;
            if (typeof updateUI === 'function') updateUI();
            break;

        case 'market_purchased': {
            // We bought something — add to inventory
            player.money -= message.price;
            const cat = message.category;

            if (cat === 'vehicle') {
                // Add vehicle to garage
                const vd = message.itemData || {};
                player.stolenCars.push({
                    name: message.itemName,
                    baseValue: vd.baseValue || 0,
                    currentValue: vd.currentValue || 0,
                    damagePercentage: vd.damagePercentage || 0,
                    usageCount: vd.usageCount || 0,
                    image: vd.image || `vehicles/${message.itemName}.png`
                });
            } else if (cat === 'ammo') {
                player.ammo = (player.ammo || 0) + (message.quantity || 1);
            } else if (cat === 'gas') {
                player.gas = (player.gas || 0) + (message.quantity || 1);
            } else {
                // weapon, armor, utility, drug — add to inventory
                const itemObj = Object.assign({}, message.itemData || {});
                itemObj.name = message.itemName;
                for (let i = 0; i < (message.quantity || 1); i++) {
                    player.inventory.push(Object.assign({}, itemObj));
                }
            }

            if (typeof showBriefNotification === 'function') showBriefNotification(`Bought ${message.itemName} from ${message.sellerName} for $${message.price.toLocaleString()}!`, 'success');
            if (typeof logAction === 'function') logAction(`Purchased ${message.itemName} from ${message.sellerName} on the Player Market for $${message.price.toLocaleString()}.`);
            playerMarketListings = message.listings || playerMarketListings;
            if (typeof updateUI === 'function') updateUI();
            showOnlineWorld('market');
            break;
        }

        case 'market_cancelled': {
            // Listing cancelled — return item to inventory
            const cat = message.category;
            if (cat === 'vehicle') {
                const vd = message.itemData || {};
                player.stolenCars.push({
                    name: message.itemName,
                    baseValue: vd.baseValue || 0,
                    currentValue: vd.currentValue || 0,
                    damagePercentage: vd.damagePercentage || 0,
                    usageCount: vd.usageCount || 0,
                    image: vd.image || `vehicles/${message.itemName}.png`
                });
            } else if (cat === 'ammo') {
                player.ammo = (player.ammo || 0) + (message.quantity || 1);
            } else if (cat === 'gas') {
                player.gas = (player.gas || 0) + (message.quantity || 1);
            } else {
                const itemObj = Object.assign({}, message.itemData || {});
                itemObj.name = message.itemName;
                for (let i = 0; i < (message.quantity || 1); i++) {
                    player.inventory.push(Object.assign({}, itemObj));
                }
            }
            if (typeof showBriefNotification === 'function') showBriefNotification(`Listing cancelled. ${message.itemName} returned to your inventory.`, 'success');
            playerMarketListings = message.listings || playerMarketListings;
            if (typeof updateUI === 'function') updateUI();
            showOnlineWorld('market');
            break;
        }

        case 'market_error':
            if (typeof showBriefNotification === 'function') showBriefNotification(message.error || 'Market error!', 'error');
            // Rollback optimistic removal
            if (window._pendingMarketListing) {
                const rb = window._pendingMarketListing;
                if (rb.category === 'vehicle' && rb.car) {
                    player.stolenCars.splice(rb.index, 0, rb.car);
                    player.selectedCar = rb.previousSelectedCar;
                } else if (rb.category === 'ammo') {
                    player.ammo = (player.ammo || 0) + (rb.quantity || 0);
                } else if (rb.category === 'gas') {
                    player.gas = (player.gas || 0) + (rb.quantity || 0);
                } else if (rb.item) {
                    player.inventory.splice(rb.index, 0, rb.item);
                }
                window._pendingMarketListing = null;
                if (typeof updateUI === 'function') updateUI();
            }
            requestMarketListings();
            break;
    }
}

// ==================== BULLET SHOP MESSAGE HANDLER (store, not market) ====================

function handleBulletShopMessage(message) {
    switch (message.type) {
        case 'bullets_purchased':
            player.ammo++;
            window._serverBulletStock = message.remaining;
            window._pendingBulletPurchase = null;
            if (typeof showBriefNotification === 'function') showBriefNotification(`Bought 1 Bullet! ${message.remaining} left in today's server supply.`, 'success');
            if (typeof logAction === 'function') logAction(`The dealer slides a single round across the table. ${message.remaining} bullets remain in today's citywide supply.`);
            if (player.streetReputation) {
                player.streetReputation.underground = Math.min(100, (player.streetReputation.underground || 0) + 1);
            }
            if (typeof updateUI === 'function') updateUI();
            if (typeof refreshStoreAfterPurchase === 'function') refreshStoreAfterPurchase();
            break;

        case 'bullets_error':
            if (window._pendingBulletPurchase) {
                player.money += window._pendingBulletPurchase.price;
                window._pendingBulletPurchase = null;
            }
            if (typeof showBriefNotification === 'function') showBriefNotification(message.error || 'Bullet purchase failed!', 'danger');
            if (typeof updateUI === 'function') updateUI();
            if (typeof refreshStoreAfterPurchase === 'function') refreshStoreAfterPurchase();
            break;

        case 'bullet_stock_update':
            window._serverBulletStock = message.remaining;
            if (typeof refreshStoreAfterPurchase === 'function') refreshStoreAfterPurchase();
            break;
    }
}

// ==================== UNIFIED PLAYER MARKET FUNCTIONS ====================

function listItemForSale(category, itemIdentifier, price, quantity, pricePerUnit) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) {
        if (typeof showBriefNotification === 'function') showBriefNotification('Not connected to server!', 'error');
        return;
    }

    price = parseInt(price) || 0;
    quantity = parseInt(quantity) || 1;
    pricePerUnit = parseInt(pricePerUnit) || price;

    const msg = { type: 'market_list', category: category, quantity: quantity, price: price, pricePerUnit: pricePerUnit };

    if (category === 'vehicle') {
        const carIndex = parseInt(itemIdentifier);
        const car = player.stolenCars[carIndex];
        if (!car) return;
        if (price < 100) { if (typeof showBriefNotification === 'function') showBriefNotification('Set a price of at least $100!', 'error'); return; }
        if (price > car.baseValue * 3) { if (typeof showBriefNotification === 'function') showBriefNotification('Price too high! Max 3x base value.', 'error'); return; }

        msg.itemName = car.name;
        msg.baseValue = car.baseValue;
        msg.itemData = { baseValue: car.baseValue, currentValue: car.currentValue, damagePercentage: car.damagePercentage, image: car.image || `vehicles/${car.name}.png`, usageCount: car.usageCount || 0 };

        // Optimistic removal
        const removedCar = player.stolenCars[carIndex];
        const prevSelected = player.selectedCar;
        if (player.selectedCar === carIndex) player.selectedCar = null;
        else if (player.selectedCar > carIndex) player.selectedCar--;
        player.stolenCars.splice(carIndex, 1);
        window._pendingMarketListing = { category: 'vehicle', car: removedCar, index: carIndex, previousSelectedCar: prevSelected };

    } else if (category === 'ammo' || category === 'gas') {
        const counter = category === 'ammo' ? 'ammo' : 'gas';
        const label = category === 'ammo' ? 'Bullets' : 'Gasoline';
        if (quantity < 1 || quantity > 100) { if (typeof showBriefNotification === 'function') showBriefNotification('List 1-100 units at a time!', 'error'); return; }
        if ((player[counter] || 0) < quantity) { if (typeof showBriefNotification === 'function') showBriefNotification(`You only have ${player[counter] || 0} ${label.toLowerCase()}!`, 'error'); return; }
        if (pricePerUnit < 10000) { if (typeof showBriefNotification === 'function') showBriefNotification('Minimum price is $10,000 per unit!', 'error'); return; }
        if (pricePerUnit > 1000000) { if (typeof showBriefNotification === 'function') showBriefNotification('Maximum price is $1,000,000 per unit!', 'error'); return; }

        msg.itemName = label;
        msg.price = quantity * pricePerUnit;

        // Optimistic removal
        player[counter] -= quantity;
        window._pendingMarketListing = { category: category, quantity: quantity };

    } else {
        // weapon, armor, utility, drug — from player.inventory
        const invIndex = parseInt(itemIdentifier);
        const item = player.inventory[invIndex];
        if (!item) return;
        // Block listing damaged weapons/armor
        if ((item.type === 'weapon' || item.type === 'armor') && typeof item.durability === 'number' && typeof item.maxDurability === 'number' && item.durability < item.maxDurability) {
            if (typeof showBriefNotification === 'function') showBriefNotification('Damaged gear cannot be listed!', 'error');
            return;
        }
        if (price < 100) { if (typeof showBriefNotification === 'function') showBriefNotification('Set a price of at least $100!', 'error'); return; }
        if (price > 5000000) { if (typeof showBriefNotification === 'function') showBriefNotification('Maximum listing price is $5,000,000!', 'error'); return; }

        msg.itemName = item.name;
        msg.itemData = Object.assign({}, item);

        // Optimistic removal
        const removedItem = player.inventory.splice(invIndex, 1)[0];
        // Unequip if this was equipped
        if (player.equippedWeapon === removedItem) player.equippedWeapon = null;
        if (player.equippedArmor === removedItem) player.equippedArmor = null;
        if (player.equippedVehicle === removedItem) player.equippedVehicle = null;
        window._pendingMarketListing = { category: category, item: removedItem, index: invIndex };
    }

    onlineWorldState.socket.send(JSON.stringify(msg));
    if (typeof showBriefNotification === 'function') showBriefNotification(`Listing ${msg.itemName} on the Player Market...`, 'info');
    if (typeof logAction === 'function') logAction(`Listed ${msg.itemName} on the Player Market for $${(msg.price || 0).toLocaleString()}.`);
    if (typeof updateUI === 'function') updateUI();
    setTimeout(() => showOnlineWorld('market'), 500);
}

function buyMarketListing(listingId) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) {
        if (typeof showBriefNotification === 'function') showBriefNotification('Not connected to server!', 'error');
        return;
    }

    const listing = playerMarketListings.find(l => l.id === listingId);
    if (!listing) { if (typeof showBriefNotification === 'function') showBriefNotification('Listing no longer available!', 'error'); return; }
    if (player.money < listing.price) { if (typeof showBriefNotification === 'function') showBriefNotification('Not enough money!', 'error'); return; }

    onlineWorldState.socket.send(JSON.stringify({ type: 'market_buy', listingId: listingId }));
    if (typeof showBriefNotification === 'function') showBriefNotification(`Purchasing ${listing.itemName}...`, 'info');
}

function cancelMarketListing(listingId) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) {
        if (typeof showBriefNotification === 'function') showBriefNotification('Not connected to server!', 'error');
        return;
    }

    onlineWorldState.socket.send(JSON.stringify({ type: 'market_cancel', listingId: listingId }));
    if (typeof showBriefNotification === 'function') showBriefNotification('Cancelling listing...', 'info');
}

function requestMarketListings() {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) return;
    onlineWorldState.socket.send(JSON.stringify({ type: 'market_get_listings' }));
}

// Update jail visibility — no longer renders a separate section.
// The prisoner-list div (game.js updatePrisonerList) handles all display.
function updateJailVisibility() {
    const jailStatusContainer = document.getElementById('online-jail-status');
    if (jailStatusContainer) jailStatusContainer.innerHTML = '';
}

// Update online player list
function updateOnlinePlayerList() {
    const playerListContainer = document.getElementById('online-player-list');
    if (!playerListContainer) return;
    
    let playersHTML = '<h4 style="color: #c0a062; margin: 0 0 15px 0; font-family: \'Georgia\', serif;"> Made Men Online</h4>';
    
    const onlinePlayers = Object.values(onlineWorldState.playerStates || {});
    
    if (onlinePlayers.length === 0) {
        playersHTML += '<div style="color: #8a7a5a; font-style: italic; text-align: center;">Loading player list...</div>';
    } else {
        onlinePlayers.forEach(p => {
            const statusIcon = p.inJail ? '' : '';
            const statusText = p.inJail ? 'In Jail' : 'Free';
            const statusColor = p.inJail ? '#8b0000' : '#c0a062';
            
            playersHTML += `
                <div style="background: rgba(20, 18, 10, 0.3); padding: 10px; margin: 8px 0; border-radius: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong style="color: ${p.playerId === onlineWorldState.playerId ? '#c0a062' : '#f5e6c8'}; font-family: 'Georgia', serif;">
                                ${escapeHTML(p.name)} ${p.playerId === onlineWorldState.playerId ? '(You)' : ''}
                            </strong>
                            <br><small style="color: ${statusColor};">${statusIcon} ${statusText}</small>
                        </div>
                        <div style="text-align: right; font-size: 0.9em;">
                            <div>Level ${p.level || 1}</div>
                            <div style="color: #8a7a5a;">${p.reputation || 0} rep</div>
                        </div>
                    </div>
                </div>
            `;
        });
    }
    
    playerListContainer.innerHTML = playersHTML;
}

// Update player jail status
function updatePlayerJailStatus(playerId, playerName, jailStatus) {
    if (!onlineWorldState.playerStates) {
        onlineWorldState.playerStates = {};
    }
    
    if (!onlineWorldState.playerStates[playerId]) {
        onlineWorldState.playerStates[playerId] = {
            playerId: playerId,
            name: playerName
        };
    }
    
    onlineWorldState.playerStates[playerId].inJail = jailStatus.inJail;
    onlineWorldState.playerStates[playerId].jailTime = jailStatus.jailTime;
    
    // Update UI if jail screen is visible
    updateJailVisibility();
    updateOnlinePlayerList();
}

// Attempt to break out another player
async function attemptPlayerJailbreak(targetPlayerId, targetPlayerName) {
    if (!onlineWorldState.isConnected) {
        window.ui.toast('You need to be connected to the online world!', 'error');
        return;
    }
    
    if (player.inJail) {
        window.ui.toast("You can't help others break out while you're in jail yourself!", 'error');
        return;
    }
    
    const confirmBreakout = await window.ui.confirm(`Attempt to break ${targetPlayerName} out of jail? This has risks.`);
    
    if (confirmBreakout) {
        if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
            onlineWorldState.socket.send(JSON.stringify({
                type: 'jailbreak_attempt',
                targetPlayerId,
                targetPlayerName,
                helperPlayerId: onlineWorldState.playerId,
                helperPlayerName: player.name || 'You'
            }));
            _safeLogAction(` Jailbreak intent sent to free ${targetPlayerName}. Awaiting authoritative outcome...`);
        } else {
            window.ui.toast('Connection lost before sending jailbreak intent.', 'error');
        }
        _safeUpdateUI();
    }
}

// Request the jail roster from the server (real players + bots)
function requestJailRoster() {
    if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        onlineWorldState.socket.send(JSON.stringify({ type: 'request_jail_roster' }));
    }
}

// Attempt to break out a jail bot (server-authoritative)
async function attemptBotJailbreak(botId, botName) {
    if (!onlineWorldState.isConnected) {
        window.ui.toast('You need to be connected to the online world!', 'error');
        return;
    }

    if (player.inJail) {
        window.ui.toast("You can't help others break out while you're in jail yourself!", 'error');
        return;
    }

    const confirmBreakout = await window.ui.confirm(`Attempt to break ${botName} out of jail? This has risks.`);

    if (confirmBreakout) {
        if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
            onlineWorldState.socket.send(JSON.stringify({
                type: 'jailbreak_bot',
                botId,
                botName,
                helperPlayerId: onlineWorldState.playerId,
                helperPlayerName: player.name || 'You'
            }));
            _safeLogAction(`Attempting to break out ${botName}...`);
        } else {
            window.ui.toast('Connection lost before sending jailbreak intent.', 'error');
        }
        _safeUpdateUI();
    }
}
window.attemptPlayerJailbreak = attemptPlayerJailbreak;
window.attemptBotJailbreak = attemptBotJailbreak;

// Unified Player Market exports
window.listItemForSale = listItemForSale;
window.buyMarketListing = buyMarketListing;
window.cancelMarketListing = cancelMarketListing;
window.requestMarketListings = requestMarketListings;
window.showVehicleMarketplace = showVehicleMarketplace; // Legacy alias from garage button

// Show "You've been freed!" popup with option to send a gift
function showFreedFromJailPopup(helperName, helperId) {
    // Remove any existing popup
    const existing = document.getElementById('freed-from-jail-popup');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'freed-from-jail-popup';
    overlay.className = 'popup-overlay';

    const giftAmounts = [500, 1000, 2500, 5000];
    let giftButtonsHTML = '';
    if (helperId) {
        giftButtonsHTML = `<p style="margin-top:12px;color:#c0a062;font-size:14px;">Want to send them a thank-you gift?</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:8px;">
            ${giftAmounts.map(amt => `<button onclick="sendGiftMoney('${helperId}', ${amt})" class="popup-btn popup-btn-success" style="padding:8px 14px;font-size:13px;">$${amt.toLocaleString()}</button>`).join('')}
        </div>`;
    }

    overlay.innerHTML = `
        <div class="popup-card popup-success" style="max-width:420px;">
            <h2 class="popup-title" style="color:#8a9a6a;">You're Free!</h2>
            <p class="popup-text" style="font-size:16px;line-height:1.5;">
                <strong style="color:#c0a062;">${escapeHTML(helperName || 'A fellow gangster')}</strong> broke you out of jail!
            </p>
            ${giftButtonsHTML}
            <div class="popup-actions">
                <button onclick="document.getElementById('freed-from-jail-popup').remove()" class="popup-btn popup-btn-crimson">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

// Send a gift of money to another player
function sendGiftMoney(targetPlayerId, amount) {
    if (player.money < amount) {
        window.ui.toast("You don't have enough money for that gift!", 'error');
        return;
    }
    player.money -= amount;
    if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        onlineWorldState.socket.send(JSON.stringify({
            type: 'send_gift',
            targetPlayerId: targetPlayerId,
            amount: amount
        }));
    }
    _safeLogAction(`You sent $${amount.toLocaleString()} as a thank-you gift!`);
    _safeUpdateUI();
    // Close the popup
    const popup = document.getElementById('freed-from-jail-popup');
    if (popup) popup.remove();
    if (typeof showBriefNotification === 'function') {
        showBriefNotification(`Gift of $${amount.toLocaleString()} sent!`, 'success');
    }
}

// Show system message in chat
function showSystemMessage(message, color = '#c0a040') {
    const chatArea = document.getElementById('global-chat-area');
    if (chatArea) {
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `margin: 8px 0; padding: 8px; background: rgba(20, 18, 10, 0.4); border-radius: 5px; border-left: 3px solid ${color};`;
        // Sanitize messages from untrusted sources before injecting into the DOM
        messageDiv.innerHTML = `<strong style="color: ${color};">System:</strong> ${escapeHTML(message)} <small style="color: #8a7a5a; float: right;">${new Date().toLocaleTimeString()}</small>`;
        chatArea.appendChild(messageDiv);
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

// PvP combat result modal
function showPvpResultModal(message, isWinner) {
    // Remove existing modal if any
    const existing = document.getElementById('pvp-result-modal');
    if (existing) existing.remove();

    const repChange = message.repChange || 5;
    const opponent = isWinner ? message.loser : message.winner;
    const myDmg = message.healthDamage ? (isWinner ? message.healthDamage.winner : message.healthDamage.loser) : 0;

    const modal = document.createElement('div');
    modal.id = 'pvp-result-modal';
    modal.className = 'popup-overlay';

    if (isWinner) {
        player.reputation = (player.reputation || 0) + repChange;

        modal.innerHTML = `
            <div class="popup-card popup-success" style="max-width:480px;">
                <h2 class="popup-title popup-title-success" style="margin:0;">VICTORY!</h2>
                <p class="popup-subtitle">You defeated <strong style="color:#8b3a3a;">${escapeHTML(opponent)}</strong></p>
                <div class="popup-section" style="border-color:rgba(138, 154, 106,0.3);">
                    <div style="display:flex;justify-content:space-around;text-align:center;">
                        <div>
                            <div style="color:#8a9a6a;font-size:1.5em;font-weight:bold;">+${repChange}</div>
                            <div class="popup-stat-label">Don Rep</div>
                        </div>
                        ${myDmg ? `<div>
                            <div style="color:#e67e22;font-size:1.5em;font-weight:bold;">-${myDmg}</div>
                            <div class="popup-stat-label">Health</div>
                        </div>` : ''}
                        <div>
                            <div style="color:#c0a040;font-size:1.5em;font-weight:bold;">Winner</div>
                            <div class="popup-stat-label">Bragging Rights</div>
                        </div>
                    </div>
                </div>
                <div class="popup-quote">"Word on the street is you're not someone to mess with."</div>
                <div class="popup-actions">
                    <button onclick="document.getElementById('pvp-result-modal').remove();" class="popup-btn popup-btn-success">Claim Victory</button>
                </div>
            </div>
        `;

        _safeLogAction(`Victory! Defeated ${opponent} and gained ${repChange} Don Rep!${myDmg ? ` (HP -${myDmg})` : ''}`);
    } else {
        const repLoss = Math.min(player.reputation || 0, 3);
        player.reputation = Math.max(0, (player.reputation || 0) - repLoss);

        modal.innerHTML = `
            <div class="popup-card popup-danger" style="max-width:480px;">
                <h2 class="popup-title popup-title-danger" style="margin:0;">DEFEATED</h2>
                <p class="popup-subtitle"><strong style="color:#8a9a6a;">${escapeHTML(opponent)}</strong> came out on top</p>
                <div class="popup-section" style="border-color:rgba(231,76,60,0.3);">
                    <div style="display:flex;justify-content:space-around;text-align:center;">
                        <div>
                            <div style="color:#8b3a3a;font-size:1.5em;font-weight:bold;">-${repLoss}</div>
                            <div class="popup-stat-label">Don Rep</div>
                        </div>
                        ${myDmg ? `<div>
                            <div style="color:#e67e22;font-size:1.5em;font-weight:bold;">-${myDmg}</div>
                            <div class="popup-stat-label">Health</div>
                        </div>` : ''}
                        <div>
                            <div style="color:#8b3a3a;font-size:1.5em;font-weight:bold;">Loss</div>
                            <div class="popup-stat-label">Bruised Ego</div>
                        </div>
                    </div>
                </div>
                <div class="popup-quote">"You'll get them next time. Every Don takes a loss before they rise."</div>
                <div class="popup-actions">
                    <button onclick="document.getElementById('pvp-result-modal').remove();" class="popup-btn popup-btn-danger">Dust Off</button>
                </div>
            </div>
        `;

        _safeLogAction(`Defeated by ${opponent}. Lost ${repLoss} Don Rep.${myDmg ? ` (HP -${myDmg})` : ''}`);
    }

    document.body.appendChild(modal);
    if (typeof updateUI === 'function') updateUI();
}


// Deferred name correction — retries a few times after connect to push the real name to the server
let _nameCorrectionAttempts = 0;
function _scheduleNameCorrection() {
    _nameCorrectionAttempts = 0;
    const interval = setInterval(() => {
        _nameCorrectionAttempts++;
        const realName = player.name && player.name.trim() !== '' ? player.name.trim() : null;
        if (realName && onlineWorldState.isConnected && onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
            // Push corrected name to server
            onlineWorldState.socket.send(JSON.stringify({
                type: 'player_update',
                playerId: onlineWorldState.playerId,
                playerName: realName,
                money: player.money,
                reputation: player.reputation,
                level: player.level || 1,
                territory: player.territory
            }));
            clearInterval(interval);
        } else if (_nameCorrectionAttempts >= 10) {
            clearInterval(interval); // Give up after 10 attempts (10 seconds)
        }
    }, 1000);
}

// Build a safe equipment summary from the local player object for server sync
function getEquipmentSummary() {
    const eq = {};
    if (typeof player === 'undefined') return eq;
    if (player.equippedWeapon && typeof player.equippedWeapon === 'object') {
        eq.weapon = { name: player.equippedWeapon.name || 'Unknown', power: player.equippedWeapon.power || 0 };
    }
    if (player.equippedArmor && typeof player.equippedArmor === 'object') {
        eq.armor = { name: player.equippedArmor.name || 'Unknown', power: player.equippedArmor.power || 0 };
    }
    if (player.equippedVehicle && typeof player.equippedVehicle === 'object') {
        eq.vehicle = { name: player.equippedVehicle.name || 'Unknown', power: player.equippedVehicle.power || 0 };
    }
    return eq;
}

// Sync player state to server
function syncPlayerState() {
    if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        // Ensure we have the saved player name before syncing
        let playerName = ensurePlayerName();
        if (!playerName) {
            playerName = 'Anonymous_' + Math.floor(Math.random() * 1000);
        }
        
        onlineWorldState.socket.send(JSON.stringify({
            type: 'player_update',
            playerId: onlineWorldState.playerId,
            playerName: playerName,
            money: player.money,
            reputation: player.reputation,
            level: player.level || 1,
            territory: player.territory,
            playerState: {
                // Display-sync stats for other players to see
                gangMembers: (player.gang && player.gang.gangMembers ? player.gang.gangMembers : []).length,
                power: typeof calculatePower === 'function' ? calculatePower() : 0
            },
            equipment: getEquipmentSummary()
        }));
    }
}

// Sync jail status to server so other players can see us in jail lists
function syncJailStatus(inJail, jailTime) {
    if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        onlineWorldState.socket.send(JSON.stringify({
            type: 'jail_status_sync',
            playerId: onlineWorldState.playerId,
            inJail: !!inJail,
            jailTime: jailTime || 0
        }));
    }
}

// ==================== GLOBAL CHAT SYSTEM ====================
// Helper to calculate attack power for display — uses unified game.js function
function calculateAttackPower() {
    if (typeof window.calculateTurfAttackPower === 'function') {
        return window.calculateTurfAttackPower();
    }
    // Fallback if game.js hasn't loaded yet
    return ((player.reputation || 0) * 0.3) + 
           ((player.skillTree?.combat?.brawler || 0) * 12) + 
           ((player.power || 0) * 2);
}

// Helper to calculate defense power for display
function calculateDefensePower() {
    const territoryCount = countControlledTerritories();
    return ((player.reputation || 0) * 0.3) + 
           (player.reputation * 0.5) + 
           ((player.power || 0) * 2) + 
           (territoryCount * 15);
}

// Update PVP screen countdown
function updatePVPCountdown() {
    const countdownEl = document.getElementById('income-countdown-pvp') || document.getElementById('income-countdown');
    const controlledCountEl = document.getElementById('controlled-count-pvp') || document.getElementById('controlled-count');
    const weeklyIncomeEl = document.getElementById('weekly-income-total-pvp') || document.getElementById('weekly-income-total');
    
    if (countdownEl) {
        const remaining = territoryIncomeNextCollection - Date.now();
        if (remaining > 0) {
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            countdownEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        } else {
            countdownEl.textContent = 'Collecting...';
        }
    }
    
    if (controlledCountEl) {
        controlledCountEl.textContent = countControlledTerritories();
    }
    
    if (weeklyIncomeEl) {
        weeklyIncomeEl.textContent = `$${calculateMultiplayerTerritoryWeeklyIncome().toLocaleString()}`;
    }
}

// ==================== GLOBAL CHAT & ONLINE WORLD ====================

// World Chat - accessible from level 0, auto-connects if needed
function showWorldChat() {
    // If not connected and not already trying, trigger connection
    if (!onlineWorldState.isConnected && onlineWorldState.connectionStatus !== 'connecting') {
        if (typeof connectToOnlineWorld === 'function') {
            connectToOnlineWorld();
        }
    }
    showGlobalChat();
}

function showGlobalChat() {
    
    // Hide all screens using game.js function, or fallback
    if (typeof hideAllScreens === 'function') {
        hideAllScreens();
    } else {
        // Fallback: hide common screen elements
        const screens = document.querySelectorAll('.game-screen');
        screens.forEach(screen => screen.style.display = 'none');
        const menu = document.getElementById('menu');
        if (menu) menu.style.display = 'none';
        
        // Hide mobile-specific elements
        const mobileMenu = document.querySelector('.mobile-slide-menu');
        if (mobileMenu) mobileMenu.style.display = 'none';
        const mobileActions = document.querySelector('.mobile-quick-actions');
        if (mobileActions) mobileActions.style.display = 'none';
    }
    
    // Ensure multiplayer screen exists
    let multiplayerScreen = document.getElementById('multiplayer-screen');
    if (!multiplayerScreen) {
        // Create the multiplayer screen if it doesn't exist
        multiplayerScreen = document.createElement('div');
        multiplayerScreen.id = 'multiplayer-screen';
        multiplayerScreen.className = 'game-screen';
        multiplayerScreen.style.display = 'none';
        document.getElementById('game').appendChild(multiplayerScreen);
    }
    
    // Ensure multiplayer-content exists inside the screen
    let mpContent = document.getElementById('multiplayer-content');
    if (!mpContent) {
        mpContent = document.createElement('div');
        mpContent.id = 'multiplayer-content';
        multiplayerScreen.appendChild(mpContent);
    }
    
    const activeWcTab = onlineWorldState._worldChatTab || 'world';
    const wcTabStyle = (id) => `padding:10px 18px;border:1px solid ${activeWcTab===id?'#c0a062':'#555'};background:${activeWcTab===id?'rgba(192,160,98,0.15)':'rgba(0,0,0,0.4)'};color:${activeWcTab===id?'#c0a062':'#888'};border-radius:8px 8px 0 0;cursor:pointer;font-family:'Georgia',serif;font-size:0.95em;font-weight:${activeWcTab===id?'bold':'normal'};`;

    let chatHTML = `
        <div class="game-screen" style="display: block;">
            <h2 style="color: #c0a062; font-family: 'Georgia', serif; text-shadow: 2px 2px 4px #000;">World Chat</h2>
            <p style="color: #ccc;">Chat with players from around the world.</p>
            
            <!-- Connection Status -->
            <div id="chat-connection-status" style="background: rgba(0, 0, 0, 0.8); padding: 10px; border-radius: 8px; margin-bottom: 15px; text-align: center; border: 1px solid #c0a062;">
                ${getConnectionStatusHTML()}
            </div>

            <!-- Channel Tabs -->
            <div style="display:flex;gap:4px;margin-bottom:0;flex-wrap:wrap;">
                <button onclick="switchWorldChatTab('world')" style="${wcTabStyle('world')}">World</button>
                <button onclick="switchWorldChatTab('crew')" style="${wcTabStyle('crew')}">Crew</button>
                <button onclick="switchWorldChatTab('alliance')" style="${wcTabStyle('alliance')}">Alliance</button>
                <button onclick="switchWorldChatTab('private')" style="${wcTabStyle('private')}">Private</button>
            </div>
            
            <!-- World Tab (default) -->
            <div id="worldchat-world-tab" style="display:${activeWcTab === 'world' ? 'block' : 'none'};background: rgba(0, 0, 0, 0.9); padding: 20px; border-radius: 0 0 15px 15px; border: 2px solid #c0a062; border-top: none; margin-bottom: 20px; box-shadow: 0 0 15px rgba(192, 160, 98, 0.2);">
                <div id="global-chat-area" style="height: 400px; max-height: 50vh; overflow-y: auto; background: rgba(20, 20, 20, 0.8); padding: 15px; border-radius: 10px; margin-bottom: 15px; border: 1px solid #555;">
                    ${generateChatHTML()}
                </div>
                
                <!-- Chat Input -->
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="chat-input" placeholder="Speak your mind..." 
                           style="flex: 1; padding: 12px; border: 2px solid #c0a062; border-radius: 8px; background: rgba(0, 0, 0, 0.8); color: #c0a062; font-size: 14px; font-family: 'Georgia', serif;"
                           onkeypress="if(event.key==='Enter') sendChatMessage()">
                    <button onclick="sendChatMessage()" 
                            style="padding: 12px 20px; background: linear-gradient(180deg, #c0a062 0%, #8a6e2f 100%); color: #000; border: 1px solid #ffd700; border-radius: 8px; cursor: pointer; font-weight: bold; font-family: 'Georgia', serif; text-transform: uppercase;">
                         Send
                    </button>
                </div>
                
                <!-- Quick Chat Options -->
                <div style="margin-top: 15px;">
                    <h4 style="color: #c0a062; margin-bottom: 10px; font-family: 'Georgia', serif;"> Quick Words</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px;">
                        <button onclick="sendQuickChat('Respect.')" style="padding: 8px; background: #7a8a5a; color: white; border:1px solid #c0a062; border-radius: 6px; cursor: pointer; font-size: 12px;"> Respect.</button>
                        <button onclick="sendQuickChat('Looking for work.')" style="padding: 8px; background: linear-gradient(45deg, #333, #000); color: #c0a062; border: 1px solid #c0a062; border-radius: 6px; cursor: pointer; font-size: 12px; font-family: 'Georgia', serif;"> Looking for work</button>
                        <button onclick="sendQuickChat('Watch your back.')" style="padding: 8px; background: #8b0000; color: white; border:1px solid #c0a062; border-radius: 6px; cursor: pointer; font-size: 12px;"> Watch your back</button>
                        <button onclick="sendQuickChat('Good business.')" style="padding: 8px; background: #c0a040; color: white; border:1px solid #c0a062; border-radius: 6px; cursor: pointer; font-size: 12px;"> Good business</button>
                        <button onclick="sendQuickChat('Anyone need a lawyer?')" style="padding: 8px; background: #8b6a4a; color: white; border:1px solid #c0a062; border-radius: 6px; cursor: pointer; font-size: 12px;"> Need a lawyer?</button>
                        <button onclick="sendQuickChat('My regards to the Don.')" style="padding: 8px; background: #1abc9c; color: white; border:1px solid #c0a062; border-radius: 6px; cursor: pointer; font-size: 12px;"> Regards to the Don</button>
                    </div>
                </div>
            </div>

            <!-- Crew / Alliance / Private Tab Content -->
            <div id="worldchat-channel-tab" style="display:${activeWcTab !== 'world' ? 'block' : 'none'};background:rgba(0,0,0,0.9);border:2px solid #c0a062;border-top:none;border-radius:0 0 15px 15px;padding:20px;margin-bottom:20px;box-shadow:0 0 15px rgba(192,160,98,0.2);">
                <div id="worldchat-channel-content">
                    ${activeWcTab !== 'world' ? renderChatChannelContent(activeWcTab) : ''}
                </div>
            </div>
            
            <!-- Online Players List -->
            <div style="background: rgba(0, 0, 0, 0.8); padding: 15px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #c0a062;">
                <h4 style="color: #c0a062; margin-bottom: 10px; font-family: 'Georgia', serif;"> Made Men Online</h4>
                <div id="chat-player-list" style="max-height: 150px; overflow-y: auto;">
                    ${generateOnlinePlayersHTML()}
                </div>
            </div>
            
            <button onclick="goBackToMainMenu()" style="background: linear-gradient(180deg, #333 0%, #000 100%); color: #c0a062; padding: 15px 30px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-size: 16px; font-weight: bold; font-family: 'Georgia', serif; text-transform: uppercase;">
                 Back to Safehouse
            </button>
        </div>
    `;
    
    mpContent.innerHTML = chatHTML;
    multiplayerScreen.style.display = 'block';
    
    // Show mobile UI elements if on mobile
    if (window.innerWidth <= 768) {
        const mobileActions = document.querySelector('.mobile-quick-actions');
        if (mobileActions) mobileActions.style.display = 'flex';
    }
    
}

// Generate chat HTML
function generateChatHTML() {
    if (!onlineWorldState.globalChat || onlineWorldState.globalChat.length === 0) {
        return '<p style="color: #8a7a5a; text-align: center; padding: 20px;">No messages yet. Be the first to say something!</p>';
    }
    
    return onlineWorldState.globalChat.map(msg => {
        const isDeathAnnouncement = msg.player === 'The Daily Racketeer' && msg.message.includes('EXTRA!');
        const isArrestAnnouncement = msg.player === 'The Daily Racketeer' && msg.message.includes('ARRESTED!');
        if (isArrestAnnouncement) {
            return `
                <div onclick="_showReceivedJailNewspaper()" style="margin: 8px 0; padding: 10px; background: rgba(30, 26, 16, 0.6); border-radius: 2px; border: 1px solid #8b7355; border-left: 3px solid #8b0000; cursor: pointer;">
                    <div style="font-family: var(--font-heading); color: #c0a040; font-size: 1.05em; letter-spacing: 1px;">THE DAILY RACKETEER</div>
                    <div style="color: #f5e6c8; margin: 4px 0;">${escapeHTML(msg.message.replace(/ — Click to read the headlines!/, ''))}</div>
                    <div class="newspaper-chat-link" style="margin-top: 4px;">Click to read the headlines</div>
                    <small style="color: #8a7a5a; float: right;">${msg.time}</small>
                </div>
            `;
        }
        if (isDeathAnnouncement) {
            return `
                <div onclick="_showReceivedDeathNewspaper()" style="margin: 8px 0; padding: 10px; background: rgba(30, 26, 16, 0.6); border-radius: 2px; border: 1px solid #8b7355; border-left: 3px solid #c0a040; cursor: pointer;">
                    <div style="font-family: var(--font-heading); color: #c0a040; font-size: 1.05em; letter-spacing: 1px;">THE DAILY RACKETEER</div>
                    <div style="color: #f5e6c8; margin: 4px 0;">${escapeHTML(msg.message)}</div>
                    <div class="newspaper-chat-link" style="margin-top: 4px;">Click to read the full obituary</div>
                    <small style="color: #8a7a5a; float: right;">${msg.time}</small>
                </div>
            `;
        }
        const safeMsgColor = sanitizeColor(msg.color, '#c0a062');
        return `
            <div style="margin: 8px 0; padding: 8px; background: rgba(20, 18, 10, 0.3); border-radius: 5px; border-left: 3px solid ${safeMsgColor};">
                <strong style="color: ${safeMsgColor};">${escapeHTML(msg.player)}:</strong> ${escapeHTML(msg.message)} 
                <small style="color: #8a7a5a; float: right;">${msg.time}</small>
            </div>
        `;
    }).join('');
}

// Validate color values to prevent style injection
function sanitizeColor(color, fallback) {
    if (!color) return fallback || '#c0a062';
    // Allow hex colors and common CSS named colors only
    if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
    const safeColors = ['red','green','blue','orange','yellow','purple','cyan','white','gold','silver','crimson','tomato'];
    if (safeColors.includes(color.toLowerCase())) return color;
    return fallback || '#c0a062';
}

// Simple HTML escape to prevent XSS in chat messages and other user-generated content
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function (tag) {
        const charsToReplace = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return charsToReplace[tag] || tag;
    });
}

// Send chat message
// Ensure player has a valid name for multiplayer
function ensurePlayerName() {
    // If player doesn't have a name, try to get it from localStorage first
    if (!player.name || player.name.trim() === '') {
        // Try to get name from saved game data
        const savedData = localStorage.getItem('gameState');
        
        if (savedData) {
            try {
                const parsedData = JSON.parse(savedData);
                
                // Check for name in player object (new format)
                if (parsedData.player && parsedData.player.name && parsedData.player.name.trim() !== '') {
                    player.name = parsedData.player.name.trim();
                    return player.name;
                }
                // Fallback to old format for backwards compatibility
                if (parsedData.name && parsedData.name.trim() !== '') {
                    player.name = parsedData.name.trim();
                    return player.name;
                }
            } catch (e) {
                console.warn('Could not parse saved game data for name', e);
            }
        }
        
        // Only prompt if we're actually trying to use chat features
        // Don't prompt during automatic connection
        return null; // Return null to indicate name is not available
    }
    return player.name;
}

// Function to ensure player name for chat (prompts if needed)
async function ensurePlayerNameForChat() {
    // First try the regular ensurePlayerName
    let name = ensurePlayerName();
    if (name) {
        return name;
    }
    
    // If no name available, prompt the user
    let userName = await window.ui.prompt('Enter your criminal name for multiplayer chat:', 'Criminal_' + Math.floor(Math.random() * 1000));
    if (userName && userName.trim() !== '') {
        // Sanitize: strip HTML tags, limit length, remove control characters
        userName = userName.trim()
            .replace(/<[^>]*>/g, '')
            // eslint-disable-next-line no-control-regex
            .replace(/[\x00-\x1F\x7F]/g, '')
            .substring(0, 30);
        if (userName.length === 0) {
            window.ui.toast('Invalid name. Please try again.', 'error');
            return null;
        }
        player.name = userName;
        // Save the name immediately
        if (typeof saveGame === 'function') {
            saveGame();
        }
        return player.name;
    } else {
        // User cancelled or entered empty name
        return null;
    }
}

async function sendChatMessage() {
    // Ensure player has a valid name before sending chat (prompt if needed)
    const playerName = await ensurePlayerNameForChat();
    if (!playerName) {
        // User cancelled name entry
        return;
    }
    
    const chatInput = document.getElementById('chat-input');
    if (!chatInput || !chatInput.value.trim()) return;
    
    const message = chatInput.value.trim();
    chatInput.value = '';
    
    if (onlineWorldState.isConnected && onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        // Send to server with guaranteed name
        onlineWorldState.socket.send(JSON.stringify({
            type: 'global_chat',
            playerId: onlineWorldState.playerId,
            message: message,
            playerName: playerName,
            timestamp: Date.now()
        }));
    } else {
        // Add locally if not connected
        addChatMessage(playerName, message, '#c0a062');
    }
}

// Send quick chat message
async function sendQuickChat(message) {
    // Ensure player has a valid name before sending quick chat (prompt if needed)
    const playerName = await ensurePlayerNameForChat();
    if (!playerName) {
        // User cancelled name entry
        return;
    }
    
    if (onlineWorldState.isConnected && onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        onlineWorldState.socket.send(JSON.stringify({
            type: 'global_chat',
            playerId: onlineWorldState.playerId,
            message: message,
            playerName: playerName,
            timestamp: Date.now()
        }));
    } else {
        addChatMessage(player.name || 'You', message, '#c0a062');
    }
}

// Add chat message locally
function addChatMessage(playerName, message, color = '#f5e6c8') {
    const chatMessage = {
        player: playerName,
        message: message,
        time: new Date().toLocaleTimeString(),
        color: color
    };
    
    onlineWorldState.globalChat.push(chatMessage);
    
    // Keep only last 50 messages
    if (onlineWorldState.globalChat.length > 50) {
        onlineWorldState.globalChat = onlineWorldState.globalChat.slice(-50);
    }
    
    // Update chat area if visible
    const chatArea = document.getElementById('global-chat-area');
    if (chatArea) {
        chatArea.innerHTML = generateChatHTML();
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

// ---- Multi-channel chat system ----

// Switch tabs within the World Chat screen
function switchWorldChatTab(channel) {
    onlineWorldState._worldChatTab = channel;
    onlineWorldState.activeChatChannel = channel;
    const worldTab = document.getElementById('worldchat-world-tab');
    const channelTab = document.getElementById('worldchat-channel-tab');
    const channelContent = document.getElementById('worldchat-channel-content');
    if (channel === 'world') {
        if (worldTab) worldTab.style.display = 'block';
        if (channelTab) channelTab.style.display = 'none';
    } else {
        if (worldTab) worldTab.style.display = 'none';
        if (channelTab) channelTab.style.display = 'block';
        if (channelContent) {
            channelContent.innerHTML = renderChatChannelContent(channel);
            const area = channelContent.querySelector('.channel-messages');
            if (area) area.scrollTop = area.scrollHeight;
        }
    }
    // Update tab button highlights
    const tabContainer = worldTab ? worldTab.parentElement : null;
    if (tabContainer) {
        tabContainer.querySelectorAll('[onclick^="switchWorldChatTab"]').forEach(btn => {
            const id = btn.getAttribute('onclick').match(/'(\w+)'/)?.[1];
            const active = id === channel;
            btn.style.border = `1px solid ${active ? '#c0a062' : '#555'}`;
            btn.style.background = active ? 'rgba(192,160,98,0.15)' : 'rgba(0,0,0,0.4)';
            btn.style.color = active ? '#c0a062' : '#888';
            btn.style.fontWeight = active ? 'bold' : 'normal';
        });
    }
}

function switchChatChannel(channel) {
    onlineWorldState.activeChatChannel = channel;
    const container = document.getElementById('chat-channel-content');
    if (container) {
        container.innerHTML = renderChatChannelContent(channel);
        // Scroll the message area
        const area = container.querySelector('.channel-messages');
        if (area) area.scrollTop = area.scrollHeight;
    }
    // Update tab buttons highlight
    const tabs = container ? container.parentElement.querySelectorAll('[onclick^="switchChatChannel"]') : [];
    tabs.forEach(btn => {
        const id = btn.getAttribute('onclick').match(/'(\w+)'/)?.[1];
        const active = id === channel;
        btn.style.border = `1px solid ${active ? '#c0a062' : '#555'}`;
        btn.style.background = active ? 'rgba(192,160,98,0.2)' : 'rgba(0,0,0,0.4)';
        btn.style.color = active ? '#c0a062' : '#888';
    });
}

function renderChatChannelContent(channel) {
    if (channel === 'world') {
        const msgs = onlineWorldState.globalChat.slice(-30);
        return `
            <h4 style="color:#c0a062;margin:0 0 10px 0;font-family:'Georgia',serif;">The Wire</h4>
            <div class="channel-messages" style="max-height:220px;overflow-y:auto;background:rgba(20,20,20,0.8);padding:10px;border-radius:5px;border:1px solid #444;margin-bottom:10px;">
                ${msgs.length ? msgs.map(m => {
                    const isArrest = m.player === 'The Daily Racketeer' && m.message.includes('ARRESTED!');
                    const isDeath = m.player === 'The Daily Racketeer' && m.message.includes('EXTRA!');
                    if (isArrest) {
                        return `<div class="newspaper-chat-card" onclick="_showReceivedJailNewspaper()" style="margin:8px 0;padding:10px;background:rgba(30,26,16,0.6);border-radius:2px;border:1px solid #8b7355;border-left:3px solid #8b0000;cursor:pointer;"><div style="font-family:var(--font-heading);color:#c0a040;font-size:1.05em;letter-spacing:1px;">THE DAILY RACKETEER</div><div style="color:#f5e6c8;margin:4px 0;">${escapeHTML(m.message.replace(/ — Click to read the headlines!/, ''))}</div><div class="newspaper-chat-link" style="margin-top:4px;">Click to read the headlines</div><small style="color:#8a7a5a;float:right;">${m.time}</small></div>`;
                    }
                    if (isDeath) {
                        return `<div class="newspaper-chat-card" onclick="_showReceivedDeathNewspaper()" style="margin:8px 0;padding:10px;background:rgba(30,26,16,0.6);border-radius:2px;border:1px solid #8b7355;border-left:3px solid #c0a040;cursor:pointer;"><div style="font-family:var(--font-heading);color:#c0a040;font-size:1.05em;letter-spacing:1px;">THE DAILY RACKETEER</div><div style="color:#f5e6c8;margin:4px 0;">${escapeHTML(m.message)}</div><div class="newspaper-chat-link" style="margin-top:4px;">Click to read the full obituary</div><small style="color:#8a7a5a;float:right;">${m.time}</small></div>`;
                    }
                    return `<div style="margin:4px 0;font-size:0.9em;"><strong style="color:${sanitizeColor(m.color,'#c0a062')};">${escapeHTML(m.player)}:</strong> ${escapeHTML(m.message)} <small style="color:#8a7a5a;float:right;">${m.time}</small></div>`;
                }).join('') : '<p style="color:#8a7a5a;text-align:center;">No messages yet.</p>'}
            </div>
            <div style="display:flex;gap:8px;">
                <input type="text" id="channel-chat-input" placeholder="Speak to the family..." maxlength="200"
                       style="flex:1;padding:10px;border-radius:5px;border:1px solid #c0a062;background:#222;color:#c0a062;font-size:1em;"
                       onkeypress="if(event.key==='Enter') sendChannelMessage('world')">
                <button onclick="sendChannelMessage('world')" style="background:#c0a062;color:#000;padding:10px 18px;border:1px solid #c0a062;border-radius:6px;cursor:pointer;font-weight:bold;">Send</button>
            </div>`;
    }

    if (channel === 'crew') {
        const msgs = onlineWorldState.crewChat.slice(-30);
        return `
            <h4 style="color:#3498db;margin:0 0 10px 0;font-family:'Georgia',serif;">Crew Channel</h4>
            <div class="channel-messages" style="max-height:220px;overflow-y:auto;background:rgba(20,20,20,0.8);padding:10px;border-radius:5px;border:1px solid #3498db33;margin-bottom:10px;">
                ${msgs.length ? msgs.map(m => `<div style="margin:4px 0;font-size:0.9em;"><strong style="color:${sanitizeColor(m.color,'#3498db')};">${escapeHTML(m.player)}:</strong> ${escapeHTML(m.message)} <small style="color:#8a7a5a;float:right;">${m.time}</small></div>`).join('') : '<p style="color:#8a7a5a;text-align:center;">No crew messages. Your crew will see messages here.</p>'}
            </div>
            <div style="display:flex;gap:8px;">
                <input type="text" id="channel-chat-input" placeholder="Message your crew..." maxlength="200"
                       style="flex:1;padding:10px;border-radius:5px;border:1px solid #3498db;background:#222;color:#3498db;font-size:1em;"
                       onkeypress="if(event.key==='Enter') sendChannelMessage('crew')">
                <button onclick="sendChannelMessage('crew')" style="background:#3498db;color:#000;padding:10px 18px;border:1px solid #c0a062;border-radius:6px;cursor:pointer;font-weight:bold;">Send</button>
            </div>`;
    }

    if (channel === 'alliance') {
        const msgs = onlineWorldState.allianceChat.slice(-30);
        return `
            <h4 style="color:#9b59b6;margin:0 0 10px 0;font-family:'Georgia',serif;">Alliance Channel</h4>
            <div class="channel-messages" style="max-height:220px;overflow-y:auto;background:rgba(20,20,20,0.8);padding:10px;border-radius:5px;border:1px solid #9b59b633;margin-bottom:10px;">
                ${msgs.length ? msgs.map(m => `<div style="margin:4px 0;font-size:0.9em;"><strong style="color:${sanitizeColor(m.color,'#9b59b6')};">${escapeHTML(m.player)}:</strong> ${escapeHTML(m.message)} <small style="color:#8a7a5a;float:right;">${m.time}</small></div>`).join('') : '<p style="color:#8a7a5a;text-align:center;">No alliance messages. Allied players will see messages here.</p>'}
            </div>
            <div style="display:flex;gap:8px;">
                <input type="text" id="channel-chat-input" placeholder="Message your alliance..." maxlength="200"
                       style="flex:1;padding:10px;border-radius:5px;border:1px solid #9b59b6;background:#222;color:#9b59b6;font-size:1em;"
                       onkeypress="if(event.key==='Enter') sendChannelMessage('alliance')">
                <button onclick="sendChannelMessage('alliance')" style="background:#9b59b6;color:#000;padding:10px 18px;border:1px solid #c0a062;border-radius:6px;cursor:pointer;font-weight:bold;">Send</button>
            </div>`;
    }

    if (channel === 'private') {
        return renderPrivateChatUI();
    }

    return '';
}

function renderPrivateChatUI() {
    const onlinePlayers = (onlineWorldState.nearbyPlayers || []).filter(p => p.name && p.name !== (typeof player !== 'undefined' ? player.name : ''));

    let html = '<h4 style="color:#e67e22;margin:0 0 10px 0;font-family:\'Georgia\',serif;">Private Messages</h4>';

    // New DM dropdown / target selector
    if (onlinePlayers.length > 0) {
        const curTarget = onlineWorldState.activePrivateChatTarget || '';
        html += `<div style="margin-bottom:10px;display:flex;gap:8px;align-items:center;">
            <select id="dm-target-select" style="flex:1;padding:8px;background:#222;color:#e67e22;border:1px solid #e67e22;border-radius:5px;" onchange="setDMTarget(this.value)">
                <option value="">-- Select who to message --</option>
                ${onlinePlayers.map(p => `<option value="${escapeHTML(p.name)}" ${p.name === curTarget ? 'selected' : ''}>${escapeHTML(p.name)} (Lvl ${p.level||'?'})</option>`).join('')}
            </select>
        </div>`;
    }

    // Combined message thread (all DMs in one timeline)
    const msgs = (onlineWorldState.privateChatAll || []).slice(-50);
    html += `
    <div class="channel-messages" style="max-height:220px;overflow-y:auto;background:rgba(20,20,20,0.8);padding:10px;border-radius:5px;border:1px solid #e67e2233;margin-bottom:10px;">
        ${msgs.length ? msgs.map(m => {
            const label = m.player === 'You' && m.toName ? `You -> ${escapeHTML(m.toName)}` : escapeHTML(m.player);
            return `<div style="margin:4px 0;font-size:0.9em;"><strong style="color:${sanitizeColor(m.color,'#e67e22')};">${label}:</strong> ${escapeHTML(m.message)} <small style="color:#8a7a5a;float:right;">${m.time}</small></div>`;
        }).join('') : '<p style="color:#8a7a5a;text-align:center;">No private messages yet. Select a player above to start a conversation.</p>'}
    </div>`;

    // Input area (only if a target is selected)
    const target = onlineWorldState.activePrivateChatTarget;
    if (target) {
        html += `<div style="display:flex;gap:8px;">
            <input type="text" id="channel-chat-input" placeholder="Message ${escapeHTML(target)}..." maxlength="200"
                   style="flex:1;padding:10px;border-radius:5px;border:1px solid #e67e22;background:#222;color:#e67e22;font-size:1em;"
                   onkeypress="if(event.key==='Enter') sendChannelMessage('private')">
            <button onclick="sendChannelMessage('private')" style="background:#e67e22;color:#000;padding:10px 18px;border:1px solid #c0a062;border-radius:6px;cursor:pointer;font-weight:bold;">Send</button>
        </div>`;
    } else {
        html += '<p style="color:#8a7a5a;text-align:center;font-size:0.9em;">Select a player above to send a message.</p>';
    }
    return html;
}

function openPrivateChat(name) {
    onlineWorldState.activePrivateChatTarget = name;
    const container = document.getElementById('chat-channel-content');
    if (container) {
        container.innerHTML = renderPrivateChatUI();
        const area = container.querySelector('.channel-messages');
        if (area) area.scrollTop = area.scrollHeight;
    }
}

function setDMTarget(name) {
    onlineWorldState.activePrivateChatTarget = name || null;
    const container = document.getElementById('chat-channel-content');
    if (container) {
        container.innerHTML = renderPrivateChatUI();
        const area = container.querySelector('.channel-messages');
        if (area) area.scrollTop = area.scrollHeight;
    }
}

function startNewDM() {
    const sel = document.getElementById('dm-target-select');
    if (!sel || !sel.value) return;
    onlineWorldState.activePrivateChatTarget = sel.value;
    if (!onlineWorldState.privateChats[sel.value]) onlineWorldState.privateChats[sel.value] = [];
    openPrivateChat(sel.value);
}

async function sendChannelMessage(channel) {
    const playerName = await ensurePlayerNameForChat();
    if (!playerName) return;

    const input = document.getElementById('channel-chat-input');
    if (!input || !input.value.trim()) return;
    const msg = input.value.trim();
    input.value = '';

    if (!onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) {
        window.ui.toast('Not connected to the server!', 'error');
        return;
    }

    if (channel === 'world') {
        onlineWorldState.socket.send(JSON.stringify({ type: 'global_chat', playerId: onlineWorldState.playerId, message: msg, playerName: playerName, timestamp: Date.now() }));
    } else if (channel === 'crew') {
        onlineWorldState.socket.send(JSON.stringify({ type: 'crew_chat', message: msg, timestamp: Date.now() }));
    } else if (channel === 'alliance') {
        onlineWorldState.socket.send(JSON.stringify({ type: 'alliance_chat', message: msg, timestamp: Date.now() }));
    } else if (channel === 'private') {
        const target = onlineWorldState.activePrivateChatTarget;
        if (!target) { window.ui.toast('Select a player to message first!', 'error'); return; }
        onlineWorldState.socket.send(JSON.stringify({ type: 'private_chat', targetName: target, message: msg, timestamp: Date.now() }));
    }
}

function updateChannelChatDisplay(channel) {
    // Only update if the active channel matches
    if (onlineWorldState.activeChatChannel !== channel) return;
    // Update Commission chat panel
    const container = document.getElementById('chat-channel-content');
    if (container) {
        container.innerHTML = renderChatChannelContent(channel);
        const area = container.querySelector('.channel-messages');
        if (area) area.scrollTop = area.scrollHeight;
    }
    // Also update World Chat's channel panel
    const wcContainer = document.getElementById('worldchat-channel-content');
    if (wcContainer) {
        wcContainer.innerHTML = renderChatChannelContent(channel);
        const area = wcContainer.querySelector('.channel-messages');
        if (area) area.scrollTop = area.scrollHeight;
    }
}

// Get connection status HTML for chat
function getConnectionStatusHTML() {
    const status = onlineWorldState.connectionStatus;
    if (onlineWorldState.isConnected || status === 'connected') {
        const count = onlineWorldState.serverInfo.playerCount || 0;
        return `<span style="color: #8a9a6a; font-family: 'Georgia', serif;">Connected to World Chat ◆ ${count} player${count !== 1 ? 's' : ''} online</span>`;
    } else if (status === 'demo' || status === 'offline') {
        return '<span style="color: #8b3a3a; font-family: \'Georgia\', serif;">Server offline ◆ retrying automatically...</span>';
    } else if (status === 'error') {
        return '<span style="color: #8b3a3a; font-family: \'Georgia\', serif;">Server unavailable ◆ retrying...</span>';
    } else {
        return '<span style="color: #c0a040; font-family: \'Georgia\', serif;">Connecting to World Chat...</span>';
    }
}

// Generate online players HTML for chat
function generateOnlinePlayersHTML() {
    if (!onlineWorldState.nearbyPlayers || onlineWorldState.nearbyPlayers.length === 0) {
        return '<p style="color: #8a7a5a; text-align: center;">Loading players...</p>';
    }
    
    return onlineWorldState.nearbyPlayers.map(p => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; margin: 2px 0; background: rgba(20, 18, 10, 0.3); border-radius: 5px;">
            <span style="color: ${sanitizeColor(p.color, '#c0a062')};"> ${escapeHTML(p.name)}</span>
            <span style="color: #8a7a5a; font-size: 12px;">Level ${p.level}</span>
        </div>
    `).join('');
}

// Show online world hub (replaces old multiplayer menu)
function showOnlineWorld(activeTab) {
    // Sync multiplayer territories to player object
    syncMultiplayerTerritoriesToPlayer();
    
    const tab = activeTab || 'overview';
    
    const tabStyle = (id) => `
        background: ${tab === id ? '#c0a062' : '#222'};
        color: ${tab === id ? '#000' : '#c0a062'};
        padding: 10px 18px; border: 1px solid #c0a062; border-bottom: ${tab === id ? 'none' : '1px solid #c0a062'};
        border-radius: 8px 8px 0 0; cursor: pointer; font-family: 'Georgia', serif;
        font-weight: ${tab === id ? 'bold' : 'normal'}; font-size: 0.95em;
    `;
    
    const hasFriendBadge = window._pendingFriendRequests && window._pendingFriendRequests.length > 0;
    const hasCrewBadge = !!window._pendingCrewInvite;
    const badgeDot = '<span style="display:inline-block;width:8px;height:8px;background:#e74c3c;border-radius:50%;margin-left:6px;vertical-align:middle;"></span>';
    
    // -- Tab bar --
    let worldHTML = `
        <h2 style="color: #c0a062; font-family: 'Georgia', serif; text-shadow: 2px 2px 4px #000; margin-bottom: 5px;">The Commission</h2>
        <p style="color: #ccc; margin: 0 0 15px 0;">The family's HQ — all multiplayer activities under one roof.</p>
        
        <!-- Connection Status -->
        <div id="world-connection-status" style="background: rgba(0, 0, 0, 0.8); padding: 10px 15px; border-radius: 10px; margin-bottom: 15px; border: 1px solid #c0a062;"></div>
        
        <!-- Tab Navigation -->
        <div style="display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 0; border-bottom: 2px solid #c0a062; padding-bottom: 0;">
            <button onclick="showOnlineWorld('overview')" style="${tabStyle('overview')}">Overview</button>
            <button onclick="showOnlineWorld('territories')" style="${tabStyle('territories')}">Territories</button>
            <button onclick="showOnlineWorld('politics')" style="${tabStyle('politics')}">Politics</button>
            <button onclick="showOnlineWorld('activities')" style="${tabStyle('activities')}">Activities</button>
            <button onclick="showOnlineWorld('crew')" style="${tabStyle('crew')}">Crew${hasCrewBadge ? badgeDot : ''}</button>
            <button onclick="showOnlineWorld('friends')" style="${tabStyle('friends')}">Friends${hasFriendBadge ? badgeDot : ''}</button>
            <button onclick="showOnlineWorld('chat')" style="${tabStyle('chat')}">Chat</button>
        </div>
        
        <!-- Tab Content -->
        <div style="background: rgba(0,0,0,0.8); border: 1px solid #c0a062; border-top: none; border-radius: 0 0 10px 10px; padding: 20px; min-height: 300px;">
    `;
    
    // -- OVERVIEW TAB --
    if (tab === 'overview') {
        // Top Don banner on overview
        const pol = onlineWorldState.politics;
        const topDonBanner = pol && pol.topDonName
            ? `<div style="background: linear-gradient(90deg, rgba(255,215,0,0.1) 0%, rgba(0,0,0,0.6) 50%, rgba(255,215,0,0.1) 100%); padding: 10px 15px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #ffd700; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer;" onclick="showOnlineWorld('politics')">
                    <span style="color: #ffd700; font-weight: bold; font-family: 'Georgia', serif;">Top Don: ${escapeHTML(pol.topDonName)}</span>
                    ${pol.isAlliance ? `<span style="color: #c0a062;">[${escapeHTML(pol.allianceTag)}]</span>` : ''}
                    <span style="color: #888; font-size: 0.85em;">| ${pol.territoryCount} territories</span>
                </div>`
            : '';

        worldHTML += `
            ${topDonBanner}
            <!-- Territory Income Timer -->
            <div id="territory-income-timer" style="background: rgba(122, 138, 90, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 2px solid #7a8a5a; text-align: center;">
                <div style="color: #7a8a5a; font-weight: bold; font-size: 1.1em;">Next Territory Income</div>
                <div id="income-countdown" style="color: #ccc; margin-top: 5px; font-family: monospace; font-size: 1.3em;">Calculating...</div>
                <div style="color: #888; font-size: 0.85em; margin-top: 5px;">Controlled Territories: <span id="controlled-count" style="color: #7a8a5a; font-weight: bold;">0</span> | Weekly Income: <span id="weekly-income-total" style="color: #7a8a5a; font-weight: bold;">$0</span></div>
            </div>
            
            <!-- Online Players & Jail Status -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 15px 0;">
                <div style="background: rgba(0, 0, 0, 0.6); padding: 20px; border-radius: 15px; border: 2px solid #c0a062;">
                    <div id="online-player-list">
                        <h4 style="color: #c0a062; margin: 0 0 15px 0; font-family: 'Georgia', serif;">Made Men Online</h4>
                        <div style="color: #8a7a5a; font-style: italic; text-align: center;">Loading associates...</div>
                    </div>
                </div>
                <div style="background: rgba(0, 0, 0, 0.6); padding: 20px; border-radius: 15px; border: 2px solid #8b0000;">
                    <div id="online-jail-status">
                        <h4 style="color: #8b0000; margin: 0 0 15px 0; font-family: 'Georgia', serif;">In The Can</h4>
                        <div style="color: #8a7a5a; font-style: italic; text-align: center;">Checking prison records...</div>
                    </div>
                </div>
            </div>
            
            <!-- Global Leaderboard -->
            <div style="background: rgba(0, 0, 0, 0.6); padding: 20px; border-radius: 15px; border: 2px solid #c0a062; margin-top: 15px;">
                <h3 style="color: #c0a062; text-align: center; margin-bottom: 15px; font-family: 'Georgia', serif;">The Bosses</h3>
                <div id="global-leaderboard">
                    <div style="color: #8a7a5a; text-align: center; font-style: italic;">Loading rankings...</div>
                </div>
            </div>
        `;
    }
    
    // -- PVP TAB --
    if (tab === 'pvp') {
        worldHTML += `
            <h3 style="color: #8b0000; text-align: center; font-family: 'Georgia', serif; margin-top: 0;">Player vs Player</h3>
            <p style="color: #ccc; text-align: center; margin: 0 0 20px 0;">Prove your worth. Crush your rivals. Take what's theirs.</p>
            
            <!-- PVP Actions Grid -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 20px 0;">
                
                <!-- Whack Rival Don -->
                <div style="background: linear-gradient(180deg, rgba(192, 160, 98, 0.2) 0%, rgba(0, 0, 0, 0.8) 100%); padding: 25px; border-radius: 15px; border: 2px solid #c0a062; cursor: pointer; transition: transform 0.2s;" onclick="showWhackRivalDon()" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                    <div style="text-align: center;">
                        <div style="font-size: 3.5em; margin-bottom: 10px;"></div>
                        <h3 style="color: #c0a062; margin: 0 0 8px 0; font-family: 'Georgia', serif; font-size: 1.3em;">Whack Rival Don</h3>
                        <p style="color: #ccc; margin: 0 0 12px 0; font-size: 0.9em;">Casual PvP brawl for bragging rights</p>
                        <div style="background: rgba(0, 0, 0, 0.6); padding: 10px; border-radius: 8px;">
                            <div style="color: #ccc; font-size: 0.8em; line-height: 1.6;">
                                Win/lose Don Rep<br>
                                Both take health damage
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Territory Conquest -->
                <div style="background: linear-gradient(180deg, rgba(243, 156, 18, 0.2) 0%, rgba(0, 0, 0, 0.8) 100%); padding: 25px; border-radius: 15px; border: 2px solid #c0a040; cursor: pointer; transition: transform 0.2s;" onclick="showOnlineWorld('territories')" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                    <div style="text-align: center;">
                        <div style="font-size: 3.5em; margin-bottom: 10px;"></div>
                        <h3 style="color: #c0a040; margin: 0 0 8px 0; font-family: 'Georgia', serif; font-size: 1.3em;">Territory Conquest</h3>
                        <p style="color: #f9ca7e; margin: 0 0 12px 0; font-size: 0.9em;">Conquer districts for weekly income</p>
                        <div style="background: rgba(0, 0, 0, 0.6); padding: 10px; border-radius: 8px;">
                            <div style="color: #ccc; font-size: 0.8em; line-height: 1.6;">
                                Assign gang/cars/weapons<br>
                                Weekly dirty money income<br>
                                Risk: Lose assigned resources
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Assassination Contract -->
                <div style="background: linear-gradient(180deg, rgba(75, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0.9) 100%); padding: 25px; border-radius: 15px; border: 2px solid #ff4444; cursor: pointer; transition: transform 0.2s;" onclick="showAssassination()" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                    <div style="text-align: center;">
                        <div style="font-size: 3.5em; margin-bottom: 10px;"></div>
                        <h3 style="color: #ff4444; margin: 0 0 8px 0; font-family: 'Georgia', serif; font-size: 1.3em;">Assassination</h3>
                        <p style="color: #ff8888; margin: 0 0 12px 0; font-size: 0.9em;">High-risk hit — steal their cash</p>
                        <div style="background: rgba(0, 0, 0, 0.6); padding: 10px; border-radius: 8px;">
                            <div style="color: #ccc; font-size: 0.8em; line-height: 1.6;">
                                Requires guns, bullets & vehicle<br>
                                Steal 8-20% of target's cash<br>
                                Risk: Arrest on failure
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- PVP Stats -->
            <div style="background: rgba(139, 58, 58, 0.15); padding: 20px; border-radius: 10px; margin: 20px 0; border: 2px solid #8b3a3a;">
                <h3 style="color: #c0a062; margin: 0 0 15px 0; font-family: 'Georgia', serif; text-align: center;">Your Combat Strength</h3>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; text-align: center;">
                    <div>
                        <div style="color: #888; font-size: 0.85em;">Your Attack</div>
                        <div style="color: #fff; font-weight: bold; font-size: 1.3em;">${calculateAttackPower()}</div>
                    </div>
                    <div>
                        <div style="color: #888; font-size: 0.85em;">Your Defense</div>
                        <div style="color: #fff; font-weight: bold; font-size: 1.3em;">${calculateDefensePower()}</div>
                    </div>
                    <div>
                        <div style="color: #888; font-size: 0.85em;">Territories</div>
                        <div style="color: #7a8a5a; font-weight: bold; font-size: 1.3em;">${countControlledTerritories()}</div>
                    </div>
                    <div>
                        <div style="color: #888; font-size: 0.85em;">Gang Members</div>
                        <div style="color: #c0a062; font-weight: bold; font-size: 1.3em;">${(player.gang && player.gang.members) || 0}</div>
                    </div>
                </div>
                <p style="color: #aaa; text-align: center; margin: 10px 0 0 0; font-size: 0.75em;">Your Attack must match or exceed a territory's Defense to wage war.</p>
            </div>
        `;
    }
    
    // -- TERRITORIES TAB --
    if (tab === 'territories') {
        // Use DISTRICTS from territories.js (exposed on window by game.js)
        const districts = window.DISTRICTS || [];
        const terrState = onlineWorldState.territories || {};
        const playerTerritory = player.currentTerritory;
        
        worldHTML += `
            <!-- Territory Income Timer -->
            <div id="territory-income-timer" style="background: rgba(122, 138, 90, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 15px; border: 2px solid #7a8a5a; text-align: center;">
                <div style="color: #7a8a5a; font-weight: bold; font-size: 1.1em;">Next Territory Income</div>
                <div id="income-countdown" style="color: #ccc; margin-top: 5px; font-family: monospace; font-size: 1.3em;">Calculating...</div>
                <div style="color: #888; font-size: 0.85em; margin-top: 5px;">Your Territory: <span style="color: #c0a062; font-weight: bold;">${playerTerritory ? (districts.find(d => d.id === playerTerritory)?.shortName || playerTerritory) : 'None'}</span> | Tax Rate: <span style="color: #8b3a3a; font-weight: bold;">10%</span></div>
            </div>
            
            <h3 style="color: #c0a040; text-align: center; margin-bottom: 5px; font-family: 'Georgia', serif;">Territories</h3>
            <p style="color: #aaa; text-align: center; margin: 0 0 15px 0; font-size: 0.85em;">Multiplayer territories — where players live, pay tax, and fight for ownership.</p>
            
            <div style="display: grid; gap: 12px;">
                ${districts.map((d, idx) => {
                    const tData = terrState[d.id] || { owner: null, residents: [], defenseRating: 100, taxCollected: 0 };
                    const isHome = playerTerritory === d.id;
                    const isOwned = tData.owner === player.name;
                    const isNPC = (window.NPC_OWNER_NAMES || new Set()).has(tData.owner);
                    const borderColor = isOwned ? '#7a8a5a' : isHome ? '#c0a062' : tData.owner ? (isNPC ? '#8b4513' : '#e67e22') : '#555';
                    const residentCount = (tData.residents || []).length;
                    
                    return `
                        <div style="background: rgba(20, 20, 20, 0.8); padding: 15px; border-radius: 10px; border: 2px solid ${borderColor};">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 15px; flex-wrap: wrap;">
                                <div style="flex: 1; min-width: 200px;">
                                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                        <span style="font-size: 1.5em;">${d.icon}</span>
                                        <strong style="color: #c0a062; font-size: 1.15em; font-family: 'Georgia', serif;">${escapeHTML(d.shortName)}</strong>
                                        ${isHome ? '<span style="background: #c0a062; color: #000; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; font-weight: bold;">HOME</span>' : ''}
                                        ${isOwned ? '<span style="background: #7a8a5a; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; font-weight: bold;">YOURS</span>' : ''}
                                    </div>
                                    <p style="color: #999; margin: 0 0 8px 0; font-size: 0.85em;">${escapeHTML(d.description)}</p>
                                    <div style="font-size: 0.85em; color: #ccc; line-height: 1.8;">
                                        <div>Owner: <span style="color: ${tData.owner ? (isNPC ? '#8b4513' : '#7a8a5a') : '#666'};">${isNPC ? '' : ''}${escapeHTML(tData.owner || 'Unclaimed')}</span>${isNPC ? ' <span style="background: #8b4513; color: #fff; padding: 1px 6px; border-radius: 3px; font-size: 0.75em;">RIVAL BOSS</span>' : ''}</div>
                                        <div>Residents: <span style="color: #c0a062;">${residentCount}</span> | Their Defense: <span style="color: #8b3a3a;">${tData.defenseRating}</span></div>
                                        <div>Tax Collected: <span style="color: #7a8a5a;">$${(tData.taxCollected || 0).toLocaleString()}</span> | Move Cost: <span style="color: #c0a040;">$${d.moveCost.toLocaleString()}</span></div>
                                    </div>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 6px; min-width: 120px;">
                                    ${!isHome ? '<button onclick="showTerritoryRelocation()" style="background: #c0a040; color: #000; padding: 8px 12px; border:1px solid #c0a062; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 0.85em;">Relocate</button>' : ''}
                                    ${!isOwned ? `<button onclick="wageWar('${d.id}')" style="background: linear-gradient(180deg, #8b0000, #5a0000); color: #fff; padding: 8px 12px; border: 1px solid #ff0000; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 0.85em;">Wage War</button>` : ''}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            
            <div style="background: rgba(192, 160, 98, 0.1); padding: 12px; border-radius: 8px; margin-top: 15px; border: 1px solid #c0a062;">
                <p style="color: #ccc; margin: 0; font-size: 0.85em; line-height: 1.6;"><strong style="color: #c0a062;">How Territories Work:</strong> Every territory is controlled by a rival NPC boss. Challenge them to seize control! Wars require 5+ gang members. The owner collects 10% tax on all resident income. Relocating costs money and has a 1-hour cooldown.</p>
            </div>
        `;
    }
    
    // -- ACTIVITIES TAB --
    if (tab === 'activities') {
        worldHTML += `
            <h3 style="color: #c0a062; text-align: center; margin: 0 0 20px 0; font-family: 'Georgia', serif;">Family Business</h3>

            <!-- PVP Section -->
            <h4 style="color: #ff4444; margin: 0 0 10px 0; font-family: 'Georgia', serif; border-bottom: 1px solid #8b3a3a; padding-bottom: 6px;">PVP</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px;">
                <button onclick="showWhackRivalDon()" style="background: linear-gradient(180deg, rgba(192,160,98,0.2) 0%, #1a1a1a 100%); color: #c0a062; padding: 15px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif; font-weight: bold;">
                    Whack Rival Don<br><small style="color: #ccc;">Casual PvP for Don Rep</small>
                </button>
                <button onclick="showAssassination()" style="background: linear-gradient(180deg, #4b0000 0%, #1a0000 100%); color: #ff4444; padding: 15px; border: 1px solid #ff4444; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif; font-weight: bold;">
                    Assassination<br><small style="color: #ff8888;">Hunt rivals for their cash</small>
                </button>
                <button onclick="showBountyBoard()" style="background: linear-gradient(180deg, #4a2600 0%, #1a0a00 100%); color: #ff6600; padding: 15px; border: 1px solid #ff6600; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif;">
                    Bounty Board<br><small style="color: #ffaa66;">Put a price on heads</small>
                </button>
                <button onclick="showRankedSeason()" style="background: linear-gradient(180deg, #1a1a3a 0%, #0a0a1a 100%); color: #ffd700; padding: 15px; border: 1px solid #ffd700; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif;">
                    Ranked Season<br><small style="color: #ffe066;">Combat rating</small>
                </button>
            </div>

            <!-- Co-op Section -->
            <h4 style="color: #27ae60; margin: 0 0 10px 0; font-family: 'Georgia', serif; border-bottom: 1px solid #1e7a46; padding-bottom: 6px;">Co-op</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px;">
                <button onclick="showActiveHeists()" style="background: linear-gradient(180deg, rgba(139,0,0,0.3) 0%, #1a0000 100%); color: #8b0000; padding: 15px; border: 1px solid #8b0000; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif; font-weight: bold;">
                    Big Scores<br><small style="color: #ccc;">Join crew heists</small>
                </button>
                <button onclick="showMissions(); setTimeout(() => { const btn = document.getElementById('ops-tab-superboss'); if (btn) switchOpsTab('superboss', btn); }, 50);" style="background: linear-gradient(180deg, rgba(231,76,60,0.2) 0%, #1a0a0a 100%); color: #e74c3c; padding: 15px; border: 1px solid #e74c3c; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif; font-weight: bold;">
                    Superboss<br><small style="color: #ff8888;">Fight legendary crime lords</small>
                </button>
                <button onclick="showNearbyPlayers()" style="background: #222; color: #c0a040; padding: 15px; border: 1px solid #c0a040; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif;">
                    Local Crew<br><small style="color: #ccc;">Players in your area</small>
                </button>
                <button onclick="showAlliancePanel()" style="background: #222; color: #c0a062; padding: 15px; border: 2px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif;">
                    Alliances<br><small style="color: #ccc;">Form a crew</small>
                </button>
            </div>

            <!-- Market & Social -->
            <h4 style="color: #c0a062; margin: 0 0 10px 0; font-family: 'Georgia', serif; border-bottom: 1px solid #555; padding-bottom: 6px;">Market & Social</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                <button onclick="showOnlineWorld('market')" style="background: linear-gradient(180deg, rgba(192,160,98,0.15) 0%, #1a1a1a 100%); color: #c0a062; padding: 15px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif; font-weight: bold;">
                    Black Market<br><small style="color: #ccc;">Buy and sell goods</small>
                </button>
                <button onclick="showGlobalChat()" style="background: #222; color: #c0a062; padding: 15px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif;">
                    The Wire<br><small style="color: #ccc;">Talk with the family</small>
                </button>
            </div>
        `;
    }
    
    // -- POLITICS TAB --
    if (tab === 'politics') {
        worldHTML += renderPoliticsTab();
    }

    // -- CREW TAB --
    if (tab === 'crew') {
        worldHTML += '<div id="crew-content"><p style="color:#8a7a5a;">Loading crew data...</p></div>';
    }

    // -- FRIENDS TAB --
    if (tab === 'friends') {
        worldHTML += '<div id="friends-tab-content"><p style="color:#8a7a5a;">Loading friends...</p></div>';
    }

    // -- MARKETPLACE TAB --
    if (tab === 'market') {
        worldHTML += renderMarketplaceTab();
    }
    
    // -- CHAT TAB --
    if (tab === 'chat') {
        const ch = onlineWorldState.activeChatChannel || 'world';
        const tabBtnStyle = (id) => `padding:8px 16px;border:1px solid ${ch===id?'#c0a062':'#555'};background:${ch===id?'rgba(192,160,98,0.2)':'rgba(0,0,0,0.4)'};color:${ch===id?'#c0a062':'#888'};border-radius:6px 6px 0 0;cursor:pointer;font-family:'Georgia',serif;font-size:0.9em;`;

        worldHTML += `
            <!-- Chat Channel Tabs -->
            <div style="display:flex;gap:4px;margin-bottom:0;flex-wrap:wrap;">
                <button onclick="switchChatChannel('world')" style="${tabBtnStyle('world')}">World</button>
                <button onclick="switchChatChannel('crew')" style="${tabBtnStyle('crew')}">Crew</button>
                <button onclick="switchChatChannel('alliance')" style="${tabBtnStyle('alliance')}">Alliance</button>
                <button onclick="switchChatChannel('private')" style="${tabBtnStyle('private')}">Private</button>
            </div>

            <div id="chat-channel-content" style="background:rgba(0,0,0,0.6);border:1px solid #555;border-top:none;border-radius:0 0 8px 8px;padding:15px;margin-bottom:20px;">
                ${renderChatChannelContent(ch)}
            </div>

            <!-- Street Activity -->
            <h3 style="color: #ccc; font-family: 'Georgia', serif;">Street Activity</h3>
            <div id="world-activity-feed" style="height: 250px; overflow-y: auto; background: rgba(20, 20, 20, 0.8); padding: 12px; border-radius: 5px; border: 1px solid #555;">
                <div style="color: #8a7a5a; font-style: italic;">Loading activity...</div>
            </div>
        `;
    }
    
    // -- Close tab content + back button --
    worldHTML += `
        </div>
        <div style="text-align: center; margin-top: 25px;">
            <button onclick="goBackToMainMenu()" 
                    style="background: linear-gradient(180deg, #333 0%, #000 100%); color: #c0a062; padding: 15px 30px; 
                           border: 1px solid #c0a062; border-radius: 10px; font-size: 1.1em; font-weight: bold; cursor: pointer; font-family: 'Georgia', serif;">
                Back to Safehouse
            </button>
        </div>
    `;
    
    const mpContent = document.getElementById('multiplayer-content');
    if (!mpContent) {
        console.warn('multiplayer-content element not found — skipping showOnlineWorld render');
        return;
    }
    mpContent.innerHTML = worldHTML;
    hideAllScreens();
    const mpScreen = document.getElementById('multiplayer-screen');
    if (mpScreen) mpScreen.style.display = 'block';
    
    // Update dynamic content
    updateConnectionStatus();
    if (tab === 'overview') {
        loadGlobalLeaderboard();
        updateJailVisibility();
        updateOnlinePlayerList();
    }
    if (tab === 'territories' || tab === 'overview') {
        // Start territory income countdown
        updatePVPCountdown();
        if (window.pvpCountdownInterval) clearInterval(window.pvpCountdownInterval);
        window.pvpCountdownInterval = setInterval(updatePVPCountdown, 1000);
    }
    if (tab === 'chat') {
        loadWorldActivityFeed();
    }
    if (tab === 'market') {
        requestMarketListings();
    }
    if (tab === 'crew') {
        sendMP({ type: 'crew_info' });
    }
    if (tab === 'friends') {
        renderFriendsTabContent();
        sendMP({ type: 'get_friends_list' });
    }

    
    // Request updated world state from server
    if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        onlineWorldState.socket.send(JSON.stringify({
            type: 'request_world_state'
        }));
    }
}

// ==================== UNIFIED PLAYER MARKET ====================
// Player-to-player trading of vehicles, weapons, armor, ammo, gas, utility, drugs

// In-memory cache of all market listings
let playerMarketListings = [];

function renderMarketplaceTab() {
    const myId = onlineWorldState.playerId;
    const myListings = playerMarketListings.filter(l => l.sellerId === myId);
    const otherListings = playerMarketListings.filter(l => l.sellerId !== myId);
    const playerCars = (typeof player !== 'undefined' && player.stolenCars) ? player.stolenCars : [];
    const playerInv = (typeof player !== 'undefined' && player.inventory) ? player.inventory : [];
    const playerAmmo = (typeof player !== 'undefined') ? (player.ammo || 0) : 0;
    const playerGas = (typeof player !== 'undefined') ? (player.gas || 0) : 0;

    // Category icons & colors
    const catMeta = {
        vehicle: { icon: '\ud83d\ude97', label: 'Vehicle', color: '#3498db' },
        weapon: { icon: '\u2694\ufe0f', label: 'Weapon', color: '#e74c3c' },
        armor: { icon: '\ud83d\udee1\ufe0f', label: 'Armor', color: '#9b59b6' },
        ammo: { icon: '\ud83d\udd2b', label: 'Bullets', color: '#e67e22' },
        gas: { icon: '\u26fd', label: 'Gasoline', color: '#f39c12' },
        utility: { icon: '\ud83d\udee0\ufe0f', label: 'Utility', color: '#1abc9c' },
        drug: { icon: '\ud83d\udcb0', label: 'Trade Goods', color: '#8e44ad' }
    };

    let html = `
        <h3 style="color: #a08850; text-align: center; font-family: 'Georgia', serif; margin-top: 0;">Player Market</h3>
        <p style="color: #ccc; text-align: center; margin: 0 0 20px 0;">Trade vehicles, weapons, armor, ammo, gas, utility items, and goods with other players. All sales are final.</p>
    `;

    // ==================== LIST ITEMS FOR SALE ====================
    html += `<div style="background: rgba(41, 128, 185, 0.12); padding: 15px; border-radius: 12px; border: 1px solid #a08850; margin-bottom: 20px;">
        <h4 style="color: #a08850; margin: 0 0 12px 0;">List Items for Sale</h4>`;

    // --- Vehicles ---
    if (playerCars.length > 0) {
        html += '<h5 style="color: #3498db; margin: 10px 0 6px;">Vehicles</h5><div style="display: grid; gap: 6px;">';
        playerCars.forEach((car, idx) => {
            const cond = 100 - car.damagePercentage;
            const condColor = car.damagePercentage < 30 ? '#8a9a6a' : car.damagePercentage < 60 ? '#c0a040' : '#8b3a3a';
            const suggested = Math.floor(car.baseValue * (cond / 100) * 0.8);
            const listed = myListings.some(l => l.category === 'vehicle' && l.itemName === car.name);
            html += `<div style="padding: 8px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px solid #1a1610; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                <div><strong style="color: #f5e6c8;">\ud83d\ude97 ${car.name}</strong><br><small style="color: #d4c4a0;">Base: $${car.baseValue.toLocaleString()} | <span style="color: ${condColor};">${car.damagePercentage}% dmg</span></small></div>
                <div style="display: flex; gap: 6px; align-items: center;">${listed ? '<span style="color: #c0a040; font-size: 0.85em;">Listed</span>' : `
                    <input type="number" id="mkt-veh-${idx}" value="${suggested}" min="100" max="${car.baseValue * 3}" style="width: 90px; padding: 5px; border-radius: 5px; border: 1px solid #c0a062; background: #222; color: #f5e6c8; font-size: 0.85em;">
                    <button onclick="listItemForSale('vehicle', ${idx}, document.getElementById('mkt-veh-${idx}').value)" style="background: #a08850; color: #fff; border:1px solid #c0a062; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">List</button>`}
                </div>
            </div>`;
        });
        html += '</div>';
    }

    // --- Inventory items (weapons, armor, utility, drugs) ---
    const sellableTypes = [
        { type: 'weapon', cat: 'weapon' },
        { type: 'armor', cat: 'armor' },
        { type: 'utility', cat: 'utility' },
        { type: 'highLevelDrug', cat: 'drug' },
        { type: 'vehicle', cat: 'vehicle' }
    ];
    const sellableItems = playerInv.filter(i => sellableTypes.some(st => st.type === i.type));
    if (sellableItems.length > 0) {
        html += '<h5 style="color: #e74c3c; margin: 12px 0 6px;">Inventory Items</h5><div style="display: grid; gap: 6px;">';
        playerInv.forEach((item, idx) => {
            const st = sellableTypes.find(s => s.type === item.type);
            if (!st) return;
            // Skip damaged weapons/armor
            if ((item.type === 'weapon' || item.type === 'armor') && typeof item.durability === 'number' && typeof item.maxDurability === 'number' && item.durability < item.maxDurability) return;
            const meta = catMeta[st.cat] || catMeta.utility;
            const suggested = Math.floor((item.price || 10000) * 0.7);
            const isEquipped = (player.equippedWeapon === item || player.equippedArmor === item || player.equippedVehicle === item);
            html += `<div style="padding: 8px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px solid #1a1610; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                <div><strong style="color: #f5e6c8;">${meta.icon} ${item.name}</strong>${isEquipped ? ' <span style="color:#c0a040; font-size:0.8em;">(Equipped)</span>' : ''}
                <br><small style="color: #d4c4a0;">${meta.label}${item.power ? ' | +' + item.power + ' power' : ''}${item.durability !== undefined ? ' | ' + item.durability + '/' + item.maxDurability + ' dur' : ''}</small></div>
                <div style="display: flex; gap: 6px; align-items: center;">
                    <input type="number" id="mkt-inv-${idx}" value="${suggested}" min="100" max="5000000" style="width: 90px; padding: 5px; border-radius: 5px; border: 1px solid #c0a062; background: #222; color: #f5e6c8; font-size: 0.85em;">
                    <button onclick="listItemForSale('${st.cat}', ${idx}, document.getElementById('mkt-inv-${idx}').value)" style="background: ${meta.color}; color: #fff; border:1px solid #c0a062; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">List</button>
                </div>
            </div>`;
        });
        html += '</div>';
    }

    // --- Ammo & Gas ---
    if (playerAmmo > 0 || playerGas > 0) {
        html += '<h5 style="color: #e67e22; margin: 12px 0 6px;">Supplies</h5>';
        if (playerAmmo > 0) {
            html += `<div style="padding: 8px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px solid #1a1610; margin-bottom: 6px;">
                <div style="margin-bottom: 6px;"><strong style="color: #f5e6c8;">\ud83d\udd2b Bullets:</strong> <span style="color: #e67e22; font-weight: bold;">${playerAmmo}</span></div>
                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                    <div><small style="color: #d4c4a0;">Qty:</small><br><input type="number" id="mkt-ammo-qty" value="1" min="1" max="${Math.min(playerAmmo, 100)}" style="width: 55px; padding: 5px; border-radius: 5px; border: 1px solid #e67e22; background: #222; color: #f5e6c8; font-size: 0.85em;"></div>
                    <div><small style="color: #d4c4a0;">$/bullet:</small><br><input type="number" id="mkt-ammo-price" value="150000" min="10000" max="1000000" step="10000" style="width: 100px; padding: 5px; border-radius: 5px; border: 1px solid #e67e22; background: #222; color: #f5e6c8; font-size: 0.85em;"></div>
                    <div style="padding-top: 14px;"><button onclick="listItemForSale('ammo', null, 0, document.getElementById('mkt-ammo-qty').value, document.getElementById('mkt-ammo-price').value)" style="background: #e67e22; color: #fff; border:1px solid #c0a062; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: bold;">List</button></div>
                </div>
            </div>`;
        }
        if (playerGas > 0) {
            html += `<div style="padding: 8px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px solid #1a1610; margin-bottom: 6px;">
                <div style="margin-bottom: 6px;"><strong style="color: #f5e6c8;">\u26fd Gasoline:</strong> <span style="color: #f39c12; font-weight: bold;">${playerGas}</span></div>
                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                    <div><small style="color: #d4c4a0;">Qty:</small><br><input type="number" id="mkt-gas-qty" value="1" min="1" max="${Math.min(playerGas, 100)}" style="width: 55px; padding: 5px; border-radius: 5px; border: 1px solid #f39c12; background: #222; color: #f5e6c8; font-size: 0.85em;"></div>
                    <div><small style="color: #d4c4a0;">$/can:</small><br><input type="number" id="mkt-gas-price" value="75000" min="10000" max="1000000" step="10000" style="width: 100px; padding: 5px; border-radius: 5px; border: 1px solid #f39c12; background: #222; color: #f5e6c8; font-size: 0.85em;"></div>
                    <div style="padding-top: 14px;"><button onclick="listItemForSale('gas', null, 0, document.getElementById('mkt-gas-qty').value, document.getElementById('mkt-gas-price').value)" style="background: #f39c12; color: #fff; border:1px solid #c0a062; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-weight: bold;">List</button></div>
                </div>
            </div>`;
        }
    }

    if (playerCars.length === 0 && sellableItems.length === 0 && playerAmmo === 0 && playerGas === 0) {
        html += '<p style="color: #6a5a3a; text-align: center;">You don\'t have any items to list. Buy from the Black Market or steal some goods first!</p>';
    }
    html += '</div>';

    // ==================== YOUR ACTIVE LISTINGS ====================
    if (myListings.length > 0) {
        html += `<div style="background: rgba(230, 126, 34, 0.12); padding: 15px; border-radius: 12px; border: 1px solid #e67e22; margin-bottom: 20px;">
            <h4 style="color: #e67e22; margin: 0 0 10px 0;">Your Active Listings (${myListings.length})</h4><div style="display: grid; gap: 6px;">`;
        myListings.forEach(listing => {
            const meta = catMeta[listing.category] || catMeta.utility;
            const qtyLabel = listing.quantity > 1 ? `${listing.quantity}x ` : '';
            html += `<div style="padding: 8px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px solid #e67e22; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                <div><strong style="color: #f5e6c8;">${meta.icon} ${qtyLabel}${listing.itemName}</strong><br>
                <small style="color: #d4c4a0;">${meta.label} | Asking: <span style="color: #8a9a6a; font-weight: bold;">$${listing.price.toLocaleString()}</span>${listing.quantity > 1 ? ` ($${listing.pricePerUnit.toLocaleString()}/ea)` : ''}</small></div>
                <button onclick="cancelMarketListing('${listing.id}')" style="background: #7a2a2a; color: #fff; border:1px solid #c0a062; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">Cancel</button>
            </div>`;
        });
        html += '</div></div>';
    }

    // ==================== AVAILABLE LISTINGS FROM OTHER PLAYERS ====================
    html += `<div style="background: rgba(138, 154, 106, 0.08); padding: 15px; border-radius: 12px; border: 1px solid #8a9a6a; margin-bottom: 20px;">
        <h4 style="color: #8a9a6a; margin: 0 0 10px 0;">Available Items (${otherListings.length})</h4>`;

    if (otherListings.length === 0) {
        html += '<p style="color: #6a5a3a; text-align: center;">No items listed by other players right now. Check back later!</p>';
    } else {
        // Group by category for cleaner display
        const grouped = {};
        otherListings.forEach(l => {
            if (!grouped[l.category]) grouped[l.category] = [];
            grouped[l.category].push(l);
        });

        const catOrder = ['vehicle', 'weapon', 'armor', 'ammo', 'gas', 'utility', 'drug'];
        catOrder.forEach(cat => {
            if (!grouped[cat] || grouped[cat].length === 0) return;
            const meta = catMeta[cat] || catMeta.utility;
            html += `<h5 style="color: ${meta.color}; margin: 10px 0 6px;">${meta.icon} ${meta.label}s</h5><div style="display: grid; gap: 6px;">`;

            grouped[cat].forEach(listing => {
                const canAfford = (typeof player !== 'undefined') && player.money >= listing.price;
                const qtyLabel = listing.quantity > 1 ? `${listing.quantity}x ` : '';
                let details = '';
                if (listing.itemData) {
                    if (cat === 'vehicle' && listing.itemData.damagePercentage !== undefined) {
                        const condColor = listing.itemData.damagePercentage < 30 ? '#8a9a6a' : listing.itemData.damagePercentage < 60 ? '#c0a040' : '#8b3a3a';
                        details = `Base: $${(listing.itemData.baseValue || 0).toLocaleString()} | <span style="color: ${condColor};">${listing.itemData.damagePercentage}% dmg</span>`;
                    } else if (listing.itemData.power) {
                        details = `+${listing.itemData.power} power`;
                        if (listing.itemData.durability !== undefined) details += ` | ${listing.itemData.durability}/${listing.itemData.maxDurability} dur`;
                    }
                }
                if (listing.quantity > 1 && listing.pricePerUnit) {
                    details += (details ? ' | ' : '') + `$${listing.pricePerUnit.toLocaleString()}/ea`;
                }

                html += `<div style="padding: 10px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px solid ${canAfford ? '#8a9a6a' : '#6a5a3a'}; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                    <div><strong style="color: #f5e6c8;">${meta.icon} ${qtyLabel}${listing.itemName}</strong>
                    <span style="color: #6a5a3a; font-size: 0.85em;"> \u2014 from ${escapeHTML(listing.sellerName)}</span><br>
                    ${details ? `<small style="color: #d4c4a0;">${details}</small><br>` : ''}
                    <small style="color: #8a9a6a; font-weight: bold; font-size: 1em;">$${listing.price.toLocaleString()}</small></div>
                    <button onclick="buyMarketListing('${listing.id}')" ${!canAfford ? 'disabled' : ''}
                        style="background: ${canAfford ? '#7a8a5a' : '#6a5a3a'}; color: #fff; border:1px solid #c0a062; padding: 8px 16px; border-radius: 8px;
                        cursor: ${canAfford ? 'pointer' : 'not-allowed'}; font-weight: bold; white-space: nowrap; font-size: 1em;">
                        ${canAfford ? 'Buy' : "Can't Afford"}
                    </button>
                </div>`;
            });
            html += '</div>';
        });
    }
    html += '</div>';

    // Refresh button
    html += `<div style="text-align: center; margin-top: 10px;">
        <button onclick="requestMarketListings()" style="background: rgba(52, 152, 219, 0.3); color: #c0a062; border: 1px solid #c0a062; padding: 8px 20px; border-radius: 6px; cursor: pointer;">
            Refresh Listings
        </button>
    </div>`;

    return html;
}

// Legacy convenience function — opens the market tab
function showVehicleMarketplace() {
    if (!onlineWorldState.isConnected) {
        if (typeof showBriefNotification === 'function') showBriefNotification('Connect to The Commission first!', 'error');
        return;
    }
    showOnlineWorld('market');
}

// ==================== ONLINE WORLD FUNCTIONS ====================

// Update connection status display
function updateConnectionStatus() {
    const statusElement = document.getElementById('world-connection-status');
    if (!statusElement) return;
    
    let statusHTML = '';
    
    switch(onlineWorldState.connectionStatus) {
        case 'connecting':
            statusHTML = `
                <div style="text-align: center;">
                    <h4 style="color: #c0a040;"> Connecting to Online World...</h4>
                    <p>Establishing connection to ${onlineWorldState.serverInfo.serverName}</p>
                </div>
            `;
            break;
            
        case 'connected':
            statusHTML = `
                <div style="text-align: center;">
                    <h4 style="color: #c0a062; font-family: 'Georgia', serif;"> Connected to The Commission</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 10px;">
                        <div><strong>Server:</strong> ${onlineWorldState.serverInfo.serverName}</div>
                        <div><strong>Players Online:</strong> ${onlineWorldState.serverInfo.playerCount}</div>
                        <div><strong>Your ID:</strong> ${onlineWorldState.playerId}</div>
                        <div><strong>Status:</strong> <span style="color: #8a9a6a;">Live</span></div>
                    </div>
                </div>
            `;
            break;
            
        case 'demo':
            statusHTML = `
                <div style="text-align: center;">
                    <h4 style="color: #c0a040;"> Demo Mode (Server Offline)</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 10px;">
                        <div><strong>Mode:</strong> Offline Demo</div>
                        <div><strong>Simulated Players:</strong> ${onlineWorldState.serverInfo.playerCount}</div>
                        <div><strong>Your ID:</strong> ${onlineWorldState.playerId}</div>
                        <div><strong>Status:</strong> <span style="color: #c0a040;">Demo</span></div>
                    </div>
                    <p style="margin-top: 10px; color: #8a7a5a; font-size: 0.9em;">
                        Server unavailable - running in demo mode with simulated players
                    </p>
                </div>
            `;
            break;
            
        case 'error':
            statusHTML = `
                <div style="text-align: center;">
                    <h4 style="color: #8b3a3a;"> Connection Error</h4>
                    <p>Unable to connect to online world. Retrying automatically...</p>
                    <p style="margin-top: 10px; color: #8a7a5a; font-size: 0.9em;">
                        The game will continue trying to connect in the background
                    </p>
                </div>
            `;
            break;
            
        default:
            statusHTML = `
                <div style="text-align: center;">
                    <h4 style="color: #c0a040;"> Connecting to Online World...</h4>
                    <p>Establishing connection automatically...</p>
                    <p style="margin-top: 10px; color: #8a7a5a; font-size: 0.9em;">
                        Please wait while we connect you to the global network
                    </p>
                </div>
            `;
    }
    
    statusElement.innerHTML = statusHTML;

    // Also update the chat screen's connection status if it's visible
    const chatStatus = document.getElementById('chat-connection-status');
    if (chatStatus) {
        chatStatus.innerHTML = getConnectionStatusHTML();
    }
}

// Initialize world data after connection
function initializeWorldData() {
    // Real data comes from the server — just set up empty defaults
    if (!onlineWorldState.nearbyPlayers) onlineWorldState.nearbyPlayers = [];
    if (!onlineWorldState.globalChat) onlineWorldState.globalChat = [];
    if (!onlineWorldState.serverInfo.cityEvents) onlineWorldState.serverInfo.cityEvents = [];
    if (!onlineWorldState.activeHeists) onlineWorldState.activeHeists = [];
    
    onlineWorldState.lastUpdate = new Date().toLocaleTimeString();

    // Refresh chat area and player list if currently visible
    const chatArea = document.getElementById('global-chat-area');
    if (chatArea) {
        chatArea.innerHTML = generateChatHTML();
        chatArea.scrollTop = chatArea.scrollHeight;
    }
    const playerList = document.getElementById('chat-player-list');
    if (playerList) {
        playerList.innerHTML = generateOnlinePlayersHTML();
    }
}

// Start periodic world updates
let _worldUpdateInterval = null;
function startWorldUpdates() {
    if (_worldUpdateInterval) clearInterval(_worldUpdateInterval);
    _worldUpdateInterval = setInterval(() => {
        if (onlineWorldState.isConnected) {
            updateWorldState();
        }
    }, onlineWorld.updateInterval);
}

// Update world state — only runs when connected to real server
function updateWorldState() {
    onlineWorldState.lastUpdate = new Date().toLocaleTimeString();
    updateConnectionStatus();
}

// Show welcome message when connected
function showWelcomeMessage() {
    const messages = [
        'Welcome to the criminal underworld! The city awaits your influence.',
        'Other players are active. Watch your back and seize opportunities.',
        'Territory wars are brewing. Choose your alliances wisely.',
        'The streets are dangerous. Keep your weapons loaded and your eyes open.',
        'A new criminal empire rises. Will it be yours?'
    ];
    
    const welcomeMsg = messages[Math.floor(Math.random() * messages.length)];
    
    // Show as a non-blocking log message instead of an alert
    _safeLogAction(`${welcomeMsg}`);
}

// Generate player ID
function generatePlayerId() {
    return 'player_' + Math.random().toString(36).substr(2, 9).toUpperCase();
}

// District exploration
function exploreDistrict(districtName) {
    const district = onlineWorldState.cityDistricts[districtName];
    
    if (!onlineWorldState.isConnected) {
        window.ui.toast('You need to be connected to the online world to explore districts!', 'error');
        return;
    }
    
    let districtHTML = `
        <div style="background: rgba(0, 0, 0, 0.9); padding: 20px; border-radius: 15px; border: 2px solid #c0a062;">
            <h3 style="color: #c0a062; font-family: 'Georgia', serif;"> ${escapeHTML(districtName.charAt(0).toUpperCase() + districtName.slice(1))} District</h3>
            
            <div style="background: rgba(20, 20, 20, 0.8); padding: 15px; border-radius: 10px; margin: 15px 0; border: 1px solid #555;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div><strong style="color: #c0a062;">Crime Level:</strong> <span style="color: #ccc;">${district.crimeLevel}%</span></div>
                    <div><strong style="color: #c0a062;">Controlled By:</strong> <span style="color: #ccc;">${escapeHTML(district.controlledBy || 'No one')}</span></div>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 20px 0;">
                <button onclick="doDistrictJob('${escapeHTML(districtName)}')" style="background: #333; color: #c0a062; padding: 10px; border: 1px solid #c0a062; border-radius: 5px; cursor: pointer; font-family: 'Georgia', serif;">
                     Find Work
                </button>
                <button onclick="wageWar('${escapeHTML(districtName)}')" style="background: #333; color: #8b0000; padding: 10px; border: 1px solid #8b0000; border-radius: 5px; cursor: pointer; font-family: 'Georgia', serif;">
                     Wage War
                </button>
                <button onclick="findPlayersInDistrict('${escapeHTML(districtName)}')" style="background: #333; color: #c0a040; padding: 10px; border: 1px solid #c0a040; border-radius: 5px; cursor: pointer; font-family: 'Georgia', serif;">
                     Find Crew
                </button>
                <button onclick="startDistrictHeist('${escapeHTML(districtName)}')" style="background: #333; color: #7a8a5a; padding: 10px; border: 1px solid #7a8a5a; border-radius: 5px; cursor: pointer; font-family: 'Georgia', serif;">
                     Plan Score
                </button>
            </div>
            
            <div style="text-align: center; margin-top: 20px;">
                <button onclick="showOnlineWorld()" style="background: #333; color: #c0a062; padding: 10px 20px; border: 1px solid #c0a062; border-radius: 5px; cursor: pointer; font-family: 'Georgia', serif;">
                    ? Back to The Commission
                </button>
            </div>
        </div>
    `;
    
    const mc1 = document.getElementById('multiplayer-content');
    if (mc1) mc1.innerHTML = districtHTML;
    
    _safeLogAction(` Exploring ${districtName} district...`);
}

// Load global leaderboard
// Active leaderboard category for tab switching
let _leaderboardCategory = 'reputation';

function loadGlobalLeaderboard() {
    const leaderboardElement = document.getElementById('global-leaderboard');
    if (!leaderboardElement) return;
    
    // Server now sends multi-category leaderboard
    const serverData = onlineWorldState.serverInfo.globalLeaderboard || {};
    const playerName = player.name || 'You';

    // Backwards compatibility: if serverData is an array (old format), wrap it
    const categories = Array.isArray(serverData)
        ? { reputation: serverData, wealth: [], combat: [], territories: [], ranked: [] }
        : serverData;

    const cat = _leaderboardCategory;
    const data = categories[cat] || [];

    // Tab bar
    const tabs = [
        { key: 'reputation', label: 'Rep', color: '#c0a040' },
        { key: 'wealth', label: 'Wealth', color: '#8a9a6a' },
        { key: 'combat', label: 'Combat', color: '#8b3a3a' },
        { key: 'territories', label: 'Territories', color: '#c0a062' },
        { key: 'ranked', label: 'Ranked', color: '#ffd700' }
    ];
    const tabHTML = `<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">${tabs.map(t =>
        `<button onclick="_leaderboardCategory='${t.key}';loadGlobalLeaderboard();" style="background:${_leaderboardCategory === t.key ? t.color : '#222'};color:${_leaderboardCategory === t.key ? '#000' : '#ccc'};border:1px solid ${t.color};padding:5px 10px;border-radius:4px;cursor:pointer;font-family:Georgia,serif;font-size:0.8em;">${t.label}</button>`
    ).join('')}</div>`;

    let rows = '';
    if (data.length === 0) {
        rows = '<div style="color:#888;text-align:center;padding:15px;">No entries yet.</div>';
    } else {
        rows = data.map((entry, i) => {
            const rank = i + 1;
            const isMe = entry.name === playerName;
            let detail = '';
            if (cat === 'reputation') detail = `${entry.reputation || 0} rep`;
            else if (cat === 'wealth') detail = `$${(entry.money || 0).toLocaleString()}`;
            else if (cat === 'combat') detail = `${entry.pvpWins || 0}W / ${entry.pvpLosses || 0}L`;
            else if (cat === 'territories') detail = `${entry.territories || 0} owned`;
            else if (cat === 'ranked') detail = `${entry.icon || ''} ${entry.elo || 0} Rating (${entry.tier || '?'}) ${entry.wins || 0}W/${entry.losses || 0}L`;

            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;margin:4px 0;background:rgba(0,0,0,0.3);border-radius:5px;${isMe ? 'border:2px solid #8a9a6a;' : ''}">
                <div>
                    <span style="color:${rank <= 3 ? '#c0a040' : '#f5e6c8'};">#${rank}</span>
                    <strong style="margin-left:10px;color:${isMe ? '#8a9a6a' : '#f5e6c8'};">${escapeHTML(entry.name)}</strong>
                </div>
                <div style="color:#8a7a5a;font-size:0.9em;">${detail}</div>
            </div>`;
        }).join('');
    }

    leaderboardElement.innerHTML = tabHTML + rows;
}

// World activity functions
function loadWorldActivityFeed() {
    const feedElement = document.getElementById('world-activity-feed');
    if (!feedElement) return;
    
    feedElement.innerHTML = '<p style="color: #8a7a5a; text-align: center; padding: 10px;">No activity yet. Connect to the server to see live events.</p>';
}

function addWorldEvent(event) {
    const feedElement = document.getElementById('world-activity-feed');
    if (feedElement) {
        const newEvent = document.createElement('div');
        newEvent.style.cssText = 'margin: 5px 0; padding: 8px; background: rgba(138, 154, 106, 0.3); border-radius: 5px;';
        // Escape any content added to the activity feed to prevent script injection
        newEvent.innerHTML = `${escapeHTML(event)} <small style="color: #8a7a5a; float: right;">Just now</small>`;
        feedElement.insertBefore(newEvent, feedElement.firstChild);
        
        // Keep only last 10 events
        while (feedElement.children.length > 10) {
            feedElement.removeChild(feedElement.lastChild);
        }
    }
}

// Chat functions
function sendGlobalChatMessage() {
    const chatInput = document.getElementById('chat-input');
    if (!chatInput) return;
    const message = chatInput.value.trim();
    
    if (!message) return;
    
    if (!onlineWorldState.isConnected) {
        window.ui.toast('You need to be connected to the online world to chat!', 'error');
        return;
    }
    
    // Send message to server
    if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        onlineWorldState.socket.send(JSON.stringify({
            type: 'global_chat',
            message: message,
            playerId: onlineWorldState.playerId,
            playerName: player.name || 'You',
            timestamp: Date.now()
        }));
    }
    
    chatInput.value = '';
    
    _safeLogAction(` Sent message to global chat: "${message}"`);
}

// Quick chat function for main online world screen
function sendQuickChatMessage() {
    const quickChatInput = document.getElementById('quick-chat-input');
    const message = quickChatInput.value.trim();
    
    if (!message) return;
    
    if (!onlineWorldState.isConnected) {
        window.ui.toast('You need to be connected to the online world to chat!', 'error');
        return;
    }
    
    // Send message to server
    if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        onlineWorldState.socket.send(JSON.stringify({
            type: 'global_chat',
            message: message,
            playerId: onlineWorldState.playerId,
            playerName: player.name || 'You',
            timestamp: Date.now()
        }));
    }
    
    quickChatInput.value = '';
    
    _safeLogAction(` Sent message to global chat: "${message}"`);
}

// Update quick chat display when new messages arrive
function updateQuickChatDisplay() {
    const quickChatMessages = document.getElementById('quick-chat-messages');
    if (quickChatMessages) {
        const recentMessages = onlineWorldState.globalChat.slice(-3);
        quickChatMessages.innerHTML = recentMessages.map(msg => `
            <div style="margin: 4px 0; font-size: 0.9em;">
                <strong style="color: ${sanitizeColor(msg.color, '#c0a062')};">${escapeHTML(msg.player)}:</strong> ${escapeHTML(msg.message)}
            </div>
        `).join('');
    }
    // Also update the world channel tab if it's active
    updateChannelChatDisplay('world');
}

function simulateGlobalChatResponse() {
    const responses = [
        { player: 'CrimeBoss42', message: 'Nice move!', color: '#c0a062' },
        { player: 'ShadowDealer', message: 'Watch your back out there...', color: '#8b3a3a' },
        { player: 'StreetKing', message: 'The docks are heating up', color: '#c0a040' }
    ];
    
    const response = responses[Math.floor(Math.random() * responses.length)];
    response.time = 'Just now';
    
    onlineWorldState.globalChat.push(response);
    
    const chatArea = document.getElementById('global-chat-area');
    if (chatArea) {
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = 'margin: 8px 0; padding: 8px; background: rgba(20, 18, 10, 0.3); border-radius: 5px;';
        messageDiv.innerHTML = `<strong style="color: ${sanitizeColor(response.color, '#c0a062')};">${escapeHTML(response.player)}:</strong> ${escapeHTML(response.message)} <small style="color: #8a7a5a; float: right;">${response.time}</small>`;
        chatArea.appendChild(messageDiv);
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

// District actions
function doDistrictJob(districtName) {
    if (!onlineWorldState.isConnected) {
        window.ui.toast('You need to be connected to the online world!', 'error');
        return;
    }

    if (player.inJail) {
        showSystemMessage("You can't work while in jail!", '#8b3a3a');
        return;
    }

    const district = onlineWorldState.cityDistricts[districtName];
    if (!district) {
        showJobs();
        return;
    }

    const crimeLevel = district.crimeLevel || 50;
    const riskMultiplier = crimeLevel / 100;
    const rewardMultiplier = 1 + (riskMultiplier * 0.5); // Higher crime = 0-50% more reward
    const dangerMultiplier = 1 + (riskMultiplier * 0.4); // Higher crime = 0-40% more danger

    // District-specific job pools
    const districtJobs = {
        downtown: [
            { name: 'Shake Down a Business', baseReward: [800, 2500], xp: 20, jailChance: 0.12, flavor: 'You walked into a shop and made the owner an offer he couldn\'t refuse.' },
            { name: 'Run a Con on Tourists', baseReward: [500, 1800], xp: 15, jailChance: 0.08, flavor: 'The tourists never saw it coming — wallets, watches, the works.' },
            { name: 'Intercept a Wire Transfer', baseReward: [2000, 5000], xp: 35, jailChance: 0.2, flavor: 'Your inside man at the bank tipped you off to a fat transfer.' }
        ],
        docks: [
            { name: 'Hijack a Shipping Container', baseReward: [1500, 4000], xp: 30, jailChance: 0.18, flavor: 'The container was full of electronics — easy money on the black market.' },
            { name: 'Smuggle Contraband', baseReward: [1000, 3000], xp: 25, jailChance: 0.15, flavor: 'You slipped the goods past customs in a fishing boat.' },
            { name: 'Bribe a Dock Foreman', baseReward: [600, 1500], xp: 15, jailChance: 0.06, flavor: 'Now you\'ve got eyes and ears on every shipment that comes through.' }
        ],
        suburbs: [
            { name: 'Burglarize a McMansion', baseReward: [1200, 3500], xp: 25, jailChance: 0.14, flavor: 'Rich family on vacation — their safe wasn\'t as secure as they thought.' },
            { name: 'Run a Prescription Scam', baseReward: [400, 1200], xp: 12, jailChance: 0.08, flavor: 'Fake prescriptions across three pharmacies. Quick and clean.' },
            { name: 'Steal Luxury Cars', baseReward: [2000, 5000], xp: 30, jailChance: 0.16, flavor: 'Three luxury cars boosted from driveways overnight.' }
        ],
        industrial: [
            { name: 'Rob a Warehouse', baseReward: [1000, 3000], xp: 22, jailChance: 0.15, flavor: 'Cut the fence, loaded the van, gone in eight minutes flat.' },
            { name: 'Steal Construction Equipment', baseReward: [800, 2000], xp: 18, jailChance: 0.1, flavor: 'Heavy machinery sells well to the right buyers.' },
            { name: 'Cook Product in an Abandoned Factory', baseReward: [1500, 4500], xp: 30, jailChance: 0.22, flavor: 'Your chemist turned raw materials into serious street value.' }
        ],
        redlight: [
            { name: 'Collect Protection Money', baseReward: [600, 2000], xp: 18, jailChance: 0.1, flavor: 'The clubs pay on time when you show up with muscle.' },
            { name: 'Run an Underground Card Game', baseReward: [1000, 3500], xp: 22, jailChance: 0.12, flavor: 'You took the house cut and nobody dared complain.' },
            { name: 'Fence Stolen Goods', baseReward: [800, 2500], xp: 20, jailChance: 0.09, flavor: 'Your fence moved the merch before dawn — cash in hand.' }
        ]
    };

    const jobPool = districtJobs[districtName] || districtJobs.downtown;
    const job = jobPool[Math.floor(Math.random() * jobPool.length)];

    // Apply district crime level modifiers
    const minReward = Math.floor(job.baseReward[0] * rewardMultiplier);
    const maxReward = Math.floor(job.baseReward[1] * rewardMultiplier);
    const adjustedJailChance = Math.min(0.5, job.jailChance * dangerMultiplier);
    const adjustedXp = Math.max(0.5, Math.round(job.xp * rewardMultiplier * 0.1 * 10) / 10);

    // Check for arrest
    const arrested = Math.random() < adjustedJailChance;

    let resultModal = document.getElementById('district-job-modal');
    if (resultModal) resultModal.remove();
    resultModal = document.createElement('div');
    resultModal.id = 'district-job-modal';
    resultModal.className = 'popup-overlay';
    document.body.appendChild(resultModal);

    if (arrested) {
        const jailTime = 10 + Math.floor(Math.random() * 15);
        player.inJail = true;
        player.jailTime = jailTime;
        player.heat = Math.min(10, (player.heat || 0) + 1);

        resultModal.innerHTML = `
            <div class="popup-card popup-danger" style="max-width:520px;">
                <h3 style="color:#c0a062;margin:0 0 5px 0;">${districtName.charAt(0).toUpperCase() + districtName.slice(1)} District Job</h3>
                <p class="popup-subtitle">Crime Level: ${crimeLevel}%</p>
                <div class="popup-section" style="border-color:rgba(231,76,60,0.3);">
                <p style="color:#8b3a3a;font-weight:bold;margin:0 0 8px 0;">Busted!</p>
                <p style="margin:0;color:#ccc;">You attempted: <strong>${job.name}</strong></p>
                <p style="margin:8px 0 0 0;color:#8b3a3a;">The cops were tipped off. You've been sentenced to ${jailTime} seconds in jail.</p>
                </div>
                <div class="popup-actions">
                    <button onclick="document.getElementById('district-job-modal').remove();if(typeof showJailScreen==='function')showJailScreen();" class="popup-btn popup-btn-danger">Accept Your Fate</button>
                </div>
            </div>
        `;

        _safeLogAction(`Busted doing a ${job.name} in ${districtName}! Jailed for ${jailTime}s.`);
        if (window.EventBus) EventBus.emit('jailStatusChanged', { inJail: true, jailTime: jailTime });
        if (typeof updateJailTimer === 'function') updateJailTimer();
    } else {
        const earned = minReward + Math.floor(Math.random() * (maxReward - minReward));
        player.money += earned;
        if (typeof gainExperience === 'function') {
            gainExperience(adjustedXp);
        }

        resultModal.innerHTML = `
            <div class="popup-card popup-success" style="max-width:520px;">
                <h3 class="popup-title">${districtName.charAt(0).toUpperCase() + districtName.slice(1)} District Job</h3>
                <p class="popup-subtitle">Crime Level: ${crimeLevel}% (${crimeLevel > 60 ? 'High Risk / High Reward' : crimeLevel > 35 ? 'Moderate Risk' : 'Low Profile'})</p>
                <div class="popup-section" style="border-color:rgba(138, 154, 106,0.3);">
                    <p style="color:#8a9a6a;font-weight:bold;margin:0 0 8px 0;">? ${job.name}</p>
                    <p style="margin:0;color:#ccc;font-style:italic;">${job.flavor}</p>
                </div>
                <div class="popup-stats-grid">
                    <div class="popup-stat">
                        <div class="popup-stat-value" style="color:#8a9a6a;">+$${earned.toLocaleString()}</div>
                        <div class="popup-stat-label">Cash</div>
                    </div>
                    <div class="popup-stat">
                        <div class="popup-stat-value" style="color:#8b6a4a;">+${adjustedXp} Rep</div>
                        <div class="popup-stat-label">Reputation</div>
                    </div>
                </div>
                <div class="popup-actions">
                    <button onclick="document.getElementById('district-job-modal').remove();" class="popup-btn popup-btn-gold">Collect</button>
                </div>
            </div>
        `;

        _safeLogAction(`${job.name} in ${districtName}: earned $${earned.toLocaleString()}, +${adjustedXp} Rep`);
        addWorldEvent(`${player.name || 'A player'} pulled off a job in ${districtName}!`);
    }

    if (typeof updateUI === 'function') updateUI();
}

function findPlayersInDistrict(districtName) {
    if (!onlineWorldState.isConnected) {
        window.ui.toast('You need to be connected to the online world!', 'error');
        return;
    }
    
    const playersInDistrict = onlineWorldState.nearbyPlayers.filter(() => Math.random() > 0.5);
    
    if (playersInDistrict.length === 0) {
        window.ui.toast(`No other players currently in ${districtName} district.`, 'info');
        return;
    }
    
    let playersHTML = `
        <div style="background: rgba(0, 0, 0, 0.9); padding: 20px; border-radius: 15px; border: 2px solid #c0a062;">
            <h3 style="color: #c0a062; font-family: 'Georgia', serif;"> Crew in ${escapeHTML(districtName.charAt(0).toUpperCase() + districtName.slice(1))}</h3>
            <div style="margin: 20px 0;">
                ${playersInDistrict.map(p => `
                    <div style="background: rgba(20, 20, 20, 0.8); padding: 15px; margin: 10px 0; border-radius: 8px; border: 1px solid #555;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <h4 style="color: #c0a062; margin: 0; font-family: 'Georgia', serif;">${escapeHTML(p.name)}</h4>
                                <div style="display: flex; gap: 20px; font-size: 0.9em; margin: 5px 0; color: #ccc;">
                                    <span>Level ${p.level}</span>
                                    <span>Respect: ${p.reputation}</span>
                                    <span>Territory: ${escapeHTML(p.territory)}</span>
                                    <span style="color: #7a8a5a;">? Online</span>
                                </div>
                            </div>
                            <div style="display: flex; gap: 10px;">
                                <button onclick="challengePlayer('${escapeHTML(p.name)}')" style="background: #8b0000; color: white; padding: 8px 12px; border:1px solid #c0a062; border-radius: 4px; cursor: pointer; font-family: 'Georgia', serif;">
                                     Challenge
                                </button>
                                <button onclick="inviteToHeist('${escapeHTML(p.name)}')" style="background: #c0a040; color: #000; padding: 8px 12px; border:1px solid #c0a062; border-radius: 4px; cursor: pointer; font-family: 'Georgia', serif;">
                                     Invite
                                </button>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    const mc2 = document.getElementById('multiplayer-content');
    if (mc2) mc2.innerHTML = playersHTML;
}

// showCityEvents (Street News) removed

// ==================== ASSASSINATION SYSTEM ====================

function showAssassination() {
    if (!onlineWorldState.isConnected) {
        window.ui.toast('You must be connected to the online world to order a hit.', 'error');
        return;
    }

    const content = document.getElementById('multiplayer-content');
    if (!content) return;

    if (typeof hideAllScreens === 'function') hideAllScreens();
    const mpScreen = document.getElementById('multiplayer-screen');
    if (mpScreen) mpScreen.style.display = 'block';

    // Check cooldown
    const lastAttemptTime = window._assassinationCooldownUntil || 0;
    const now = Date.now();
    const onCooldown = now < lastAttemptTime;
    let cooldownHTML = '';
    if (onCooldown) {
        const remaining = Math.ceil((lastAttemptTime - now) / 1000);
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        cooldownHTML = `
            <div style="background: rgba(255, 68, 68, 0.15); padding: 15px; border-radius: 10px; margin-bottom: 20px; border: 2px solid #ff4444; text-align: center;">
                <div style="color: #ff4444; font-weight: bold; font-size: 1.1em;">Cooldown Active</div>
                <div style="color: #ff8888; margin-top: 5px;">Next hit available in: <strong>${mins}m ${secs}s</strong></div>
            </div>
        `;
    }

    // Gather player's assassination resources
    const guns = (player.inventory || []).filter(i => i.type === 'gun');
    const vehicles = (player.inventory || []).filter(i => i.type === 'car' || i.type === 'vehicle');
    const stolenCars = player.stolenCars || [];
    const totalVehicles = vehicles.length + stolenCars.length;
    const bestGun = guns.reduce((best, g) => (g.power || 0) > (best.power || 0) ? g : best, { name: 'None', power: 0 });
    const gangCount = (player.gang && player.gang.members) || 0;
    const bullets = player.ammo || 0;
    const hasGun = guns.length > 0;
    const hasBullets = bullets >= 3;
    const hasVehicle = totalVehicles > 0;
    const canAttempt = hasGun && hasBullets && hasVehicle && !onCooldown;

    // Calculate estimated chance (mirror server logic approximately)
    let estimatedChance = 8;
    estimatedChance += Math.min(bullets * 0.5, 15);
    estimatedChance += Math.min((bestGun.power || 0) * 0.05, 6);
    estimatedChance += Math.min((guns.length - 1) * 1, 5);
    estimatedChance += Math.min(totalVehicles * 2, 6);
    estimatedChance += Math.min(gangCount * 0.5, 10);
    estimatedChance += Math.min((player.power || 0) * 0.002, 5);
    estimatedChance = Math.max(5, Math.min(Math.round(estimatedChance), 20));

    // Get online players (not self, not in jail)
    const onlinePlayers = Object.values(onlineWorldState.playerStates || {}).filter(
        p => p.playerId !== onlineWorldState.playerId && !p.inJail
    );

    const requirementColor = (met) => met ? '#8a9a6a' : '#8b3a3a';
    const requirementIcon = (met) => met ? '\u2714' : '\u2718';

    let targetListHTML;
    if (onlinePlayers.length === 0) {
        targetListHTML = '<p style="color: #888; text-align: center; font-style: italic;">No valid targets online right now.</p>';
    } else {
        targetListHTML = onlinePlayers.map(p => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; margin: 8px 0; background: rgba(139, 0, 0, 0.15); border-radius: 8px; border: 1px solid #5a0000;">
                <div>
                    <strong style="color: #ff4444; font-family: 'Georgia', serif;">${escapeHTML(p.name)}</strong>
                    <br><small style="color: #999;">Level ${p.level || 1} | ${p.reputation || 0} rep</small>
                </div>
                <button onclick="attemptAssassination('${escapeHTML(p.name)}')" 
                    style="background: ${canAttempt ? 'linear-gradient(180deg, #8b0000 0%, #3a0000 100%)' : '#333'}; color: ${canAttempt ? '#ff4444' : '#666'}; padding: 10px 20px; border: 1px solid ${canAttempt ? '#ff0000' : '#555'}; border-radius: 6px; cursor: ${canAttempt ? 'pointer' : 'not-allowed'}; font-family: 'Georgia', serif; font-weight: bold;"
                    ${canAttempt ? '' : 'disabled'}>
                    Order Hit
                </button>
            </div>
        `).join('');
    }

    content.innerHTML = `
        <div style="background: rgba(0,0,0,0.95); padding: 30px; border-radius: 15px; border: 3px solid #8b0000;">
            <div style="text-align: center; margin-bottom: 25px;">
                <div style="font-size: 3em;"></div>
                <h2 style="color: #ff4444; font-family: 'Georgia', serif; font-size: 2em; margin: 10px 0 5px 0;">Assassination Contract</h2>
                <p style="color: #ff6666; font-style: italic; margin: 0;">Send a message they can't refuse. Hunt a rival and take their wealth.</p>
            </div>

            <!-- Requirements Box -->
            <div style="background: rgba(0,0,0,0.6); padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #555;">
                <h3 style="color: #c0a062; margin: 0 0 15px 0; font-family: 'Georgia', serif;">Requirements</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
                    <div style="background: rgba(0,0,0,0.4); padding: 12px; border-radius: 8px; border: 1px solid ${requirementColor(hasGun)};">
                        <div style="color: ${requirementColor(hasGun)}; font-weight: bold;">${requirementIcon(hasGun)} Firearm</div>
                        <div style="color: #ccc; font-size: 0.85em; margin-top: 5px;">${hasGun ? escapeHTML(bestGun.name) + ' (+' + bestGun.power + ')' : 'Need a gun from the Store'}</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.4); padding: 12px; border-radius: 8px; border: 1px solid ${requirementColor(hasBullets)};">
                        <div style="color: ${requirementColor(hasBullets)}; font-weight: bold;">${requirementIcon(hasBullets)} Bullets (3+)</div>
                        <div style="color: #ccc; font-size: 0.85em; margin-top: 5px;">You have: ${bullets} rounds</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.4); padding: 12px; border-radius: 8px; border: 1px solid ${requirementColor(hasVehicle)};">
                        <div style="color: ${requirementColor(hasVehicle)}; font-weight: bold;">${requirementIcon(hasVehicle)} Getaway Vehicle</div>
                        <div style="color: #ccc; font-size: 0.85em; margin-top: 5px;">${totalVehicles} vehicle${totalVehicles !== 1 ? 's' : ''} available</div>
                    </div>
                </div>
            </div>

            <!-- Odds Breakdown -->
            <div style="background: rgba(139, 0, 0, 0.15); padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #5a0000;">
                <h3 style="color: #ff4444; margin: 0 0 15px 0; font-family: 'Georgia', serif;">Your Odds</h3>
                <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                    <div style="flex: 1; background: rgba(0,0,0,0.4); border-radius: 8px; height: 30px; overflow: hidden;">
                        <div style="background: linear-gradient(90deg, #8b0000, #ff4444); height: 100%; width: ${estimatedChance}%; border-radius: 8px; transition: width 0.3s;"></div>
                    </div>
                    <div style="color: #ff4444; font-weight: bold; font-size: 1.3em; min-width: 50px;">${estimatedChance}%</div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.85em;">
                    <div style="color: #ccc;">Guns: <span style="color: #c0a062;">${guns.length}</span> <small style="color: #888;">(+${Math.min((guns.length - 1) * 1, 5)}%)</small></div>
                    <div style="color: #ccc;">Bullets: <span style="color: #c0a062;">${bullets}</span> <small style="color: #888;">(+${Math.min(Math.round(bullets * 0.5), 15)}%)</small></div>
                    <div style="color: #ccc;">Vehicles: <span style="color: #c0a062;">${totalVehicles}</span> <small style="color: #888;">(+${Math.min(totalVehicles * 2, 6)}%)</small></div>
                    <div style="color: #ccc;">Gang: <span style="color: #c0a062;">${gangCount}</span> <small style="color: #888;">(+${Math.min(Math.round(gangCount * 0.5), 10)}%)</small></div>
                    <div style="color: #ccc;">Power: <span style="color: #c0a062;">${player.power || 0}</span> <small style="color: #888;">(+${Math.min(Math.round((player.power || 0) * 0.002), 5)}%)</small></div>
                    <div style="color: #ccc;">Base Chance: <span style="color: #888;">8%</span></div>
                </div>
                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #5a0000;">
                <div style="color: #ff6666; font-size: 0.85em;">Costs 3-5 bullets. You WILL take heavy damage. 40% arrest chance on failure.</div>
                    <div style="color: #ff6666; font-size: 0.85em; margin-top: 4px;">Gang members sent may be killed in the firefight (20% each).</div>
                    <div style="color: #c0a062; font-size: 0.85em; margin-top: 4px;">Steal 8-20% of target's cash on success.</div>
                    <div style="color: #ff8800; font-size: 0.85em; margin-top: 4px;">10 minute cooldown between attempts.</div>
                </div>
            </div>

            ${cooldownHTML}

            <!-- Target List -->
            <div style="background: rgba(0,0,0,0.6); padding: 20px; border-radius: 10px; border: 1px solid #555;">
                <h3 style="color: #c0a062; margin: 0 0 15px 0; font-family: 'Georgia', serif;">Select Target</h3>
                ${targetListHTML}
            </div>

            <div style="text-align: center; margin-top: 20px;">
                <button onclick="goBackToMainMenu()" style="background: #333; color: #c0a062; padding: 12px 25px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif;">Back</button>
            </div>
        </div>
    `;
}

async function attemptAssassination(targetName) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) {
        window.ui.toast('Not connected to the server!', 'error');
        return;
    }

    // Check cooldown
    const now = Date.now();
    if (window._assassinationCooldownUntil && now < window._assassinationCooldownUntil) {
        const remaining = Math.ceil((window._assassinationCooldownUntil - now) / 1000);
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        window.ui.toast(`You must wait ${mins}m ${secs}s before attempting another hit.`, 'error');
        return;
    }

    // Validate local requirements
    const guns = (player.inventory || []).filter(i => i.type === 'gun');
    const vehicles = (player.inventory || []).filter(i => i.type === 'car' || i.type === 'vehicle');
    const stolenCars = player.stolenCars || [];
    const totalVehicles = vehicles.length + stolenCars.length;
    const bestGun = guns.reduce((best, g) => (g.power || 0) > (best.power || 0) ? g : best, { name: 'None', power: 0 });
    const gangCount = (player.gang && player.gang.members) || 0;
    const bullets = player.ammo || 0;

    if (guns.length < 1) { window.ui.toast('You need at least one gun!', 'error'); return; }
    if (bullets < 3) { window.ui.toast('You need at least 3 bullets!', 'error'); return; }
    if (totalVehicles < 1) { window.ui.toast('You need a getaway vehicle!', 'error'); return; }

    const confirmHit = await window.ui.confirm(
        `ORDER HIT ON ${targetName}?\n\n` +
        'This will cost:\n' +
        '◆ 3-5 Bullets\n' +
        '◆ You WILL take heavy health damage\n' +
        '◆ Gang members may die in the firefight\n' +
        '◆ 10 minute cooldown after attempt\n\n' +
        'Success is NOT guaranteed. You could get arrested.\n' +
        'Proceed?'
    );
    if (!confirmHit) return;

    // Send assassination intent to server
    onlineWorldState.socket.send(JSON.stringify({
        type: 'assassination_attempt',
        targetPlayer: targetName,
        bullets: bullets,
        gunCount: guns.length,
        bestGunPower: bestGun.power || 0,
        vehicleCount: totalVehicles,
        gangMembers: gangCount,
        power: player.power || 0
    }));

    _safeLogAction(`Sent a hitman after ${targetName}... awaiting results.`);

    // Show waiting state
    const content = document.getElementById('multiplayer-content');
    if (content) {
        content.innerHTML = `
            <div style="background: rgba(0,0,0,0.95); padding: 60px 30px; border-radius: 15px; border: 3px solid #8b0000; text-align: center;">
                <div style="font-size: 4em; margin-bottom: 20px;"></div>
                <h2 style="color: #ff4444; font-family: 'Georgia', serif;">Hit in Progress...</h2>
                <p style="color: #ff6666; font-style: italic;">Your crew is moving on ${escapeHTML(targetName)}. Stand by.</p>
                <div style="margin-top: 20px;">
                    <div style="display: inline-block; width: 40px; height: 40px; border: 3px solid #8b0000; border-top-color: #ff4444; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                </div>
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
            </div>
        `;
    }
}

// Handle assassination results from server
function handleAssassinationResult(message) {
    const content = document.getElementById('multiplayer-content');

    // Handle cooldown error (server rejected due to cooldown)
    if (message.cooldownRemaining && !message.targetName) {
        const mins = Math.floor(message.cooldownRemaining / 60);
        const secs = message.cooldownRemaining % 60;
        // Sync our local cooldown
        window._assassinationCooldownUntil = Date.now() + message.cooldownRemaining * 1000;
        if (content) {
            content.innerHTML = `
                <div style="background: rgba(0,0,0,0.95); padding: 40px; border-radius: 15px; border: 3px solid #ff8800; text-align: center;">
                    <div style="font-size: 4em; margin-bottom: 15px;"></div>
                    <h2 style="color: #ff8800; font-family: 'Georgia', serif;">Cooldown Active</h2>
                    <p style="color: #ccc; margin: 15px 0;">${escapeHTML(message.error || 'You must wait before ordering another hit.')}</p>
                    <p style="color: #ff8800; font-size: 1.3em; font-weight: bold;">${mins}m ${secs}s remaining</p>
                    <button onclick="showAssassination()" style="background: #333; color: #c0a062; padding: 12px 25px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif; margin-top: 20px;">Back</button>
                </div>
            `;
        }
        return;
    }

    if (message.success) {
        // Deduct bullets locally
        player.ammo = Math.max(0, (player.ammo || 0) - (message.bulletsUsed || 3));

        // Sync authoritative money/rep from server
        if (typeof message.newMoney === 'number') player.money = message.newMoney;
        if (typeof message.newReputation === 'number') player.reputation = message.newReputation;
        if (typeof message.heat === 'number') player.heat = message.heat;

        // Apply health damage
        if (typeof message.newHealth === 'number') player.health = message.newHealth;

        // Apply gang member losses
        const gangLost = message.gangMembersLost || 0;
        if (gangLost > 0 && player.gang) {
            for (let i = 0; i < gangLost; i++) {
                if (player.gang.gangMembers && player.gang.gangMembers.length > 0) {
                    player.gang.gangMembers.pop();
                }
                if (player.gang.members > 0) player.gang.members--;
            }
        }

        // Set cooldown
        window._assassinationCooldownUntil = Date.now() + (message.cooldownSeconds || 600) * 1000;

        if (typeof updateUI === 'function') updateUI();
        // Territory seizure from assassination
        const seizedTerritories = message.territoriesSeized || [];
        if (seizedTerritories.length > 0) {
            onlineWorldState.territories = message.territories || onlineWorldState.territories;
            _safeLogAction(`Seized ${seizedTerritories.join(', ')} from ${message.targetName}!`);
        }

        _safeLogAction(`HIT SUCCESSFUL! Assassinated ${message.targetName} and stole $${(message.stolenAmount || 0).toLocaleString()} (${message.stealPercent}%)! +${message.repGain} rep. Took ${message.healthDamage || 0} damage.${gangLost > 0 ? ` Lost ${gangLost} gang member${gangLost > 1 ? 's' : ''}.` : ''}`);

        if (content) {
            const seizedHTML = seizedTerritories.length > 0
                ? `<div style="color: #ffd700; margin-top: 10px; font-size: 1.1em;">Seized territories: ${seizedTerritories.map(t => t.replace(/_/g, ' ')).join(', ')}</div>`
                : '';
            content.innerHTML = `
                <div style="background: rgba(0,0,0,0.95); padding: 40px; border-radius: 15px; border: 3px solid #8a9a6a; text-align: center;">
                    <div style="font-size: 4em; margin-bottom: 15px;"></div>
                    <h2 style="color: #8a9a6a; font-family: 'Georgia', serif; font-size: 2em;">HIT SUCCESSFUL</h2>
                    <p style="color: #ccc; font-size: 1.1em; margin: 15px 0;">
                        ${escapeHTML(message.targetName)} has been eliminated.
                    </p>
                    <div style="background: rgba(138, 154, 106, 0.15); padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 350px; border: 1px solid #8a9a6a;">
                        <div style="color: #8a9a6a; font-size: 1.5em; font-weight: bold; margin-bottom: 10px;">+$${(message.stolenAmount || 0).toLocaleString()}</div>
                        <div style="color: #ccc;">Stole ${message.stealPercent}% of their wealth</div>
                        <div style="color: #c0a062; margin-top: 8px;">+${message.repGain} Reputation</div>
                        <div style="color: #ff6666; margin-top: 4px;">+25 Heat</div>
                        <div style="color: #ff4444; margin-top: 8px;">-${message.healthDamage || 0} Health (now ${message.newHealth || '?'})</div>
                        ${(message.gangMembersLost || 0) > 0 ? '<div style="color: #ff8800; margin-top: 4px;">Lost ' + message.gangMembersLost + ' gang member' + (message.gangMembersLost > 1 ? 's' : '') + ' in the firefight</div>' : ''}
                        ${seizedHTML}
                        <div style="color: #888; margin-top: 8px; font-size: 0.85em;">Hit chance was ${message.chance}% | ${message.bulletsUsed} bullets used</div>
                        <div style="color: #ff8800; margin-top: 4px; font-size: 0.85em;">Next hit available in 10 minutes</div>
                    </div>
                    <div style="margin-top: 25px;">
                        <button onclick="showAssassination()" style="background: #8b0000; color: #fff; padding: 12px 25px; border: 1px solid #ff0000; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif; margin-right: 10px;">Another Hit</button>
                        <button onclick="goBackToMainMenu()" style="background: #333; color: #c0a062; padding: 12px 25px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: 'Georgia', serif;">Back</button>
                    </div>
                </div>
            `;
        }
    } else {
        // Failed
        player.ammo = Math.max(0, (player.ammo || 0) - (message.bulletsUsed || 3));
        if (typeof message.heat === 'number') player.heat = message.heat;

        // Apply health damage
        if (typeof message.newHealth === 'number') player.health = message.newHealth;

        // Apply gang member losses
        const gangLostFail = message.gangMembersLost || 0;
        if (gangLostFail > 0 && player.gang) {
            for (let i = 0; i < gangLostFail; i++) {
                if (player.gang.gangMembers && player.gang.gangMembers.length > 0) {
                    player.gang.gangMembers.pop();
                }
                if (player.gang.members > 0) player.gang.members--;
            }
        }

        // Set cooldown
        window._assassinationCooldownUntil = Date.now() + (message.cooldownSeconds || 600) * 1000;

        if (message.arrested) {
            player.inJail = true;
            player.jailTime = message.jailTime || 25;
            player.breakoutAttempts = 3;
            if (window.EventBus) EventBus.emit('jailStatusChanged', { inJail: true, jailTime: player.jailTime });
            if (typeof updateJailTimer === 'function') updateJailTimer();
            if (typeof generateJailPrisoners === 'function') generateJailPrisoners();
        }

        if (typeof updateUI === 'function') updateUI();
        _safeLogAction(`HIT FAILED on ${message.targetName}!${message.arrested ? ' ARRESTED!' : ''} -${message.repLoss} rep. Took ${message.healthDamage || 0} damage.${(message.gangMembersLost || 0) > 0 ? ` Lost ${message.gangMembersLost} gang member${message.gangMembersLost > 1 ? 's' : ''}.` : ''}`);

        if (content) {
            content.innerHTML = `
                <div style="background: rgba(0,0,0,0.95); padding: 40px; border-radius: 15px; border: 3px solid ${message.arrested ? '#ff0000' : '#ff8800'}; text-align: center;">
                    <div style="font-size: 4em; margin-bottom: 15px;">${message.arrested ? '' : ''}</div>
                    <h2 style="color: ${message.arrested ? '#ff4444' : '#ff8800'}; font-family: 'Georgia', serif; font-size: 2em;">
                        ${message.arrested ? 'HIT FAILED — ARRESTED!' : 'HIT FAILED — ESCAPED'}
                    </h2>
                    <p style="color: #ccc; font-size: 1.1em; margin: 15px 0;">
                        ${escapeHTML(message.error || 'The hit didn\'t go as planned.')}
                    </p>
                    <div style="background: rgba(139, 0, 0, 0.2); padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 350px; border: 1px solid #8b0000;">
                        <div style="color: #ff4444;">-${message.repLoss || 0} Reputation</div>
                        <div style="color: #ff8800; margin-top: 4px;">+15 Heat</div>
                        <div style="color: #ff4444; margin-top: 4px;">-${message.healthDamage || 0} Health (now ${message.newHealth || '?'})</div>
                        ${(message.gangMembersLost || 0) > 0 ? '<div style="color: #ff8800; margin-top: 4px;">Lost ' + message.gangMembersLost + ' gang member' + (message.gangMembersLost > 1 ? 's' : '') + ' in the firefight</div>' : ''}
                        <div style="color: #888; margin-top: 4px;">${message.bulletsUsed || 3} bullets wasted</div>
                        ${message.arrested ? '<div style="color: #ff0000; margin-top: 8px; font-weight: bold;">Jail Time: ' + (message.jailTime || 25) + ' seconds</div>' : ''}
                        <div style="color: #888; margin-top: 8px; font-size: 0.85em;">Hit chance was ${message.chance}%</div>
                        <div style="color: #ff8800; margin-top: 4px; font-size: 0.85em;">Next hit available in 10 minutes</div>
                    </div>
                    <div style="margin-top: 25px;">
                        ${message.arrested
                            ? '<button onclick="if(typeof showJailScreen===\'function\') showJailScreen();" style="background: #8b0000; color: #fff; padding: 12px 25px; border: 1px solid #ff0000; border-radius: 8px; cursor: pointer; font-family: \'Georgia\', serif;">Go to Jail</button>'
                            : '<button onclick="showAssassination()" style="background: #8b0000; color: #fff; padding: 12px 25px; border: 1px solid #ff0000; border-radius: 8px; cursor: pointer; font-family: \'Georgia\', serif; margin-right: 10px;">Try Again</button><button onclick="goBackToMainMenu()" style="background: #333; color: #c0a062; padding: 12px 25px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: \'Georgia\', serif;">Back</button>'
                        }
                    </div>
                </div>
            `;
        }

        // If arrested, auto-redirect to jail screen after a moment
        if (message.arrested && typeof showJailScreen === 'function') {
            setTimeout(() => showJailScreen(), 3000);
        }
    }
}

function handleAssassinationVictim(message) {
    // You were assassinated by someone — show notification
    if (typeof message.newMoney === 'number') player.money = message.newMoney;
    if (typeof updateUI === 'function') updateUI();

    const stolenStr = (message.stolenAmount || 0).toLocaleString();
    _safeLogAction(`You were assassinated by ${message.attackerName}! They stole $${stolenStr} (${message.stealPercent}%) of your cash!`);
    addWorldEvent(`${message.attackerName} assassinated you and stole $${stolenStr}!`);

    // Show prominent notification
    if (typeof showBriefNotification === 'function') {
        showBriefNotification(`ASSASSINATED by ${message.attackerName}! Lost $${stolenStr}!`, 6000);
    } else {
        window.ui.alert(`You were assassinated by ${message.attackerName}!\n\nThey stole $${stolenStr} (${message.stealPercent}%) of your cash!`);
    }
}

function handleAssassinationSurvived(message) {
    // Someone tried to kill you and failed
    _safeLogAction(`${message.attackerName} sent a hitman after you, but the attempt FAILED!`);
    addWorldEvent(`Survived an assassination attempt by ${message.attackerName}!`);

    if (typeof showBriefNotification === 'function') {
        showBriefNotification(`Survived a hit from ${message.attackerName}!`, 5000);
    } else {
        window.ui.alert(`Someone tried to assassinate you!\n\n${message.attackerName} sent a hitman, but you survived!`);
    }
}

// Player interaction functions
function challengePlayer(playerName) {
    if (!onlineWorldState.isConnected) {
        showSystemMessage('You need to be connected to the online world!', '#8b3a3a');
        return;
    }

    if (player.inJail) {
        showSystemMessage('You can\'t fight while in jail!', '#8b3a3a');
        return;
    }

    // Show challenge confirmation modal instead of confirm()
    let modal = document.getElementById('pvp-challenge-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'pvp-challenge-modal';
        modal.className = 'popup-overlay';
        document.body.appendChild(modal);
    }

    // Find target player info from nearby players
    const targetInfo = (onlineWorldState.nearbyPlayers || []).find(p => p.name === playerName);
    const targetRep = targetInfo ? (targetInfo.reputation || '?') : '?';

    modal.innerHTML = `
        <div class="popup-card popup-crimson" style="max-width:480px;">
            <h3 class="popup-title">Challenge to Combat</h3>
            <div style="margin:20px 0;display:grid;grid-template-columns:1fr auto 1fr;gap:15px;align-items:center;">
                <div class="popup-section" style="border-color:rgba(138, 154, 106,0.3);text-align:center;padding:15px;">
                    <div style="color:#8a9a6a;font-weight:bold;font-size:1.1em;">${escapeHTML(player.name || 'You')}</div>
                    <div style="color:#888;font-size:0.85em;margin-top:5px;">Respect: ${Math.floor(player.reputation || 0)}</div>
                </div>
                <div style="color:#8b0000;font-size:1.5em;font-weight:bold;">VS</div>
                <div class="popup-section" style="border-color:rgba(231,76,60,0.3);text-align:center;padding:15px;">
                    <div style="color:#8b3a3a;font-weight:bold;font-size:1.1em;">${escapeHTML(playerName)}</div>
                    <div style="color:#888;font-size:0.85em;margin-top:5px;">Respect: ${targetRep}</div>
                </div>
            </div>
            <p class="popup-subtitle">Winner gains Don Respect</p>
            <div class="popup-actions">
                <button onclick="executePvpChallenge('${escapeHTML(playerName)}')" class="popup-btn popup-btn-crimson">Fight</button>
                <button onclick="document.getElementById('pvp-challenge-modal').remove();" class="popup-btn popup-btn-secondary">Walk Away</button>
            </div>
        </div>
    `;
}

function executePvpChallenge(playerName) {
    // Remove confirmation modal
    const modal = document.getElementById('pvp-challenge-modal');
    if (modal) modal.remove();

    // Send challenge to server for authoritative resolution
    // Include combat stats so server can use the balanced formula
    if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        onlineWorldState.socket.send(JSON.stringify({
            type: 'player_challenge',
            targetPlayer: playerName,
            playerName: player.name,
            level: player.level,
            reputation: player.reputation,
            power: typeof calculatePower === 'function' ? calculatePower() : 0,
            gangMembers: (player.gang && player.gang.gangMembers ? player.gang.gangMembers : []).length
        }));

        // Show a "waiting" notification
        showSystemMessage(`Engaging ${playerName} in combat...`, '#c0a040');
        _safeLogAction(`Challenged ${playerName} to combat!`);
    } else {
        showSystemMessage('Connection lost. Try reconnecting.', '#8b3a3a');
        if (typeof updateUI === 'function') updateUI();
    }
}

// ==================== UTILITY FUNCTIONS ====================

// Setup online world UI
function setupOnlineWorldUI() {
    // Create multiplayer screen if it doesn't exist (reusing existing structure)
    if (!document.getElementById('multiplayer-screen')) {
        const multiplayerScreen = document.createElement('div');
        multiplayerScreen.id = 'multiplayer-screen';
        multiplayerScreen.className = 'game-screen';
        multiplayerScreen.style.display = 'none';
        
        const multiplayerContent = document.createElement('div');
        multiplayerContent.id = 'multiplayer-content';
        
        multiplayerScreen.appendChild(multiplayerContent);
        document.getElementById('game').appendChild(multiplayerScreen);
    }
}

// Save online world settings
function saveOnlineWorldData() {
    if (typeof(Storage) !== 'undefined') {
        const data = {
            playerId: onlineWorldState.playerId,
            lastConnected: new Date().toISOString(),
            // Don't save sensitive data like socket connections
        };
        localStorage.setItem('onlineWorldData', JSON.stringify(data));
    }
}

// spectateWar removed — Turf Wars replaced by Horse Betting in casino

function participateInEvent(eventType, district) {
    if (!onlineWorldState.isConnected) {
        window.ui.toast('You need to be connected to the online world!', 'error');
        return;
    }

    // Define event outcomes based on type
    const eventOutcomes = {
        police_raid: {
            title: 'Police Raid',
            icon: '',
            scenarios: [
                { text: 'You slipped through the police barricade and looted an evidence lockup.', moneyMin: 800, moneyMax: 3000, xp: 30, repGain: 3, successChance: 0.5, riskText: 'But a detective spotted you fleeing the scene.', healthLoss: 15, wantedGain: 1 },
                { text: 'Chaos erupted and you picked pockets in the confusion.', moneyMin: 300, moneyMax: 1200, xp: 15, repGain: 1, successChance: 0.65, riskText: 'A stray baton caught you across the ribs.', healthLoss: 10, wantedGain: 0 },
                { text: 'You tipped off a rival gang and the cops took them down instead.', moneyMin: 500, moneyMax: 2000, xp: 25, repGain: 5, successChance: 0.55, riskText: 'The rival gang figured out who snitched.', healthLoss: 20, wantedGain: 0 }
            ]
        },
        market_crash: {
            title: 'Market Crash',
            icon: '',
            scenarios: [
                { text: 'You bought seized assets at rock-bottom prices and flipped them.', moneyMin: 1500, moneyMax: 5000, xp: 35, repGain: 2, successChance: 0.6, riskText: 'Turns out the assets were flagged — you lost some to seizure.', healthLoss: 0, wantedGain: 1 },
                { text: 'You shorted a corrupt businessman\'s portfolio through your contacts.', moneyMin: 2000, moneyMax: 6000, xp: 40, repGain: 4, successChance: 0.45, riskText: 'The businessman sent enforcers to collect.', healthLoss: 15, wantedGain: 0 },
                { text: 'You laundered cash through panicking banks while no one was looking.', moneyMin: 1000, moneyMax: 4000, xp: 20, repGain: 1, successChance: 0.55, riskText: 'A suspicious teller flagged the transactions.', healthLoss: 0, wantedGain: 2 }
            ]
        },
        gang_meeting: {
            title: 'Gang Meeting',
            icon: '',
            scenarios: [
                { text: 'You impressed the bosses and received a cut of their operation.', moneyMin: 600, moneyMax: 2500, xp: 30, repGain: 6, successChance: 0.5, riskText: 'A rival at the meeting took offense and jumped you after.', healthLoss: 20, wantedGain: 0 },
                { text: 'You brokered a deal between two factions and took a commission.', moneyMin: 1000, moneyMax: 3500, xp: 35, repGain: 8, successChance: 0.45, riskText: 'One side felt you favored the other — they want payback.', healthLoss: 10, wantedGain: 0 },
                { text: 'You gathered intel on upcoming operations while making connections.', moneyMin: 200, moneyMax: 800, xp: 45, repGain: 4, successChance: 0.7, riskText: 'Someone noticed you eavesdropping a bit too much.', healthLoss: 5, wantedGain: 0 }
            ]
        }
    };

    // Default for unknown event types
    const eventData = eventOutcomes[eventType] || {
        title: eventType.replace(/_/g, ' '),
        icon: '\u2753',
        scenarios: [
            { text: 'You got involved and made some connections.', moneyMin: 300, moneyMax: 1500, xp: 20, repGain: 2, successChance: 0.55, riskText: 'Things didn\'t go entirely smooth.', healthLoss: 10, wantedGain: 0 }
        ]
    };

    // Pick a random scenario
    const scenario = eventData.scenarios[Math.floor(Math.random() * eventData.scenarios.length)];

    // Level bonus: higher level = slightly better success chance
    const levelBonus = Math.min(0.15, (player.reputation || 0) * 0.001);
    const success = Math.random() < (scenario.successChance + levelBonus);

    // Build the result modal
    let modal = document.getElementById('event-participation-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'event-participation-modal';
        modal.className = 'popup-overlay';
        document.body.appendChild(modal);
    }

    if (success) {
        const moneyEarned = scenario.moneyMin + Math.floor(Math.random() * (scenario.moneyMax - scenario.moneyMin));
        player.money += moneyEarned;
        player.reputation = (player.reputation || 0) + scenario.repGain;

        modal.innerHTML = `
            <div class="popup-card popup-success" style="max-width:550px;">
                <h3 class="popup-title">${eventData.icon} ${eventData.title}</h3>
                <p class="popup-subtitle">District: ${district.charAt(0).toUpperCase() + district.slice(1)}</p>
                <div class="popup-section" style="border-color:rgba(138, 154, 106,0.3);">
                    <p style="color:#8a9a6a;font-weight:bold;margin:0 0 8px 0;">? Success!</p>
                    <p style="margin:0;color:#ccc;">${scenario.text}</p>
                </div>
                <div class="popup-stats-grid">
                    <div class="popup-stat">
                        <div class="popup-stat-value" style="color:#8a9a6a;">+$${moneyEarned.toLocaleString()}</div>
                        <div class="popup-stat-label">Cash</div>
                    </div>
                    <div class="popup-stat">
                        <div class="popup-stat-value" style="color:#c0a040;">+${scenario.repGain} Rep</div>
                        <div class="popup-stat-label">Reputation</div>
                    </div>
                </div>
                <div class="popup-actions">
                    <button onclick="document.getElementById('event-participation-modal').remove();" class="popup-btn popup-btn-purple">Collect Rewards</button>
                </div>
            </div>
        `;

        _safeLogAction(`${eventData.icon} ${eventData.title} in ${district}: earned $${moneyEarned.toLocaleString()}, +${scenario.repGain} Rep`);
        addWorldEvent(`${eventData.icon} ${player.name || 'A player'} profited from the ${eventData.title.toLowerCase()} in ${district}!`);
    } else {
        // Failure — still get partial rewards but take a hit
        const partialMoney = Math.floor(scenario.moneyMin * 0.3);
        player.money += partialMoney;
        player.health = Math.max(0, (player.health || 100) - scenario.healthLoss);
        player.heat = Math.min(10, (player.heat || 0) + scenario.wantedGain);

        modal.innerHTML = `
            <div class="popup-card popup-danger" style="max-width:550px;">
                <h3 class="popup-title">${eventData.icon} ${eventData.title}</h3>
                <p class="popup-subtitle">District: ${district.charAt(0).toUpperCase() + district.slice(1)}</p>
                <div class="popup-section" style="border-color:rgba(231,76,60,0.3);">
                    <p style="color:#8b3a3a;font-weight:bold;margin:0 0 8px 0;">? Things went south...</p>
                    <p style="margin:0 0 8px 0;color:#ccc;">${scenario.text.split('.')[0]}... but ${scenario.riskText.toLowerCase()}</p>
                </div>
                <div class="popup-stats-grid">
                    <div class="popup-stat">
                        <div class="popup-stat-value" style="color:#e67e22;">+$${partialMoney.toLocaleString()}</div>
                        <div class="popup-stat-label">Salvaged</div>
                    </div>
                    <div class="popup-stat">
                        <div class="popup-stat-value" style="color:#8b3a3a;">-${scenario.healthLoss} HP</div>
                        <div class="popup-stat-label">Health</div>
                    </div>
                    ${scenario.wantedGain > 0 ? `
                    <div class="popup-stat">
                        <div class="popup-stat-value" style="color:#8b3a3a;">+${scenario.wantedGain} ?</div>
                        <div class="popup-stat-label">Wanted</div>
                    </div>` : ''}
                </div>
                <div class="popup-actions">
                    <button onclick="document.getElementById('event-participation-modal').remove();" class="popup-btn popup-btn-danger">Dust Yourself Off</button>
                </div>
            </div>
        `;

        _safeLogAction(`${eventData.icon} ${eventData.title} in ${district}: went wrong! ${scenario.riskText} -${scenario.healthLoss} HP`);
    }

    // Update UI
    if (typeof updateUI === 'function') updateUI();
}

// ==================== PHASE C: ALLIANCE PANEL ====================

let _currentAllianceData = null;
let _allianceActiveTab = 'info'; // 'info' or 'territories'

function showAlliancePanel() {
    if (!ensureConnected()) return;

    // Request alliance info from server
    if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        onlineWorldState.socket.send(JSON.stringify({ type: 'alliance_info' }));
        // Also request territory data for the territories tab
        onlineWorldState.socket.send(JSON.stringify({ type: 'territory_info' }));
    }

    _allianceActiveTab = 'info';

    const content = document.getElementById('multiplayer-content');
    content.innerHTML = `
        <h2 style="color: #c0a062; font-family: Georgia, serif;">Alliances</h2>
        <p style="color: #ccc;">Form powerful alliances with other players. Share territory bonuses and deposit to a shared treasury.</p>
        <div id="alliance-tab-bar" style="display: none; margin-bottom: 16px;"></div>
        <div id="alliance-panel-content" style="color: #888; text-align: center; padding: 30px;">Loading alliance data...</div>
        <div style="text-align: center; margin-top: 30px;">
            <button onclick="showOnlineWorld()" style="background: #333; color: #c0a062; padding: 12px 25px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: Georgia, serif;">? Back to Commission</button>
        </div>
    `;
    hideAllScreens();
    const ms1 = document.getElementById('multiplayer-screen');
    if (ms1) ms1.style.display = 'block';
}

function handleAllianceInfoResult(message) {
    _currentAllianceData = message;
    const container = document.getElementById('alliance-panel-content');
    if (!container) return;

    const myAlliance = message.myAlliance;
    const allAlliances = message.allAlliances || [];

    // Show tab bar only if player is in an alliance
    const tabBar = document.getElementById('alliance-tab-bar');
    if (tabBar && myAlliance) {
        tabBar.style.display = 'flex';
        const tabStyle = (active) => `background: ${active ? '#c0a062' : '#333'}; color: ${active ? '#000' : '#c0a062'}; padding: 10px 24px; border: 1px solid #c0a062; border-radius: 8px 8px 0 0; cursor: pointer; font-family: Georgia, serif; font-weight: ${active ? 'bold' : 'normal'}; font-size: 0.95em; border-bottom: ${active ? '2px solid #000' : '1px solid #c0a062'};`;
        tabBar.innerHTML = `
            <button onclick="switchAllianceTab('info')" style="${tabStyle(_allianceActiveTab === 'info')}">Alliance Info</button>
            <button onclick="switchAllianceTab('territories')" style="${tabStyle(_allianceActiveTab === 'territories')}">Alliance Territories</button>
        `;
    } else if (tabBar) {
        tabBar.style.display = 'none';
    }

    // If territories tab is active, render that instead
    if (_allianceActiveTab === 'territories' && myAlliance) {
        renderAllianceTerritoriesTab();
        return;
    }

    let html = '';

    if (myAlliance) {
        // Show my alliance details
        const isLeader = myAlliance.leaderName === (player.name || '');
        html += `
            <div style="background: rgba(0,0,0,0.8); padding: 20px; border-radius: 12px; border: 2px solid #c0a062; margin-bottom: 20px;">
                <h3 style="color: #c0a062; margin: 0 0 5px 0;">[${escapeHTML(myAlliance.tag)}] ${escapeHTML(myAlliance.name)}</h3>
                <p style="color: #888; font-style: italic; margin: 5px 0;">"${escapeHTML(myAlliance.motto)}"</p>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin: 15px 0;">
                    <div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 6px;">
                        <div style="color: #c0a062; font-size: 1.3em; font-weight: bold;">${myAlliance.memberCount}/${myAlliance.maxMembers}</div>
                        <div style="color: #888; font-size: 0.8em;">Members</div>
                    </div>
                    <div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 6px;">
                        <div style="color: #8a9a6a; font-size: 1.3em; font-weight: bold;">$${(myAlliance.treasury || 0).toLocaleString()}</div>
                        <div style="color: #888; font-size: 0.8em;">Treasury</div>
                    </div>
                    <div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 6px;">
                        <div style="color: #c0a040; font-size: 1.3em; font-weight: bold;">${escapeHTML(myAlliance.leaderName)}</div>
                        <div style="color: #888; font-size: 0.8em;">Leader</div>
                    </div>
                </div>
                <h4 style="color: #ccc; margin: 10px 0 5px;">Members:</h4>
                ${myAlliance.members.map(m => `<div style="padding:5px;color:${m === myAlliance.leaderName ? '#ffd700' : '#ccc'};">${m === myAlliance.leaderName ? '' : ''} ${escapeHTML(m)}</div>`).join('')}
                <div style="display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap;">
                    <button onclick="allianceDeposit()" style="background: #8a9a6a; color: #000; padding: 8px 15px; border:1px solid #c0a062; border-radius: 6px; cursor: pointer; font-weight: bold;">Deposit</button>
                    ${isLeader ? '<button onclick="allianceInvitePrompt()" style="background: #c0a062; color: #fff; padding: 8px 15px; border:1px solid #c0a062; border-radius: 6px; cursor: pointer;">Invite</button>' : ''}
                    ${isLeader ? '<button onclick="allianceKickPrompt()" style="background: #8b3a3a; color: #fff; padding: 8px 15px; border:1px solid #c0a062; border-radius: 6px; cursor: pointer;">Kick</button>' : ''}
                    ${isLeader ? '<button onclick="showDisciplinePanel()" style="background: #8b0000; color: #fff; padding: 8px 15px; border:1px solid #c0a062; border-radius: 6px; cursor: pointer;">Discipline</button>' : ''}
                    <button onclick="allianceLeave()" style="background: #666; color: #fff; padding: 8px 15px; border:1px solid #c0a062; border-radius: 6px; cursor: pointer;">Leave</button>
                </div>
            </div>
        `;
    } else {
        // Show create alliance form
        html += `
            <div style="background: rgba(0,0,0,0.8); padding: 20px; border-radius: 12px; border: 2px solid #c0a062; margin-bottom: 20px;">
                <h3 style="color: #c0a062; margin: 0 0 10px 0;">Found an Alliance</h3>
                <p style="color: #888;">Cost: $10,000 | Max 4 members</p>
                <div style="display: grid; gap: 10px; margin: 15px 0;">
                    <input id="alliance-name-input" type="text" placeholder="Alliance Name (3-24 chars)" maxlength="24" style="padding: 10px; background: #222; color: #c0a062; border: 1px solid #c0a062; border-radius: 6px;">
                    <input id="alliance-tag-input" type="text" placeholder="Tag (2-4 chars, e.g. MAFIA)" maxlength="4" style="padding: 10px; background: #222; color: #c0a062; border: 1px solid #c0a062; border-radius: 6px; text-transform: uppercase;">
                    <input id="alliance-motto-input" type="text" placeholder="Motto (optional)" maxlength="80" style="padding: 10px; background: #222; color: #c0a062; border: 1px solid #c0a062; border-radius: 6px;">
                </div>
                <button onclick="createAlliance()" style="background: #c0a062; color: #000; padding: 12px 25px; border:1px solid #c0a062; border-radius: 8px; cursor: pointer; font-weight: bold; font-family: Georgia, serif; width: 100%;">Found Alliance ($10,000)</button>
            </div>
        `;
    }

    // Show all alliances
    if (allAlliances.length > 0) {
        html += `<div style="background: rgba(0,0,0,0.6); padding: 15px; border-radius: 10px; border: 1px solid #555;">
            <h3 style="color: #ccc; margin: 0 0 10px 0;">All Active Alliances</h3>
            ${allAlliances.map(a => `
                <div style="padding: 10px; margin: 5px 0; background: rgba(255,255,255,0.05); border-radius: 6px; border-left: 3px solid #c0a062;">
                    <strong style="color: #c0a062;">[${escapeHTML(a.tag)}] ${escapeHTML(a.name)}</strong>
                    <span style="color: #888; margin-left: 10px;">${a.memberCount}/${a.maxMembers} members | Leader: ${escapeHTML(a.leaderName)} | Treasury: $${(a.treasury || 0).toLocaleString()}</span>
                </div>
            `).join('')}
        </div>`;
    }

    container.innerHTML = html;
}

function switchAllianceTab(tab) {
    _allianceActiveTab = tab;
    if (_currentAllianceData) {
        handleAllianceInfoResult(_currentAllianceData);
    }
}
window.switchAllianceTab = switchAllianceTab;

function renderAllianceTerritoriesTab() {
    const container = document.getElementById('alliance-panel-content');
    if (!container || !_currentAllianceData || !_currentAllianceData.myAlliance) return;

    const myAlliance = _currentAllianceData.myAlliance;
    const memberNames = myAlliance.members || [];
    const tState = (typeof onlineWorldState !== 'undefined' && onlineWorldState.territories) || {};

    // Find all districts owned by alliance members
    const allianceTerritories = [];
    if (typeof DISTRICTS !== 'undefined') {
        DISTRICTS.forEach(d => {
            const terr = tState[d.id];
            if (terr && terr.owner && memberNames.includes(terr.owner)) {
                allianceTerritories.push({ district: d, data: terr });
            }
        });
    }

    let html = '<div id="alliance-territories-tab-content">';

    // Summary
    const totalDistricts = allianceTerritories.length;
    const totalResidents = allianceTerritories.reduce((sum, t) => sum + (t.data.residents || []).length, 0);
    const totalTax = allianceTerritories.reduce((sum, t) => sum + (t.data.taxCollected || 0), 0);
    const uniqueOwners = [...new Set(allianceTerritories.map(t => t.data.owner))];

    html += `
        <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; justify-content: center;">
            <div style="background: rgba(0,0,0,0.5); padding: 10px 18px; border-radius: 8px; border: 1px solid rgba(192,160,98,0.3); text-align: center; min-width: 100px;">
                <div style="color: #c0a062; font-size: 1.3em; font-weight: bold;">${totalDistricts}</div>
                <div style="color: #888; font-size: 0.8em;">Districts Held</div>
            </div>
            <div style="background: rgba(0,0,0,0.5); padding: 10px 18px; border-radius: 8px; border: 1px solid rgba(138, 154, 106,0.3); text-align: center; min-width: 100px;">
                <div style="color: #8a9a6a; font-size: 1.3em; font-weight: bold;">${totalResidents}</div>
                <div style="color: #888; font-size: 0.8em;">Total Residents</div>
            </div>
            <div style="background: rgba(0,0,0,0.5); padding: 10px 18px; border-radius: 8px; border: 1px solid rgba(138, 154, 106,0.3); text-align: center; min-width: 100px;">
                <div style="color: #8a9a6a; font-size: 1.3em; font-weight: bold;">$${totalTax.toLocaleString()}</div>
                <div style="color: #888; font-size: 0.8em;">Total Tax Revenue</div>
            </div>
            <div style="background: rgba(0,0,0,0.5); padding: 10px 18px; border-radius: 8px; border: 1px solid rgba(243,156,18,0.3); text-align: center; min-width: 100px;">
                <div style="color: #c0a040; font-size: 1.3em; font-weight: bold;">${uniqueOwners.length}</div>
                <div style="color: #888; font-size: 0.8em;">Territory Holders</div>
            </div>
        </div>
    `;

    if (allianceTerritories.length > 0) {
        html += '<div style="display: flex; flex-wrap: wrap; gap: 14px; justify-content: center;">';
        allianceTerritories.forEach(({ district: d, data: terr }) => {
            const isMe = terr.owner === (player.name || '');
            const resCount = (terr.residents || []).length;
            const residents = terr.residents || [];

            // Build compact residents list
            let residentsHTML = '';
            if (residents.length > 0) {
                const shown = residents.slice(0, 6);
                residentsHTML = '<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">';
                residentsHTML += '<span style="color: #c0a062; font-size: 0.8em; font-weight: bold;">Residents:</span><br>';
                residentsHTML += shown.map(r => `<span style="color: #d4c4a0; font-size: 0.8em;">${typeof r === 'string' ? r : (r.name || 'Unknown')}</span>`).join('<br>');
                if (residents.length > 6) {
                    residentsHTML += `<br><span style="color: #888; font-size: 0.75em;">...and ${residents.length - 6} more</span>`;
                }
                residentsHTML += '</div>';
            }

            html += `
                <div style="background: rgba(20, 18, 10,0.85); border: 2px solid ${isMe ? '#d4af37' : '#c0a062'}; border-radius: 12px;
                            padding: 16px; min-width: 230px; max-width: 290px; text-align: left;">
                    <div style="font-size: 1.6em; margin-bottom: 4px;">${d.icon}</div>
                    <h4 style="color: #c0a062; margin: 0 0 4px;">${d.shortName}</h4>
                    <div style="font-size: 0.85em; color: #d4c4a0; line-height: 1.6;">
                        <span>Owner: <strong style="color: ${isMe ? '#ffd700' : '#c0a040'};">${isMe ? 'YOU' : escapeHTML(terr.owner)}</strong></span><br>
                        <span>Residents: ${resCount}</span><br>
                        <span>Defense: ${terr.defenseRating || 100}</span><br>
                        <span>Tax: $${(terr.taxCollected || 0).toLocaleString()}</span><br>
                        <span>Base Income: $${d.baseIncome.toLocaleString()}</span>
                    </div>
                    ${residentsHTML}
                </div>
            `;
        });
        html += '</div>';
    } else {
        html += '<p style="color: #888; text-align: center; padding: 30px;">No alliance member owns any districts yet. Claim districts via Relocate to build your alliance\'s territory empire.</p>';
    }

    // Show which members hold no territory
    const membersWithout = memberNames.filter(name => !uniqueOwners.includes(name));
    if (membersWithout.length > 0 && allianceTerritories.length > 0) {
        html += `
            <div style="margin-top: 16px; padding: 12px; background: rgba(0,0,0,0.4); border-radius: 8px; border-left: 3px solid #555;">
                <span style="color: #888; font-size: 0.85em;">Members without territory: ${membersWithout.map(n => escapeHTML(n)).join(', ')}</span>
            </div>
        `;
    }

    html += '</div>';
    container.innerHTML = html;
}
window.renderAllianceTerritoriesTab = renderAllianceTerritoriesTab;

function createAlliance() {
    const name = document.getElementById('alliance-name-input')?.value?.trim();
    const tag = document.getElementById('alliance-tag-input')?.value?.trim();
    const motto = document.getElementById('alliance-motto-input')?.value?.trim();
    if (!name || !tag) { showSystemMessage('Enter a name and tag.', '#8b3a3a'); return; }
    sendMP({ type: 'alliance_create', name, tag, motto });
}

function allianceInvitePrompt() {
    const target = prompt('Enter player name to invite:');
    if (target) sendMP({ type: 'alliance_invite', targetPlayer: target.trim() });
}

function allianceKickPrompt() {
    const target = prompt('Enter member name to kick:');
    if (target) sendMP({ type: 'alliance_kick', targetPlayer: target.trim() });
}

function allianceDeposit() {
    const amount = prompt('Amount to deposit into alliance treasury ($100 min):');
    if (amount) sendMP({ type: 'alliance_deposit', amount: parseInt(amount) });
}

function allianceLeave() {
    if (confirm('Leave your alliance? This cannot be undone.')) {
        sendMP({ type: 'alliance_leave' });
    }
}

function handleAllianceResult(message) {
    if (!message.success) {
        showSystemMessage(message.error || 'Alliance action failed.', '#8b3a3a');
        return;
    }

    switch (message.action) {
        case 'created':
            showMPToast(`Alliance [${message.alliance.tag}] ${message.alliance.name} founded!`, '#c0a062', 5000);
            if (typeof updateUI === 'function') updateUI();
            showAlliancePanel(); // Refresh
            break;
        case 'invited':
            showMPToast(`Invite sent to ${message.targetPlayer}.`, '#c0a062');
            break;
        case 'member_joined':
            showMPToast(`${message.newMember} joined the alliance!`, '#8a9a6a');
            showAlliancePanel();
            break;
        case 'left':
            showMPToast(`You left ${message.allianceName}.`, '#888');
            showAlliancePanel();
            break;
        case 'kicked':
            showMPToast(`You were kicked from ${message.allianceName}!`, '#8b3a3a');
            showAlliancePanel();
            break;
        case 'member_left':
            showMPToast(`${message.leftMember} left the alliance.`, '#888');
            break;
        case 'member_kicked':
            showMPToast(`${message.kickedMember} was kicked.`, '#8b3a3a');
            break;
        case 'deposit':
            showMPToast(`${message.depositor} deposited $${(message.amount || 0).toLocaleString()} to treasury.`, '#8a9a6a');
            // Sync depositor's money
            if (typeof message.newMoney === 'number') {
                player.money = message.newMoney;
            }
            // Update cached alliance data with new treasury
            if (message.alliance) {
                _currentAllianceData = { myAlliance: message.alliance, allAlliances: _currentAllianceData?.allAlliances || [] };
            }
            // Refresh UI so treasury and cash display update
            if (typeof updateUI === 'function') updateUI();
            showAlliancePanel();
            break;
    }
}

// ==================== ALLIANCE DISCIPLINE SYSTEM ====================

function showDisciplinePanel() {
    if (!_currentAllianceData || !_currentAllianceData.myAlliance) {
        showSystemMessage('No alliance data loaded.', '#8b3a3a');
        return;
    }
    const myAlliance = _currentAllianceData.myAlliance;
    const members = myAlliance.members.filter(m => m !== myAlliance.leaderName);

    if (members.length === 0) {
        showSystemMessage('No members to discipline.', '#c0a040');
        return;
    }

    // Remove existing modal if present
    const existing = document.getElementById('discipline-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'discipline-modal';
    modal.className = 'popup-overlay';
    modal.innerHTML = `
        <div class="popup-card" style="max-width:520px; background: #0d0d0d; border: 2px solid #8b0000;">
            <h2 style="color: #8b0000; font-family: Georgia, serif; margin: 0 0 5px; text-align: center;">Discipline a Member</h2>
            <p style="color: #888; text-align: center; font-size: 0.85em; margin-bottom: 18px;">As leader of [${escapeHTML(myAlliance.tag)}] ${escapeHTML(myAlliance.name)}, bring order to your ranks.<br>All punishments are broadcast live to every player.</p>

            <div style="margin-bottom: 14px;">
                <label style="color: #ccc; font-size: 0.9em; display: block; margin-bottom: 5px;">Target Member</label>
                <select id="discipline-target" style="width: 100%; padding: 10px; background: #1a1a1a; color: #c0a062; border: 1px solid #555; border-radius: 6px; font-family: Georgia, serif;">
                    <option value="">— Select a member —</option>
                    ${members.map(m => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join('')}
                </select>
            </div>

            <div style="margin-bottom: 14px;">
                <label style="color: #ccc; font-size: 0.9em; display: block; margin-bottom: 8px;">Punishment</label>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <label onclick="document.getElementById('discipline-type-warning').checked = true" style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: rgba(243,156,18,0.1); border: 2px solid rgba(243,156,18,0.3); border-radius: 8px; cursor: pointer; transition: border-color 0.2s;">
                        <input type="radio" name="discipline-type" id="discipline-type-warning" value="warning" checked style="margin-top: 3px;">
                        <div>
                            <div style="color: #c0a040; font-weight: bold;">Formal Warning</div>
                            <div style="color: #888; font-size: 0.8em;">A public notice that this member is on thin ice. A slap on the wrist — everyone sees it.</div>
                        </div>
                    </label>
                    <label onclick="document.getElementById('discipline-type-humiliation').checked = true" style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: rgba(231,76,60,0.1); border: 2px solid rgba(231,76,60,0.3); border-radius: 8px; cursor: pointer; transition: border-color 0.2s;">
                        <input type="radio" name="discipline-type" id="discipline-type-humiliation" value="humiliation" style="margin-top: 3px;">
                        <div>
                            <div style="color: #8b3a3a; font-weight: bold;">Public Humiliation</div>
                            <div style="color: #888; font-size: 0.8em;">Drag their name through the mud in front of the entire city. Maximum embarrassment.</div>
                        </div>
                    </label>
                    <label onclick="document.getElementById('discipline-type-punishment').checked = true" style="display: flex; align-items: flex-start; gap: 10px; padding: 12px; background: rgba(139,0,0,0.15); border: 2px solid rgba(139,0,0,0.4); border-radius: 8px; cursor: pointer; transition: border-color 0.2s;">
                        <input type="radio" name="discipline-type" id="discipline-type-punishment" value="punishment" style="margin-top: 3px;">
                        <div>
                            <div style="color: #ff4444; font-weight: bold;">Serious Punishment</div>
                            <div style="color: #888; font-size: 0.8em;">Make an example of them. The whole server sees this — a message to anyone who steps out of line.</div>
                        </div>
                    </label>
                </div>
            </div>

            <div style="margin-bottom: 18px;">
                <label style="color: #ccc; font-size: 0.9em; display: block; margin-bottom: 5px;">Reason <span style="color:#555;">(optional, max 100 chars)</span></label>
                <input id="discipline-reason" type="text" maxlength="100" placeholder="e.g. Disrespected the family..." style="width: 100%; padding: 10px; background: #1a1a1a; color: #c0a062; border: 1px solid #555; border-radius: 6px; font-family: Georgia, serif; box-sizing: border-box;">
            </div>

            <div style="display: flex; gap: 10px; justify-content: center;">
                <button onclick="executeDiscipline()" style="background: linear-gradient(135deg, #8b0000, #5a0000); color: #fff; padding: 12px 30px; border: 1px solid #ff4444; border-radius: 8px; cursor: pointer; font-family: Georgia, serif; font-weight: bold; font-size: 1em;">Execute Punishment</button>
                <button onclick="document.getElementById('discipline-modal').remove()" style="background: #333; color: #aaa; padding: 12px 20px; border: 1px solid #555; border-radius: 8px; cursor: pointer; font-family: Georgia, serif;">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}
window.showDisciplinePanel = showDisciplinePanel;

function executeDiscipline() {
    const target = document.getElementById('discipline-target')?.value;
    if (!target) { showSystemMessage('Select a member to discipline.', '#8b3a3a'); return; }

    const typeRadio = document.querySelector('input[name="discipline-type"]:checked');
    if (!typeRadio) { showSystemMessage('Select a punishment type.', '#8b3a3a'); return; }

    const reason = document.getElementById('discipline-reason')?.value?.trim() || '';

    sendMP({
        type: 'alliance_discipline',
        targetPlayer: target,
        disciplineType: typeRadio.value,
        reason: reason
    });

    // Close the modal
    const modal = document.getElementById('discipline-modal');
    if (modal) modal.remove();
}
window.executeDiscipline = executeDiscipline;

function handleAllianceDisciplineResult(message) {
    if (!message.success) {
        showSystemMessage(message.error || 'Discipline action failed.', '#8b3a3a');
        return;
    }

    const typeColors = { warning: '#c0a040', humiliation: '#8b3a3a', punishment: '#8b0000' };
    const color = typeColors[message.disciplineType] || '#c0a062';

    switch (message.action) {
        case 'issued':
            // Leader confirmation
            showMPToast(`${message.icon} ${message.disciplineName} issued to ${message.targetPlayer}.`, color, 5000);
            break;

        case 'received': {
            // The victim sees a dramatic full-screen popup
            const popup = document.createElement('div');
            popup.id = 'discipline-received-modal';
            popup.className = 'popup-overlay';
            const borderColor = color;
            popup.innerHTML = `
                <div class="popup-card" style="max-width:450px; background: #0a0a0a; border: 3px solid ${borderColor}; text-align: center;">
                    <div style="font-size: 3em; margin-bottom: 10px;">${message.icon}</div>
                    <h2 style="color: ${borderColor}; font-family: Georgia, serif; margin: 0 0 8px;">${escapeHTML(message.disciplineName)}</h2>
                    <p style="color: #ccc; font-size: 1.05em; line-height: 1.5;">
                        <strong style="color: #ffd700;">${escapeHTML(message.leaderName)}</strong>, leader of
                        <strong style="color: #c0a062;">[${escapeHTML(message.allianceTag)}] ${escapeHTML(message.allianceName)}</strong>,
                        has disciplined you.
                    </p>
                    ${message.reason ? `<p style="color: #8b3a3a; font-style: italic; border-left: 3px solid ${borderColor}; padding-left: 12px; margin: 15px 20px;">"${escapeHTML(message.reason)}"</p>` : ''}
                    <p style="color: #666; font-size: 0.85em; margin-top: 12px;">This has been broadcast to all players in the city.</p>
                    <button onclick="document.getElementById('discipline-received-modal').remove()" style="background: ${borderColor}; color: #fff; padding: 12px 30px; border:1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: Georgia, serif; font-weight: bold; margin-top: 15px;">Understood</button>
                </div>
            `;
            document.body.appendChild(popup);
            break;
        }

        case 'witnessed':
            // Other alliance members see a toast
            showMPToast(`${message.icon} ${message.leaderName} disciplined ${message.targetPlayer} — ${message.disciplineName}`, color, 6000);
            break;
    }
}

function handleAllianceInviteReceived(message) {
    showMPToast(`${message.inviterName} invited you to [${message.allianceTag}] ${message.allianceName}!`, '#c0a062', 10000);
    // Show accept/decline popup
    const modal = document.createElement('div');
    modal.id = 'alliance-invite-modal';
    modal.className = 'popup-overlay';
    modal.innerHTML = `
        <div class="popup-card" style="max-width:400px;">
            <h3 class="popup-title">Alliance Invite</h3>
            <p class="popup-text">${escapeHTML(message.inviterName)} invited you to join:</p>
            <h2 style="color:#ffd700;margin:10px 0;text-align:center;font-family:'Georgia',serif;">[${escapeHTML(message.allianceTag)}] ${escapeHTML(message.allianceName)}</h2>
            <div class="popup-actions">
                <button onclick="sendMP({type:'alliance_join',allianceId:'${message.allianceId}'});document.getElementById('alliance-invite-modal').remove();" class="popup-btn popup-btn-success">Accept</button>
                <button onclick="document.getElementById('alliance-invite-modal').remove();" class="popup-btn popup-btn-danger">Decline</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// ==================== PHASE C: BOUNTY BOARD ====================

function showBountyBoard() {
    if (!ensureConnected()) return;

    // Request bounty list from server
    sendMP({ type: 'bounty_list' });

    const content = document.getElementById('multiplayer-content');
    content.innerHTML = `
        <h2 style="color: #ff6600; font-family: Georgia, serif;">Bounty Board</h2>
        <p style="color: #ccc;">Place bounties on rival players. Kill the target in PvP combat to auto-collect the reward.</p>

        <div style="background: rgba(0,0,0,0.8); padding: 20px; border-radius: 12px; border: 2px solid #ff6600; margin-bottom: 20px;">
            <h3 style="color: #ff6600; margin: 0 0 10px;">Post a Bounty</h3>
            <div style="display: grid; gap: 10px;">
                <input id="bounty-target-input" type="text" placeholder="Target player name" style="padding: 10px; background: #222; color: #ff6600; border: 1px solid #ff6600; border-radius: 6px;">
                <input id="bounty-reward-input" type="number" placeholder="Reward ($5,000 - $500,000)" min="5000" max="500000" style="padding: 10px; background: #222; color: #ff6600; border: 1px solid #ff6600; border-radius: 6px;">
                <input id="bounty-reason-input" type="text" placeholder="Reason (optional)" maxlength="60" style="padding: 10px; background: #222; color: #ff6600; border: 1px solid #ff6600; border-radius: 6px;">
                <label style="display: flex; align-items: center; gap: 10px; padding: 8px; background: rgba(139,0,0,0.2); border: 1px solid #8b0000; border-radius: 6px; cursor: pointer;">
                    <input id="bounty-anonymous-input" type="checkbox" style="width: 18px; height: 18px; accent-color: #8b0000; cursor: pointer;">
                    <span style="color: #ff4444; font-weight: bold;">Post Anonymously</span>
                    <span style="color: #888; font-size: 0.85em;">(2x cost — your name stays hidden)</span>
                </label>
            </div>
            <button onclick="postBounty()" style="background: #ff6600; color: #000; padding: 12px 25px; border:1px solid #c0a062; border-radius: 8px; cursor: pointer; font-weight: bold; font-family: Georgia, serif; width: 100%; margin-top: 10px;">Post Bounty (money deducted upfront)</button>
        </div>

        <div id="bounty-list-content" style="color: #888; text-align: center; padding: 20px;">Loading bounties...</div>

        <div style="text-align: center; margin-top: 30px;">
            <button onclick="showOnlineWorld()" style="background: #333; color: #c0a062; padding: 12px 25px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: Georgia, serif;">? Back to Commission</button>
        </div>
    `;
    hideAllScreens();
    const ms2 = document.getElementById('multiplayer-screen');
    if (ms2) ms2.style.display = 'block';
}

function postBounty() {
    const target = document.getElementById('bounty-target-input')?.value?.trim();
    const reward = parseInt(document.getElementById('bounty-reward-input')?.value);
    const reason = document.getElementById('bounty-reason-input')?.value?.trim();
    const anonymous = document.getElementById('bounty-anonymous-input')?.checked || false;
    if (!target) { showSystemMessage('Enter a target name.', '#8b3a3a'); return; }
    if (!reward || reward < 5000) { showSystemMessage('Minimum bounty is $5,000.', '#8b3a3a'); return; }
    sendMP({ type: 'post_bounty', targetPlayer: target, reward, reason, anonymous });
}

function handleBountyResult(message) {
    if (!message.success) {
        showSystemMessage(message.error || 'Bounty action failed.', '#8b3a3a');
        return;
    }
    if (message.action === 'posted') {
        showMPToast(`Bounty posted on ${message.bounty.targetName}!`, '#ff6600', 4000);
        player.money = message.newMoney || player.money;
        if (typeof updateUI === 'function') updateUI();
        sendMP({ type: 'bounty_list' }); // Refresh list
    } else if (message.action === 'cancelled') {
        showMPToast(`Bounty cancelled. Refund: $${(message.refund || 0).toLocaleString()} (50% cancellation fee)`, '#888', 4000);
        player.money = message.newMoney || player.money;
        if (typeof updateUI === 'function') updateUI();
        sendMP({ type: 'bounty_list' });
    }
}

function handleBountyAlert(message) {
    showMPToast(`${message.message}`, '#ff0000', 8000);
}

function handleBountyListResult(message) {
    const container = document.getElementById('bounty-list-content');
    if (!container) return;

    const bounties = message.bounties || [];
    if (bounties.length === 0) {
        container.innerHTML = '<div style="color:#888;text-align:center;padding:20px;">No active bounties. The streets are calm... for now.</div>';
        return;
    }

    container.innerHTML = `
        <h3 style="color: #ff6600; margin: 0 0 10px;">Active Bounties (${bounties.length})</h3>
        ${bounties.map(b => {
            const timeLeft = Math.max(0, Math.floor(b.timeLeft / 60000));
            const isMyBounty = b.posterName === (player.name || '');
            const isOnMe = b.targetName === (player.name || '');
            return `
                <div style="padding: 12px; margin: 8px 0; background: rgba(${isOnMe ? '139,0,0' : '255,102,0'},0.15); border-radius: 8px; border-left: 4px solid ${isOnMe ? '#ff0000' : '#ff6600'};">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong style="color: #ff6600; font-size: 1.1em;">${escapeHTML(b.targetName)}</strong>
                            ${isOnMe ? '<span style="color:#ff0000;font-weight:bold;margin-left:8px;">THAT\'S YOU!</span>' : ''}
                            <div style="color: #888; font-size: 0.85em;">${escapeHTML(b.reason || 'Wanted dead or alive.')}</div>
                            <div style="color: #666; font-size: 0.8em;">Posted by: ${b.anonymous ? '<span style="color:#8b0000;font-style:italic;">Anonymous</span>' : escapeHTML(b.posterName)} | Expires in ${timeLeft} min</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="color: #8a9a6a; font-size: 1.3em; font-weight: bold;">$${b.reward.toLocaleString()}</div>
                            ${isMyBounty ? `<button onclick="sendMP({type:'cancel_bounty',bountyId:'${b.id}'})" style="background:#8b3a3a;color:#fff;padding:4px 10px;border:1px solid #c0a062;border-radius:4px;cursor:pointer;font-size:0.8em;margin-top:5px;">Cancel</button>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('')}
    `;
}

// ==================== PHASE C: RANKED SEASON ====================

function showRankedSeason() {
    if (!ensureConnected()) return;

    sendMP({ type: 'season_info' });

    const content = document.getElementById('multiplayer-content');
    content.innerHTML = `
        <h2 style="color: #ffd700; font-family: Georgia, serif;">Ranked Season</h2>
        <p style="color: #ccc;">Compete in ranked PvP combat. Your combat rating determines your tier. Seasons last 30 days with soft resets.</p>
        <div id="season-info-content" style="color: #888; text-align: center; padding: 30px;">Loading season data...</div>
        <div style="text-align: center; margin-top: 30px;">
            <button onclick="showOnlineWorld()" style="background: #333; color: #c0a062; padding: 12px 25px; border: 1px solid #c0a062; border-radius: 8px; cursor: pointer; font-family: Georgia, serif;">? Back to Commission</button>
        </div>
    `;
    hideAllScreens();
    const ms3 = document.getElementById('multiplayer-screen');
    if (ms3) ms3.style.display = 'block';
}

function handleSeasonInfoResult(message) {
    const container = document.getElementById('season-info-content');
    if (!container) return;

    const season = message.season;
    const myRating = message.myRating;
    const topPlayers = message.topPlayers || [];
    const daysLeft = Math.max(0, Math.ceil(season.timeLeft / (24 * 60 * 60 * 1000)));

    const tiers = [
        { name: 'Bronze', min: 0, color: '#cd7f32', icon: 'III' },
        { name: 'Silver', min: 1000, color: '#c0c0c0', icon: 'II' },
        { name: 'Gold', min: 1500, color: '#ffd700', icon: 'I' },
        { name: 'Diamond', min: 2000, color: '#b9f2ff', icon: '*' },
        { name: 'Kingpin', min: 2500, color: '#ff4500', icon: 'K' }
    ];

    const currentTier = tiers.find(t => t.name === myRating.tier) || tiers[0];
    const nextTier = tiers[tiers.indexOf(currentTier) + 1];
    const eloToNext = nextTier ? nextTier.min - myRating.elo : 0;

    container.innerHTML = `
        <div style="background: rgba(0,0,0,0.8); padding: 20px; border-radius: 12px; border: 2px solid #ffd700; margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3 style="color: #ffd700; margin: 0;">Season ${season.number}</h3>
                <span style="color: #888;">${daysLeft} days remaining</span>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin: 15px 0;">
                <div style="text-align: center; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 2px solid ${currentTier.color};">
                    <div style="font-size: 2em;">${currentTier.icon}</div>
                    <div style="color: ${currentTier.color}; font-size: 1.4em; font-weight: bold;">${myRating.elo}</div>
                    <div style="color: ${currentTier.color}; font-weight: bold;">${currentTier.name}</div>
                    ${nextTier ? `<div style="color: #888; font-size: 0.8em; margin-top: 5px;">${eloToNext} to ${nextTier.icon} ${nextTier.name}</div>` : '<div style="color: #ffd700; font-size: 0.8em; margin-top: 5px;">MAX TIER</div>'}
                </div>
                <div style="text-align: center; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                    <div style="color: #8a9a6a; font-size: 1.8em; font-weight: bold;">${myRating.wins}</div>
                    <div style="color: #888;">Wins</div>
                </div>
                <div style="text-align: center; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                    <div style="color: #8b3a3a; font-size: 1.8em; font-weight: bold;">${myRating.losses}</div>
                    <div style="color: #888;">Losses</div>
                </div>
            </div>
        </div>

        <div style="background: rgba(0,0,0,0.6); padding: 15px; border-radius: 10px; border: 1px solid #ffd700; margin-bottom: 15px;">
            <h3 style="color: #ffd700; margin: 0 0 10px;">Tier Progression</h3>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                ${tiers.map(t => `
                    <div style="text-align: center; padding: 8px 12px; background: ${t.name === myRating.tier ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.03)'}; border-radius: 6px; border: 1px solid ${t.name === myRating.tier ? t.color : '#333'};">
                        <div style="font-size: 1.3em;">${t.icon}</div>
                        <div style="color: ${t.color}; font-size: 0.85em; font-weight: bold;">${t.name}</div>
                        <div style="color: #666; font-size: 0.7em;">${t.min}+</div>
                    </div>
                `).join('')}
            </div>
        </div>

        <div style="background: rgba(0,0,0,0.6); padding: 15px; border-radius: 10px; border: 1px solid #555;">
            <h3 style="color: #ccc; margin: 0 0 10px;">Season Leaderboard</h3>
            ${topPlayers.length === 0 ? '<div style="color:#888;text-align:center;">No ranked matches yet this season.</div>' :
              topPlayers.map((p, i) => `
                <div style="display:flex;justify-content:space-between;padding:8px;margin:4px 0;background:rgba(255,255,255,0.03);border-radius:5px;${p.name === (player.name || '') ? 'border:2px solid #ffd700;' : ''}">
                    <div><span style="color:${i < 3 ? '#ffd700' : '#ccc'};">#${i+1}</span> <strong style="color:#f5e6c8;margin-left:8px;">${escapeHTML(p.name)}</strong></div>
                    <div style="color:#888;">${p.icon} ${p.elo} Rating | ${p.wins}W/${p.losses}L</div>
                </div>
              `).join('')}
        </div>
    `;
}

// ==================== UTILITY HELPERS ====================

// Death newspaper data from other players
let lastReceivedDeathNewspaper = null;
window._showReceivedDeathNewspaper = function() {
    if (lastReceivedDeathNewspaper && typeof showDeathNewspaper === 'function') {
        showDeathNewspaper(lastReceivedDeathNewspaper);
    } else if (typeof window.showDeathNewspaper === 'function' && lastReceivedDeathNewspaper) {
        window.showDeathNewspaper(lastReceivedDeathNewspaper);
    } else if (typeof window.showLastDeathNewspaper === 'function') {
        window.showLastDeathNewspaper();
    } else if (window.ui && window.ui.toast) {
        window.ui.toast('Obituary is no longer available.', 'info');
    }
};

function broadcastDeathNewspaper(newspaperData) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) {
        // Not online — just log locally, no broadcast
        return;
    }
    sendMP({
        type: 'player_death',
        newspaperData: newspaperData
    });
}
window.broadcastDeathNewspaper = broadcastDeathNewspaper;

// Jail newspaper data from other players
let lastReceivedJailNewspaper = null;
window._showReceivedJailNewspaper = function() {
    if (lastReceivedJailNewspaper && typeof showJailNewspaper === 'function') {
        showJailNewspaper(lastReceivedJailNewspaper);
    } else if (typeof window.showLastJailNewspaper === 'function') {
        window.showLastJailNewspaper();
    } else if (window.ui && window.ui.toast) {
        window.ui.toast('Headlines are no longer available.', 'info');
    }
};

function broadcastJailNewspaper(newspaperData) {
    if (!onlineWorldState.isConnected || !onlineWorldState.socket || onlineWorldState.socket.readyState !== WebSocket.OPEN) {
        return;
    }
    sendMP({
        type: 'player_jail_newspaper',
        newspaperData: newspaperData
    });
}
window.broadcastJailNewspaper = broadcastJailNewspaper;

function sendMP(msg) {
    if (onlineWorldState.socket && onlineWorldState.socket.readyState === WebSocket.OPEN) {
        onlineWorldState.socket.send(JSON.stringify(msg));
    } else {
        showSystemMessage('Not connected to server.', '#8b3a3a');
    }
}

function ensureConnected() {
    if (!onlineWorldState.isConnected) {
        showSystemMessage('Connect to the online world first.', '#8b3a3a');
        return false;
    }
    return true;
}

// ==================== POLITICAL SYSTEM — TOP DON UI ====================
let _politicsCache = null; // last received politics data
let _isTopDon = false;
let _politicsCooldown = 0;

function renderPoliticsTab() {
    const pol = onlineWorldState.politics || _politicsCache;
    const policyDescriptions = {
        worldTaxRate: 'Tax residents pay to territory owners on all job earnings',
        marketFee: 'Fee charged on all vehicle marketplace transactions',
        crimeBonus: 'Bonus earnings from crime jobs for all players',
        jailTimeMod: 'Modifier to jail sentence duration (negative = shorter)',
        heistBonus: 'Bonus payout on successful heists for all crews'
    };

    let html = `
        <div style="text-align: center; margin-bottom: 20px;">
            <h3 style="color: #ffd700; font-family: 'Georgia', serif; margin: 0; font-size: 1.5em; text-shadow: 2px 2px 6px rgba(255,215,0,0.5);">City Politics</h3>
            <p style="color: #ccc; margin: 5px 0 0 0;">The player controlling the most territories rules as <strong style="color: #ffd700;">Top Don</strong> and sets policies for the entire city.</p>
        </div>
    `;

    // Top Don banner
    if (pol && pol.topDonName) {
        const allianceStr = pol.isAlliance ? `<div style="color: #c0a062; font-size: 0.9em; margin-top: 3px;">[${escapeHTML(pol.allianceTag)}] ${escapeHTML(pol.allianceName)}</div>` : '';
        html += `
            <div style="background: linear-gradient(180deg, rgba(255,215,0,0.15) 0%, rgba(0,0,0,0.9) 100%); padding: 25px; border-radius: 15px; border: 2px solid #ffd700; margin-bottom: 20px; text-align: center;">
                <div style="font-size: 2.5em;">&#9813;</div>
                <div style="color: #ffd700; font-size: 1.8em; font-weight: bold; font-family: 'Georgia', serif; text-shadow: 2px 2px 8px rgba(255,215,0,0.4);">${escapeHTML(pol.topDonName)}</div>
                ${allianceStr}
                <div style="color: #c0a062; font-size: 0.95em; margin-top: 8px;">Top Don of the City</div>
                <div style="display: inline-block; background: rgba(255,215,0,0.1); padding: 6px 18px; border-radius: 20px; border: 1px solid #ffd700; margin-top: 10px;">
                    <span style="color: #ffd700; font-weight: bold;">${pol.territoryCount}</span> <span style="color: #ccc;">Territories Controlled</span>
                </div>
            </div>
        `;
    } else {
        html += `
            <div style="background: rgba(100,100,100,0.15); padding: 25px; border-radius: 15px; border: 2px dashed #555; margin-bottom: 20px; text-align: center;">
                <div style="font-size: 2.5em; opacity: 0.4;">&#9813;</div>
                <div style="color: #888; font-size: 1.3em; font-family: 'Georgia', serif;">No Top Don</div>
                <p style="color: #666; margin: 10px 0 0 0;">All territories are under NPC control. Conquer territory to become the Top Don!</p>
            </div>
        `;
    }

    // Current Policies
    html += `
        <div style="background: rgba(0,0,0,0.6); padding: 20px; border-radius: 12px; border: 1px solid #c0a062; margin-bottom: 20px;">
            <h4 style="color: #c0a062; margin: 0 0 15px 0; font-family: 'Georgia', serif; text-align: center;">City Policies</h4>
            <div id="politics-policies-list" style="display: grid; gap: 12px;">
    `;

    if (pol && pol.policies) {
        const limits = pol.policyLimits || {};
        for (const [key, value] of Object.entries(pol.policies)) {
            const lim = limits[key] || {};
            const icon = lim.icon || '';
            const label = lim.label || key;
            const unit = lim.unit || '';
            const desc = policyDescriptions[key] || '';

            // Color based on value (green = beneficial, red = harsh)
            let valueColor = '#ccc';
            if (key === 'crimeBonus' || key === 'heistBonus') {
                valueColor = value > 0 ? '#8a9a6a' : '#ccc';
            } else if (key === 'worldTaxRate' || key === 'marketFee') {
                valueColor = value > 10 ? '#8b3a3a' : value < 10 ? '#8a9a6a' : '#ccc';
            } else if (key === 'jailTimeMod') {
                valueColor = value < 0 ? '#8a9a6a' : value > 0 ? '#8b3a3a' : '#ccc';
            }

            html += `
                <div style="background: rgba(255,255,255,0.03); padding: 12px 15px; border-radius: 8px; border-left: 3px solid ${valueColor}; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="color: #ccc; font-weight: bold;">${icon} ${label}</div>
                        <div style="color: #666; font-size: 0.8em; margin-top: 2px;">${desc}</div>
                    </div>
                    <div style="color: ${valueColor}; font-size: 1.4em; font-weight: bold; min-width: 60px; text-align: right;">
                        ${value > 0 && (key === 'jailTimeMod' || key === 'crimeBonus' || key === 'heistBonus') ? '+' : ''}${value}${unit}
                    </div>
                </div>
            `;
        }
    } else {
        html += '<div style="color: #666; text-align: center; padding: 20px;">Policy data unavailable. Connect to the server to see current policies.</div>';
    }

    html += `
            </div>
        </div>
    `;

    // Top Don controls (only if player is the Top Don)
    html += '<div id="politics-controls-container"></div>';

    // Info box
    html += `
        <div style="background: rgba(192, 160, 98, 0.1); padding: 12px; border-radius: 8px; border: 1px solid #c0a062;">
            <p style="color: #ccc; margin: 0; font-size: 0.85em; line-height: 1.6;">
                <strong style="color: #c0a062;">How Politics Work:</strong> The player or alliance controlling the most territories becomes the <strong style="color: #ffd700;">Top Don</strong>. 
                The Top Don gets a <strong>30-point policy budget</strong> to set city-wide policies. Favorable changes (lower taxes, crime bonuses) cost points, while harsh changes (higher taxes, longer jail) earn points back. 
                Policies have a 10-minute cooldown between changes. Conquer more territory to seize political power!
            </p>
        </div>
    `;

    // Request fresh data from server
    if (onlineWorldState.isConnected) {
        sendMP({ type: 'politics_info' });
    }

    return html;
}

function handlePoliticsInfoResult(message) {
    _politicsCache = message.politics;
    _isTopDon = message.isTopDon;
    _politicsCooldown = message.cooldownRemaining || 0;

    // Update the cached state
    onlineWorldState.politics = message.politics;

    // Render the controls if we're the Top Don
    const controlsContainer = document.getElementById('politics-controls-container');
    if (controlsContainer) {
        if (_isTopDon) {
            controlsContainer.innerHTML = renderTopDonControls(message.politics);
            updatePolicyBudgetDisplay();
        } else {
            controlsContainer.innerHTML = '';
        }
    }
}

function renderTopDonControls(pol) {
    if (!pol || !pol.policies || !pol.policyLimits) return '';

    const cooldownActive = _politicsCooldown > 0;
    const cooldownMin = Math.ceil(_politicsCooldown / 60000);
    const budget = pol.policyBudget || 30;

    let html = `
        <div style="background: linear-gradient(180deg, rgba(255,215,0,0.08) 0%, rgba(0,0,0,0.8) 100%); padding: 20px; border-radius: 12px; border: 2px solid #ffd700; margin-bottom: 20px;">
            <h4 style="color: #ffd700; margin: 0 0 5px 0; font-family: 'Georgia', serif; text-align: center;">Top Don Controls</h4>
            <p style="color: #c0a062; text-align: center; margin: 0 0 8px 0; font-size: 0.85em;">Set policies for the entire city. Favorable policies cost points; harsh policies earn them back.</p>
            <div id="policy-budget-bar" style="text-align: center; margin-bottom: 14px;">
                <div style="display: inline-block; background: rgba(0,0,0,0.6); padding: 8px 20px; border-radius: 20px; border: 1px solid #ffd700;">
                    <span style="color: #ccc; font-size: 0.85em;">Budget:</span>
                    <span id="policy-budget-display" style="color: #ffd700; font-weight: bold; font-size: 1.1em; margin: 0 4px;">${budget - (pol.budgetUsed || 0)}</span>
                    <span style="color: #888; font-size: 0.85em;">/ ${budget} pts remaining</span>
                </div>
            </div>
            ${cooldownActive ? `<div style="text-align: center; color: #8b3a3a; margin-bottom: 12px; font-size: 0.9em;">Policy changes on cooldown -- ${cooldownMin} min remaining</div>` : ''}
            <div style="display: grid; gap: 12px;">
    `;

    for (const [key, value] of Object.entries(pol.policies)) {
        const lim = pol.policyLimits[key] || {};
        const icon = lim.icon || '';
        const label = lim.label || key;
        const unit = lim.unit || '';
        const min = lim.min !== undefined ? lim.min : 0;
        const max = lim.max !== undefined ? lim.max : 100;
        const neutral = lim.neutral !== undefined ? lim.neutral : 0;

        // Describe the tradeoff
        let tradeoffDesc = '';
        if (key === 'worldTaxRate') tradeoffDesc = `Neutral: ${neutral}${unit}. Lower costs ${lim.costPer} pts/${unit}, higher earns ${lim.earnPer} pt/${unit}`;
        else if (key === 'marketFee') tradeoffDesc = `Neutral: ${neutral}${unit}. Lower costs ${lim.costPer} pts/${unit}, higher earns ${lim.earnPer} pt/${unit}`;
        else if (key === 'jailTimeMod') tradeoffDesc = `Neutral: ${neutral}${unit}. Shorter costs ${lim.costPer} pt/${unit}, longer earns ${lim.earnPer} pt/${unit}`;
        else tradeoffDesc = `Costs ${lim.costPer} pts per ${unit}`;

        html += `
            <div style="background: rgba(0,0,0,0.5); padding: 12px; border-radius: 8px; border: 1px solid #555;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="color: #ccc; font-weight: bold;">${icon} ${label}</span>
                    <span id="policy-val-${key}" style="color: #ffd700; font-weight: bold; font-size: 1.2em;">${value}${unit}</span>
                </div>
                <div style="color: #777; font-size: 0.72em; margin-bottom: 6px;">${tradeoffDesc}</div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="color: #666; font-size: 0.8em;">${min}${unit}</span>
                    <input type="range" id="policy-slider-${key}" min="${min}" max="${max}" value="${value}"
                           data-policy="${key}" data-neutral="${neutral}" data-costper="${lim.costPer}" data-earnper="${lim.earnPer}" data-unit="${unit}"
                           oninput="updatePolicyBudgetDisplay()"
                           style="flex: 1; accent-color: #ffd700; cursor: pointer;" ${cooldownActive ? 'disabled' : ''}>
                    <span style="color: #666; font-size: 0.8em;">${max}${unit}</span>
                    <span id="policy-cost-${key}" style="color: #888; font-size: 0.75em; min-width: 42px; text-align: right;"></span>
                </div>
            </div>
        `;
    }

    html += `
            </div>
            <div style="text-align: center; margin-top: 16px;">
                <button id="submit-policies-btn" onclick="submitPolicies()"
                        style="background: ${cooldownActive ? '#444' : 'linear-gradient(135deg, #ffd700, #c0a030)'}; color: #000; padding: 12px 30px; border:1px solid #c0a062; border-radius: 8px; cursor: ${cooldownActive ? 'not-allowed' : 'pointer'}; font-weight: bold; font-size: 1em; font-family: 'Georgia', serif; letter-spacing: 1px; box-shadow: 0 2px 8px rgba(255,215,0,0.3);"
                        ${cooldownActive ? 'disabled' : ''}>
                    Submit Policy
                </button>
            </div>
        </div>
    `;
    return html;
}

// Live budget calculation as sliders move
function updatePolicyBudgetDisplay() {
    const pol = _politicsCache;
    if (!pol || !pol.policyLimits) return;
    const budget = pol.policyBudget || 30;
    let totalCost = 0;
    let totalEarned = 0;

    for (const [key, lim] of Object.entries(pol.policyLimits)) {
        const slider = document.getElementById(`policy-slider-${key}`);
        if (!slider) continue;
        const val = parseInt(slider.value);
        const neutral = lim.neutral !== undefined ? lim.neutral : 0;
        const unit = lim.unit || '';
        const diff = val - neutral;
        const costEl = document.getElementById(`policy-cost-${key}`);
        const valEl = document.getElementById(`policy-val-${key}`);
        if (valEl) valEl.textContent = val + unit;

        let itemCost = 0;
        let itemEarned = 0;
        const favorDown = (key === 'worldTaxRate' || key === 'marketFee' || key === 'jailTimeMod');
        if (favorDown ? diff < 0 : diff > 0) {
            itemCost = Math.abs(diff) * (lim.costPer || 0);
        } else if (favorDown ? diff > 0 : diff < 0) {
            itemEarned = Math.abs(diff) * (lim.earnPer || 0);
        }
        totalCost += itemCost;
        totalEarned += itemEarned;

        if (costEl) {
            if (itemCost > 0) {
                costEl.textContent = `-${itemCost} pts`;
                costEl.style.color = '#e74c3c';
            } else if (itemEarned > 0) {
                costEl.textContent = `+${itemEarned} pts`;
                costEl.style.color = '#8a9a6a';
            } else {
                costEl.textContent = '0 pts';
                costEl.style.color = '#888';
            }
        }
    }

    const net = totalCost - totalEarned;
    const remaining = budget - net;
    const budgetEl = document.getElementById('policy-budget-display');
    const submitBtn = document.getElementById('submit-policies-btn');
    if (budgetEl) {
        budgetEl.textContent = remaining;
        budgetEl.style.color = remaining < 0 ? '#e74c3c' : '#ffd700';
    }
    if (submitBtn) {
        const overBudget = remaining < 0;
        submitBtn.disabled = overBudget || (_politicsCooldown > 0);
        submitBtn.style.opacity = overBudget ? '0.5' : '1';
    }
}
window.updatePolicyBudgetDisplay = updatePolicyBudgetDisplay;

function submitPolicies() {
    if (!ensureConnected()) return;
    const pol = _politicsCache;
    if (!pol || !pol.policyLimits) return;
    const policies = {};
    for (const key of Object.keys(pol.policyLimits)) {
        const slider = document.getElementById(`policy-slider-${key}`);
        if (slider) policies[key] = parseInt(slider.value);
    }
    sendMP({ type: 'politics_submit_all', policies });
}
window.submitPolicies = submitPolicies;

function applyPolicy(policyKey) {
    if (!ensureConnected()) return;
    const slider = document.getElementById(`policy-slider-${policyKey}`);
    if (!slider) return;

    const newValue = parseInt(slider.value);
    sendMP({
        type: 'politics_set_policy',
        policy: policyKey,
        value: newValue
    });
}
window.applyPolicy = applyPolicy;

function handlePoliticsSubmitResult(message) {
    if (message.success) {
        const summary = message.changes.map(c => `${c.label}: ${c.oldValue}${c.unit} -> ${c.newValue}${c.unit}`).join(', ');
        window.ui.toast(`Policies enacted: ${summary}`, 'success');
        _politicsCooldown = message.cooldownRemaining || 0;
        sendMP({ type: 'politics_info' });
        setTimeout(() => showOnlineWorld('politics'), 500);
    } else {
        window.ui.toast(message.error, 'error');
    }
}

function handlePoliticsPolicyResult(message) {
    if (message.success) {
        const lim = (_politicsCache && _politicsCache.policyLimits) ? _politicsCache.policyLimits[message.policy] : {};
        const label = (lim && lim.label) || message.policy;
        const unit = (lim && lim.unit) || '';
        window.ui.toast(`${label} set to ${message.newValue}${unit} (was ${message.oldValue}${unit})`, 'success');

        // Update cooldown
        _politicsCooldown = message.cooldownRemaining || 0;

        // Request fresh politics info then full re-render the tab
        sendMP({ type: 'politics_info' });
        setTimeout(() => showOnlineWorld('politics'), 500);
    } else {
        window.ui.toast(`? ${message.error}`, 'error');
    }
}

function refreshPoliticsTab() {
    // Called when politics_update is broadcast (e.g. another player changed policy)
    // Only re-render if the politics tab is currently visible
    const policiesList = document.getElementById('politics-policies-list');
    if (!policiesList) return;
    showOnlineWorld('politics');
}

// ==================== POLICY NEWSPAPER ====================

function showPolicyNewspaper(data) {
    if (!data || !data.changes || data.changes.length === 0) return;
    const overlay = document.getElementById('policy-newspaper-overlay');
    const content = document.getElementById('policy-newspaper-content');
    if (!overlay || !content) return;
    content.innerHTML = buildPolicyNewspaperHTML(data);
    overlay.style.display = 'flex';
}
window.showPolicyNewspaper = showPolicyNewspaper;

function closePolicyNewspaper() {
    const overlay = document.getElementById('policy-newspaper-overlay');
    if (overlay) overlay.style.display = 'none';
}
window.closePolicyNewspaper = closePolicyNewspaper;

function buildPolicyNewspaperHTML(data) {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const ts = new Date(data.timestamp || Date.now());
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const dateStr = `${months[ts.getMonth()]} ${ts.getDate()}, ${ts.getFullYear()}`;
    const edition = pick(['Morning','Evening','Late','Final']) + ' Edition';
    const donName = data.topDonName || 'Unknown';
    const DON = donName.toUpperCase();
    const changeCount = data.changes.length;

    // Headlines
    const headlines = [
        `${DON} ISSUES SWEEPING NEW CITY POLICIES`,
        `TOP DON ${DON} RESHAPES THE CITY&rsquo;S ECONOMY`,
        `NEW DECREES FROM ${DON} SHAKE THE UNDERWORLD`,
        `${DON} TIGHTENS GRIP &mdash; ${changeCount} POLICIES CHANGED`,
        `CITY BRACES FOR IMPACT AS ${DON} REWRITES THE RULES`,
        `${DON} PLAYS GOD WITH THE CITY&rsquo;S FUTURE`,
    ];

    // Subheads
    const subheads = [
        `${changeCount} policy change${changeCount > 1 ? 's' : ''} announced from the top -- residents brace for impact`,
        `Sources close to ${donName} say the changes are "non-negotiable"`,
        'City officials scramble to interpret the new directives from the Don&rsquo;s office',
        'Insiders warn: "This changes everything for the families"',
    ];

    // Opening lines
    const openings = [
        `In a bold move that sent shockwaves through the underworld, Top Don ${donName} announced sweeping changes to the city&rsquo;s governing policies today.`,
        `${donName}, the undisputed ruler of the city&rsquo;s territories, has issued a series of new decrees that will reshape how business is conducted on every corner.`,
        `The word came down from the top this morning: ${donName} is changing the rules. Those who don&rsquo;t adapt may find themselves on the wrong side of the new order.`,
        'Every family in the city received the same message today -- the Top Don has spoken, and the city&rsquo;s policies are shifting.',
    ];

    // Build change details
    let changesHTML = '';
    const favorableLabels = [];
    const harshLabels = [];
    data.changes.forEach(c => {
        const arrow = c.newValue > c.oldValue ? '&#9650;' : '&#9660;';
        const color = '#1a0a00';
        changesHTML += `
            <div class="newspaper-stat-row">
                <span>${c.label}</span>
                <span>${arrow} ${c.oldValue}${c.unit} &rarr; ${c.newValue}${c.unit}</span>
            </div>`;
        // Categorize for flavor text
        if (c.policy === 'crimeBonus' || c.policy === 'heistBonus') {
            if (c.newValue > c.oldValue) favorableLabels.push(c.label.toLowerCase());
            else harshLabels.push(c.label.toLowerCase());
        } else if (c.policy === 'worldTaxRate' || c.policy === 'marketFee') {
            if (c.newValue < c.oldValue) favorableLabels.push('lower ' + c.label.toLowerCase());
            else harshLabels.push('higher ' + c.label.toLowerCase());
        } else if (c.policy === 'jailTimeMod') {
            if (c.newValue < c.oldValue) favorableLabels.push('shorter jail sentences');
            else harshLabels.push('longer jail sentences');
        }
    });

    // Reaction paragraph
    let reactionP = '';
    if (favorableLabels.length > 0 && harshLabels.length > 0) {
        reactionP = `The new policies are a mixed bag. Residents will welcome ${favorableLabels.join(' and ')}, but ${harshLabels.join(' and ')} have drawn sharp criticism from the streets. "You give with one hand and take with the other," muttered one veteran enforcer.`;
    } else if (favorableLabels.length > 0) {
        reactionP = `The changes are being hailed as generous by the city&rsquo;s criminal element. ${favorableLabels.join(', ')} -- all music to the ears of anyone making a dishonest living. But veterans know: nothing from the Top Don comes free.`;
    } else if (harshLabels.length > 0) {
        reactionP = `The new policies have sent a chill through the underworld. ${harshLabels.join(', ')} -- every last one designed to tighten the screws. "The Don&rsquo;s getting greedy," whispered one unnamed source.`;
    }

    // Budget paragraph
    const budgetP = `City accountants note that the new policy configuration uses ${data.budgetUsed} of ${data.budgetMax} available governance points, leaving ${data.budgetMax - data.budgetUsed} points in reserve. The balance of power, it seems, is a careful calculus.`;

    // Footer quotes
    const footerQuotes = [
        'Power is not given. It is taken -- and taxed.',
        'When the Don changes the rules, the only safe bet is to adapt.',
        'The city never sleeps, and neither does its ruler.',
        'New policies, same old game. Only the numbers change.',
        'In this city, the pen of the Top Don is mightier than any gun.',
        'The families will adjust. They always do. The question is: at what cost?',
    ];

    return `
        <div class="newspaper-masthead">
            <h2 class="newspaper-title">The Daily Racketeer</h2>
            <p class="newspaper-subtitle">All the News That&rsquo;s Fit to Print &mdash; And Plenty That Isn&rsquo;t</p>
        </div>
        <div class="newspaper-dateline">
            <span>${dateStr}</span>
            <span>${edition}</span>
            <span>Price: Two Cents</span>
        </div>
        <h3 class="newspaper-headline">${pick(headlines)}</h3>
        <p class="newspaper-subhead">${pick(subheads)}</p>
        <hr class="newspaper-rule-double">
        <div class="newspaper-body">
            <p>${pick(openings)}</p>
            <div class="newspaper-stats-box">
                <h4>Policy Changes</h4>
                ${changesHTML}
            </div>
            ${reactionP ? `<p>${reactionP}</p>` : ''}
            <p>${budgetP}</p>
        </div>
        <div class="newspaper-footer">
            &ldquo;${pick(footerQuotes)}&rdquo;<br>
            &mdash; The Daily Racketeer, est. 1923
        </div>
    `;
}

// ==================== FRIENDS & SOCIAL SYSTEM ====================

function renderFriendsTabContent() {
    const container = document.getElementById('friends-tab-content');
    if (!container) return;

    const onlineData = window._onlineFriendsData || [];
    const friends = player.friends || [];
    const blocked = player.blocked || [];
    const style = 'style="background:rgba(20,18,10,0.4);border:1px solid #3a3520;border-radius:8px;padding:16px;margin:10px 0;"';

    let html = '';

    // Add friend form
    html += `<div ${style}>
      <h4 style="color:#c0a062;">Add Friend</h4>
      <div style="display:flex;gap:8px;margin:8px 0;">
        <input type="text" id="add-friend-input" placeholder="Player name" style="flex:1;padding:8px;background:#1a1810;border:1px solid #3a3520;color:#d4c4a0;border-radius:4px;">
        <button onclick="addFriend(document.getElementById('add-friend-input').value.trim())" style="background:linear-gradient(135deg,#d4af37,#b8962e);color:#14120a;border:1px solid #c0a062;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:bold;">Add</button>
      </div>
    </div>`;

    // Pending friend requests
    const pendingRequests = window._pendingFriendRequests || [];
    if (pendingRequests.length > 0) {
      html += `<div ${style}>
        <h4 style="color:#c0a062;">Pending Friend Requests (${pendingRequests.length})</h4>`;
      pendingRequests.forEach(r => {
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid #2a2518;">
          <span style="color:#d4c4a0;">${escapeHTML(r.fromName)} wants to be your friend</span>
          <div>
            <button onclick="acceptFriendRequest('${escapeHTML(r.fromName)}')" style="background:#27ae60;color:#fff;border:1px solid #c0a062;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.85em;margin-right:4px;">Accept</button>
            <button onclick="declineFriendRequest('${escapeHTML(r.fromName)}')" style="background:#8b3a3a;color:#f5e6c8;border:1px solid #c0a062;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.85em;">Decline</button>
          </div>
        </div>`;
      });
      html += '</div>';
    }

    // Friends list
    html += `<div ${style}>
      <h4 style="color:#c0a062;">Friends (${friends.length})</h4>`;
    if (friends.length === 0) {
      html += '<p style="color:#8a7a5a;">No friends yet. Add some!</p>';
    } else {
      friends.forEach(f => {
        const onlineInfo = onlineData.find(o => o.name === f.name);
        const isOnline = !!onlineInfo;
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid #2a2518;">
          <span style="color:#d4c4a0;">
            <span style="color:${isOnline ? '#27ae60' : '#8a7a5a'};">●</span> ${escapeHTML(f.name)}
            ${isOnline ? '<span style="color:#27ae60;font-size:0.8em;"> Online</span>' : '<span style="color:#8a7a5a;font-size:0.8em;"> Offline</span>'}
          </span>
          <div>
            <button onclick="removeFriend('${escapeHTML(f.name)}')" style="background:#8b3a3a;color:#f5e6c8;border:1px solid #c0a062;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.85em;margin-right:4px;">Remove</button>
            <button onclick="blockPlayer('${escapeHTML(f.name)}')" style="background:#555;color:#f5e6c8;border:1px solid #c0a062;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.85em;">Block</button>
          </div>
        </div>`;
      });
    }
    html += '</div>';

    // Online players (non-friends, non-blocked)
    if (onlineData.length > 0) {
      const nonFriendOnline = onlineData.filter(o => !friends.find(f => f.name === o.name) && !blocked.find(b => b.name === o.name) && o.name !== player.name);
      if (nonFriendOnline.length > 0) {
        html += `<div ${style}><h4 style="color:#c0a062;">Online Players</h4>`;
        nonFriendOnline.forEach(o => {
          html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid #2a2518;">
            <span style="color:#d4c4a0;"><span style="color:#27ae60;">●</span> ${escapeHTML(o.name)} <span style="color:#8a7a5a;font-size:0.8em;">Lv.${o.level || '?'}</span></span>
            <div>
              <button onclick="addFriend('${escapeHTML(o.name)}')" style="background:#27ae60;color:#fff;border:1px solid #c0a062;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.85em;margin-right:4px;">Send Request</button>
              <button onclick="blockPlayer('${escapeHTML(o.name)}')" style="background:#555;color:#f5e6c8;border:1px solid #c0a062;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.85em;">Block</button>
            </div>
          </div>`;
        });
        html += '</div>';
      }
    }

    // Blocked players
    if (blocked.length > 0) {
      html += `<div ${style}><h4 style="color:#c0a062;">Blocked Players (${blocked.length})</h4>`;
      blocked.forEach(b => {
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid #2a2518;">
          <span style="color:#8a7a5a;">\ud83d\udeab ${escapeHTML(b.name)}</span>
          <button onclick="unblockPlayer('${escapeHTML(b.name)}')" style="background:#3a3520;color:#d4c4a0;border:1px solid #5a4a30;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:0.85em;">Unblock</button>
        </div>`;
      });
      html += '</div>';
    }

    html += '<button onclick="requestFriendsList()" style="background:#3a3520;color:#d4c4a0;border:1px solid #5a4a30;padding:8px 16px;border-radius:6px;cursor:pointer;margin-top:8px;">Refresh</button>';
    container.innerHTML = html;
}

function handleFriendResult(message) {
    if (message.success) {
        if (message.action === 'added') {
            // Add to local friends list
            if (!player.friends) player.friends = [];
            if (!player.friends.find(f => f.name === message.targetName)) {
                player.friends.push({ name: message.targetName, addedAt: Date.now() });
            }
            // Remove from pending requests if it was there
            if (window._pendingFriendRequests) {
                window._pendingFriendRequests = window._pendingFriendRequests.filter(r => r.fromName !== message.targetName);
            }
            if (typeof showBriefNotification === 'function') showBriefNotification(`${message.targetName} added as friend!`, 'success');
        } else if (message.action === 'removed') {
            player.friends = (player.friends || []).filter(f => f.name !== message.targetName);
            if (typeof showBriefNotification === 'function') showBriefNotification(`${message.targetName} removed from friends.`, 'info');
        } else if (message.action === 'requested') {
            if (typeof showBriefNotification === 'function') showBriefNotification(`Friend request sent to ${message.targetName}.`, 'success');
        } else if (message.action === 'declined') {
            if (window._pendingFriendRequests) {
                window._pendingFriendRequests = window._pendingFriendRequests.filter(r => r.fromName !== message.targetName);
            }
            if (typeof showBriefNotification === 'function') showBriefNotification(`Declined friend request from ${message.targetName}.`, 'info');
        }
        renderFriendsTabContent();
    } else {
        if (typeof showBriefNotification === 'function') showBriefNotification(message.error || 'Friend action failed.', 'error');
    }
}

function handleFriendRequest(message) {
    // Store pending friend request for accept/decline
    if (!window._pendingFriendRequests) window._pendingFriendRequests = [];
    if (!window._pendingFriendRequests.find(r => r.fromName === message.fromName)) {
        window._pendingFriendRequests.push({ fromName: message.fromName, receivedAt: Date.now() });
    }
    if (typeof showBriefNotification === 'function') showBriefNotification(`${message.fromName} sent you a friend request!`, 'success');
    if (typeof logAction === 'function') _safeLogAction(`${message.fromName} sent you a friend request!`, 'social');
}

function handleBlockResult(message) {
    if (message.success) {
        if (message.action === 'blocked') {
            if (!player.blocked) player.blocked = [];
            if (!player.blocked.find(b => b.name === message.targetName)) {
                player.blocked.push({ name: message.targetName, blockedAt: Date.now() });
            }
            if (typeof showBriefNotification === 'function') showBriefNotification(`${message.targetName} blocked.`, 'info');
        } else if (message.action === 'unblocked') {
            player.blocked = (player.blocked || []).filter(b => b.name !== message.targetName);
            if (typeof showBriefNotification === 'function') showBriefNotification(`${message.targetName} unblocked.`, 'info');
        }
    }
}

function handleFriendsListResult(message) {
    window._onlineFriendsData = message.onlinePlayers || [];
    renderFriendsTabContent();
}

// Global functions for friends screen buttons
window.addFriend = function(name) {
    sendMP({ type: 'friend_add', targetName: name });
};
window.acceptFriendRequest = function(name) {
    sendMP({ type: 'friend_accept', fromName: name });
    window._pendingFriendRequests = (window._pendingFriendRequests || []).filter(r => r.fromName !== name);
    renderFriendsTabContent();
};
window.declineFriendRequest = function(name) {
    sendMP({ type: 'friend_decline', fromName: name });
    window._pendingFriendRequests = (window._pendingFriendRequests || []).filter(r => r.fromName !== name);
    renderFriendsTabContent();
};
window.removeFriend = function(name) {
    sendMP({ type: 'friend_remove', targetName: name });
    player.friends = (player.friends || []).filter(f => f.name !== name);
    renderFriendsTabContent();
};
window.blockPlayer = function(name) {
    sendMP({ type: 'block_player', targetName: name });
    if (!player.blocked) player.blocked = [];
    player.blocked.push({ name, blockedAt: Date.now() });
    // Also remove from friends
    player.friends = (player.friends || []).filter(f => f.name !== name);
    renderFriendsTabContent();
};
window.unblockPlayer = function(name) {
    sendMP({ type: 'unblock_player', targetName: name });
    player.blocked = (player.blocked || []).filter(b => b.name !== name);
    renderFriendsTabContent();
};
window.requestFriendsList = function() {
    sendMP({ type: 'get_friends_list' });
};

// ==================== LEADERBOARDS (SERVER-SIDE) ====================

let _cachedLeaderboards = null;

function handleLeaderboardsResult(message) {
    _cachedLeaderboards = message.leaderboards;
    // If the leaderboard tab is visible, refresh it
    const container = document.getElementById('server-leaderboards-container');
    if (container) renderServerLeaderboards(container);
}

function renderServerLeaderboards(container) {
    if (!_cachedLeaderboards) {
        container.innerHTML = '<p style="color:#8a7a5a;">Loading leaderboards...</p>';
        sendMP({ type: 'get_leaderboards' });
        return;
    }
    const lb = _cachedLeaderboards;
    let html = '';

    const sections = [
        { title: 'Reputation Leaders', data: lb.reputation, cols: ['Name', 'Rep', 'Territory'], render: p => `<td>${escapeHTML(p.name)}</td><td>${p.reputation}</td><td>${p.territory || 0}</td>` },
        { title: 'Wealthiest', data: lb.wealth, cols: ['Name', 'Money'], render: p => `<td>${escapeHTML(p.name)}</td><td>$${(p.money||0).toLocaleString()}</td>` },
        { title: 'Top Fighters', data: lb.combat, cols: ['Name', 'Wins', 'Losses'], render: p => `<td>${escapeHTML(p.name)}</td><td>${p.pvpWins}</td><td>${p.pvpLosses}</td>` },
        { title: 'Territory Lords', data: lb.territories, cols: ['Name', 'Territories'], render: p => `<td>${escapeHTML(p.name)}</td><td>${p.territories}</td>` },
        { title: 'Ranked (ELO)', data: lb.ranked, cols: ['Name', 'ELO', 'Tier', 'W/L'], render: p => `<td>${escapeHTML(p.name)}</td><td>${p.elo}</td><td>${p.icon||''} ${p.tier}</td><td>${p.wins}/${p.losses}</td>` }
    ];

    sections.forEach(s => {
        if (!s.data || s.data.length === 0) return;
        html += `<h4 style="color:#c0a062;margin:12px 0 6px;">${s.title}</h4>`;
        html += `<table style="width:100%;border-collapse:collapse;font-size:0.9em;"><tr>${s.cols.map(c => `<th style="text-align:left;padding:4px 8px;border-bottom:1px solid #3a3520;color:#8a7a5a;">${c}</th>`).join('')}</tr>`;
        s.data.forEach((p, i) => {
            html += `<tr style="background:${i%2===0?'rgba(20,18,10,0.3)':'transparent'};">${s.render(p)}</tr>`;
        });
        html += '</table>';
    });

    container.innerHTML = html || '<p style="color:#8a7a5a;">No leaderboard data yet.</p>';
}

window.requestServerLeaderboards = function() {
    sendMP({ type: 'get_leaderboards' });
};

// ==================== HEIST MATCHMAKING ====================

function handleHeistQueueResult(message) {
    if (message.success) {
        if (message.action === 'left') {
            if (typeof showBriefNotification === 'function') showBriefNotification('Left heist queue.', 'info');
        } else {
            if (typeof showBriefNotification === 'function') showBriefNotification(`Joined heist queue! Position: ${message.position}`, 'success');
        }
    } else {
        if (typeof showBriefNotification === 'function') showBriefNotification(message.error || 'Queue error.', 'error');
    }
}

function handleHeistQueueMatched(message) {
    if (typeof showBriefNotification === 'function') showBriefNotification('Heist crew assembled! Check the Heist tab!', 'success');
    if (typeof logAction === 'function') _safeLogAction('Your matchmade heist crew has assembled!', 'heist');
}

window.joinHeistQueue = function() { sendMP({ type: 'heist_queue_join' }); };
window.leaveHeistQueue = function() { sendMP({ type: 'heist_queue_leave' }); };

// ==================== CREW SYSTEM CLIENT ====================

let _crewInfoCache = null;

function handleCrewResult(message) {
    if (message.success) {
        if (message.action === 'created') {
            player.crewId = message.crew.id;
            player.crewRole = 'leader';
            if (typeof showBriefNotification === 'function') showBriefNotification(`Crew "${message.crew.name}" created!`, 'success');
        } else if (message.action === 'joined') {
            player.crewId = message.crew.id;
            player.crewRole = 'member';
            if (typeof showBriefNotification === 'function') showBriefNotification(`Joined crew "${message.crew.name}"!`, 'success');
        } else if (message.action === 'left') {
            player.crewId = null;
            player.crewRole = null;
            window._myCrewSize = 0;
            if (typeof showBriefNotification === 'function') showBriefNotification('Left your crew.', 'info');
        } else if (message.action === 'kicked') {
            if (typeof showBriefNotification === 'function') showBriefNotification(`${message.targetName} kicked from crew.`, 'info');
        } else if (message.action === 'invited') {
            if (typeof showBriefNotification === 'function') showBriefNotification(`Invite sent to ${message.targetName}.`, 'success');
        } else if (message.action === 'updated') {
            if (typeof showBriefNotification === 'function') showBriefNotification('Crew updated.', 'success');
        }
        // Refresh crew screen
        sendMP({ type: 'crew_info' });
    } else {
        if (typeof showBriefNotification === 'function') showBriefNotification(message.error || 'Crew action failed.', 'error');
    }
}

function handleCrewInviteReceived(message) {
    if (typeof showBriefNotification === 'function') showBriefNotification(`[${message.crewTag}] ${message.fromName} invited you to join ${message.crewName}!`, 'success');
    // Store pending invite
    window._pendingCrewInvite = { crewId: message.crewId, crewName: message.crewName };
    if (typeof logAction === 'function') _safeLogAction(`Crew invite from ${message.fromName}: Join [${message.crewTag}] ${message.crewName}`, 'social');
}

function handleCrewInfoResult(message) {
    _crewInfoCache = message;
    // Track crew size for job bonus calculations
    window._myCrewSize = message.myCrew ? message.myCrew.members.length : 0;
    const container = document.getElementById('crew-content');
    if (container) renderCrewScreen(container, message);
}

function renderCrewScreen(container, data) {
    let html = '';
    const style = 'style="background:rgba(20,18,10,0.4);border:1px solid #3a3520;border-radius:8px;padding:16px;margin:10px 0;"';

    html += '<p style="color:#8a7a5a;font-style:italic;margin:0 0 10px;">Form a crew with other players to pull off multiplayer heists together. Bigger crews can hit harder targets for bigger payouts.</p>';

    if (data.myCrew) {
        const c = data.myCrew;
        const isLeader = c.leader === onlineWorldState.playerId;
        const isOpen = !!c.open;
        html += `<div ${style}>
            <h3 style="color:#c0a062;margin:0 0 8px;">${c.emblem} [${escapeHTML(c.tag)}] ${escapeHTML(c.name)}</h3>
            ${c.motto ? `<p style="color:#8a7a5a;font-style:italic;margin:4px 0;">"${escapeHTML(c.motto)}"</p>` : ''}
            <p style="color:#d4c4a0;">Members: ${c.members.length}/10</p>
            <p style="color:${isOpen ? '#27ae60' : '#8a7a5a'};font-size:0.9em;">Status: ${isOpen ? 'Open — Accepting new members' : 'Closed — Invite only'}</p>
            <div style="margin:8px 0;">
            ${c.members.map(m => `<div style="padding:4px 8px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #2a2518;">
                <span style="color:#d4c4a0;">${escapeHTML(m.name)} <span style="color:#8a7a5a;font-size:0.85em;">(${m.role})</span></span>
                ${isLeader && m.role === 'member' ? `<div><button onclick="window.crewPromote('${escapeHTML(m.name)}')" style="background:#27ae60;color:#fff;border:1px solid #c0a062;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:0.8em;margin-right:4px;">Promote</button><button onclick="window.crewKick('${escapeHTML(m.name)}')" style="background:#8b3a3a;color:#fff;border:1px solid #c0a062;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:0.8em;">Kick</button></div>` : ''}
            </div>`).join('')}
            </div>
            ${isLeader ? `
            <div style="margin-top:12px;display:flex;align-items:center;gap:10px;">
                <span style="color:#d4c4a0;">Recruitment:</span>
                <button onclick="window.crewToggleOpen(${isOpen ? 'false' : 'true'})" style="background:${isOpen ? '#8b3a3a' : '#27ae60'};color:#fff;border:1px solid #c0a062;padding:6px 14px;border-radius:4px;cursor:pointer;font-weight:bold;">${isOpen ? 'Close Recruitment' : 'Open to All Players'}</button>
            </div>
            <div style="margin-top:8px;">
                <input type="text" id="crew-motto-input" placeholder="Crew motto..." maxlength="64" value="${escapeHTML(c.motto || '')}" style="width:70%;padding:6px;background:#1a1810;border:1px solid #3a3520;color:#d4c4a0;border-radius:4px;">
                <button onclick="window.crewUpdateMotto()" style="background:linear-gradient(135deg,#d4af37,#b8962e);color:#14120a;border:1px solid #c0a062;padding:6px 12px;border-radius:4px;cursor:pointer;font-weight:bold;">Set Motto</button>
            </div>
            <div style="margin-top:8px;">
                <input type="text" id="crew-invite-input" placeholder="Player name to invite..." style="width:70%;padding:6px;background:#1a1810;border:1px solid #3a3520;color:#d4c4a0;border-radius:4px;">
                <button onclick="window.crewInvitePlayer()" style="background:linear-gradient(135deg,#d4af37,#b8962e);color:#14120a;border:1px solid #c0a062;padding:6px 12px;border-radius:4px;cursor:pointer;font-weight:bold;">Invite</button>
            </div>` : ''}
            <button onclick="window.crewLeave()" style="background:#8b3a3a;color:#f5e6c8;border:1px solid #c0a062;padding:8px 16px;border-radius:6px;cursor:pointer;margin-top:12px;font-weight:bold;">Leave Crew</button>
        </div>`;
    } else {
        // No crew — show create form and pending invite
        html += `<div ${style}>
            <h3 style="color:#c0a062;">Create a Crew</h3>
            <div style="display:grid;gap:8px;margin:12px 0;">
                <input type="text" id="crew-name-input" placeholder="Crew name (3-24 chars)" maxlength="24" style="padding:8px;background:#1a1810;border:1px solid #3a3520;color:#d4c4a0;border-radius:4px;">
                <input type="text" id="crew-tag-input" placeholder="Tag (2-5 chars, e.g. MFB)" maxlength="5" style="padding:8px;background:#1a1810;border:1px solid #3a3520;color:#d4c4a0;border-radius:4px;">
                <input type="text" id="crew-motto-create" placeholder="Motto (optional)" maxlength="64" style="padding:8px;background:#1a1810;border:1px solid #3a3520;color:#d4c4a0;border-radius:4px;">
                <button onclick="window.crewCreate()" style="background:linear-gradient(135deg,#d4af37,#b8962e);color:#14120a;border:1px solid #c0a062;padding:10px;border-radius:6px;cursor:pointer;font-weight:bold;font-size:1em;">Create Crew</button>
            </div>
        </div>`;

        if (window._pendingCrewInvite) {
            html += `<div ${style} style="border-color:#d4af37;">
                <h4 style="color:#d4af37;">Pending Invite</h4>
                <p style="color:#d4c4a0;">You've been invited to join <strong>${escapeHTML(window._pendingCrewInvite.crewName)}</strong></p>
                <div style="display:flex;gap:8px;">
                    <button onclick="window.crewAcceptInvite()" style="background:#27ae60;color:#fff;border:1px solid #c0a062;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:bold;">Accept</button>
                    <button onclick="window.crewDeclineInvite()" style="background:#8b3a3a;color:#f5e6c8;border:1px solid #c0a062;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:bold;">Decline</button>
                </div>
            </div>`;
        }

        // Open crews looking for members — always show section
        const openCrews = (data.allCrews || []).filter(c => c.open && c.memberCount < 10);
        html += `<div ${style}>
            <h3 style="color:#c0a062;">Crews Looking for Members</h3>`;
        if (openCrews.length > 0) {
            html += '<p style="color:#8a7a5a;font-size:0.9em;margin:0 0 8px;">These crews are open — join one to team up for heists and activities.</p>';
            openCrews.forEach(c => {
                html += `<div style="padding:8px;border-bottom:1px solid #2a2518;display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <span style="color:#d4c4a0;font-weight:bold;">${c.emblem} [${escapeHTML(c.tag)}] ${escapeHTML(c.name)}</span>
                        <span style="color:#8a7a5a;font-size:0.85em;"> (${c.memberCount}/10) -- Led by ${escapeHTML(c.leaderName)}</span>
                        ${c.motto ? `<br><span style="color:#8a7a5a;font-size:0.85em;font-style:italic;">"${escapeHTML(c.motto)}"</span>` : ''}
                    </div>
                    <button onclick="window.crewJoinOpen('${c.id}')" style="background:#27ae60;color:#fff;border:1px solid #c0a062;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:bold;">Join</button>
                </div>`;
            });
        } else {
            html += '<p style="color:#8a7a5a;font-size:0.9em;margin:4px 0;">No crews are currently recruiting. Create your own or wait for a crew leader to open recruitment.</p>';
        }
        html += '</div>';
    }

    // All crews list
    if (data.allCrews && data.allCrews.length > 0) {
        html += `<div ${style}><h3 style="color:#c0a062;">All Crews</h3>`;
        data.allCrews.forEach(c => {
            html += `<div style="padding:6px 8px;border-bottom:1px solid #2a2518;display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#d4c4a0;">${c.emblem} [${escapeHTML(c.tag)}] ${escapeHTML(c.name)} <span style="color:#8a7a5a;">(${c.memberCount}/10) -- Led by ${escapeHTML(c.leaderName)}</span></span>
                <span style="color:${c.open ? '#27ae60' : '#8a7a5a'};font-size:0.8em;">${c.open ? 'Open' : 'Closed'}</span>
            </div>`;
        });
        html += '</div>';
    }

    container.innerHTML = html;
}

window.crewCreate = function() {
    const name = document.getElementById('crew-name-input')?.value?.trim();
    const tag = document.getElementById('crew-tag-input')?.value?.trim();
    const motto = document.getElementById('crew-motto-create')?.value?.trim();
    sendMP({ type: 'crew_create', name, tag, motto });
};
window.crewInvitePlayer = function() {
    const name = document.getElementById('crew-invite-input')?.value?.trim();
    if (name) sendMP({ type: 'crew_invite', targetName: name });
};
window.crewKick = function(name) { sendMP({ type: 'crew_kick', targetName: name }); };
window.crewPromote = function(name) { sendMP({ type: 'crew_update', promote: name }); };
window.crewUpdateMotto = function() {
    const motto = document.getElementById('crew-motto-input')?.value?.trim();
    sendMP({ type: 'crew_update', motto });
};
window.crewLeave = function() { sendMP({ type: 'crew_leave' }); };
window.crewAcceptInvite = function() {
    if (window._pendingCrewInvite) {
        sendMP({ type: 'crew_join', crewId: window._pendingCrewInvite.crewId });
        window._pendingCrewInvite = null;
    }
};
window.crewDeclineInvite = function() {
    window._pendingCrewInvite = null;
    if (typeof showBriefNotification === 'function') showBriefNotification('Crew invite declined.', 'info');
    renderCrewScreen();
};
window.crewToggleOpen = function(open) {
    sendMP({ type: 'crew_update', open: open });
};
window.crewJoinOpen = function(crewId) {
    sendMP({ type: 'crew_join', crewId: crewId });
};

// ==================== PLAYER GAMBLING CLIENT ====================

let _gamblingTablesCache = [];

function handleGamblingResult(message) {
    if (message.success) {
        if (message.action === 'created') {
            if (typeof showBriefNotification === 'function') showBriefNotification(`Gambling table created! Bet: $${message.table.bet.toLocaleString()}`, 'success');
        } else if (message.action === 'left') {
            if (typeof showBriefNotification === 'function') showBriefNotification('Left the table.', 'info');
        }
        sendMP({ type: 'gambling_list_tables' });
    } else {
        if (typeof showBriefNotification === 'function') showBriefNotification(message.error || 'Gambling error.', 'error');
    }
}

function handleGamblingResolved(message) {
    const isWinner = message.winnerId === onlineWorldState.playerId;
    const isTie = message.isTie;

    if (isTie) {
        if (typeof showBriefNotification === 'function') showBriefNotification(`It's a tie! Bets returned. ${message.result.description}`, 'info');
    } else if (isWinner) {
        player.money += message.bet;
        if (typeof showBriefNotification === 'function') showBriefNotification(`You WON $${message.bet.toLocaleString()}! ${message.result.description}`, 'success');
        // Track for achievement
        if (!player._pokerWins) player._pokerWins = 0;
        player._pokerWins++;
    } else {
        player.money -= message.bet;
        if (typeof showBriefNotification === 'function') showBriefNotification(`You LOST $${message.bet.toLocaleString()}. ${message.result.description}`, 'error');
    }
    _safeUpdateUI();
    if (typeof logAction === 'function') _safeLogAction(`${message.result.description} — ${isWinner ? 'You won!' : isTie ? 'Tie!' : 'You lost.'}`, 'casino');

    // Refresh tables
    sendMP({ type: 'gambling_list_tables' });
}

function handleGamblingTablesList(message) {
    _gamblingTablesCache = message.tables || [];
    const container = document.getElementById('player-gambling-content');
    if (container) renderPlayerGambling(container);
}

function renderPlayerGambling(container) {
    const style = 'style="background:rgba(20,18,10,0.4);border:1px solid #3a3520;border-radius:8px;padding:16px;margin:10px 0;"';
    const typeIcons = { dice: '[Dice]', coinflip: '[Coin]', highcard: '[Card]' };
    const typeNames = { dice: 'Dice Roll', coinflip: 'Coin Flip', highcard: 'High Card' };

    let html = '<p style="color:#8a7a5a;font-style:italic;">Gamble against other players. Create a table or join one. Winner takes all.</p>';

    // Create table form
    html += `<div ${style}>
        <h4 style="color:#c0a062;">Open a Table</h4>
        <div style="display:grid;gap:8px;margin:8px 0;">
            <select id="gambling-type-select" style="padding:8px;background:#1a1810;border:1px solid #3a3520;color:#d4c4a0;border-radius:4px;">
                <option value="dice">Dice Roll (2d6 each)</option>
                <option value="coinflip">Coin Flip</option>
                <option value="highcard">High Card</option>
            </select>
            <input type="number" id="gambling-bet-input" placeholder="Bet amount ($1,000 — $500,000)" min="1000" max="500000" style="padding:8px;background:#1a1810;border:1px solid #3a3520;color:#d4c4a0;border-radius:4px;">
            <button onclick="window.createGamblingTable()" style="background:linear-gradient(135deg,#d4af37,#b8962e);color:#14120a;border:1px solid #c0a062;padding:10px;border-radius:6px;cursor:pointer;font-weight:bold;">Open Table</button>
        </div>
    </div>`;

    // Open tables
    if (_gamblingTablesCache.length > 0) {
        html += '<h4 style="color:#c0a062;margin:12px 0 6px;">Open Tables</h4>';
        _gamblingTablesCache.forEach(t => {
            html += `<div ${style}>
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <strong style="color:#d4c4a0;">${typeIcons[t.type] || '[Dice]'} ${typeNames[t.type] || t.type}</strong>
                        <p style="color:#d4af37;margin:4px 0;">Bet: $${t.bet.toLocaleString()}</p>
                        <small style="color:#8a7a5a;">Hosted by ${escapeHTML(t.hostName)}</small>
                    </div>
                    <button onclick="window.joinGamblingTable('${t.id}')" style="background:linear-gradient(135deg,#d4af37,#b8962e);color:#14120a;border:1px solid #c0a062;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:bold;">Sit Down ($${t.bet.toLocaleString()})</button>
                </div>
            </div>`;
        });
    } else {
        html += '<p style="color:#8a7a5a;text-align:center;margin:20px 0;">No open tables. Be the first to open one.</p>';
    }

    html += '<button onclick="sendMP({type:\'gambling_list_tables\'})" style="background:#3a3520;color:#d4c4a0;border:1px solid #5a4a30;padding:8px 16px;border-radius:6px;cursor:pointer;margin-top:8px;">Refresh Tables</button>';
    container.innerHTML = html;
}

window.createGamblingTable = function() {
    const gameType = document.getElementById('gambling-type-select')?.value || 'dice';
    const bet = parseInt(document.getElementById('gambling-bet-input')?.value) || 0;
    if (bet < 1000) { if (typeof showBriefNotification === 'function') showBriefNotification('Minimum bet is $1,000.', 'error'); return; }
    if (player.money < bet) { if (typeof showBriefNotification === 'function') showBriefNotification('Not enough cash.', 'error'); return; }
    sendMP({ type: 'gambling_create_table', gameType, bet });
};
window.joinGamblingTable = function(tableId) {
    const table = _gamblingTablesCache.find(t => t.id === tableId);
    if (table && player.money < table.bet) { if (typeof showBriefNotification === 'function') showBriefNotification('Not enough cash to match the bet.', 'error'); return; }
    sendMP({ type: 'gambling_join_table', tableId });
};

// ==================== SUPERBOSS CLIENT ====================

let _superbossListCache = null;
let _activeSuperbossFight = null;
let _superbossAttackOnCooldown = false;
let _superbossAttackCooldownTimer = null;
const SUPERBOSS_ATTACK_COOLDOWN_MS = 2000;

function handleSuperbossResult(message) {
    if (message.success) {
        if (message.action === 'started') {
            _activeSuperbossFight = message.fight;
            if (typeof showBriefNotification === 'function') showBriefNotification(`Superboss fight started: ${message.fight.bossName}!`, 'success');
        } else if (message.action === 'joined') {
            _activeSuperbossFight = message.fight;
            if (typeof showBriefNotification === 'function') showBriefNotification(`Joined the fight against ${message.fight.bossName}!`, 'success');
        } else if (message.action === 'invited') {
            if (typeof showBriefNotification === 'function') showBriefNotification(`Invite sent to ${message.targetName}.`, 'success');
        }
        renderSuperbossScreen();
    } else {
        if (typeof showBriefNotification === 'function') showBriefNotification(message.error || 'Superboss error.', 'error');
    }
}

function handleSuperbossInviteReceived(message) {
    if (typeof showBriefNotification === 'function') showBriefNotification(`${message.fromName} invites you to fight ${message.bossName}!`, 'success');
    window._pendingSuperbossInvite = { fightId: message.fightId, bossName: message.bossName };
    if (typeof logAction === 'function') _safeLogAction(`${message.fromName} invites you to fight ${message.bossName}! Go to the Superboss screen to join.`, 'combat');
}

function handleSuperbossUpdate(message) {
    if (_activeSuperbossFight && _activeSuperbossFight.id === message.fightId) {
        if (message.type === 'superboss_update') {
            _activeSuperbossFight = message.fight;
        } else {
            _activeSuperbossFight.bossHP = message.bossHP;
            _activeSuperbossFight.bossMaxHP = message.bossMaxHP;
            _activeSuperbossFight.phase = message.phase;
            // Update participant status from server
            if (message.bossAttack && message.bossAttack.downed) {
                const downed = _activeSuperbossFight.participants.find(p => p.name === message.bossAttack.targetName);
                if (downed) downed.alive = false;
            }
        }
        renderSuperbossScreen();
    }
    
    // Log the attack
    if (message.attackerName) {
        const critText = message.isCrit ? ' (CRITICAL!)' : '';
        if (typeof logAction === 'function') _safeLogAction(`${message.attackerName} hit the boss for ${message.damage} damage${critText}!`, 'combat');
        if (message.bossAttack) {
            const downText = message.bossAttack.downed ? ' -- DOWNED!' : '';
            if (typeof showBriefNotification === 'function') {
                const notifType = message.bossAttack.downed ? 'danger' : 'warning';
                showBriefNotification(`Boss strikes ${message.bossAttack.targetName} for ${message.bossAttack.damage} damage${downText}`, notifType);
            }
            _safeLogAction(`Boss counter-attacks ${message.bossAttack.targetName} for ${message.bossAttack.damage} damage${downText}!`, 'combat');
        }
    }
}

function handleSuperbossVictory(message) {
    _activeSuperbossFight = null;
    _superbossAttackOnCooldown = false;
    if (_superbossAttackCooldownTimer) { clearInterval(_superbossAttackCooldownTimer); _superbossAttackCooldownTimer = null; }
    player.money += message.moneyReward;
    if (typeof gainExperience === 'function') gainExperience(message.xpReward);
    
    // Apply buff
    if (message.buff) {
        if (!player.activeBuffs) player.activeBuffs = [];
        player.activeBuffs.push({
            ...message.buff,
            expiresAt: Date.now() + (message.buff.duration || 3600000)
        });
    }
    
    // Track for achievement
    if (!player.superbossesDefeated) player.superbossesDefeated = [];
    const bossId = message.bossId || message.bossName; // Prefer ID, fallback to name
    if (!player.superbossesDefeated.includes(bossId)) player.superbossesDefeated.push(bossId);
    
    // Invalidate boss list cache so cooldowns refresh on next render
    _superbossListCache = null;
    
    _safeUpdateUI();
    
    if (typeof showBriefNotification === 'function') showBriefNotification(`${message.bossName} DEFEATED! +$${message.moneyReward.toLocaleString()} +${message.xpReward} Rep (${message.damageShare}% contribution)`, 'success');
    if (typeof logAction === 'function') _safeLogAction(`SUPERBOSS DEFEATED: ${message.bossName}! You dealt ${message.damageDealt} damage (${message.damageShare}% share). Reward: $${message.moneyReward.toLocaleString()} + ${message.xpReward} Rep`, 'combat');
    
    // Show crew loadout in log if available
    if (Array.isArray(message.crewLoadout) && message.crewLoadout.length > 0) {
        message.crewLoadout.forEach(c => {
            const eq = c.equipment || {};
            let gear = [];
            if (eq.weapon) gear.push(eq.weapon.name);
            if (eq.armor) gear.push(eq.armor.name);
            if (eq.vehicle) gear.push(eq.vehicle.name);
            const gearStr = gear.length > 0 ? gear.join(', ') : 'No gear';
            _safeLogAction(`  ${c.name} (${c.damageShare}% dmg) — ${gearStr}`, 'info');
        });
    }
    
    renderSuperbossScreen();
}

function handleSuperbossDefeat(message) {
    _activeSuperbossFight = null;
    _superbossAttackOnCooldown = false;
    if (_superbossAttackCooldownTimer) { clearInterval(_superbossAttackCooldownTimer); _superbossAttackCooldownTimer = null; }
    if (typeof showBriefNotification === 'function') showBriefNotification(message.message || 'Your crew was wiped out!', 'danger');
    if (typeof logAction === 'function') _safeLogAction(`SUPERBOSS WIPE: ${message.bossName} destroyed your entire crew! Regroup and try again.`, 'combat');
    renderSuperbossScreen();
}

function handleSuperbossListResult(message) {
    _superbossListCache = message;
    renderSuperbossScreen();
}

function renderSuperbossScreen() {
    const container = document.getElementById('superboss-content');
    if (!container) return;
    
    const style = 'style="background:rgba(20,18,10,0.4);border:1px solid #3a3520;border-radius:8px;padding:16px;margin:10px 0;"';
    let html = '';

    // Active fight
    if (_activeSuperbossFight && _activeSuperbossFight.phase !== 'resolved') {
        const f = _activeSuperbossFight;
        const hpPct = Math.max(0, (f.bossHP / f.bossMaxHP) * 100);
        const hpColor = hpPct > 50 ? '#27ae60' : hpPct > 25 ? '#e67e22' : '#e74c3c';
        
        html += `<div style="background:rgba(139,0,0,0.2);border:2px solid #8b0000;border-radius:12px;padding:20px;margin:10px 0;">
            <h3 style="color:#e74c3c;text-align:center;margin:0 0 12px;">${escapeHTML(f.bossName)}</h3>
            <div style="background:#1a1810;border:1px solid #3a3520;border-radius:8px;overflow:hidden;height:32px;margin:8px 0;">
                <div style="background:${hpColor};height:100%;width:${hpPct}%;transition:width 0.5s;display:flex;align-items:center;justify-content:center;">
                    <span style="color:#fff;font-weight:bold;font-size:0.85em;text-shadow:1px 1px 2px #000;">${f.bossHP.toLocaleString()} / ${f.bossMaxHP.toLocaleString()} HP</span>
                </div>
            </div>
            <div style="margin:12px 0;">
                <h4 style="color:#c0a062;">Participants:</h4>
                ${f.participants.map(p => {
                    const eq = (f.equipment || {})[p.playerId] || {};
                    let gear = [];
                    if (eq.weapon) gear.push(`<span style="color:#e74c3c;">${escapeHTML(eq.weapon.name)}</span>`);
                    if (eq.armor) gear.push(`<span style="color:#3498db;">${escapeHTML(eq.armor.name)}</span>`);
                    if (eq.vehicle) gear.push(`<span style="color:#f39c12;">${escapeHTML(eq.vehicle.name)}</span>`);
                    const gearStr = gear.length > 0 ? `<div style="font-size:0.8em;color:#888;margin-left:16px;">Gear: ${gear.join(' / ')}</div>` : '';
                    return `<div style="padding:4px 8px;color:${p.alive ? '#d4c4a0' : '#8a7a5a'};"><span>${p.alive ? '[OK]' : '[X]'} ${escapeHTML(p.name)}</span> <span style="color:#8a7a5a;">— ${p.damage} dmg</span>${gearStr}</div>`;
                }).join('')}
            </div>
            ${f.phase === 'recruiting' ? `
                <p style="color:#d4af37;text-align:center;">Recruiting phase — invite friends before attacking!</p>
                <div style="margin:8px 0;">
                    <input type="text" id="superboss-invite-input" placeholder="Player name to invite" style="padding:6px;background:#1a1810;border:1px solid #3a3520;color:#d4c4a0;border-radius:4px;width:60%;">
                    <button onclick="window.superbossInvite()" style="background:#d4af37;color:#14120a;border:1px solid #c0a062;padding:6px 12px;border-radius:4px;cursor:pointer;font-weight:bold;">Invite</button>
                </div>` : ''}
            <div style="width:100%;margin-top:8px;">
              <button id="superboss-attack-btn" onclick="window.superbossAttack()" style="background:linear-gradient(135deg,#e74c3c,#c0392b);color:#fff;border:1px solid #c0a062;padding:12px 24px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:1.1em;width:100%;${_superbossAttackOnCooldown ? 'display:none;' : ''}">ATTACK</button>
              <div id="superboss-cooldown-bar" style="${_superbossAttackOnCooldown ? '' : 'display:none;'}background:#1a1810;border:1px solid #3a3520;border-radius:8px;overflow:hidden;height:44px;">
                <div id="superboss-cooldown-fill" style="background:linear-gradient(90deg,#5a2a2a,#e74c3c);height:100%;width:0%;display:flex;align-items:center;justify-content:center;">
                  <span style="color:#fff;font-weight:bold;font-size:1.1em;text-shadow:1px 1px 2px #000;">Reloading...</span>
                </div>
              </div>
            </div>
        </div>`;
    }

    // Pending invite
    if (window._pendingSuperbossInvite && !_activeSuperbossFight) {
        html += `<div ${style} style="border-color:#d4af37;">
            <h4 style="color:#d4af37;">Fight Invitation</h4>
            <p style="color:#d4c4a0;">You've been invited to fight <strong>${escapeHTML(window._pendingSuperbossInvite.bossName)}</strong>!</p>
            <button onclick="window.superbossJoinInvite()" style="background:#27ae60;color:#fff;border:1px solid #c0a062;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:bold;">Join Fight</button>
        </div>`;
    }

    // Boss list
    if (_superbossListCache) {
        html += '<h3 style="color:#c0a062;margin:16px 0 8px;">Legendary Crime Lords</h3>';
        const cooldowns = _superbossListCache.cooldowns || {};
        const cooldownDuration = _superbossListCache.cooldownDuration || 3600000;
        _superbossListCache.bosses.forEach(b => {
            const canFight = (player.reputation || 0) >= (b.minReputation || b.level || 1);
            const defeated = (player.superbossesDefeated || []).includes(b.id);
            const lastDefeat = cooldowns[b.id] || 0;
            const cdRemaining = Math.max(0, cooldownDuration - (Date.now() - lastDefeat));
            const onCooldown = cdRemaining > 0;
            const cdMins = Math.ceil(cdRemaining / 60000);
            let actionBtn = '';
            if (!canFight) {
                actionBtn = '<span style="color:#8a7a5a;">Locked</span>';
            } else if (_activeSuperbossFight) {
                actionBtn = '<span style="color:#8a7a5a;">In fight</span>';
            } else if (onCooldown) {
                actionBtn = `<span style="color:#e67e22;">Cooldown: ${cdMins}m</span>`;
            } else {
                actionBtn = `<button onclick="window.startSuperbossFight('${b.id}')" style="background:linear-gradient(135deg,#e74c3c,#c0392b);color:#fff;border:1px solid #c0a062;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:bold;">Challenge</button>`;
            }
            html += `<div ${style} style="opacity:${canFight && !onCooldown ? 1 : 0.5};">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <strong style="color:#e74c3c;">${defeated ? '[Defeated] ' : ''}${escapeHTML(b.name)}</strong>
                        <p style="color:#8a7a5a;margin:4px 0;">${escapeHTML(b.description)}</p>
                        <small style="color:#8a7a5a;">Requires ${b.minReputation || b.level || 1}+ Rep -- HP: ${b.hp.toLocaleString()} -- Power: ${(b.power || 0).toLocaleString()}</small>
                    </div>
                    ${actionBtn}
                </div>
            </div>`;
        });

        // Active fights
        if (_superbossListCache.activeFights && _superbossListCache.activeFights.length > 0) {
            html += '<h4 style="color:#c0a062;margin:12px 0 6px;">Active Superboss Fights</h4>';
            _superbossListCache.activeFights.forEach(f => {
                const hpPct = Math.round((f.bossHP / f.bossMaxHP) * 100);
                html += `<div ${style}>
                    <strong style="color:#e74c3c;">${escapeHTML(f.bossName)}</strong> — ${hpPct}% HP
                    <br><small style="color:#8a7a5a;">Fighters: ${f.participants.map(p => escapeHTML(p.name)).join(', ')}</small>
                </div>`;
            });
        }
    } else {
        html += '<p style="color:#8a7a5a;">Loading superboss data...</p>';
        sendMP({ type: 'superboss_list' });
    }

    container.innerHTML = html;

    // Re-sync cooldown bar state after render (DOM was rebuilt)
    if (_superbossAttackOnCooldown) {
        const btn = document.getElementById('superboss-attack-btn');
        const bar = document.getElementById('superboss-cooldown-bar');
        if (btn) btn.style.display = 'none';
        if (bar) bar.style.display = 'block';
    }
}

window.startSuperbossFight = async function(bossId) {
    if (typeof window.checkCrewBeforeAction === 'function') {
        const choice = await window.checkCrewBeforeAction('a Superboss Fight', true);
        if (choice === 'crew' || choice === 'cancel') return;
    }
    sendMP({ type: 'superboss_start', bossId, equipment: getEquipmentSummary() });
};
window.superbossAttack = function() {
    if (!_activeSuperbossFight || _superbossAttackOnCooldown) return;
    sendMP({ type: 'superboss_attack', fightId: _activeSuperbossFight.id });
    _superbossAttackOnCooldown = true;
    const btn = document.getElementById('superboss-attack-btn');
    const bar = document.getElementById('superboss-cooldown-bar');
    const fill = document.getElementById('superboss-cooldown-fill');
    if (btn) btn.style.display = 'none';
    if (bar) bar.style.display = 'block';
    if (fill) fill.style.width = '0%';
    if (_superbossAttackCooldownTimer) clearInterval(_superbossAttackCooldownTimer);
    const startTime = Date.now();
    _superbossAttackCooldownTimer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const pct = Math.min(100, (elapsed / SUPERBOSS_ATTACK_COOLDOWN_MS) * 100);
        const f = document.getElementById('superboss-cooldown-fill');
        if (f) f.style.width = pct + '%';
        if (elapsed >= SUPERBOSS_ATTACK_COOLDOWN_MS) {
            clearInterval(_superbossAttackCooldownTimer);
            _superbossAttackCooldownTimer = null;
            _superbossAttackOnCooldown = false;
            const b = document.getElementById('superboss-attack-btn');
            const br = document.getElementById('superboss-cooldown-bar');
            if (b) b.style.display = 'block';
            if (br) br.style.display = 'none';
        }
    }, 50);
};
window.superbossInvite = function() {
    const name = document.getElementById('superboss-invite-input')?.value?.trim();
    if (name && _activeSuperbossFight) {
        sendMP({ type: 'superboss_invite', fightId: _activeSuperbossFight.id, targetName: name });
    }
};
window.superbossJoinInvite = function() {
    if (window._pendingSuperbossInvite) {
        sendMP({ type: 'superboss_join', fightId: window._pendingSuperbossInvite.fightId, equipment: getEquipmentSummary() });
        window._pendingSuperbossInvite = null;
    }
};

// ==================== SEASONAL EVENT CLIENT ====================

function handleSeasonalEventResult(message) {
    window._seasonalEventData = message;
    // If a screen is rendering this, it will pick it up
}

window.requestSeasonalEvent = function() { sendMP({ type: 'seasonal_event_info' }); };
window.reportSeasonalProgress = function(objId, amount) { sendMP({ type: 'seasonal_event_progress', objectiveId: objId, amount }); };

// ==================== ANTI-CHEAT SNAPSHOTS ====================

// Send a snapshot of critical values every 60 seconds
setInterval(() => {
    if (onlineWorldState.isConnected && typeof player !== 'undefined') {
        sendMP({
            type: 'anticheat_snapshot',
            money: player.money || 0,
            level: player.level || 1,
            reputation: player.reputation || 0
        });
    }
}, 60000);

// ==================== SERVER STATUS TOOLTIP ====================
// Periodically ping the server and update the sign-in button tooltip
(function initServerStatusTooltip() {
    function updateSignInTooltip(text) {
        const introBtn = document.getElementById('intro-login-btn');
        if (introBtn) introBtn.title = text;
    }

    function checkServerStatus() {
        // If we already have an active WebSocket connection, the server is up
        if (onlineWorldState.isConnected) {
            updateSignInTooltip('Server is online \u2705');
            return;
        }
        // Quick HTTP ping to the server health endpoint (Render responds to GET /)
        const serverOrigin = onlineWorld.serverUrl.replace(/^ws/, 'http');
        fetch(serverOrigin, { method: 'GET', mode: 'no-cors', cache: 'no-store' })
            .then(() => {
                updateSignInTooltip('Server is online \u2705');
            })
            .catch(() => {
                updateSignInTooltip('Server appears offline \u274c');
            });
    }

    // Run once DOM is ready and then every 30 seconds
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { checkServerStatus(); });
    } else {
        checkServerStatus();
    }
    setInterval(checkServerStatus, 30000);
})();
