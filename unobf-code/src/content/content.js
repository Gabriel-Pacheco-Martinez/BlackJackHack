// Content Script - Game Data Capture & Bot Control
// INJECT INTERCEPTOR AND BOT IMMEDIATELY
(function() {
    const isIframe = window !== window.top;
    console.log('[CONTENT] Starting injection in', isIframe ? 'IFRAME' : 'TOP FRAME');
    console.log('[CONTENT] Current URL:', window.location.href);

    // Enable debug mode for the interceptor
    document.documentElement.setAttribute('data-debug-mode', 'true');

    // Inject interceptor script as early as possible
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/interceptor.js');
    script.onload = function() {
        console.log('[CONTENT] Interceptor injected successfully');
        this.remove();
    };
    script.onerror = function() {
        console.error('[CONTENT] Failed to load interceptor!');
    };
    (document.head || document.documentElement).appendChild(script);

    // Also inject the bot script
    const botScript = document.createElement('script');
    botScript.src = chrome.runtime.getURL('src/bot.js');
    botScript.onload = function() {
        console.log('[CONTENT] Bot script injected successfully');
        this.remove();
    };
    (document.head || document.documentElement).appendChild(botScript);
})();


// ═══════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

const isIframe = window !== window.top;

let gameState = {
    detected: false,
    initialized: false,
    gameData: null,
    balance: null,
    availableBets: [],
    sessionActive: false
};

let hasGameService = false;
let tabId = null;


// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function safeSendMessage(message) {
    return new Promise((resolve) => {
        if (!chrome.runtime?.id) {
            console.log('[CONTENT] Extension context lost');
            resolve(null);
            return;
        }

        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                console.log('[CONTENT] Message error:', chrome.runtime.lastError.message);
                resolve(null);
            } else {
                resolve(response);
            }
        });
    });
}

async function getTabId() {
    const response = await safeSendMessage({ type: 'GET_TAB_ID' });
    if (response && response.tabId) {
        tabId = response.tabId;
        console.log('[CONTENT] Tab ID:', tabId);
    }
}

let checkerInjected = false;

