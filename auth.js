// ==================== AUTH & CLOUD SAVE CLIENT ====================
// Handles login, registration, cloud saves, and account UI.
// Imported as ES module by game.js.
import { ui } from './ui-modal.js';

// ── Server URL (same host as multiplayer WS, but HTTP) ─────────
const AUTH_API_BASE = (function () {
    try {
        if (window.__MULTIPLAYER_SERVER_URL__) {
            return window.__MULTIPLAYER_SERVER_URL__.replace(/^ws/, 'http').replace(/\/$/, '');
        }
        const h = window.location.hostname;
        const isLocal = h === 'localhost' || h === '127.0.0.1';
        if (isLocal) return 'http://localhost:3000';
        return 'https://mafia-born.onrender.com';
    } catch {
        return 'https://mafia-born.onrender.com';
    }
})();

// ── Local state ────────────────────────────────────────────────
let authToken = localStorage.getItem('mb_auth_token') || null;
let authUsername = localStorage.getItem('mb_auth_user') || null;
let isLoggedIn = !!authToken;
let _isAdmin = false;

// Client-side admin list (mirrors server ADMIN_USERNAMES) — used as
// immediate/fallback check so the admin panel shows even if the API
// call hasn't returned yet or the server is unreachable.
const CLIENT_ADMIN_USERNAMES = new Set(['admin']);
function isAdminUsername(name) {
    return name && CLIENT_ADMIN_USERNAMES.has(name.toLowerCase());
}

