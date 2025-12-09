/**
 * @file background.js
 * @description Background service worker - handles messaging between popup/content/bot
 */

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

/** @type {Map<number, Object>} Active games indexed by tab ID */
const activeGames = new Map();

/** @type {Object} Strategy rules from JSON */
let strategyRules = {};

/** @type {Array} Recent bot log entries */
let botLogs = [];


// ═══════════════════════════════════════════════════════════════
// STRATEGY
// ═══════════════════════════════════════════════════════════════

/**
 * Load strategy from JSON file
 * @returns {Promise<boolean>}
 */
async function loadStrategy() {
    try {
        const response = await fetch(chrome.runtime.getURL('strategy.json'));
        strategyRules = await response.json();
        console.log('[BG] Strategy loaded');
        return true;
    } catch (error) {
        console.error('[BG] Strategy load failed:', error);
        return false;
    }
}

/**
 * Analyze hand and return recommended action
 * @param {string} playerHand - Player's hand value
 * @param {string} dealerCard - Dealer's upcard
 * @returns {Object} Analysis result
 */
function analyzeHand(playerHand, dealerCard) {
    const dealerKey = dealerCard === 'A' || dealerCard === '11' || dealerCard === '1'
        ? '1/11'
        : dealerCard.toString();

    if (strategyRules[dealerKey]?.[playerHand]) {
        return {
            success: true,
            action: strategyRules[dealerKey][playerHand],
            playerHand,
            dealerCard
        };
    }

    // Fallback for hands not in table
    const playerValue = parseInt(playerHand);
    if (!isNaN(playerValue)) {
        if (playerValue <= 11) return { success: true, action: 'Hit' };
        if (playerValue >= 17) return { success: true, action: 'Stand' };
        return { success: true, action: 'Hit' };
    }

    return { success: true, action: 'Stand' };
}


// ═══════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[BG] Message:', request.type);

    switch (request.type) {
        case 'GET_TAB_ID':
            sendResponse(sender.tab ? { tabId: sender.tab.id } : { error: 'No tab ID' });
            break;

        case 'GAME_DETECTED':
            if (sender.tab) {
                const tabId = sender.tab.id;
                activeGames.set(tabId, {
                    detected: true,
                    initialized: true,
                    gameData: request.data,
                    timestamp: new Date().toISOString()
                });
                console.log('[BG] Game detected on tab', tabId);
                sendResponse({ success: true, tabId });
            }
            break;

        case 'SESSION_UPDATE':
            if (sender.tab) {
                const tabId = sender.tab.id;
                const game = activeGames.get(tabId);
                if (game?.gameData) {
                    game.gameData.mgckey = request.data.mgckey;
                }
                sendResponse({ success: true });
            }
            break;

        case 'BETS_UPDATE':
            if (sender.tab) {
                const tabId = sender.tab.id;
                const game = activeGames.get(tabId);
                if (game) {
                    game.availableBets = request.data.availableBets;
                }
                chrome.storage.local.set({ availableBets: request.data.availableBets });
                sendResponse({ success: true });
            }
            break;

        case 'BALANCE_UPDATE':
            if (sender.tab) {
                const tabId = sender.tab.id;
                const game = activeGames.get(tabId);
                if (game) {
                    game.balance = request.data.balance;
                }
                sendResponse({ success: true });
            }
            break;

        case 'BOT_LOG':
            botLogs.push({
                message: request.message,
                level: request.level,
                timestamp: request.timestamp || new Date().toLocaleTimeString()
            });
            // Keep only last 100 entries
            if (botLogs.length > 100) {
                botLogs = botLogs.slice(-100);
            }
            sendResponse({ success: true });
            break;

        case 'BOT_STATS':
            chrome.storage.local.set({ botStats: request.stats });
            sendResponse({ success: true });
            break;

        case 'GET_BOT_LOGS':
            sendResponse({ logs: botLogs });
            break;

        case 'SESSION_END':
            if (sender.tab) {
                const tabId = sender.tab.id;
                activeGames.delete(tabId);
                console.log('[BG] Session ended for tab', tabId);
                sendResponse({ success: true });
            }
            break;

        case 'START_GAME':
            handleStartGame(request, sendResponse);
            return true; // async response

        case 'STOP_GAME':
            handleStopGame(sendResponse);
            return true;

        case 'ANALYZE_HAND':
            sendResponse(analyzeHand(request.data.playerHand, request.data.dealerCard));
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

        case 'GET_STATUS':
            const tabId = sender.tab?.id;
            const game = tabId ? activeGames.get(tabId) : null;
            sendResponse({
                hasGameData: game !== null,
                gameDetected: game?.detected ?? false,
                gameInitialized: game?.initialized ?? false,
                strategyLoaded: Object.keys(strategyRules).length > 0,
                activeGamesCount: activeGames.size,
                tabData: game || null,
                tabId
            });
            break;

        default:
            sendResponse({ success: false, error: 'Unknown message type' });
    }
});

