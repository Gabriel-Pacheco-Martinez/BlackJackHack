/**
 * Background Service Worker
 * Handles game detection, tab management, and bot control
 */

const DEBUG = true;
const VERSION = "0.2";

function log(...args) {
    if (DEBUG) {
        console.log(`[BG v${VERSION}]`, ...args);
    }
}

function logError(...args) {
    console.error(`[BG ERROR]`, ...args);
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let activeGames = new Map();  // tabId -> gameInfo
let strategyRules = {};
let botLogs = [];

// ============================================================================
// STRATEGY FUNCTIONS
// ============================================================================

async function loadStrategy() {
    log("loadStrategy called");
    try {
        const response = await fetch(chrome.runtime.getURL('strategy.json'));
        strategyRules = await response.json();
        log("Strategy loaded");
        return true;
    } catch (error) {
        logError("Strategy load failed:", error);
        return false;
    }
}

function analyzeHand(playerHand, dealerCard) {
    // TODO: implement full strategy lookup
    const playerValue = parseInt(playerHand);
    if (!isNaN(playerValue)) {
        if (playerValue <= 11) return { success: true, action: 'Hit' };
        if (playerValue >= 17) return { success: true, action: 'Stand' };
    }
    return { success: true, action: 'Hit' };
}

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log("Received message:", request.type, "from:", sender.tab ? `tab ${sender.tab.id}` : "popup");

    switch (request.type) {

        case 'GET_TAB_ID':
            if (sender.tab) {
                log("Returning tab ID:", sender.tab.id);
                sendResponse({ tabId: sender.tab.id });
            } else {
                logError("No tab ID available");
                sendResponse({ error: 'No tab ID available' });
            }
            break;

        case 'GAME_DETECTED':
            if (sender.tab) {
                const tabId = sender.tab.id;
                log("Game detected on tab", tabId);
                activeGames.set(tabId, {
                    detected: true,
                    initialized: true,
                    gameData: request.data,
                    timestamp: new Date().toISOString()
                });
                log("Active games count:", activeGames.size);
                sendResponse({ success: true, tabId: tabId });
            }
            break;

        case 'SESSION_UPDATE':
            if (sender.tab) {
                const tabId = sender.tab.id;
                const game = activeGames.get(tabId);
                if (game && game.gameData) {
                    game.gameData.mgckey = request.data.mgckey;
                    log("Updated mgckey for tab", tabId);
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
                    log("Updated bets for tab", tabId, ":", request.data.availableBets);
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
                    log("Balance update for tab", tabId, ":", request.data.balance);
                }
                sendResponse({ success: true });
            }
            break;

        case 'BOT_LOG':
            log("Bot log:", request.message);
            botLogs.push({
                message: request.message,
                level: request.level,
                timestamp: request.timestamp || new Date().toLocaleTimeString()
            });
            if (botLogs.length > 100) {
                botLogs = botLogs.slice(-100);
            }
            sendResponse({ success: true });
            break;

        case 'BOT_STATS':
            log("Saving bot stats:", request.stats);
            chrome.storage.local.set({ botStats: request.stats });
            sendResponse({ success: true });
            break;

        case 'GET_BOT_LOGS':
            log("Returning", botLogs.length, "logs");
            sendResponse({ logs: botLogs });
            break;

        case 'SESSION_END':
            if (sender.tab) {
                const tabId = sender.tab.id;
                activeGames.delete(tabId);
                log("Session ended for tab", tabId);
                sendResponse({ success: true });
            }
            break;

        case 'START_GAME':
            log("START_GAME request received with settings:", request.data);
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (tabs[0]) {
                    const tabId = tabs[0].id;
                    log("Forwarding START_BOT to tab", tabId);

                    chrome.storage.local.set({
                        betSize: request.data.betSize,
                        targetWager: request.data.targetWager,
                        actionDelay: request.data.actionDelay
                    });

                    const frames = await chrome.webNavigation.getAllFrames({ tabId });
                    log("Sending to", frames.length, "frames");

                    for (const frame of frames) {
                        try {
                            chrome.tabs.sendMessage(tabId, {
                                type: 'START_BOT',
                                settings: request.data
                            }, { frameId: frame.frameId }, (response) => {
                                if (chrome.runtime.lastError) {
                                    // Frame doesn't have content script
                                } else if (response && response.success) {
                                    log("Bot started in frame", frame.frameId);
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
            log("STOP_GAME request received");
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (tabs[0]) {
                    const tabId = tabs[0].id;
                    const frames = await chrome.webNavigation.getAllFrames({ tabId });
                    log("Sending STOP_BOT to", frames.length, "frames");

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
            log("Analysis result:", result);
            sendResponse(result);
            break;

        case 'LOAD_STRATEGY':
            loadStrategy()
                .then(success => {
                    log("Strategy load result:", success);
                    sendResponse({ success });
                })
                .catch(error => {
                    logError("Strategy load error:", error);
                    sendResponse({ success: false, error: error.message });
                });
            return true;

        case 'UPDATE_SETTINGS':
            log("Updating settings:", request.data);
            chrome.storage.local.set(request.data)
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'GET_STATUS':
            const tabId = sender.tab ? sender.tab.id : null;
            const game = tabId ? activeGames.get(tabId) : null;
            const status = {
                hasGameData: game !== null,
                gameDetected: game ? game.detected : false,
                gameInitialized: game ? game.initialized : false,
                strategyLoaded: Object.keys(strategyRules).length > 0,
                activeGamesCount: activeGames.size,
                tabData: game || null,
                tabId: tabId
            };
            log("Status request, returning:", status);
            sendResponse(status);
            break;

        default:
            logError("Unknown message type:", request.type);
            sendResponse({ success: false, error: 'Unknown message type' });
    }
});

// ============================================================================
// TAB LIFECYCLE MANAGEMENT
// ============================================================================

chrome.tabs.onRemoved.addListener(async (tabId) => {
    log("Tab closed:", tabId);
    activeGames.delete(tabId);

    const keysToRemove = [
        `gameData_${tabId}`,
        `botStatus_${tabId}`,
        `tabStats_${tabId}`,
        `tabHasGame_${tabId}`
    ];

    await chrome.storage.local.remove(keysToRemove);
    log("Cleaned up data for tab:", tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading') {
        log("Tab navigating/refreshing:", tabId);
        activeGames.delete(tabId);

        const autoRefreshKey = `autoRefresh_${tabId}`;
        const stored = await chrome.storage.local.get([autoRefreshKey]);

        const keysToRemove = [
            `gameData_${tabId}`,
            `tabHasGame_${tabId}`
        ];

        if (!stored[autoRefreshKey]) {
            keysToRemove.push('botStats', 'botRunning');
            log("Clearing stats (not auto-refresh)");
        } else {
            await chrome.storage.local.remove([autoRefreshKey]);
            log("Preserving stats (auto-refresh)");
        }

        await chrome.storage.local.remove(keysToRemove);
        log("Cleared game data for tab:", tabId);
    }
});

// ============================================================================
// INITIALIZATION
// ============================================================================

chrome.runtime.onInstalled.addListener(() => {
    log("Extension installed!");
    loadStrategy();
});

loadStrategy();

log("Background script loaded and ready");