// ── API helpers ────────────────────────────────────────────────
async function apiFetch(endpoint, options = {}) {
    const url = `${AUTH_API_BASE}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    try {
        const resp = await fetch(url, {
            ...options,
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
        return data;
    } catch (err) {
        // If auth is expired/invalid, clear session
        const msg = (err.message || '').toLowerCase();
        if (msg.includes('not authenticated') || msg.includes('unauthorized') || msg.includes('invalid token') || msg.includes('token expired')) {
            clearLocalAuth();
        }
        throw err;
    }
}

// ── Auth actions ───────────────────────────────────────────────
export async function register(username, password) {
    const data = await apiFetch('/api/register', {
        method: 'POST',
        body: { username, password }
    });
    setLocalAuth(data.token, data.username);
    _isAdmin = isAdminUsername(data.username);
    return data;
}

export async function login(username, password) {
    const data = await apiFetch('/api/login', {
        method: 'POST',
        body: { username, password }
    });
    setLocalAuth(data.token, data.username);
    _isAdmin = isAdminUsername(data.username);
    return data;
}

export async function logout() {
    try {
        await apiFetch('/api/logout', { method: 'POST' });
    } catch { /* ignore */ }
    clearLocalAuth();
}

export async function getProfile() {
    return apiFetch('/api/profile', { method: 'GET' });
}

export async function changePassword(oldPassword, newPassword) {
    return apiFetch('/api/change-password', {
        method: 'POST',
        body: { oldPassword, newPassword }
    });
}

export async function deleteAccount() {
    await apiFetch('/api/account', { method: 'DELETE' });
    clearLocalAuth();
}

// ── Cloud save / load ──────────────────────────────────────────
export async function cloudSave(saveEntry) {
    return apiFetch('/api/save', {
        method: 'POST',
        body: {
            playerName: saveEntry.playerName,
            level: saveEntry.level,
            money: saveEntry.money,
            reputation: saveEntry.reputation,
            empireRating: saveEntry.empireRating,
            playtime: saveEntry.playtime,
            gameVersion: saveEntry.gameVersion,
            data: saveEntry.data
        }
    });
}

export async function cloudLoad() {
    return apiFetch('/api/load', { method: 'GET' });
}

// Delete the cloud save (used on permadeath)
export async function cloudDeleteSave() {
    return apiFetch('/api/save', { method: 'DELETE' });
}

// Check if a character name is already taken by another player's cloud save
export async function checkPlayerName(name) {
    const data = await apiFetch(`/api/check-name?name=${encodeURIComponent(name)}`, { method: 'GET' });
    return data.taken; // true/false
}

// ── Token management ───────────────────────────────────────────
function setLocalAuth(token, username) {
    if (!token || !username) {
        console.error('[auth] setLocalAuth called with missing token or username');
        return;
    }
    authToken = token;
    authUsername = username;
    isLoggedIn = true;
    localStorage.setItem('mb_auth_token', token);
    localStorage.setItem('mb_auth_user', username);
}

function clearLocalAuth() {
    authToken = null;
    authUsername = null;
    isLoggedIn = false;
    localStorage.removeItem('mb_auth_token');
    localStorage.removeItem('mb_auth_user');
}

export function getAuthState() {
    return { isLoggedIn, username: authUsername, token: authToken, isAdmin: _isAdmin };
}

// ── Admin helpers ─────────────────────────────────────────────────
export async function checkAdmin() {
    // Immediate client-side check (works even if server is unreachable)
    if (isAdminUsername(authUsername)) { _isAdmin = true; }
    if (!authToken) { _isAdmin = false; return false; }
    try {
        const data = await apiFetch('/api/admin/check', { method: 'GET' });
        _isAdmin = !!data.isAdmin;
    } catch {
        // Keep client-side result if server fails
        console.warn('[auth] Admin check API failed, using client-side fallback');
    }
    return _isAdmin;
}

export async function adminModify(modifications) {
    if (!authToken || !_isAdmin) throw new Error('Not admin');
    return apiFetch('/api/admin/modify', {
        method: 'POST',
        body: modifications
    });
}

// ── Verify saved token still valid on startup ──────────────────
export async function verifySession() {
    if (!authToken) return false;
    try {
        const info = await getProfile();
        authUsername = info.username;
        isLoggedIn = true;
        _isAdmin = !!info.isAdmin || isAdminUsername(info.username);
        return true;
    } catch (err) {
        // Distinguish auth failure (token expired/invalid) from network errors
        const msg = (err.message || '').toLowerCase();
        const isAuthFailure = msg.includes('not authenticated') || msg.includes('unauthorized') || msg.includes('invalid token') || msg.includes('token expired');
        if (isAuthFailure) {
            // Token is definitely bad — clear everything
            clearLocalAuth();
            return false;
        }
        // Server unreachable — if we have a stored username, stay logged in
        if (authUsername) {
            isLoggedIn = true;
            _isAdmin = isAdminUsername(authUsername);
        } else {
            clearLocalAuth();
        }
        return isLoggedIn;
    }
}

// ── UI: Auth full-screen page ──────────────────────────────────
// options: { required: bool, onAuth: fn, startOnRegister: bool }
export function showAuthModal(onSuccessOrOpts) {
    let onSuccess = null;
    let required = false;
    let startOnRegister = false;
    if (typeof onSuccessOrOpts === 'function') {
        onSuccess = onSuccessOrOpts;
    } else if (onSuccessOrOpts && typeof onSuccessOrOpts === 'object') {
        onSuccess = onSuccessOrOpts.onAuth || null;
        required = !!onSuccessOrOpts.required;
        startOnRegister = !!onSuccessOrOpts.startOnRegister;
    }

    // Remove existing
    const old = document.getElementById('auth-modal-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'auth-modal-overlay';
    overlay.className = 'auth-fullscreen';
    overlay.innerHTML = `
        <div class="auth-fullscreen-inner">
            <button class="auth-close" id="auth-close-btn" ${required ? 'style="display:none;"' : ''}>&times;</button>

            <!-- Game pitch header -->
            <div class="auth-hero">
                <img src="GameLogo.png" alt="Mafia Born" class="auth-hero-logo" />
                <p class="auth-hero-tagline">Rise from the gutter. Build an empire. Own the city.</p>
            </div>

            <div class="auth-content-wrap">
                <!-- Left: game features -->
                <div class="auth-features-col">
                    <div class="auth-feature-card">
                        <span class="auth-feature-title">Run Jobs & Heists</span>
                        <span class="auth-feature-desc">Pull off robberies, smuggle contraband, and climb the ranks of the underworld.</span>
                    </div>
                    <div class="auth-feature-card">
                        <span class="auth-feature-title">Build Your Empire</span>
                        <span class="auth-feature-desc">Buy businesses, launder money, recruit a gang, and control turf across the city.</span>
                    </div>
                    <div class="auth-feature-card">
                        <span class="auth-feature-title">Live the Life</span>
                        <span class="auth-feature-desc">Bribe cops, break out of jail, gamble at the casino, and make a name for yourself.</span>
                    </div>
                    <div class="auth-feature-card">
                        <span class="auth-feature-title">Multiplayer Underworld</span>
                        <span class="auth-feature-desc">Compete with other players for territory, reputation, and bragging rights.</span>
                    </div>
                </div>

                <!-- Right: auth form -->
                <div class="auth-form-col">
                    <h2 class="auth-title" id="auth-modal-title">${startOnRegister ? 'Create Your Identity' : 'Sign In'}</h2>
                    <p class="auth-subtitle" id="auth-modal-subtitle">${startOnRegister ? 'Choose a name for the underworld' : 'Welcome back to the family'}</p>

                    <div id="auth-form-area">
                        <div class="auth-field">
                            <label for="auth-username">Player Name</label>
                            <input type="text" id="auth-username" placeholder="Choose your name" maxlength="20" autocomplete="username" />
                            <p class="auth-field-hint" id="auth-username-hint" style="display:${startOnRegister ? 'block' : 'none'};">This is the name the underworld will know you by. Other players will see this name.</p>
                        </div>
                        <div class="auth-field">
                            <label for="auth-password">Password</label>
                            <input type="password" id="auth-password" placeholder="Enter password" maxlength="64" autocomplete="current-password" />
                            <p class="auth-field-hint" id="auth-password-hint" style="display:${startOnRegister ? 'block' : 'none'};">Your password lets you play from anywhere -- PC, phone, or tablet. No email required.</p>
                        </div>
                        <div class="auth-field" id="auth-confirm-field" style="display:${startOnRegister ? 'block' : 'none'};">
                            <label for="auth-confirm">Confirm Password</label>
                            <input type="password" id="auth-confirm" placeholder="Confirm password" maxlength="64" autocomplete="new-password" />
                        </div>
                        <p class="auth-error" id="auth-error"></p>
                        <button class="auth-btn auth-btn-primary" id="auth-submit-btn">${startOnRegister ? 'Enter the Underworld' : 'Sign In'}</button>
                        <p class="auth-toggle" id="auth-toggle">${startOnRegister ? 'Already have an account? <span class="auth-link" id="auth-switch-link">Sign in</span>' : 'Don\'t have an account? <span class="auth-link" id="auth-switch-link">Create one</span>'}</p>
                        <p style="margin-top:12px; font-size:0.75em; color:#666;"><a href="privacy-policy.html" target="_blank" style="color:#8a7a5a;">Privacy Policy</a> &middot; <a href="terms-of-use.html" target="_blank" style="color:#8a7a5a;">Terms of Use</a></p>
                    </div>

                    <div id="auth-logged-in-area" style="display:none;">
                        <div class="auth-profile-info">
                            <p>Signed in as <strong id="auth-display-name"></strong></p>
                            <p class="auth-save-info" id="auth-save-info"></p>
                        </div>
                        <button class="auth-btn auth-btn-primary" id="auth-cloud-save-btn">Save to Cloud</button>
                        <button class="auth-btn auth-btn-secondary" id="auth-cloud-load-btn">Load from Cloud</button>
                        <button class="auth-btn auth-btn-danger" id="auth-logout-btn">Sign Out</button>
                        <hr style="border-color: #333; margin: 15px 0;">
                        <button class="auth-btn auth-btn-danger" id="auth-delete-account-btn" style="border-color: #8b3a3a; margin-top: 5px;">Delete Account & Save</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // State
    let isRegisterMode = !!startOnRegister;

    const closeBtn = document.getElementById('auth-close-btn');
    const submitBtn = document.getElementById('auth-submit-btn');
    const switchLink = document.getElementById('auth-switch-link');
    const usernameInput = document.getElementById('auth-username');
    const passwordInput = document.getElementById('auth-password');
    const confirmInput = document.getElementById('auth-confirm');
    const confirmField = document.getElementById('auth-confirm-field');
    const usernameHint = document.getElementById('auth-username-hint');
    const passwordHint = document.getElementById('auth-password-hint');
    const errorEl = document.getElementById('auth-error');
    const titleEl = document.getElementById('auth-modal-title');
    const subtitleEl = document.getElementById('auth-modal-subtitle');
    const toggleEl = document.getElementById('auth-toggle');
    const formArea = document.getElementById('auth-form-area');
    const loggedInArea = document.getElementById('auth-logged-in-area');

    const close = () => overlay.remove();

    if (!required) {
        closeBtn.onclick = close;
    }

    // If already logged in, show account panel
    if (isLoggedIn) {
        showLoggedInPanel();
        return;
    }

    // Toggle login / register
    switchLink.onclick = () => {
        isRegisterMode = !isRegisterMode;
        if (isRegisterMode) {
            titleEl.textContent = 'Create Your Identity';
            subtitleEl.textContent = 'Choose a name for the underworld';
            submitBtn.textContent = 'Enter the Underworld';
            confirmField.style.display = 'block';
            usernameHint.style.display = 'block';
            passwordHint.style.display = 'block';
            toggleEl.innerHTML = 'Already have an account? <span class="auth-link" id="auth-switch-link">Sign in</span>';
        } else {
            titleEl.textContent = 'Sign In';
            subtitleEl.textContent = 'Welcome back to the family';
            submitBtn.textContent = 'Sign In';
            confirmField.style.display = 'none';
            usernameHint.style.display = 'none';
            passwordHint.style.display = 'none';
            toggleEl.innerHTML = 'Don\'t have an account? <span class="auth-link" id="auth-switch-link">Create one</span>';
        }
        errorEl.textContent = '';
        document.getElementById('auth-switch-link').onclick = switchLink.onclick;
    };

    // Submit
    submitBtn.onclick = async () => {
        errorEl.textContent = '';
        const user = usernameInput.value.trim();
        const pass = passwordInput.value;

        if (!user || !pass) {
            errorEl.textContent = 'Please fill in all fields';
            return;
        }

        if (isRegisterMode) {
            if (pass !== confirmInput.value) {
                errorEl.textContent = 'Passwords do not match';
                return;
            }
        }

        submitBtn.disabled = true;
        submitBtn.textContent = isRegisterMode ? 'Creating...' : 'Signing in...';

        try {
            if (isRegisterMode) {
                await register(user, pass);
            } else {
                await login(user, pass);
            }
            // Set admin flag immediately so Settings shows admin panel
            await checkAdmin();
            updateAuthStatusUI();

            // After a LOGIN (not register), try to auto-load the cloud save
            if (!isRegisterMode) {
                try {
                    const save = await cloudLoad();
                    if (save && save.data && typeof window.applyCloudSave === 'function') {
                        window.applyCloudSave(save);
                        if (typeof window.showBriefNotification === 'function') {
                            window.showBriefNotification(' Cloud save loaded!', 'success');
                        }
                        close();
                        return; // skip onSuccess — save was loaded, game is running
                    }
                } catch (e) {
                    console.warn('[auth] No cloud save to auto-load:', e.message);
                }
            }

            // No cloud save (or new registration) — close modal so player
            // can proceed from the title screen ("Join the Family", etc.)
            close();
            if (onSuccess) onSuccess();
        } catch (err) {
            errorEl.textContent = err.message;
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = isRegisterMode ? 'Create Account' : 'Sign In';
        }
    };

    // Enter key submits
    const enterHandler = (e) => { if (e.key === 'Enter') submitBtn.onclick(); };
    usernameInput.addEventListener('keydown', enterHandler);
    passwordInput.addEventListener('keydown', enterHandler);
    confirmInput.addEventListener('keydown', enterHandler);

    // -- Logged-in panel --
    async function showLoggedInPanel() {
        formArea.style.display = 'none';
        loggedInArea.style.display = 'block';
        titleEl.textContent = ' Cloud Account';
        subtitleEl.textContent = 'Manage your cloud saves';

        document.getElementById('auth-display-name').textContent = authUsername;

        // Fetch profile for save info
        try {
            const profile = await getProfile();
            const info = document.getElementById('auth-save-info');
            if (profile.hasSave) {
                const d = new Date(profile.saveDate);
                info.textContent = `Cloud save: ${profile.playerName || 'Unknown'} (Lvl ${profile.playerLevel || '?'}) — ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
            } else {
                info.textContent = 'No cloud save yet';
            }
        } catch {
            document.getElementById('auth-save-info').textContent = 'Could not fetch save info';
        }

        // Cloud Save button
        document.getElementById('auth-cloud-save-btn').onclick = async () => {
            const btn = document.getElementById('auth-cloud-save-btn');
            btn.disabled = true;
            btn.textContent = ' Saving...';
            try {
                // Access the global save data creator from game.js
                if (typeof window.createSaveDataForCloud === 'function') {
                    const saveEntry = window.createSaveDataForCloud();
                    await cloudSave(saveEntry);
                    btn.textContent = ' Saved!';
                    if (typeof window.showBriefNotification === 'function') {
                        window.showBriefNotification(' Progress saved to cloud!', 'success');
                    }
                    // Refresh save info
                    showLoggedInPanel();
                } else {
                    btn.textContent = ' No active game to save';
                }
            } catch (err) {
                btn.textContent = ' Save failed';
                console.error('Cloud save error:', err);
            }
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = ' Save to Cloud';
            }, 2000);
        };

        // Cloud Load button
        document.getElementById('auth-cloud-load-btn').onclick = async () => {
            const btn = document.getElementById('auth-cloud-load-btn');
            btn.disabled = true;
            btn.textContent = ' Loading...';
            try {
                const save = await cloudLoad();
                if (save && save.data) {
                    if (typeof window.applyCloudSave === 'function') {
                        const hasCurrentGame = window.player && window.player.name;
                        if (hasCurrentGame) {
                            if (!await ui.confirm(`This will replace your current game with your cloud save:\n${save.playerName || 'Unknown'} (Lvl ${save.level || '?'})\n\nContinue?`)) {
                                btn.disabled = false;
                                btn.textContent = ' Load from Cloud';
                                return;
                            }
                        }
                        window.applyCloudSave(save);
                        btn.textContent = ' Loaded!';
                        if (typeof window.showBriefNotification === 'function') {
                            window.showBriefNotification(' Cloud save loaded!', 'success');
                        }
                        setTimeout(close, 1000);
                    } else {
                        btn.textContent = ' Game not ready';
                    }
                } else {
                    btn.textContent = ' No cloud save found';
                }
            } catch (err) {
                btn.textContent = err.message === 'No cloud save found' ? ' No cloud save' : ' Load failed';
                console.error('Cloud load error:', err);
            }
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = ' Load from Cloud';
            }, 2000);
        };

        // Logout button
        document.getElementById('auth-logout-btn').onclick = async () => {
            await logout();
            updateAuthStatusUI();
            close();
            if (typeof window.showBriefNotification === 'function') {
                window.showBriefNotification('Signed out', 2000);
            }
        };

        // Delete account button
        document.getElementById('auth-delete-account-btn').onclick = async () => {
            if (!await ui.confirm('WARNING: This will permanently delete your account and cloud save.\n\nThis cannot be undone!\n\nAre you sure?')) return;
            if (!await ui.confirm('Are you REALLY sure? All progress will be lost forever.')) return;
            const btn = document.getElementById('auth-delete-account-btn');
            btn.disabled = true;
            btn.textContent = ' Deleting...';

            // Attempt server-side deletion, but always clean up locally
            try {
                await deleteAccount();
            } catch (err) {
                console.error('Delete account server error:', err);
                // Server call may have failed, but user confirmed — clear local state anyway
            }

            // Always: force log-out, close modal, wipe saves, return to title
            clearLocalAuth();
            updateAuthStatusUI();
            close();
            if (typeof window.deleteAllLocalSavesAndReset === 'function') {
                window.deleteAllLocalSavesAndReset();
            }
        };
    }
}

// ── UI: Status indicator (shown in stats bar or intro) ─────────
export function updateAuthStatusUI() {
    // Update all auth status elements
    const indicators = document.querySelectorAll('.auth-status-indicator');
    indicators.forEach(el => {
        if (isLoggedIn) {
            const span = document.createElement('span');
            span.className = 'auth-status-online';
            span.title = `Signed in as ${authUsername}`;
            span.textContent = ` ${authUsername}`;
            el.innerHTML = '';
            el.appendChild(span);
        } else {
            el.innerHTML = '';
        }
    });

    // Update intro screen buttons if they exist
    const introLoginBtn = document.getElementById('intro-login-btn');
    if (introLoginBtn) {
        if (isLoggedIn) {
            introLoginBtn.textContent = ` ${authUsername}`;
            introLoginBtn.title = 'Manage cloud account';
        } else {
            introLoginBtn.textContent = 'Account / Cloud Sync';
            introLoginBtn.title = 'Optional: create an account to back up and sync your game';
        }
    }
}

// ── Auto cloud save hook (called from game.js after local save) ──
let _lastCloudFailNotify = 0;
export async function autoCloudSave(saveEntry) {
    if (!isLoggedIn) return;
    try {
        await cloudSave(saveEntry);
    } catch (err) {
        console.warn('Auto cloud save failed:', err.message);
        const now = Date.now();
        if (now - _lastCloudFailNotify > 300000) {
            _lastCloudFailNotify = now;
            if (typeof window.showBriefNotification === 'function') {
                window.showBriefNotification('Cloud save failed — check your connection', 'warning');
            }
        }
    }
}

// ── Emergency cloud save (survives page unload via keepalive) ──
export function emergencyCloudSave(saveEntry) {
    if (!isLoggedIn || !authToken) return;
    try {
        fetch(`${AUTH_API_BASE}/api/save`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                playerName: saveEntry.playerName,
                level: saveEntry.level,
                money: saveEntry.money,
                reputation: saveEntry.reputation,
                empireRating: saveEntry.empireRating,
                playtime: saveEntry.playtime,
                gameVersion: saveEntry.gameVersion,
                data: saveEntry.data
            }),
            keepalive: true
        });
    } catch (e) {
        // Silently fail — local save is the safety net
    }
}

// ── Initialize on import ───────────────────────────────────────
export async function initAuth() {
    if (authToken) {
        const valid = await verifySession();
        if (!valid) {
            console.log('[auth] Saved session expired');
        } else {
            console.log(`[auth] Restored session for ${authUsername}`);
            // Check admin status on session restore
            await checkAdmin();
            // Auto-load cloud save into memory but stay on the title screen.
            // The player uses 'Resume Business' or 'Join the Family' to enter.
            try {
                const save = await cloudLoad();
                if (save && save.data) {
                    // Stash the save so the title-screen buttons can use it
                    window._pendingCloudSave = save;
                    console.log('[auth] Cloud save pre-loaded (staying on title screen)');
                }
            } catch (e) {
                console.warn('[auth] No cloud save to pre-load on startup:', e.message);
            }
        }
    }
    // Defer UI update to next tick so DOM is ready
    setTimeout(updateAuthStatusUI, 0);
}