/**
 * Handle START_GAME message - forward to all frames in active tab
 */
async function handleStartGame(request, sendResponse) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) {
        sendResponse({ success: false, error: 'No active tab' });
        return;
    }

    const tabId = tabs[0].id;

    // Persist settings
    chrome.storage.local.set({
        betSize: request.data.betSize,
        targetWager: request.data.targetWager,
        actionDelay: request.data.actionDelay
    });

    // Send to all frames - the one with gameData will respond
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    console.log('[BG] Sending START_BOT to', frames.length, 'frames');

    for (const frame of frames) {
        try {
            chrome.tabs.sendMessage(tabId, {
                type: 'START_BOT',
                settings: request.data
            }, { frameId: frame.frameId }, (response) => {
                if (chrome.runtime.lastError) {
                    // Expected for frames without content script
                } else if (response?.success) {
                    console.log('[BG] Bot started in frame', frame.frameId);
                }
            });
        } catch {
            // Ignore
        }
    }

    sendResponse({ success: true });
}

/**
 * Handle STOP_GAME message
 */
async function handleStopGame(sendResponse) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) {
        sendResponse({ success: false });
        return;
    }

    const tabId = tabs[0].id;
    const frames = await chrome.webNavigation.getAllFrames({ tabId });

    for (const frame of frames) {
        try {
            chrome.tabs.sendMessage(tabId, { type: 'STOP_BOT' }, { frameId: frame.frameId });
        } catch {
            // Ignore
        }
    }

    sendResponse({ success: true });
}


// ═══════════════════════════════════════════════════════════════
// TAB LIFECYCLE
// ═══════════════════════════════════════════════════════════════

// Cleanup on tab close
chrome.tabs.onRemoved.addListener(async (tabId) => {
    console.log('[BG] Tab closed:', tabId);
    activeGames.delete(tabId);

    await chrome.storage.local.remove([
        `gameData_${tabId}`,
        `botStatus_${tabId}`,
        `tabStats_${tabId}`,
        `tabHasGame_${tabId}`
    ]);
});

// Cleanup on navigation/refresh
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status !== 'loading') return;

    console.log('[BG] Tab navigating:', tabId);
    activeGames.delete(tabId);

    const autoRefreshKey = `autoRefresh_${tabId}`;
    const stored = await chrome.storage.local.get([autoRefreshKey]);

    const keysToRemove = [`gameData_${tabId}`, `tabHasGame_${tabId}`];

    if (!stored[autoRefreshKey]) {
        keysToRemove.push('botStats', 'botRunning');
        console.log('[BG] Clearing stats (not auto-refresh)');
    } else {
        await chrome.storage.local.remove([autoRefreshKey]);
        console.log('[BG] Preserving stats (auto-refresh)');
    }

    await chrome.storage.local.remove(keysToRemove);
});


// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener(() => {
    console.log('[BG] Extension installed');
    loadStrategy();
});

// Load on startup
loadStrategy();

console.log('[BG] Background script loaded');
