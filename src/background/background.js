// background.js
// handles settings, stats, and basic messaging

// game data - will come from interceptor eventually
var capturedGameData = null;
var currentStrategy = null;
var strategyRules = {};

// load strategy file
async function loadStrategy() {
  try {
    const response = await fetch(chrome.runtime.getURL('strategy.json'));
    strategyRules = await response.json();
    currentStrategy = 'basic';
    console.log('strategy loaded ok');
    return true;
  } catch (error) {
    console.error('failed to load strategy:', error);
    return false;
  }
}

// analyze hand - basic version
function analyzeHand(playerHand, dealerCard, strategy = 'basic') {
  try {
    console.log('analyzing:', playerHand, 'vs dealer', dealerCard);

    // convert dealer for lookup
    const dealerKey = dealerCard === 'A' || dealerCard === '11' ? '1/11' : dealerCard.toString();

    // check strategy table
    if (strategyRules[dealerKey] && strategyRules[dealerKey][playerHand]) {
      const action = strategyRules[dealerKey][playerHand];

      var reason = '';
      if (action === 'Hit') reason = 'strategy says hit';
      else if (action === 'Stand') reason = 'strategy says stand';
      else if (action === 'Double') reason = 'double opportunity';
      else if (action === 'Split') reason = 'should split';
      else reason = 'math says so';

      return {
        success: true,
        action: action,
        reason: reason,
        playerHand: playerHand,
        dealerCard: dealerCard,
        strategy: strategy
      };
    }

    // fallback
    const playerValue = parseInt(playerHand);
    if (!isNaN(playerValue)) {
      if (playerValue <= 11) {
        return { success: true, action: 'Hit', reason: 'safe to hit' };
      } else if (playerValue >= 17) {
        return { success: true, action: 'Stand', reason: 'stand on 17+' };
      } else {
        return { success: true, action: 'Hit', reason: 'default' };
      }
    }

    return { success: true, action: 'Hit', reason: 'fallback' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// handle start game request
// right now just simulates since we dont have the interceptor hooked up
async function handleGameRequest(gameData) {
  try {
    console.log('got game request:', gameData);

    // save settings
    await chrome.storage.local.set({
      currentSettings: gameData,
      lastStartTime: Date.now()
    });

    // add delay if configured
    if (gameData.useDelays) {
      await delay(Math.random() * gameData.actionDelay + 500);
    }

    // TODO: implement real game interaction
    // for now just simulate
    console.log('simulating hand with:');
    console.log('- bet:', gameData.betSize);
    console.log('- target:', gameData.targetWager);

    // update stats - simulated results
    const stats = await chrome.storage.local.get('stats');
    const currentStats = stats.stats || {
      wins: 0,
      losses: 0,
      pushes: 0,
      totalGames: 0,
      totalWagered: 0,
      netProfit: 0
    };

    // play fake hand
    currentStats.totalGames++;
    currentStats.totalWagered += gameData.betSize;

    // random outcome lol
    const outcome = Math.random();
    if (outcome < 0.42) {
      currentStats.wins++;
      currentStats.netProfit += gameData.betSize;
    } else if (outcome < 0.49) {
      currentStats.pushes++;
    } else {
      currentStats.losses++;
      currentStats.netProfit -= gameData.betSize;
    }

    await chrome.storage.local.set({ stats: currentStats });

    return {
      message: 'simulated',
      settings: gameData,
      strategyLoaded: currentStrategy !== null
    };
  } catch (error) {
    console.error('error:', error);
    throw error;
  }
}

// message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('got message:', request.type);

  switch (request.type) {
    case 'START_GAME':
      handleGameRequest(request.data)
        .then(response => sendResponse({ success: true, data: response }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'ANALYZE_HAND':
      const result = analyzeHand(
        request.data.playerHand,
        request.data.dealerCard,
        request.data.strategy
      );
      sendResponse(result);
      break;

    case 'LOAD_STRATEGY':
      loadStrategy()
        .then(success => sendResponse({ success }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'UPDATE_SETTINGS':
      chrome.storage.local.set(request.data)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'CAPTURE_GAME_DATA':
      // will receive data from interceptor when that's done
      capturedGameData = request.data;
      console.log('game data captured:', capturedGameData);
      sendResponse({ success: true });
      break;

    case 'GET_STATUS':
      sendResponse({
        running: false,
        hasGameData: capturedGameData !== null,
        strategyLoaded: currentStrategy !== null
      });
      break;

    default:
      sendResponse({ success: false, error: 'unknown message type' });
  }
});

// helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// init
chrome.runtime.onInstalled.addListener(() => {
  console.log('blackjack helper installed');
  loadStrategy();
});

loadStrategy();
