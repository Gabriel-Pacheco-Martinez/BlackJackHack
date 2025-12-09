// Background service worker for Blackjack Bot
// Handles game detection, data capture, bot control, and strategy


// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let activeGames = new Map();
let strategyRules = {};
let botLogs = [];


// ═══════════════════════════════════════════════════════════════
// STRATEGY LOADING
// ═══════════════════════════════════════════════════════════════

async function loadStrategy() {
    try {
        const response = await fetch(chrome.runtime.getURL('strategy.json'));
        strategyRules = await response.json();
        console.log('[BG] Strategy loaded successfully');
        return true;
    } catch (error) {
        console.error('[BG] Failed to load strategy:', error);
        return false;
    }
}

function analyzeHand(playerHand, dealerCard) {
    const dealerKey = dealerCard === 'A' || dealerCard === '11' || dealerCard === '1' ? '1/11' : dealerCard.toString();

    if (strategyRules[dealerKey] && strategyRules[dealerKey][playerHand]) {
        const action = strategyRules[dealerKey][playerHand];
        return {
            success: true,
            action: action,
            playerHand: playerHand,
            dealerCard: dealerCard
        };
    }

    // Fallback
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
            if (sender.tab) {
                sendResponse({ tabId: sender.tab.id });
            } else {
                sendResponse({ error: 'No tab ID available' });
            }
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
                sendResponse({ success: true, tabId: tabId });
            }
            break;

        case 'SESSION_UPDATE':
            if (sender.tab) {
                const tabId = sender.tab.id;
                const game = activeGames.get(tabId);
                if (game && game.gameData) {
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
                // Also save to storage
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
            // Store bot logs
            botLogs.push({
                message: request.message,
                level: request.level,
                timestamp: request.timestamp || new Date().toLocaleTimeString()
            });
            // Keep only last 100 logs
            if (botLogs.length > 100) {
                botLogs = botLogs.slice(-100);
            }
            sendResponse({ success: true });
            break;

        case 'BOT_STATS':
            // Store stats
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
            // Forward to content script to start the bot
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (tabs[0]) {
                    const tabId = tabs[0].id;

                    // Save settings
                    chrome.storage.local.set({
                        betSize: request.data.betSize,
                        targetWager: request.data.targetWager,
                        actionDelay: request.data.actionDelay
                    });

                    // Get all frames in this tab
                    const frames = await chrome.webNavigation.getAllFrames({ tabId });
                    console.log('[BG] Sending START_BOT to', frames.length, 'frames');

                    // Send to all frames - the one with game data will respond
                    for (const frame of frames) {
                        try {
                            chrome.tabs.sendMessage(tabId, {
                                type: 'START_BOT',
                                settings: request.data
                            }, { frameId: frame.frameId }, (response) => {
                                if (chrome.runtime.lastError) {
                                    // Ignore errors for frames without content script
                                } else if (response && response.success) {
                                    console.log('[BG] Bot started in frame', frame.frameId);
                                }
                            });
                        } catch (e) {
                            // Ignore
                        }
                    }

                    sendResponse({ success: true });
                }
            });
            return true;

        case 'STOP_GAME':
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (tabs[0]) {
                    const tabId = tabs[0].id;
                    const frames = await chrome.webNavigation.getAllFrames({ tabId });

                    for (const frame of frames) {
                        try {
                            chrome.tabs.sendMessage(tabId, {
                                type: 'STOP_BOT'
                            }, { frameId: frame.frameId });
                        } catch (e) {
                            // Ignore
                        }
                    }

                    sendResponse({ success: true });
                }
            });
            return true;

        case 'ANALYZE_HAND':
            const result = analyzeHand(request.data.playerHand, request.data.dealerCard);
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

        case 'GET_STATUS':
            const tabId = sender.tab ? sender.tab.id : null;
            const game = tabId ? activeGames.get(tabId) : null;
            sendResponse({
                hasGameData: game !== null,
                gameDetected: game ? game.detected : false,
                gameInitialized: game ? game.initialized : false,
                strategyLoaded: Object.keys(strategyRules).length > 0,
                activeGamesCount: activeGames.size,
                tabData: game || null,
                tabId: tabId
            });
            break;

        default:
            sendResponse({ success: false, error: 'Unknown message type' });
    }
});


// ═══════════════════════════════════════════════════════════════
// TAB LIFECYCLE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// Clear tab-specific data when tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
    console.log('[BG] Tab closed:', tabId);

    activeGames.delete(tabId);

    const keysToRemove = [
        `gameData_${tabId}`,
        `botStatus_${tabId}`,
        `tabStats_${tabId}`,
        `tabHasGame_${tabId}`
    ];

    await chrome.storage.local.remove(keysToRemove);
    console.log('[BG] Cleaned up data for tab:', tabId);
});

// Clear tab-specific game data on page navigation/refresh
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') {
        console.log('[BG] Tab navigating/refreshing:', tabId);

        activeGames.delete(tabId);

        // Check if this is an auto-refresh (bot should preserve stats)
        const autoRefreshKey = `autoRefresh_${tabId}`;
        const stored = await chrome.storage.local.get([autoRefreshKey]);

        const keysToRemove = [
            `gameData_${tabId}`,
            `tabHasGame_${tabId}`
        ];

        // Only clear stats if NOT an auto-refresh
        if (!stored[autoRefreshKey]) {
            keysToRemove.push('botStats', 'botRunning');
            console.log('[BG] Clearing stats and bot state (not auto-refresh)');
        } else {
            // Clear the auto-refresh flag after use
            await chrome.storage.local.remove([autoRefreshKey]);
            console.log('[BG] Preserving stats (auto-refresh cycle)');
        }

        await chrome.storage.local.remove(keysToRemove);
        console.log('[BG] Cleared game data for tab refresh:', tabId);
    }
});


// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener(() => {
    console.log('[BG] Blackjack Bot Extension installed');
    loadStrategy();
});

// Load strategy on startup
loadStrategy();

console.log('[BG] Background script loaded');
