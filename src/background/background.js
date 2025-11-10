// Background service worker for Chrome Extension
// Feature: F010 - Settings Management

let currentSettings = {
  betSize: 10,
  targetWager: 100,
  actionDelay: 500,
  useDelays: true,
  autoRefresh: false,
  strategy: 'basic'
};

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.type);

  switch (request.type) {
    case 'START_GAME':
      handleGameStart(request, sendResponse);
      return true; // Will respond asynchronously

    case 'UPDATE_SETTINGS':
      updateSettings(request.settings);
      sendResponse({ success: true });
      break;

    default:
      sendResponse({
        success: false,
        error: 'Unknown message type'
      });
  }
});

// Handle game start request with settings
async function handleGameStart(request, sendResponse) {
  try {
    // Extract settings from request
    const settings = {
      betSize: request.betSize,
      targetWager: request.targetWager,
      useDelays: request.useDelays,
      actionDelay: request.actionDelay,
      strategy: request.strategy,
      autoRefresh: request.autoRefresh
    };

    // Save settings to storage
    await chrome.storage.local.set({
      currentSettings: settings,
      betSize: settings.betSize.toString(),
      targetWager: settings.targetWager.toString(),
      actionDelay: settings.actionDelay.toString(),
      strategy: settings.strategy
    });

    // Update current settings
    currentSettings = settings;

    console.log('Settings saved:', settings);

    // Apply delays if enabled
    if (settings.useDelays) {
      const delay = settings.actionDelay + Math.random() * settings.actionDelay;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Simulate successful initialization
    sendResponse({
      success: true,
      message: 'Game settings configured successfully',
      settings: settings,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error starting game:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

// Update settings
function updateSettings(settings) {
  currentSettings = { ...currentSettings, ...settings };
  chrome.storage.local.set({ currentSettings });
  console.log('Settings updated:', currentSettings);
}

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Blackjack Helper v0.1 - F010 Settings Management');
  console.log('Features implemented: Settings configuration and persistence');
});