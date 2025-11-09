// Bot logic copied EXACTLY from test-extension
// Debug logging wrapper
function debugLog(...args) {
  // Check debug mode from data attribute
  const debugAttr = document.documentElement.getAttribute('data-debug-mode');
  if (debugAttr === 'true') {
    console.log(...args);
  }
}

debugLog('[BOT-LOGIC] Loading bot logic script');

// This will be injected into the page context
window.__startBlackjackBot = function(gameData, strategyData, settings) {
  debugLog('[BOT] Starting with settings:', settings);
  
  if (window.__botInterval) {
    clearInterval(window.__botInterval);
    window.__botRunning = false;
  }
  
  window.__botRunning = true;
  window.__totalWagered = 0;
  window.__targetWager = settings.targetWager || 0;
  window.__betSize = settings.betSize || 0.1;
  
  // Initialize counters from captured data
  if (typeof window.__lastIndex === 'undefined') {
    window.__lastIndex = gameData.index || 0;
    window.__lastCounter = gameData.counter || 0;
  }
  
  debugLog('[BOT] Target wager: $' + (window.__targetWager || 'unlimited'));
  debugLog('[BOT] Current index=' + window.__lastIndex + ', counter=' + window.__lastCounter);
  
  const playRound = async () => {
    if (!window.__botRunning) {
      debugLog('[BOT] Bot stopped');
      return;
    }
    
    // IMPORTANT: Increment from last response values
    let currentIndex = window.__lastIndex + 1;
    let currentCounter = window.__lastCounter + 2;
    
    debugLog('[BOT] ========= STARTING ROUND =========');
    debugLog('[BOT] Using index=' + currentIndex + ', counter=' + currentCounter);
    
    const makeAction = async (action, cid = 0, betString = null, insf = null) => {
      const params = {
        action: action,
        symbol: gameData.symbol,
        cid: cid,
        index: currentIndex,
        counter: currentCounter,
        repeat: 0,
        mgckey: gameData.mgckey
      };
      
      if (betString) params.c = betString;
      if (insf !== null) params.insf = insf;
      
      const body = new URLSearchParams(params).toString();
      debugLog('[BOT] ' + action + ' cid=' + cid);
      
      try {
        const response = await fetch(gameData.requestUrl, {
          method: 'POST',
          headers: {
            'accept': '*/*',
            'accept-language': 'en-US,en;q=0.9',
            'cache-control': 'no-cache',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': gameData.origin,
            'pragma': 'no-cache'
          },
          body: body,
          credentials: 'include'
        });
        
        const text = await response.text();
        debugLog('[BOT] Response:', text.substring(0, 200));
        
        // CRITICAL: Update counters from response
        const responseParams = {};
        text.split('&').forEach(pair => {
          const [key, value] = pair.split('=');
          responseParams[key] = value;
        });
        
        if (responseParams.counter !== undefined) {
          currentCounter = parseInt(responseParams.counter) + 1;
        }
        if (responseParams.index !== undefined) {
          currentIndex = parseInt(responseParams.index) + 1;
        }
        
        // Check for errors
        if (text.includes('frozen=') || text.includes('msg_code=7') || text.includes('SystemError')) {
          console.error('[BOT] ERROR: Game frozen or system error!');
          console.error('[BOT] Response:', text);
          window.__botRunning = false;
          // Send error to extension
          window.postMessage({ 
            type: 'BOT_ERROR', 
            error: 'Game frozen - please refresh and recapture' 
          }, '*');
          return { success: false, error: 'Game frozen' };
        }
        
        return { success: true, response: text };
      } catch (error) {
        console.error('[BOT] Request failed:', error);
        return { success: false, error: error.message };
      }
    };
    
    // Parse game response
    const parseGameResponse = (responseText) => {
      const params = {};
      responseText.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        params[key] = value;
      });
      
      const hands = [];
      for (let i = 0; i <= 5; i++) {
        const cpKey = 'cp' + i;
        const spKey = 'sp' + i;
        const statKey = 'stat' + i;
        
        if (params[cpKey]) {
          hands.push({
            index: i,
            cards: params[cpKey].split(',').map(c => parseInt(c)),
            status: parseInt(params[statKey] || 1),
            serverTotal: params[spKey] || '0',
            isSoft: (params[spKey] || '').includes('/')
          });
        }
      }
      
      return {
        hands: hands,
        dealerValue: parseInt(params.sd || 10),
        currentHand: parseInt(params.hnd || 0),
        needsInsurance: params.inip === '1',
        gameEnded: params.end === '1',
        totalWin: parseFloat(params.win || 0)
      };
    };
    
    // Check target wager
    if (window.__targetWager > 0 && window.__totalWagered >= window.__targetWager) {
      debugLog('[BOT] Target wager reached!');
      window.__botRunning = false;
      return;
    }
    
    // Deal new hand
    const betString = window.__betSize + ',0,' + window.__betSize + ',0,' + window.__betSize + ',0,0,0';
    const roundWager = window.__betSize * 3;
    
    debugLog('[BOT] Dealing 3 hands at $' + window.__betSize + ' each');
    const dealResult = await makeAction('doDeal', 0, betString);
    
    if (!dealResult.success) {
      console.error('[BOT] Deal failed!');
      return;
    }
    
    window.__totalWagered += roundWager;
    debugLog('[BOT] Total wagered: $' + window.__totalWagered.toFixed(2));
    
    let gameState = parseGameResponse(dealResult.response);
    debugLog('[BOT] Dealt ' + gameState.hands.length + ' hands');
    
    // Handle insurance
    while (gameState.needsInsurance && !gameState.gameEnded) {
      debugLog('[BOT] Declining insurance');
      const insResult = await makeAction('doInsurance', 0, null, 0);
      if (!insResult.success) break;
      gameState = parseGameResponse(insResult.response);
    }
    
    // Play each hand
    while (!gameState.gameEnded) {
      const handNum = gameState.currentHand;
      const hand = gameState.hands.find(h => h.index === handNum);
      
      if (!hand || hand.status !== 1) {
        break;
      }
      
      debugLog('[BOT] Playing hand ' + handNum + ' (total: ' + hand.serverTotal + ')');
      
      // Get strategy decision
      const dealerKey = gameState.dealerValue === 11 ? "1/11" : gameState.dealerValue.toString();
      const handKey = hand.serverTotal;
      let action = strategyData[dealerKey]?.[handKey] || "Stand";
      
      // Convert strategy to API action
      if (action === "DoubleStand") action = hand.cards.length === 2 ? "Double" : "Stand";
      if (action === "Surrender") action = "Hit";
      if (action === "Split") action = "Hit"; // No split support yet
      
      debugLog('[BOT] Strategy says:', action);
      
      // Execute action
      let apiAction;
      if (action === "Hit") apiAction = "doHit";
      else if (action === "Stand") apiAction = "doStand";
      else if (action === "Double") apiAction = "doDouble";
      else apiAction = "doStand";
      
      const result = await makeAction(apiAction, handNum);
      if (!result.success) break;
      
      gameState = parseGameResponse(result.response);
      
      // Check if hand busted or we stood
      if (apiAction === "doStand" || apiAction === "doDouble") {
        continue; // Move to next hand
      }
      
      // If we hit, check if we need to continue
      const updatedHand = gameState.hands.find(h => h.index === handNum);
      if (updatedHand && updatedHand.status === 1) {
        // Hand still active, loop will continue
      }
    }
    
    // Collect winnings if any
    const hasBlackjack = gameState.hands.some(h => h.status === 3 || h.status === 14);
    if (gameState.gameEnded && (gameState.totalWin > 0 || hasBlackjack)) {
      debugLog('[BOT] Collecting winnings');
      await makeAction('doWin', 0);
    }
    
    // Save last counters for next round
    window.__lastIndex = currentIndex - 1;
    window.__lastCounter = currentCounter - 1;
    
    debugLog('[BOT] Round complete');
  };
  
  // Start playing rounds
  window.__botInterval = setInterval(playRound, 3000);
  playRound(); // Start immediately
};

window.__stopBlackjackBot = function() {
  debugLog('[BOT] Stopping bot');
  window.__botRunning = false;
  if (window.__botInterval) {
    clearInterval(window.__botInterval);
    window.__botInterval = null;
  }
};