// Message types for communication with background script
export const MessageTypes = {
  START_GAME: 'START_GAME',
  GAME_RESPONSE: 'GAME_RESPONSE',
  ERROR: 'ERROR',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
};

// Send message to background script
export const sendToBackground = (type, data = {}) => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...data }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
};

// Save settings to Chrome storage
export const saveSettings = (settings) => {
  return chrome.storage.local.set(settings);
};

// Load settings from Chrome storage
export const loadSettings = () => {
  return new Promise((resolve) => {
    chrome.storage.local.get(['betSize', 'targetWager', 'actionDelay', 'strategy'], (result) => {
      resolve(result);
    });
  });
};