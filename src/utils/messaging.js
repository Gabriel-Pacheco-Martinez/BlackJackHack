// messaging utils - ohm
// helper functions for talking to background script

// message types we support
export const MessageTypes = {
  START_GAME: 'START_GAME',
  GAME_RESPONSE: 'GAME_RESPONSE',
  ERROR: 'ERROR',
  ANALYZE_HAND: 'ANALYZE_HAND',
  LOAD_STRATEGY: 'LOAD_STRATEGY',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS'
  // TODO: add more types when we implement real bot
  // START_BOT: 'START_BOT',
  // STOP_BOT: 'STOP_BOT',
  // GAME_DETECTED: 'GAME_DETECTED'
};

// send message to background script
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

// save stats to storage
export const saveStats = async (stats) => {
  return chrome.storage.local.set({ stats });
};

// load stats from storage
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

// TODO: add settings helpers when needed
