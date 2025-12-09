// Blackjack Bot - Full Implementation (Page Context)
// This runs in the page context, NOT the extension context
// It communicates with the content script via postMessage

(function() {
    console.log('[BOT] Bot script loading...');

    // Debug logging
    function debugLog(...args) {
        console.log(...args);
    }

    class BlackjackBot {
        constructor() {
            this.gameData = null;
            this.botRunning = false;
            this.currentIndex = null;
            this.currentCounter = null;
            this.strategy = null;
            this.betSize = 1;
            this.targetWager = 2000;
            this.actionDelay = 1000;
            this.delayStdDev = 200;

            this.stats = {
                totalWagered: 0,
                totalReturned: 0,
                handsPlayed: 0,
                handsWon: 0,
                handsLost: 0,
                handsPushed: 0
            };

            debugLog('[BOT] BlackjackBot instance created');
        }

        async initialize(gameData) {
            this.gameData = gameData;
            debugLog('[BOT] Initialized with game data:', gameData);

            if (gameData.index !== undefined && gameData.counter !== undefined) {
                this.currentIndex = gameData.index + 1;
                this.currentCounter = gameData.counter + 1;
                debugLog('[BOT] Starting counters:', this.currentIndex, this.currentCounter);
            }

            // Load strategy from window (set by interceptor capturing doInit response)
            // or fetch it directly
            await this.loadStrategy();

            return true;
        }

        async loadStrategy() {
            try {
                // Try to fetch strategy.json from the extension
                // The content script should have made it available
                const strategyAttr = document.documentElement.getAttribute('data-strategy');
                if (strategyAttr) {
                    this.strategy = JSON.parse(strategyAttr);
                    debugLog('[BOT] Strategy loaded from attribute');
                    return true;
                }

                // Fallback: use basic strategy inline
                debugLog('[BOT] Using fallback basic strategy');
                this.strategy = this.getBasicStrategy();
                return true;
            } catch (error) {
                console.error('[BOT] Failed to load strategy:', error);
                this.strategy = this.getBasicStrategy();
                return false;
            }
        }

        getBasicStrategy() {
            // Simplified basic strategy
            return {
                "2": { "5": "Hit", "6": "Hit", "7": "Hit", "8": "Hit", "9": "Double", "10": "Double", "11": "Double", "12": "Hit", "13": "Stand", "14": "Stand", "15": "Stand", "16": "Stand", "17": "Stand" },
                "3": { "5": "Hit", "6": "Hit", "7": "Hit", "8": "Hit", "9": "Double", "10": "Double", "11": "Double", "12": "Hit", "13": "Stand", "14": "Stand", "15": "Stand", "16": "Stand", "17": "Stand" },
                "4": { "5": "Hit", "6": "Hit", "7": "Hit", "8": "Hit", "9": "Double", "10": "Double", "11": "Double", "12": "Stand", "13": "Stand", "14": "Stand", "15": "Stand", "16": "Stand", "17": "Stand" },
                "5": { "5": "Hit", "6": "Hit", "7": "Hit", "8": "Hit", "9": "Double", "10": "Double", "11": "Double", "12": "Stand", "13": "Stand", "14": "Stand", "15": "Stand", "16": "Stand", "17": "Stand" },
                "6": { "5": "Hit", "6": "Hit", "7": "Hit", "8": "Hit", "9": "Double", "10": "Double", "11": "Double", "12": "Stand", "13": "Stand", "14": "Stand", "15": "Stand", "16": "Stand", "17": "Stand" },
                "7": { "5": "Hit", "6": "Hit", "7": "Hit", "8": "Hit", "9": "Hit", "10": "Double", "11": "Double", "12": "Hit", "13": "Hit", "14": "Hit", "15": "Hit", "16": "Hit", "17": "Stand" },
                "8": { "5": "Hit", "6": "Hit", "7": "Hit", "8": "Hit", "9": "Hit", "10": "Double", "11": "Double", "12": "Hit", "13": "Hit", "14": "Hit", "15": "Hit", "16": "Hit", "17": "Stand" },
                "9": { "5": "Hit", "6": "Hit", "7": "Hit", "8": "Hit", "9": "Hit", "10": "Double", "11": "Double", "12": "Hit", "13": "Hit", "14": "Hit", "15": "Hit", "16": "Hit", "17": "Stand" },
                "10": { "5": "Hit", "6": "Hit", "7": "Hit", "8": "Hit", "9": "Hit", "10": "Hit", "11": "Double", "12": "Hit", "13": "Hit", "14": "Hit", "15": "Hit", "16": "Hit", "17": "Stand" },
                "1/11": { "5": "Hit", "6": "Hit", "7": "Hit", "8": "Hit", "9": "Hit", "10": "Hit", "11": "Hit", "12": "Hit", "13": "Hit", "14": "Hit", "15": "Hit", "16": "Hit", "17": "Stand" }
            };
        }

        async start(settings = {}) {
            if (this.botRunning) {
                debugLog('[BOT] Already running');
                return false;
            }

            debugLog('[BOT] Starting with settings:', settings);

            this.betSize = settings.betSize || this.betSize;
            this.targetWager = settings.targetWager || this.targetWager;
            this.actionDelay = settings.actionDelay || 0;
            this.delayStdDev = settings.delayStdDev || 0;

            this.stats = {
                totalWagered: 0,
                totalReturned: 0,
                handsPlayed: 0,
                handsWon: 0,
                handsLost: 0,
                handsPushed: 0
            };

            this.botRunning = true;
            this.log('Bot started', 'info');

            this.runBotLoop();
            return true;
        }

        async stop() {
            debugLog('[BOT] Stopping...');
            this.botRunning = false;
            this.log('Bot stopped', 'info');
        }

        async runBotLoop() {
            debugLog('[BOT] Bot loop started');

            while (this.botRunning) {
                try {
                    if (this.targetWager > 0 && this.stats.totalWagered >= this.targetWager) {
                        debugLog('[BOT] Target wager reached!');
                        this.log('Target wager reached!', 'success');
                        this.botRunning = false;
                        break;
                    }

                    await this.playRound();

                    if (!this.botRunning) break;
                } catch (error) {
                    console.error('[BOT] Error in bot loop:', error);
                    this.log('Error: ' + error.message, 'error');
                    await this.sleep(3000);
                }
            }

            debugLog('[BOT] Bot loop ended');
        }

        async playRound() {
            if (!this.botRunning) return;

            debugLog('[BOT] Starting new round...');
            this.log('Dealing new hand...', 'action');

            const betString = `${this.betSize},0,${this.betSize},0,${this.betSize},0,0,0`;

            const dealResult = await this.makeAction('doDeal', 0, betString);
            if (!dealResult.success) {
                console.error('[BOT] Deal failed:', dealResult.error);
                this.log('Deal failed: ' + dealResult.error, 'error');
                this.botRunning = false;
                return;
            }

            let gameState = this.parseGameResponse(dealResult.response);
            const initialHandCount = gameState.hands.length;
            const dealerDisplay = gameState.dealerValue === 1 ? 'A' : gameState.dealerValue;
            this.log(`Deal: ${initialHandCount} hand(s), Dealer: ${dealerDisplay}`, 'info');

            let totalWagered = initialHandCount * this.betSize;
            let maxHandsSeen = initialHandCount;

            // Handle insurance (always decline)
            while (gameState.needsInsurance && !gameState.gameEnded) {
                debugLog('[BOT] Declining insurance');
                const insResult = await this.makeAction('doInsurance', 0, null, 0);
                gameState = this.parseGameResponse(insResult.response);
            }

            // Play each hand
            while (!gameState.gameEnded) {
                const handNum = gameState.currentHand;
                const hand = gameState.hands.find(h => h.index === handNum);

                if (!hand || hand.status !== 1) break;

                debugLog('[BOT] Playing hand', handNum, 'total:', hand.serverTotal);

                while (hand.status === 1 && !gameState.gameEnded) {
                    const action = this.getStrategyDecision(gameState, hand);
                    debugLog('[BOT] Strategy:', action);

                    let apiAction;
                    if (action === 'Hit' && gameState.canHit) apiAction = 'doHit';
                    else if (action === 'Stand' && gameState.canStand) apiAction = 'doStand';
                    else if (action === 'Double' && gameState.canDouble) apiAction = 'doDouble';
                    else if (action === 'Split' && gameState.canSplit) apiAction = 'doSplit';
                    else if (gameState.canHit) apiAction = 'doHit';
                    else if (gameState.canStand) apiAction = 'doStand';
                    else break;

                    const result = await this.makeAction(apiAction, handNum);
                    if (!result.success) break;

                    gameState = this.parseGameResponse(result.response);

                    if (gameState.hands.length > maxHandsSeen) {
                        totalWagered += (gameState.hands.length - maxHandsSeen) * this.betSize;
                        maxHandsSeen = gameState.hands.length;
                    }

                    const updatedHand = gameState.hands.find(h => h.index === handNum);
                    if (updatedHand) {
                        hand.status = updatedHand.status;
                        hand.serverTotal = updatedHand.serverTotal;
                    }

                    if (apiAction === 'doDouble') {
                        totalWagered += this.betSize;
                        break;
                    }
                    if (apiAction === 'doSplit') {
                        totalWagered += this.betSize;
                        break;
                    }
                    if (apiAction === 'doStand') break;
                }
            }

            // Collect winnings
            let totalReturns = 0;
            if (gameState.gameEnded && gameState.totalWin > 0) {
                await this.makeAction('doWin', 0);
                totalReturns = gameState.totalWin;
            }

            const profit = totalReturns - totalWagered;
            const result = profit > 0 ? 'WIN' : profit < 0 ? 'LOSS' : 'PUSH';
            this.log(`Result: ${result} (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)})`, 'result');

            this.stats.totalWagered += totalWagered;
            this.stats.totalReturned += totalReturns;
            this.stats.handsPlayed++;
            if (result === 'WIN') this.stats.handsWon++;
            else if (result === 'LOSS') this.stats.handsLost++;
            else this.stats.handsPushed++;

            this.sendStatsUpdate();
        }

        getStrategyDecision(gameState, hand) {
            const dealerCard = gameState.dealerValue;
            const dealerKey = dealerCard === 1 ? '1/11' : dealerCard.toString();

            if (!this.strategy || !this.strategy[dealerKey]) {
                return hand.serverTotal >= 17 ? 'Stand' : 'Hit';
            }

            // Parse hand total
            let handValue = hand.serverTotal;
            if (typeof handValue === 'string' && handValue.includes('/')) {
                // Soft hand like "7/17"
                const parts = handValue.split('/');
                handValue = parseInt(parts[1]); // Use higher value
            } else {
                handValue = parseInt(handValue);
            }

            // Clamp to strategy table range
            if (handValue <= 8) return 'Hit';
            if (handValue >= 17) return 'Stand';

            const decision = this.strategy[dealerKey][handValue.toString()];
            if (!decision) {
                return handValue >= 17 ? 'Stand' : 'Hit';
            }

            if (decision === 'Double' && !gameState.canDouble) return 'Hit';
            if (decision === 'DoubleStand' && !gameState.canDouble) return 'Stand';

            return decision;
        }

        async makeAction(action, cid = 0, betString = null, insf = null) {
            if (!this.gameData || !this.gameData.requestUrl) {
                return { success: false, error: 'No game data' };
            }

            let body = `action=${action}&symbol=${this.gameData.symbol}&cid=${cid}`;
            if (betString) body += `&c=${betString}`;
            body += `&index=${this.currentIndex}&counter=${this.currentCounter}&repeat=0&mgckey=${this.gameData.mgckey}`;
            if (insf !== null) body += `&insf=${insf}`;

            debugLog('[BOT] Request:', action);

            await this.waitForDelay();

            try {
                const response = await fetch(this.gameData.requestUrl, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded',
                        'origin': this.gameData.origin
                    },
                    body: body,
                    credentials: 'include'
                });

                const text = await response.text();
                debugLog('[BOT] Response:', text.substring(0, 150));

                if (text.includes('frozen=') || text.includes('msg_code=7')) {
                    this.log('Game frozen - refresh needed', 'error');
                    this.stop();
                    return { success: false, error: 'Game frozen' };
                }

                // Update counters
                const params = {};
                text.split('&').forEach(pair => {
                    const [k, v] = pair.split('=');
                    params[k] = v;
                });

                if (params.counter && params.index) {
                    this.currentIndex = parseInt(params.index) + 1;
                    this.currentCounter = parseInt(params.counter) + 1;
                }

                return { success: true, response: text };
            } catch (error) {
                console.error('[BOT] Request failed:', error);
                return { success: false, error: error.message };
            }
        }

        parseGameResponse(responseText) {
            const params = {};
            responseText.split('&').forEach(pair => {
                const [k, v] = pair.split('=');
                params[k] = v;
            });

            const hands = [];
            for (let i = 0; i <= 5; i++) {
                if (params['cp' + i]) {
                    hands.push({
                        index: i,
                        cards: params['cp' + i].split(',').map(c => parseInt(c)),
                        status: parseInt(params['stat' + i] || 1),
                        serverTotal: params['sp' + i] || '0'
                    });
                }
            }

            return {
                hands,
                dealerValue: parseInt(params.sd || 10),
                currentHand: parseInt(params.hnd || 0),
                needsInsurance: params.inip === '1',
                gameEnded: params.end === '1',
                totalWin: parseFloat(params.win || 0),
                canHit: params.hiip === '1',
                canStand: params.stip === '1',
                canDouble: params.doip === '1',
                canSplit: params.spip === '1'
            };
        }

        generateHumanDelay() {
            if (this.actionDelay === 0) return 0;

            // Define bounds using ±5σ
            const minDelay = Math.max(0, this.actionDelay - (5 * this.delayStdDev));
            const maxDelay = this.actionDelay + (5 * this.delayStdDev);

            let delay;
            let attempts = 0;
            const maxAttempts = 100;

            // Keep generating until we get a value within ±5σ
            do {
                // Box-Muller transform for normal distribution
                const u1 = Math.random();
                const u2 = Math.random();
                const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

                delay = this.actionDelay + (z0 * this.delayStdDev);
                attempts++;

                if (attempts >= maxAttempts) {
                    delay = Math.max(minDelay, Math.min(maxDelay, delay));
                    break;
                }
            } while (delay < minDelay || delay > maxDelay);

            debugLog(`[BOT] Delay: ${delay.toFixed(0)}ms (base: ${this.actionDelay}ms ± ${this.delayStdDev}ms)`);
            return delay;
        }

        async waitForDelay() {
            const delay = this.generateHumanDelay();
            if (delay > 0) {
                await this.sleep(delay);
            }
        }

        sleep(ms) {
            return new Promise(r => setTimeout(r, ms));
        }

        log(message, level = 'info') {
            console.log('[BOT]', message);
            window.postMessage({ type: 'BOT_LOG', message, level, timestamp: new Date().toLocaleTimeString() }, '*');
        }

        sendStatsUpdate() {
            window.postMessage({ type: 'BOT_STATS', stats: this.stats }, '*');
        }
    }

    // Export to window
    window.BlackjackBot = BlackjackBot;

    // Listen for commands from content script
    window.addEventListener('message', async function(event) {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.type !== 'BOT_COMMAND') return;

        debugLog('[BOT] Received command:', msg.command);

        if (msg.command === 'start') {
            if (!window.bot) {
                window.bot = new BlackjackBot();
                await window.bot.initialize(msg.gameData);
            }
            await window.bot.start(msg.settings);
        } else if (msg.command === 'stop') {
            if (window.bot) {
                window.bot.stop();
            }
        }
    });

    console.log('[BOT] Bot script loaded and listening for commands');
})();
