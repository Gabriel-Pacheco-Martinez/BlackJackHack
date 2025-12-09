/*
 * messaging.js
 * chrome messaging helpers
 */

// msg types
export const MSG_TYPES = {
    START_GAME: 'START_GAME',
    STOP_GAME: 'STOP_GAME',
    GAME_RESPONSE: 'GAME_RESPONSE',
    ERROR: 'ERROR',
    ANALYZE_HAND: 'ANALYZE_HAND',
    LOAD_STRATEGY: 'LOAD_STRATEGY',
    UPDATE_SETTINGS: 'UPDATE_SETTINGS',
    GET_STATUS: 'GET_STATUS'
};

// send msg to background
export const sendMsg = (type, data) =>
    new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, data }, resp => {
            chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(resp);
        });
    });

// stats helpers
export const setStats = async stats => chrome.storage.local.set({ stats });

export const getStats = async () => {
    const { stats } = await chrome.storage.local.get('stats');
    return stats || { wins: 0, losses: 0, pushes: 0, totalGames: 0, totalWagered: 0, netProfit: 0 };
};

// settings
export const setSettings = async s => chrome.storage.local.set(s);

export const getSettings = async () => {
    const keys = ['betSize', 'targetWager', 'actionDelay', 'delayStdDev', 'strategy'];
    return chrome.storage.local.get(keys);
};
