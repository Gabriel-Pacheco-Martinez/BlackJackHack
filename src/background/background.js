/*
 * background.js
 * strategy loading and hand analysis
 */

// state
const state = {
    games: new Map(),
    strategy: null,
    logs: []
};

// ═══════════════════════════════════════════════════════════════
// STRATEGY
// ═══════════════════════════════════════════════════════════════

const loadStrategy = async () => {
    try {
        const res = await fetch(chrome.runtime.getURL('strategy.json'));
        state.strategy = await res.json();
        console.log('[BG] strategy loaded -', Object.keys(state.strategy).length, 'dealer cards');
        return true;
    } catch (err) {
        console.error('[BG] strategy load failed:', err);
        return false;
    }
};

// hand analysis - looks up optimal play from strategy table
const analyzeHand = (hand, dealer) => {
    // normalize dealer card for lookup
    let dk = dealer;
    if (dealer === 'A' || dealer === '11' || dealer === '1') {
        dk = '1/11';
    } else {
        dk = String(dealer);
    }

    // check strategy table
    if (state.strategy?.[dk]?.[hand]) {
        const action = state.strategy[dk][hand];
        return {
            success: true,
            action: action,
            playerHand: hand,
            dealerCard: dealer,
            source: 'strategy_table'
        };
    }

    // fallback for hands not in table
    const val = parseInt(hand);
    if (!isNaN(val)) {
        if (val <= 11) return { success: true, action: 'Hit', source: 'fallback' };
        if (val >= 17) return { success: true, action: 'Stand', source: 'fallback' };
    }
    return { success: true, action: 'Hit', source: 'default' };
};

// ═══════════════════════════════════════════════════════════════
// TAB HELPERS
// ═══════════════════════════════════════════════════════════════

const getGame = (tabId) => state.games.get(tabId);
const setGame = (tabId, data) => state.games.set(tabId, data);
const clearGame = (tabId) => state.games.delete(tabId);

// ═══════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    const tabId = sender.tab?.id;

    switch (msg.type) {
        case 'GET_TAB_ID':
            reply(tabId ? { tabId } : { error: 'no tab' });
            break;

        case 'GAME_DETECTED':
            if (tabId) {
                setGame(tabId, {
                    detected: true,
                    init: true,
                    data: msg.data,
                    ts: Date.now()
                });
                reply({ success: true, tabId });
            }
            break;

        case 'SESSION_UPDATE':
            if (tabId) {
                const g = getGame(tabId);
                if (g?.data) g.data.mgckey = msg.data.mgckey;
                reply({ success: true });
            }
            break;

        case 'BETS_UPDATE':
            if (tabId) {
                const g = getGame(tabId);
                if (g) g.bets = msg.data.availableBets;
                chrome.storage.local.set({ availableBets: msg.data.availableBets });
                reply({ success: true });
            }
            break;

        case 'BALANCE_UPDATE':
            if (tabId) {
                const g = getGame(tabId);
                if (g) g.balance = msg.data.balance;
                reply({ success: true });
            }
            break;

        case 'BOT_LOG':
            state.logs.push({
                msg: msg.message,
                lvl: msg.level,
                time: msg.timestamp || new Date().toLocaleTimeString()
            });
            if (state.logs.length > 100) state.logs = state.logs.slice(-100);
            reply({ success: true });
            break;

        case 'BOT_STATS':
            chrome.storage.local.set({ botStats: msg.stats });
            reply({ success: true });
            break;

        case 'GET_BOT_LOGS':
            reply({ logs: state.logs });
            break;

        case 'SESSION_END':
            if (tabId) {
                clearGame(tabId);
                reply({ success: true });
            }
            break;

        case 'START_GAME':
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (!tabs[0]) return;
                const tid = tabs[0].id;

                chrome.storage.local.set({
                    betSize: msg.data.betSize,
                    targetWager: msg.data.targetWager,
                    actionDelay: msg.data.actionDelay
                });

                const frames = await chrome.webNavigation.getAllFrames({ tabId: tid });
                for (const f of frames) {
                    try {
                        chrome.tabs.sendMessage(tid, { type: 'START_BOT', settings: msg.data }, { frameId: f.frameId });
                    } catch {}
                }
                reply({ success: true });
            });
            return true;

        case 'STOP_GAME':
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (!tabs[0]) return;
                const tid = tabs[0].id;
                const frames = await chrome.webNavigation.getAllFrames({ tabId: tid });
                for (const f of frames) {
                    try {
                        chrome.tabs.sendMessage(tid, { type: 'STOP_BOT' }, { frameId: f.frameId });
                    } catch {}
                }
                reply({ success: true });
            });
            return true;

        case 'ANALYZE_HAND':
            reply(analyzeHand(msg.data.playerHand, msg.data.dealerCard));
            break;

        case 'LOAD_STRATEGY':
            loadStrategy().then(ok => reply({ success: ok }));
            return true;

        case 'UPDATE_SETTINGS':
            chrome.storage.local.set(msg.data).then(() => reply({ success: true }));
            return true;

        case 'GET_STATUS':
            const game = tabId ? getGame(tabId) : null;
            reply({
                hasGame: !!game,
                detected: game?.detected ?? false,
                init: game?.init ?? false,
                strategyLoaded: !!state.strategy,
                count: state.games.size,
                tabId
            });
            break;

        default:
            reply({ success: false, error: 'unknown msg type' });
    }
});

// ═══════════════════════════════════════════════════════════════
// TAB CLEANUP
// ═══════════════════════════════════════════════════════════════

chrome.tabs.onRemoved.addListener(async (tabId) => {
    clearGame(tabId);
    await chrome.storage.local.remove([`gameData_${tabId}`]);
});

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
    if (change.status !== 'loading') return;
    clearGame(tabId);
    await chrome.storage.local.remove([`gameData_${tabId}`]);
});

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener(() => {
    console.log('[BG] installed');
    loadStrategy();
});

loadStrategy();
