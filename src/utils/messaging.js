/**
 * Messaging Utilities
 * Helper functions for communication between popup and background
 */

// Message types - keeping track of what we support
export const MessageTypes = {
    START_GAME: 'START_GAME',
    STOP_GAME: 'STOP_GAME',
    GAME_RESPONSE: 'GAME_RESPONSE',
    ERROR: 'ERROR',
    ANALYZE_HAND: 'ANALYZE_HAND',
    LOAD_STRATEGY: 'LOAD_STRATEGY',
    UPDATE_SETTINGS: 'UPDATE_SETTINGS',
    GET_STATUS: 'GET_STATUS'
};

/**
 * Send message to background script
 * @param {string} type - Message type from MessageTypes
 * @param {object} data - Data to send
 * @returns {Promise} - Response from background
 */
export const sendToBackground = (type, data) => {
    console.log('[messaging] Sending:', type, data);
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, data }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[messaging] Error:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                console.log('[messaging] Response:', response);
                resolve(response);
            }
        });
    });
};

/**
 * Save stats to storage
 */
export const saveStats = async (stats) => {
    console.log('[messaging] Saving stats:', stats);
    return chrome.storage.local.set({ stats });
};

/**
 * Load stats from storage
 */
export const loadStats = async () => {
    const result = await chrome.storage.local.get('stats');
    console.log('[messaging] Loaded stats:', result.stats);
    return result.stats || {
        wins: 0,
        losses: 0,
        pushes: 0,
        totalGames: 0,
        totalWagered: 0,
        netProfit: 0
    };
};

/**
 * Save settings to storage
 */
export const saveSettings = async (settings) => {
    console.log('[messaging] Saving settings:', settings);
    return chrome.storage.local.set(settings);
};

/**
 * Load settings from storage
 */
export const loadSettings = async () => {
    const keys = ['betSize', 'targetWager', 'actionDelay', 'delayStdDev', 'strategy', 'autoRefresh'];
    const result = await chrome.storage.local.get(keys);
    console.log('[messaging] Loaded settings:', result);
    return result;
};
