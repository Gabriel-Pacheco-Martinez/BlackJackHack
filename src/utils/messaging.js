/**
 * @file messaging.js
 * @description Chrome extension messaging utilities
 * @version 0.4-dev
 */

/** Message type constants */
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
 * Send message from popup to background script
 * @param {string} type - Message type
 * @param {Object} data - Message payload
 * @returns {Promise<Object>} Response from background
 */
export const sendToBackground = (type, data) => {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, data }, (response) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                resolve(response);
            }
        });
    });
};

/**
 * Save stats to chrome.storage.local
 * @param {Object} stats - Stats object to save
 */
export const saveStats = async (stats) => {
    return chrome.storage.local.set({ stats });
};

/**
 * Load stats from chrome.storage.local
 * @returns {Promise<Object>} Stats object
 */
export const loadStats = async () => {
    const result = await chrome.storage.local.get('stats');
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
 * Save settings to chrome.storage.local
 * @param {Object} settings - Settings to save
 */
export const saveSettings = async (settings) => {
    return chrome.storage.local.set(settings);
};

/**
 * Load settings from chrome.storage.local
 * @returns {Promise<Object>} Settings object
 */
export const loadSettings = async () => {
    const keys = ['betSize', 'targetWager', 'actionDelay', 'delayStdDev', 'strategy', 'autoRefresh'];
    const result = await chrome.storage.local.get(keys);
    return result;
};
