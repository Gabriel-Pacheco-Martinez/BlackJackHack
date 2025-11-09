// Message types
export const MessageTypes = {
  START_GAME: 'START_GAME',
  GAME_RESPONSE: 'GAME_RESPONSE',
  ERROR: 'ERROR'
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

// Storage helpers
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