function checkForGameService() {
    if (checkerInjected) return;
    checkerInjected = true;

    const checkScript = document.createElement('script');
    checkScript.src = chrome.runtime.getURL('src/checker.js');
    checkScript.onload = function() {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(checkScript);
}


// ═══════════════════════════════════════════════════════════════
// MESSAGE HANDLERS
// ═══════════════════════════════════════════════════════════════

// Listen for messages from the interceptor (page context)
window.addEventListener('message', function(event) {
    if (event.source !== window) return;

    const message = event.data;
    if (!message || !message.type) return;

    // Only process game messages if this frame has gameService
    const gameMessages = ['GAME_DATA_CAPTURED', 'AVAILABLE_BETS_UPDATE', 'INIT_RESPONSE', 'BALANCE_UPDATE', 'BOT_LOG', 'BOT_STATS'];
    if (!hasGameService && gameMessages.includes(message.type) && message.type !== 'HAS_GAME_SERVICE') {
        return;
    }

    switch (message.type) {
        case 'HAS_GAME_SERVICE':
            if (!hasGameService) {
                hasGameService = true;
                console.log('[CONTENT] GameService detected in this frame!');
            }
            break;

        case 'GAME_DATA_CAPTURED':
            console.log('[CONTENT] Game data captured:', message.data);
            handleGameDetection(message.data);
            if (message.availableBets) {
                handleBetsDetection(message.availableBets);
            }
            break;

        case 'AVAILABLE_BETS_UPDATE':
            console.log('[CONTENT] Available bets:', message.availableBets);
            handleBetsDetection(message.availableBets);
            break;

        case 'INIT_RESPONSE':
            console.log('[CONTENT] Init response - index:', message.index, 'counter:', message.counter);
            if (gameState.gameData) {
                gameState.gameData.index = message.index;
                gameState.gameData.counter = message.counter;
            }
            break;

        case 'MGCKEY_UPDATE':
            if (gameState.gameData) {
                gameState.gameData.mgckey = message.mgckey;
            }
            break;

        case 'BALANCE_UPDATE':
            gameState.balance = message.balance;
            safeSendMessage({
                type: 'BALANCE_UPDATE',
                data: { balance: message.balance, action: message.action }
            });
            break;

        case 'BOT_LOG':
            // Forward bot logs to background
            safeSendMessage({
                type: 'BOT_LOG',
                message: message.message,
                level: message.level,
                timestamp: message.timestamp
            });
            break;

        case 'BOT_STATS':
            // Forward stats to background
            safeSendMessage({
                type: 'BOT_STATS',
                stats: message.stats
            });
            break;
    }
});

async function handleGameDetection(gameData) {
    console.log('[CONTENT] Game detected:', gameData);
    gameState.detected = true;
    gameState.initialized = true;
    gameState.gameData = gameData;
    gameState.sessionActive = true;

    // Notify background
    await safeSendMessage({
        type: 'GAME_DETECTED',
        data: {
            url: window.location.href,
            origin: gameData.origin,
            symbol: gameData.symbol,
            mgckey: gameData.mgckey,
            requestUrl: gameData.requestUrl,
            index: gameData.index,
            counter: gameData.counter,
            timestamp: gameData.timestamp,
            isIframe: isIframe
        }
    });

    // Store in tab-specific storage
    const currentTabId = tabId;
    if (currentTabId) {
        const tabDataKey = `gameData_${currentTabId}`;
        await chrome.storage.local.set({
            [tabDataKey]: {
                detected: true,
                initialized: true,
                gameData: gameData,
                timestamp: new Date().toISOString()
            }
        });
        console.log('[CONTENT] Stored game data for tab:', currentTabId);
    }
}

async function handleBetsDetection(availableBets) {
    console.log('[CONTENT] Bets detected:', availableBets);
    gameState.availableBets = availableBets;

    await chrome.storage.local.set({ availableBets: availableBets });
    await safeSendMessage({
        type: 'BETS_UPDATE',
        data: { availableBets: availableBets }
    });
}


// ═══════════════════════════════════════════════════════════════
// BOT CONTROL
// ═══════════════════════════════════════════════════════════════

function startBot(settings) {
    if (!gameState.gameData) {
        console.log('[CONTENT] No game data in this frame, skipping');
        return false;
    }

    if (!hasGameService) {
        console.log('[CONTENT] No gameService in this frame, skipping');
        return false;
    }

    console.log('[CONTENT] Starting bot with settings:', settings);
    console.log('[CONTENT] Game data:', gameState.gameData);

    // Store settings and game data in data attributes for the bot to read (CSP-safe)
    document.documentElement.setAttribute('data-bot-settings', JSON.stringify(settings));
    document.documentElement.setAttribute('data-game-data', JSON.stringify(gameState.gameData));
    document.documentElement.setAttribute('data-bot-command', 'start');

    // Dispatch a custom event that the bot script can listen for
    window.postMessage({
        type: 'BOT_COMMAND',
        command: 'start',
        settings: settings,
        gameData: gameState.gameData
    }, '*');

    return true;
}

function stopBot() {
    console.log('[CONTENT] Stopping bot');
    document.documentElement.setAttribute('data-bot-command', 'stop');
    window.postMessage({
        type: 'BOT_COMMAND',
        command: 'stop'
    }, '*');
}


// ═══════════════════════════════════════════════════════════════
// EXTENSION MESSAGE LISTENER
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[CONTENT] Message from extension:', request.type);

    switch (request.type) {
        case 'GET_GAME_STATE':
            sendResponse({
                state: gameState,
                url: window.location.href,
                hasGameService: hasGameService
            });
            break;

        case 'CHECK_GAME':
            sendResponse({
                detected: gameState.detected,
                initialized: gameState.initialized,
                hasGameService: hasGameService
            });
            break;

        case 'START_BOT':
            const started = startBot(request.settings);
            sendResponse({ success: started, hasGameData: !!gameState.gameData });
            break;

        case 'STOP_BOT':
            stopBot();
            sendResponse({ success: true });
            break;

        case 'RESET_STATE':
            gameState = {
                detected: false,
                initialized: false,
                gameData: null,
                balance: null,
                availableBets: [],
                sessionActive: false
            };
            sendResponse({ reset: true });
            break;

        default:
            sendResponse({ error: 'Unknown request type' });
    }

    return true;
});


// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

console.log('[CONTENT] Initializing game data capture...');

// Get tab ID
getTabId();

// Check for gameService
checkForGameService();
setTimeout(checkForGameService, 100);
setTimeout(checkForGameService, 500);
setTimeout(checkForGameService, 1500);

// Periodic check
let checkInterval = setInterval(() => {
    if (!gameState.detected) {
        if (!hasGameService) {
            checkForGameService();
        }
    } else {
        clearInterval(checkInterval);
    }
}, 2000);

// Clean up on unload
window.addEventListener('beforeunload', () => {
    if (gameState.sessionActive) {
        safeSendMessage({
            type: 'SESSION_END',
            data: {
                gameData: gameState.gameData,
                finalBalance: gameState.balance
            }
        });
    }
});
