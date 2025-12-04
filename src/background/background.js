// Background service worker for Chrome Extension
// Features: F010 - Settings Management
//          F006 - Game Interception

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

    case 'GAME_ACTION':
      handleGameAction(request, sendResponse);
      return true; // Will respond asynchronously

    case 'GAME_STATE_UPDATE':
      handleGameStateUpdate(request);
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

// Handle game action from content script (F006)
async function handleGameAction(request, sendResponse) {
  console.log('Game action intercepted:', request.action, request.gameState);

  try {
    // Basic strategy logic (simplified for demo)
    const { playerHand, dealerCard } = request.gameState;
    let shouldProceed = true;
    let suggestedAction = null;

    // Simple logic for demonstration
    const handValue = calculateHandValue(playerHand);
    if (handValue < 12 && request.action === 'stand') {
      shouldProceed = false;
      suggestedAction = 'hit';
    } else if (handValue >= 17 && request.action === 'hit') {
      shouldProceed = false;
      suggestedAction = 'stand';
    }

    sendResponse({
      shouldProceed,
      suggestedAction,
      reason: suggestedAction ? `Better to ${suggestedAction} with hand value ${handValue}` : 'Action approved'
    });

  } catch (error) {
    console.error('Error handling game action:', error);
    sendResponse({
      shouldProceed: true,
      error: error.message
    });
  }
}

// Handle game state updates (F006)
function handleGameStateUpdate(request) {
  console.log('Game state updated:', request.gameState);
  // Store latest game state
  chrome.storage.local.set({
    lastGameState: request.gameState,
    lastUpdateTime: request.timestamp
  });
}

// Calculate hand value (helper function)
function calculateHandValue(hand) {
  if (!hand || hand.length === 0) return 0;

  let value = 0;
  let aces = 0;

  for (const card of hand) {
    if (card === 'A') {
      aces++;
      value += 11;
    } else if (['K', 'Q', 'J'].includes(card)) {
      value += 10;
    } else {
      value += parseInt(card) || 0;
    }
  }

  // Adjust for aces
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return value;
}

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Blackjack Helper v0.1.1');
  console.log('Features implemented:');
  console.log('- F010: Settings configuration and persistence');
  console.log('- F006: Game interception and DOM manipulation');
});