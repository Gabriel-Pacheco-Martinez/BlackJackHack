// Message types
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

// Send message from popup to background
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

// Storage helpers for statistics tracking (F011)
export const saveStats = async (stats) => {
  return chrome.storage.local.set({ stats });
};

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

// Settings management helpers (F010)
export const saveSettings = async (settings) => {
  return chrome.storage.local.set(settings);
};

export const loadSettings = async () => {
  const keys = ['betSize', 'targetWager', 'actionDelay', 'strategy', 'autoRefresh'];
  const result = await chrome.storage.local.get(keys);
  return result;
};
