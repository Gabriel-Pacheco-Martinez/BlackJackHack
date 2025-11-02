
// Debug logging wrapper
let debugMode = false;
chrome.storage.local.get(['debugMode'], (result) => {
  debugMode = result.debugMode || false;
});

function debugLog(...args) {
  if (debugMode) {
    console.log(...args);
  }
}

// Listen for debug mode changes
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DEBUG_MODE_CHANGED') {
    debugMode = msg.enabled;
  }
});

// Strategy will be loaded from strategy.json
let STRATEGY_DATA = null;

async function loadStrategy() {
  try {
    const url = chrome.runtime.getURL('strategy.json');
    const response = await fetch(url);
    STRATEGY_DATA = await response.json();
    debugLog('[BOT] Strategy loaded from strategy.json');
    return true;
  } catch (error) {
    console.error('[BOT] Failed to load strategy.json:', error);
    return false;
  }
}

class BlackjackBot {
  constructor() {
    this.gameData = null;
    this.botRunning = false;
    this.currentIndex = null;
    this.currentCounter = null;
    this.hasInitResponse = false; // Track if we have values from INIT_RESPONSE
    this.hasGameService = false;
    this.initialized = false;
    this.sessionStartBalance = null;
    this.currentBalance = null;
    this.strategy = null; // Will be loaded from strategy.json
    this.availableBets = null;
    this.betSize = 1;
    this.tabId = null;
    this.audioContext = null;
    this.oscillator = null;
    this.needsRefreshAfterHand = false;
    this.refreshTimer = null;
    this.actionDelay = 0; // Base delay in milliseconds
    this.delayStdDev = 0; // Standard deviation for delay randomization
    
    // Tab-specific stats
    this.tabStats = {
      totalWagered: 0,
      totalReturned: 0,
      handsPlayed: 0,
      handsWon: 0,
      handsLost: 0,
      handsPushed: 0,
      targetWager: 2000
    };
    
    // Get tab ID for tab-specific storage (wait for response before continuing)
    chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (response) => {
      if (response && response.tabId) {
        this.tabId = response.tabId;
        debugLog('[BOT] Tab ID:', this.tabId);
        
        // Initialize after we have tab ID, if gameService is already detected
        if (this.hasGameService && !this.initialized) {
          debugLog('[BOT] GameService already detected, initializing bot');
          this.initialized = true;
          this.connectToServiceWorker().then(() => {
            this.loadGameData();
            this.checkBotStatus();
          });
        } else {
          // Wait a bit for gameService detection
          setTimeout(() => {
            if (this.hasGameService && !this.initialized) {
              debugLog('[BOT] GameService detected, initializing bot');
              this.initialized = true;
              this.connectToServiceWorker().then(() => {
                this.loadGameData();
                this.checkBotStatus();
              });
            } else if (!this.hasGameService) {
              debugLog('[BOT] No gameService detected in this frame after waiting');
            }
          }, 2000);
        }
      }
    });
    
    // Only setup interceptor first to detect gameService
    this.setupInterceptor();
    
    // Start audio in ALL frames (both top-level and iframes) when bot starts
    // This ensures audio persists in the top-level even when iframe refreshes
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'START_BOT') {
        // Start audio in this frame when bot starts anywhere
        this.startSilentAudio();
      } else if (msg.type === 'STOP_BOT') {
        // Stop audio in this frame when bot stops
        this.stopSilentAudio();
      }
    });
  }
  
  async checkBotStatus() {
    // Check tab-specific status only
    const tabKey = `botStatus_${this.tabId}`;
    const tabStatsKey = `tabStats_${this.tabId}`;
    const status = await chrome.storage.local.get(['shouldResumeAfterRefresh', tabKey, tabStatsKey, 'targetWager']);
    
    // Load tab-specific stats if they exist (preserves across refresh)
    if (status[tabStatsKey]) {
      this.tabStats = status[tabStatsKey];
      debugLog('[BOT] Loaded tab-specific stats after refresh:', this.tabStats);
    }
    
    // Load target wager
    if (status.targetWager) {
      this.tabStats.targetWager = status.targetWager;
    }
    
    // Check if we just refreshed and should resume
    const shouldResumeKey = `shouldResumeAfterRefresh_${this.tabId}`;
    const shouldResume = (await chrome.storage.local.get([shouldResumeKey]))[shouldResumeKey];
    if (shouldResume === true || status[tabKey]?.refreshing === true) {
      debugLog('[BOT] Resuming after page refresh - waiting for new gameService data...');
      
      // Clear the refresh flags
      await chrome.storage.local.set({ 
        [shouldResumeKey]: false,
        [tabKey]: { running: true, refreshing: false }
      });
      
      // IMPORTANT: Clear old game data to force capture of new data with fresh mgckey
      this.gameData = null;
      this.hasInitResponse = false;
      this.currentIndex = null;
      this.currentCounter = null;
      
      // Clear stored game data to ensure we don't use stale mgckey
      const tabDataKey = `gameData_${this.tabId}`;
      await chrome.storage.local.remove([tabDataKey, 'pragmaticData', 'lastIndex', 'lastCounter', 'nextIndex', 'nextCounter']);
      
      debugLog('[BOT] Cleared old game data, waiting for fresh capture...');
      this.log('Waiting for game to initialize (doInit)...', 'info');
      
      // Try to trigger game initialization by simulating user interaction
      setTimeout(() => {
        debugLog('[BOT] Attempting to trigger game initialization...');
        // Click on the game iframe or canvas to potentially trigger doInit
        const gameFrame = document.querySelector('iframe[src*="pragmatic"], iframe[src*="game"]');
        if (gameFrame) {
          try {
            gameFrame.contentWindow.focus();
            gameFrame.contentWindow.document.body.click();
            debugLog('[BOT] Clicked game iframe to trigger initialization');
          } catch (e) {
            // Cross-origin, try clicking the iframe element itself
            gameFrame.click();
            debugLog('[BOT] Clicked iframe element (cross-origin)');
          }
        }
        
        // Also try clicking any visible game canvas or container
        const gameCanvas = document.querySelector('canvas, .game-container, #game-container');
        if (gameCanvas) {
          gameCanvas.click();
          debugLog('[BOT] Clicked game canvas/container');
        }
      }, 2000);
      
      // Set up a listener to wait for new game data
      let dataCheckInterval = setInterval(async () => {
        const stored = await chrome.storage.local.get([tabDataKey, 'pragmaticData']);
        if (stored[tabDataKey] || stored.pragmaticData) {
          clearInterval(dataCheckInterval);
          debugLog('[BOT] New game data captured! Restarting bot with preserved stats');
          this.log('Game data recaptured - resuming bot', 'info');
          this.startBot(true); // Pass flag to indicate this is a resume
        }
      }, 1000);
      
      // Timeout after 30 seconds if no data captured
      setTimeout(() => {
        clearInterval(dataCheckInterval);
        debugLog('[BOT] Timeout waiting for game data after refresh');
        this.log('Failed to capture game data - please refresh manually', 'error');
      }, 30000);
    } else if (status[tabKey]?.running === true) {
      debugLog('[BOT] Bot was running on this tab, resuming...');
      this.startBot();
    }
  }
  
  async loadGameData() {
    // Load tab-specific game data, fall back to global if needed
    const tabDataKey = `gameData_${this.tabId}`;
    const stored = await chrome.storage.local.get([tabDataKey, 'pragmaticData', 'betSize', 'lastIndex', 'lastCounter', 'nextIndex', 'nextCounter']);
    
    // Prefer tab-specific data, fall back to global
    if (stored[tabDataKey]) {
      this.gameData = stored[tabDataKey];
      debugLog('[BOT] Loaded tab-specific game data from:', this.gameData.origin);
    } else if (stored.pragmaticData) {
      this.gameData = stored.pragmaticData;
      debugLog('[BOT] Loaded global game data from:', this.gameData.origin);
      // Store it as tab-specific for future use
      chrome.storage.local.set({ [tabDataKey]: this.gameData });
    }
    
    // Load last index/counter if available
    // First check if we have nextIndex/nextCounter from a previous INIT_RESPONSE
    if (stored.nextIndex !== undefined && stored.nextCounter !== undefined) {
      this.currentIndex = stored.nextIndex;
      this.currentCounter = stored.nextCounter;
      debugLog('[BOT] Loaded next index/counter from INIT_RESPONSE: will use index=' + this.currentIndex + ', counter=' + this.currentCounter);
    } else if (stored.lastIndex !== undefined && stored.lastCounter !== undefined) {
      this.currentIndex = stored.lastIndex + 1;
      this.currentCounter = stored.lastCounter + 1;
      debugLog('[BOT] Loaded last index/counter: will use index=' + this.currentIndex + ', counter=' + this.currentCounter);
    } else if (this.gameData && this.gameData.index !== undefined && this.gameData.counter !== undefined) {
      // Use values from game data
      this.currentIndex = this.gameData.index + 1;
      this.currentCounter = this.gameData.counter + 1;
      debugLog('[BOT] Using index/counter from game data: index=' + this.currentIndex + ', counter=' + this.currentCounter);
    }
    
    if (stored.betSize) {
      this.betSize = stored.betSize;
      debugLog('[BOT] Loaded bet size:', this.betSize);
    }
  }

  setupInterceptor() {
    // Store debug mode in a data attribute to avoid CSP issues
    document.documentElement.setAttribute('data-debug-mode', debugMode);
    
    // Use external script to avoid CSP errors
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('interceptor.js');
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
    
    // Check if this frame has gameService (using external script to avoid CSP)
    // Check immediately and again after a delay
    const checkForGameService = () => {
      const checkScript = document.createElement('script');
      checkScript.src = chrome.runtime.getURL('checker.js');
      checkScript.onload = function() {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(checkScript);
    };
    
    checkForGameService(); // Check immediately
    setTimeout(checkForGameService, 500); // Check again after 500ms
    setTimeout(checkForGameService, 1500); // And once more after 1.5s
    
    window.addEventListener('message', (event) => {
      if (event.data.type === 'MGCKEY_UPDATE') {
        // Update mgckey when SESSION changes
        if (this.gameData && event.data.mgckey) {
          debugLog('[BOT] Updating mgckey due to SESSION change');
          this.gameData.mgckey = event.data.mgckey;
          
          // Also update in storage
          if (this.tabId) {
            const tabDataKey = `gameData_${this.tabId}`;
            chrome.storage.local.get([tabDataKey], (stored) => {
              if (stored[tabDataKey]) {
                stored[tabDataKey].mgckey = event.data.mgckey;
                chrome.storage.local.set({ [tabDataKey]: stored[tabDataKey] });
              }
            });
          }
        }
      } else if (event.data.type === 'HAS_GAME_SERVICE') {
        if (!this.hasGameService) {
          this.hasGameService = true;
          debugLog('[BOT] GameService detected in this frame');
          
          // Store that this tab has a game
          if (this.tabId) {
            const tabKey = `tabHasGame_${this.tabId}`;
            chrome.storage.local.set({ [tabKey]: true });
          }
          
          // Initialize bot now if we have tab ID
          if (this.tabId && !this.initialized) {
            debugLog('[BOT] Initializing bot after gameService detection');
            this.initialized = true;
            this.connectToServiceWorker().then(() => {
              this.loadGameData();
              this.checkBotStatus();
            });
          }
        }
      } else if (event.data.type === 'BALANCE_UPDATE') {
        this.currentBalance = event.data.balance;
        if (!this.sessionStartBalance && event.data.action === 'doInit') {
          this.sessionStartBalance = event.data.balance;
          debugLog('[BOT] Session start balance:', this.sessionStartBalance);
        }
      } else if (event.data.type === 'AVAILABLE_BETS_UPDATE') {
        // Update available bets from any gameService response
        if (event.data.availableBets && event.data.availableBets.length > 0) {
          this.availableBets = event.data.availableBets;
          debugLog('[BOT] Available bets updated:', this.availableBets);
          
          // Get the currently selected bet from storage
          chrome.storage.local.get(['betSize'], (result) => {
            const currentlySelected = result.betSize || this.betSize;
            
            // Re-validate the selected bet size
            if (this.availableBets.includes(currentlySelected)) {
              this.betSize = currentlySelected;
              debugLog('[BOT] Keeping selected bet size:', this.betSize);
            } else {
              // Invalid bet - use lowest available
              const sortedBets = [...this.availableBets].sort((a, b) => a - b);
              const oldBet = currentlySelected;
              this.betSize = sortedBets[0];
              debugLog('[BOT] Bet size ' + oldBet + ' no longer valid, switching to lowest:', this.betSize);
            }
            
            // Update storage with validated bet
            chrome.storage.local.set({ 
              availableBets: event.data.availableBets,
              betSize: this.betSize
            });
          });
        }
      } else if (event.data.type === 'INIT_RESPONSE') {
        // Game's doInit response - set our starting values
        this.currentIndex = event.data.index + 1;
        this.currentCounter = event.data.counter + 1;
        this.hasInitResponse = true; // Mark that we have values from INIT_RESPONSE
        debugLog('[BOT] doInit response received: index=' + event.data.index + ', counter=' + event.data.counter);
        debugLog('[BOT] Bot will start with: index=' + this.currentIndex + ', counter=' + this.currentCounter);
        
        // Store these values for future use - store the NEXT values to be used
        chrome.storage.local.set({ 
          lastIndex: event.data.index,
          lastCounter: event.data.counter,
          nextIndex: this.currentIndex,  // Store the calculated next values
          nextCounter: this.currentCounter
        });
      } else if (event.data.type === 'GAME_DATA_CAPTURED') {
        debugLog('[BOT] Received GAME_DATA_CAPTURED event');
        debugLog('[BOT] Available bets in event:', event.data.availableBets);
        
        this.gameData = event.data.data;
        
        // Try to get fresh mgckey from current page URL instead of using captured one
        const urlParams = new URLSearchParams(window.location.search);
        const urlMgckey = urlParams.get('mgckey');
        if (urlMgckey) {
          debugLog('[BOT] Using mgckey from URL instead of captured:', urlMgckey.substring(0, 50) + '...');
          this.gameData.mgckey = urlMgckey;
        }
        
        // Use the index and counter from the captured game data as starting point
        // BUT only if we don't have values from INIT_RESPONSE
        if (!this.hasInitResponse && (this.currentIndex === null || this.currentCounter === null)) {
          if (this.gameData.index !== undefined && this.gameData.counter !== undefined) {
            // The next request should use index+1 and counter+1
            this.currentIndex = this.gameData.index + 1;
            this.currentCounter = this.gameData.counter + 1;
            debugLog('[BOT] Set starting values from game data: index=' + this.currentIndex + ', counter=' + this.currentCounter);
          }
        } else if (this.hasInitResponse) {
          debugLog('[BOT] Keeping values from INIT_RESPONSE: index=' + this.currentIndex + ', counter=' + this.currentCounter);
        } else {
          debugLog('[BOT] Keeping existing loaded values: index=' + this.currentIndex + ', counter=' + this.currentCounter);
        }
        
        // Store data after ensuring we have tab ID
        const storeGameData = (tabId) => {
          const tabDataKey = `gameData_${tabId}`;
          
          // Also check if we captured available bets in the response
          if (event.data.availableBets && event.data.availableBets.length > 0) {
            this.availableBets = event.data.availableBets;
            debugLog('[BOT] Setting available bet sizes:', this.availableBets);
            
            // Get the currently selected bet and validate it
            chrome.storage.local.get(['betSize'], (result) => {
              const currentlySelected = result.betSize || this.betSize || 1;
              
              // Check if selected bet is valid
              if (this.availableBets.includes(currentlySelected)) {
                this.betSize = currentlySelected;
                debugLog('[BOT] Using previously selected bet:', this.betSize);
              } else {
                // Invalid - use lowest
                const sortedBets = [...this.availableBets].sort((a, b) => a - b);
                this.betSize = sortedBets[0];
                debugLog('[BOT] Previous bet ' + currentlySelected + ' invalid, using lowest:', this.betSize);
              }
              
              // Store with tab-specific game data
              debugLog('[BOT] Storing tab-specific game data for tab:', tabId);
              chrome.storage.local.set({ 
                [tabDataKey]: this.gameData,
                pragmaticData: this.gameData, // Keep global for compatibility
                lastCapture: Date.now(),
                availableBets: event.data.availableBets,
                betSize: this.betSize,
                lastIndex: this.gameData.index,
                lastCounter: this.gameData.counter
              }).then(() => {
                debugLog('[BOT] Game data stored successfully for tab:', tabId);
              });
            });
          } else {
            debugLog('[BOT] No available bets in GAME_DATA_CAPTURED event');
            chrome.storage.local.set({ 
              [tabDataKey]: this.gameData,
              pragmaticData: this.gameData, // Keep global for compatibility
              lastCapture: Date.now(),
              lastIndex: this.gameData.index,
              lastCounter: this.gameData.counter
            });
          }
        };
        
        // If we already have tab ID, store immediately
        if (this.tabId) {
          storeGameData(this.tabId);
        } else {
          // Otherwise get tab ID first
          chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (response) => {
            if (response && response.tabId) {
              this.tabId = response.tabId;
              debugLog('[BOT] Got tab ID for game data storage:', this.tabId);
              storeGameData(this.tabId);
            }
          });
        }
        
        chrome.runtime.sendMessage({
          type: 'CAPTURE_GAME_DATA',
          data: this.gameData
        }).catch(() => {});
        
        debugLog('[BOT] Game data captured and stored');
        if (this.initialized) {
          this.log('Game data captured successfully', 'info');
        }
      }
    });
  }


  updateBetSize() {
    // Get selected bet size from storage
    chrome.storage.local.get(['betSize', 'availableBets'], (result) => {
      const selectedBet = result.betSize || 1;
      
      if (this.availableBets && this.availableBets.length > 0) {
        // Sort available bets to ensure we can get the lowest
        const sortedBets = [...this.availableBets].sort((a, b) => a - b);
        const lowestBet = sortedBets[0];
        // const highestBet = sortedBets[sortedBets.length - 1];
        
        // Check if selected bet is valid
        if (this.availableBets.includes(selectedBet)) {
          this.betSize = selectedBet;
          debugLog('[BOT] Using selected bet size:', this.betSize);
        } else {
          // Invalid bet - use lowest available
          this.betSize = lowestBet;
          debugLog('[BOT] Invalid bet size ' + selectedBet + ' - using lowest available:', this.betSize);
          debugLog('[BOT] Valid bets are:', sortedBets.join(', '));
          
          // Update storage with the valid bet
          chrome.storage.local.set({ betSize: this.betSize });
        }
      } else {
        // No available bets known yet, use default
        this.betSize = 1;
        debugLog('[BOT] No bet limits known, defaulting to:', this.betSize);
      }
    });
  }

  async connectToServiceWorker() {
    debugLog('[BOT] Ready to receive commands');
    // Load strategy on initialization
    if (!this.strategy) {
      const strategyLoaded = await loadStrategy();
      if (strategyLoaded) {
        this.strategy = STRATEGY_DATA;
        debugLog('[BOT] Strategy loaded during initialization');
      } else {
        console.error('[BOT] Failed to load strategy during initialization');
      }
    }
  }
  
  // Generate a delay using normal distribution (Box-Muller transform)
  generateHumanDelay() {
    if (this.actionDelay === 0) return 0; // No delay configured
    
    // Define bounds
    const minDelay = Math.max(0, this.actionDelay - (5 * this.delayStdDev));
    const maxDelay = this.actionDelay + (5 * this.delayStdDev);
    
    let delay;
    let attempts = 0;
    const maxAttempts = 100; // Prevent infinite loop
    
    // Keep generating until we get a value within ±5σ
    do {
      // Box-Muller transform for normal distribution
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      
      // Calculate delay with standard deviation
      delay = this.actionDelay + (z0 * this.delayStdDev);
      attempts++;
      
      // Fallback to clamping if we somehow can't generate a valid value
      if (attempts >= maxAttempts) {
        debugLog(`[BOT] Failed to generate delay within bounds after ${maxAttempts} attempts, using clamped value`);
        delay = Math.max(minDelay, Math.min(maxDelay, delay));
        break;
      }
    } while (delay < minDelay || delay > maxDelay);
    
    debugLog(`[BOT] Generated delay: ${delay.toFixed(0)}ms (base: ${this.actionDelay}ms, stdDev: ${this.delayStdDev}ms, attempts: ${attempts})`);
    return delay;
  }
  
  // Wait for the generated delay
  async waitForHumanDelay() {
    const delay = this.generateHumanDelay();
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  startSilentAudio() {
    if (this.audioContext) return; // Already running
    
    try {
      // Create audio context
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        debugLog('[BOT] Web Audio API not supported');
        return;
      }
      
      this.audioContext = new AudioContext();
      
      // Create an extremely quiet oscillator
      this.oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      // Use a higher volume since nobody can hear 22kHz
      gainNode.gain.value = 0.05; // 5% volume - Chrome will definitely detect this
      
      // Use 22kHz - maximum safe frequency (Nyquist limit for 44.1kHz sample rate)
      // Completely inaudible to all humans (hearing range ends at ~20kHz even for babies)
      this.oscillator.frequency.value = 22000; // Above human hearing range
      this.oscillator.type = 'sine'; // Smoothest waveform
      
      this.oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      this.oscillator.start();
      
      debugLog('[BOT] Ultrasonic audio started (22kHz at 5% volume) - tab will remain active');
      
      // Resume if suspended
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
    } catch (e) {
      debugLog('[BOT] Could not start audio context:', e.message);
    }
  }
  
  stopSilentAudio() {
    if (this.oscillator) {
      try {
        this.oscillator.stop();
      } catch (e) {}
      this.oscillator = null;
    }
    
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (e) {}
      this.audioContext = null;
    }
    
    debugLog('[BOT] Ultrasonic audio stopped');
  }
  
  setupAutoRefresh(isResume = false) {
    // Clear any existing refresh timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    
    // Clear the refresh flag if we're resuming (it was already handled)
    if (isResume) {
      this.needsRefreshAfterHand = false;
      debugLog('[BOT] Cleared refresh flag after resume');
    }
    
    // Set refresh timer for 10 minutes
    const REFRESH_TIME = 10 * 60 * 1000; // 10 minutes
    this.refreshTimer = setTimeout(() => {
      if (this.botRunning) {
        debugLog('[BOT] Auto-refresh timer triggered - will refresh after current hand');
        this.log('Auto-refresh timer expired - will refresh after current hand', 'info');
        // Set flag to refresh after current hand completes
        this.needsRefreshAfterHand = true;
      }
    }, REFRESH_TIME);
    
    debugLog('[BOT] Auto-refresh timer set for 10 minutes to recapture gameService');
  }

  async startBot(isResume = false) {
    if (this.botRunning) {
      debugLog('[BOT] Already running');
      this.log('Bot already running', 'info');
      return;
    }
    
    // Ensure we have a tab ID
    if (!this.tabId) {
      console.error('[BOT] No tab ID available');
      this.log('ERROR: Tab ID not initialized', 'error');
      return;
    }
    
    // Load strategy if not already loaded
    if (!this.strategy) {
      const strategyLoaded = await loadStrategy();
      if (!strategyLoaded) {
        console.error('[BOT] Failed to load strategy');
        this.log('ERROR: Failed to load strategy', 'error');
        return;
      }
      this.strategy = STRATEGY_DATA;
    }
    
    // Get target wager and delay settings from storage
    const { targetWager, actionDelay, delayStdDev } = await chrome.storage.local.get(['targetWager', 'actionDelay', 'delayStdDev']);
    if (targetWager) {
      this.tabStats.targetWager = targetWager;
    }
    
    // Set delay settings
    this.actionDelay = actionDelay || 0;
    this.delayStdDev = delayStdDev || 0;
    
    if (this.actionDelay > 0) {
      debugLog(`[BOT] Human delay enabled: ${this.actionDelay}ms ± ${this.delayStdDev}ms`);
      this.log(`Human delay: ${this.actionDelay}ms ± ${this.delayStdDev}ms`, 'info');
    }
    
    // Only reset tab stats if this is NOT a resume after refresh
    if (!isResume) {
      // Reset tab stats for new session
      this.tabStats.totalWagered = 0;
      this.tabStats.totalReturned = 0;
      this.tabStats.handsPlayed = 0;
      this.tabStats.handsWon = 0;
      this.tabStats.handsLost = 0;
      this.tabStats.handsPushed = 0;
      
      debugLog('[BOT] Starting fresh session with reset stats');
    } else {
      debugLog('[BOT] Resuming after refresh with preserved stats:', this.tabStats);
      this.log('Resumed after refresh - gameService recaptured', 'info');
    }
    
    // Save tab stats
    const tabStatsKey = `tabStats_${this.tabId}`;
    await chrome.storage.local.set({ [tabStatsKey]: this.tabStats });
    
    // Store bot status with tab ID - do NOT set global botRunning flag
    if (this.tabId) {
      const tabKey = `botStatus_${this.tabId}`;
      const currentTime = Date.now();
      await chrome.storage.local.set({ 
        [tabKey]: { 
          running: true, 
          startTime: isResume ? (await chrome.storage.local.get([tabKey]))[tabKey]?.startTime || currentTime : currentTime,
          lastRefreshTime: isResume ? currentTime : null
        } 
      });
    }
    
    // Set up auto-refresh timer (25 minutes)
    this.setupAutoRefresh(isResume);
    
    // Start silent audio to keep tab active
    this.startSilentAudio();
    
    // Reset session tracking
    if (this.currentBalance) {
      this.sessionStartBalance = this.currentBalance;
    }
    
    const tabDataKey = `gameData_${this.tabId}`;
    const stored = await chrome.storage.local.get([tabDataKey, 'pragmaticData', 'lastIndex', 'lastCounter', 'nextIndex', 'nextCounter', 'availableBets', 'betSize']);
    
    // Only load game data from storage if we don't already have it (to preserve mgckey updates)
    if (!this.gameData) {
      // Prefer tab-specific data, fall back to global
      if (stored[tabDataKey]) {
        this.gameData = stored[tabDataKey];
        debugLog('[BOT] Using tab-specific stored game data from:', this.gameData.origin);
      } else if (stored.pragmaticData) {
        this.gameData = stored.pragmaticData;
        debugLog('[BOT] Using global stored game data from:', this.gameData.origin);
        // Store as tab-specific for future use
        chrome.storage.local.set({ [tabDataKey]: this.gameData });
      }
    } else {
      debugLog('[BOT] Keeping existing game data with current mgckey');
      
      // If we have stored values from a previous doInit, use them
      // First check if we have nextIndex/nextCounter from a previous INIT_RESPONSE
      if (stored.nextIndex !== undefined && stored.nextCounter !== undefined) {
        this.currentIndex = stored.nextIndex;
        this.currentCounter = stored.nextCounter;
        debugLog('[BOT] Using stored next values from INIT_RESPONSE: index=' + this.currentIndex + ', counter=' + this.currentCounter);
      } else if (stored.lastIndex !== undefined && stored.lastCounter !== undefined) {
        this.currentIndex = stored.lastIndex + 1;
        this.currentCounter = stored.lastCounter + 1;
        debugLog('[BOT] Using stored values: index=' + this.currentIndex + ', counter=' + this.currentCounter);
      }
      
      // Load available bets if stored
      if (stored.availableBets) {
        this.availableBets = stored.availableBets;
        debugLog('[BOT] Loaded available bets:', this.availableBets);
        
        // Validate the stored bet size
        const selectedBet = stored.betSize || 1;
        if (this.availableBets.includes(selectedBet)) {
          this.betSize = selectedBet;
          debugLog('[BOT] Using stored bet size:', this.betSize);
        } else {
          // Invalid - use lowest
          const sortedBets = [...this.availableBets].sort((a, b) => a - b);
          this.betSize = sortedBets[0];
          debugLog('[BOT] Stored bet invalid, using lowest:', this.betSize);
          chrome.storage.local.set({ betSize: this.betSize });
        }
      }
    }
    
    if (!this.gameData) {
      debugLog('[BOT] No game data in storage');
      this.log('No game data - please refresh the game', 'error');
      return;
    }
    
    // Check if we're in the right frame (same origin as game data)
    if (window.location.origin !== this.gameData.origin) {
      debugLog('[BOT] Wrong frame - this frame:', window.location.origin, 'game origin:', this.gameData.origin);
      return;
    }
    
    debugLog('[BOT] Starting bot in correct frame');
    this.log('Bot started', 'info');
    this.botRunning = true;
    
    // Mark as initialized since we have game data and are in correct frame
    this.initialized = true;
    
    this.runBotLoop();
  }

  async stopBot() {
    debugLog('[BOT] Stopping bot...');
    if (this.initialized) {
      this.log('Bot stopped', 'info');
    }
    this.botRunning = false;
    
    // Clear auto-refresh timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    
    // Stop silent audio
    this.stopSilentAudio();
    
    // Clear bot status for this tab only - do NOT set global botRunning flag
    if (this.tabId) {
      const tabKey = `botStatus_${this.tabId}`;
      await chrome.storage.local.set({ [tabKey]: { running: false, endTime: Date.now() } });
    }
  }

  async runBotLoop() {
    debugLog('[BOT] Bot loop started - will run independently');
    let roundCount = 0;
    const startTime = Date.now();
    const REFRESH_INTERVAL = 25 * 60 * 1000;
    
    while (this.botRunning) {
      try {
        const tabKey = `botStatus_${this.tabId}`;
        const status = await chrome.storage.local.get([tabKey]);
        if (status[tabKey]?.running === false) {
          debugLog('[BOT] Bot stopped via tab-specific storage flag');
          this.botRunning = false;
          break;
        }
        
        // The refresh is now handled by setupAutoRefresh() and playRound()
        // to ensure it only happens between hands, not during them
        
        // Periodic license check (silent)
        if (roundCount % 20 === 0) {
          chrome.runtime.sendMessage({ type: 'CHECK_LICENSE' }).then(licenseCheck => {
            if (!licenseCheck || !licenseCheck.valid) {
              // Only stop bot, don't log error
              this.stopBot();
            }
          }).catch(() => {});
        }
        
        // Double-check before starting a new round
        if (!this.botRunning) {
          debugLog('[BOT] Bot stopped, exiting loop');
          break;
        }
        
        await this.playRound();
        
        // Check if bot was stopped during playRound (e.g., for refresh)
        if (!this.botRunning) {
          debugLog('[BOT] Bot stopped during round, exiting loop');
          break;
        }
        
        roundCount++;
        
      } catch (error) {
        console.error('[BOT] Error in bot loop:', error);
        await this.sleep(3000);
      }
    }
    
    debugLog('[BOT] Bot loop ended');
  }

  async playRound() {
    // Check both local flag and storage
    if (!this.botRunning) {
      debugLog('[BOT] Bot stopped (local flag), ending round');
      return;
    }
    
    // Check tab-specific bot status
    const tabKey = `botStatus_${this.tabId}`;
    const status = await chrome.storage.local.get([tabKey]);
    if (status[tabKey]?.running === false) {
      debugLog('[BOT] Bot flagged as stopped for this tab, ending');
      this.botRunning = false;
      return;
    }
    
    // Check if we need to refresh BEFORE starting a new hand
    if (this.needsRefreshAfterHand) {
      debugLog('[BOT] Refresh needed - refreshing now');
      this.log('Auto-refreshing to recapture gameService data...', 'info');
      
      // Clear the flag
      this.needsRefreshAfterHand = false;
      
      // Save state for resume after refresh
      const tabStatsKey = `tabStats_${this.tabId}`;
      await chrome.storage.local.set({ 
        [`shouldResumeAfterRefresh_${this.tabId}`]: true,
        lastRefresh: Date.now(),
        [tabKey]: { running: true, refreshing: true },
        [tabStatsKey]: this.tabStats // Preserve tab stats across refresh
      });
      
      // Stop the bot immediately to prevent any further actions
      this.botRunning = false;
      
      // Add a small delay to ensure storage is saved before refresh
      await this.sleep(100);
      
      // Refresh the page
      window.location.reload();
      return; // Exit immediately - no more rounds should be played
    }
    
    debugLog('[BOT] Starting new round...');
    debugLog('[BOT] Game data available:', !!this.gameData);
    debugLog('[BOT] Request URL:', this.gameData?.requestUrl);
    
    // If we don't have index/counter yet, try to use from game data or defaults
    if (this.currentIndex === null || this.currentCounter === null) {
      debugLog('[BOT] WARNING: Index/counter not set, this should not happen');
      // Fall back to safe defaults
      this.currentIndex = 2;
      this.currentCounter = 3;
      debugLog('[BOT] Using fallback values: index=' + this.currentIndex + ', counter=' + this.currentCounter);
    }
    
    debugLog('[BOT] Current index:', this.currentIndex, 'counter:', this.currentCounter);
    
    this.log('Dealing new hand...', 'action');
    
    // Silent license check
    chrome.runtime.sendMessage({ type: 'CHECK_LICENSE' }).catch(() => {});
    
    // Create bet string with actual bet size
    const betString = `${this.betSize},0,${this.betSize},0,${this.betSize},0,0,0`;
    debugLog('[BOT] Using bet string:', betString);
    
    const dealResult = await this.makeAction('doDeal', 0, betString);
    if (!dealResult.success) {
      console.error('[BOT] Deal failed:', dealResult.error);
      this.log('Deal failed!', 'error');
      return;
    }
    
    let gameState = this.parseGameResponse(dealResult.response);
    const initialHandCount = gameState.hands.length;
    debugLog('[BOT] Deal complete - ' + initialHandCount + ' hands');
    // Fix dealer Ace display
    const dealerDisplay = gameState.dealerValue === 1 ? 'A' : gameState.dealerValue;
    this.log(`Deal complete - ${initialHandCount} hands, Dealer: ${dealerDisplay}`, 'info');
    
    // Check for blackjacks and log them
    for (const hand of gameState.hands) {
      if (hand.status === 3 || hand.status === 14) {
        this.log(`Hand ${hand.index}: Blackjack!`, 'success');
      }
    }
    
    // Track total wagered (will be updated if we double or split)
    let totalWagered = initialHandCount * this.betSize;
    let maxHandsSeen = initialHandCount;
    
    
    while (gameState.needsInsurance && !gameState.gameEnded) {
      debugLog('[BOT] Declining insurance');
      const insResult = await this.makeAction('doInsurance', 0, null, 0);
      gameState = this.parseGameResponse(insResult.response);
    }
    
    while (!gameState.gameEnded) {
      const handNum = gameState.currentHand;
      const hand = gameState.hands.find(h => h.index === handNum);
      
      if (!hand || hand.status !== 1) {
        break;
      }
      
      debugLog('[BOT] Playing hand ' + handNum + ' (total: ' + hand.serverTotal + ')');
      const dealerDisplay = gameState.dealerValue === 1 ? 'A' : gameState.dealerValue;
      this.log(`Hand ${handNum}: ${hand.serverTotal} vs Dealer ${dealerDisplay}`, 'info');
      
      while (hand.status === 1 && !gameState.gameEnded) {
        const action = this.getStrategyDecision(gameState, hand);
        debugLog('[BOT] Strategy action:', action);
        this.log(`Action: ${action}`, 'action');
        
        let apiAction;
        debugLog(`[BOT] Mapping action ${action} with permissions: Hit=${gameState.canHit}, Stand=${gameState.canStand}, Double=${gameState.canDouble}`);
        
        if (action === 'Hit') {
          if (gameState.canHit) {
            apiAction = 'doHit';
          } else {
            console.error('[BOT] Strategy says Hit but canHit=false!');
            apiAction = gameState.canStand ? 'doStand' : null;
          }
        } else if (action === 'Stand') {
          if (gameState.canStand) {
            apiAction = 'doStand';
          } else {
            console.error('[BOT] Strategy says Stand but canStand=false!');
            apiAction = gameState.canHit ? 'doHit' : null;
          }
        } else if (action === 'Double') {
          if (gameState.canDouble) {
            apiAction = 'doDouble';
          } else {
            console.error('[BOT] Strategy says Double but canDouble=false! This should not happen!');
            // Strategy should have already handled this case
            apiAction = gameState.canHit ? 'doHit' : 'doStand';
          }
        } else if (action === 'Split' && gameState.canSplit) {
          apiAction = 'doSplit';
        } else if (action === 'Surrender' && gameState.canSurrender) {
          apiAction = 'doSurrender';
        } else {
          // Fallback if action not available
          console.log(`[BOT] WARNING: Action ${action} not matching any condition, falling back`);
          console.log(`[BOT] Conditions checked: Hit=${action === 'Hit'} && ${gameState.canHit}, Stand=${action === 'Stand'} && ${gameState.canStand}, Double=${action === 'Double'} && ${gameState.canDouble}`);
          if (gameState.canHit) apiAction = 'doHit';
          else if (gameState.canStand) apiAction = 'doStand';
          else {
            console.error('[BOT] No valid action available!');
            break;
          }
        }
        
        const result = await this.makeAction(apiAction, handNum);
        if (!result.success) break;
        
        gameState = this.parseGameResponse(result.response);
        
        // Check if we have more hands now (split occurred)
        if (gameState.hands.length > maxHandsSeen) {
          const newHands = gameState.hands.length - maxHandsSeen;
          totalWagered += newHands * this.betSize;
          debugLog('[BOT] Split detected - ' + newHands + ' new hands, total wagered now:', totalWagered);
          maxHandsSeen = gameState.hands.length;
        }
        
        if (apiAction === 'doHit') {
          const updatedHand = gameState.hands.find(h => h.index === handNum);
          if (updatedHand) {
            hand.cards = updatedHand.cards;
            hand.status = updatedHand.status;
            hand.serverTotal = updatedHand.serverTotal;
            hand.isSoft = updatedHand.isSoft;
            // Log the updated hand value
            this.log(`Hand ${handNum} updated: ${hand.serverTotal}`, 'info');
          }
        }
        
        if (apiAction === 'doDouble') {
          // Double means we wagered another betSize on this hand
          totalWagered += this.betSize;
          debugLog('[BOT] Doubled - total wagered now:', totalWagered);
          // Get the updated hand after double
          const updatedHand = gameState.hands.find(h => h.index === handNum);
          if (updatedHand) {
            this.log(`Hand ${handNum} doubled, final: ${updatedHand.serverTotal}`, 'info');
          }
          break;
        }
        
        if (apiAction === 'doSplit') {
          // Split occurred - the current hand was split into two
          totalWagered += this.betSize; // Split requires another bet
          debugLog('[BOT] Split executed - total wagered now:', totalWagered);
          this.log(`Split hand ${handNum}`, 'action');
          // After split, break out of inner loop to let outer loop handle the new hands
          // The game will update currentHand to point to the first split hand
          break;
        }
        
        if (apiAction === 'doStand') {
          this.log(`Hand ${handNum} stands at: ${hand.serverTotal}`, 'info');
          break;
        }
        
      }
    }
    
    
    const hasBlackjack = gameState.hands.some(h => h.status === 3 || h.status === 14);
    let totalReturns = 0;
    
    if (gameState.gameEnded && (gameState.totalWin > 0 || hasBlackjack)) {
      await this.makeAction('doWin', 0);
      // totalWin appears to be the total amount returned (including original wager)
      totalReturns = gameState.totalWin;
    } else if (gameState.gameEnded && gameState.totalWin === 0) {
      // Check if it's a push (tie) - in a push, the wager is returned
      // We can determine push if no win but also didn't lose all hands
      const allLost = gameState.hands.every(h => h.status === 2 || h.status === 5); // 2=bust, 5=dealer wins
      if (!allLost) {
        totalReturns = totalWagered; // Push - wager returned
      } else {
        totalReturns = 0; // Loss - nothing returned
      }
    }
    
    
    // Calculate actual profit (returns minus wager)
    const profit = totalReturns - totalWagered;
    const result = profit > 0 ? 'WIN' : profit < 0 ? 'LOSS' : 'PUSH';
    this.log(`Round complete: ${result} (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)})`, 'result');
    
    // Update tab-specific stats
    this.tabStats.totalWagered += totalWagered;
    this.tabStats.totalReturned += totalReturns;
    this.tabStats.handsPlayed++;
    if (result === 'WIN') {
      this.tabStats.handsWon++;
    } else if (result === 'LOSS') {
      this.tabStats.handsLost++;
    } else {
      this.tabStats.handsPushed++;
    }
    
    // Save tab-specific stats
    const tabStatsKey = `tabStats_${this.tabId}`;
    debugLog(`[BOT] Saving stats to ${tabStatsKey}:`, this.tabStats);
    await chrome.storage.local.set({ [tabStatsKey]: this.tabStats });
    
    // Check if target reached (skip if targetWager <= 0 for infinite mode)
    if (this.tabStats.targetWager > 0 && this.tabStats.totalWagered >= this.tabStats.targetWager) {
      debugLog('[BOT] Target wager reached!');
      this.log('Target wager reached!', 'info');
      this.botRunning = false; // Stop immediately
      await this.stopBot();
      return; // Exit playRound immediately
    } else if (this.tabStats.targetWager <= 0) {
      // Infinite mode - just log periodically
      if (this.tabStats.handsPlayed % 100 === 0 && this.tabStats.handsPlayed > 0) {
        debugLog('[BOT] Infinite mode - ' + this.tabStats.handsPlayed + ' hands played');
      }
    }
  }

  getStrategyDecision(gameState, hand) {
    const dealerCard = gameState.dealerValue;
    const canDouble = gameState.canDouble;
    const canSplit = gameState.canSplit;
    const canSurrender = gameState.canSurrender;
    
    debugLog(`[STRATEGY] Getting decision for: serverTotal=${hand.serverTotal}, Dealer=${dealerCard}`);
    debugLog(`[STRATEGY] Available actions: Hit=${gameState.canHit}, Stand=${gameState.canStand}, Double=${canDouble}, Split=${canSplit}, Surrender=${canSurrender}`);
    
    // ONLY use strategy.json - no fallback
    if (!this.strategy) {
      console.error('[STRATEGY] ERROR: Strategy.json not loaded!');
      this.log('ERROR: Strategy not loaded - STOPPING BOT', 'error');
      this.botRunning = false;
      this.stopBot();
      throw new Error('Strategy not loaded');
    }
    
    const dealerKey = dealerCard === 1 ? '1/11' : dealerCard.toString();
    const dealerStrategy = this.strategy[dealerKey];
    
    if (!dealerStrategy) {
      console.error(`[STRATEGY] ERROR: No strategy found for dealer ${dealerKey}`);
      this.log(`ERROR: No strategy for dealer ${dealerKey} - STOPPING BOT`, 'error');
      this.botRunning = false;
      this.stopBot();
      throw new Error(`No strategy for dealer ${dealerKey}`);
    }
    
    // Use the server total directly as the hand key
    // Server sends it in the exact format we need: "15" for hard, "5/15" for soft, "14s" for pairs
    let handKey = hand.serverTotal;
    
    // Special case: If we have "2/12" and canSplit is true, it's a pair of Aces
    // The server might not add the 's' suffix, so we need to add it
    if (handKey === "2/12" && canSplit) {
      handKey = "2/12s";
      debugLog(`[STRATEGY] Detected pair of Aces (2/12 with canSplit=true), using handKey: 2/12s`);
    }
    
    // The server total is already in the correct format for strategy lookup
    debugLog(`[STRATEGY] Using server total as handKey: ${handKey}`)
    
    const decision = dealerStrategy[handKey];
    
    // Always log what we're looking up and what we found
    console.log(`[STRATEGY] Looking up: handKey="${handKey}" in dealer ${dealerKey} strategy`);
    console.log(`[STRATEGY] Result: ${decision || 'NOT FOUND'}`);
    
    if (!decision) {
      console.error(`[STRATEGY] ERROR: No decision found for ${handKey} vs dealer ${dealerKey}`);
      console.error(`[STRATEGY] Available keys for dealer ${dealerKey}:`, Object.keys(dealerStrategy));
      
      // Check if there's a close match (case issues, whitespace, etc)
      const closeMatch = Object.keys(dealerStrategy).find(key => 
        key.toLowerCase().replace(/\s/g, '') === handKey.toLowerCase().replace(/\s/g, '')
      );
      if (closeMatch) {
        console.error(`[STRATEGY] Found close match: "${closeMatch}" - using it`);
        return dealerStrategy[closeMatch];
      }
      
      // No match found at all - stop the bot
      this.log(`ERROR: No strategy for ${handKey} vs ${dealerKey} - STOPPING BOT`, 'error');
      this.botRunning = false;
      this.stopBot();
      throw new Error(`No strategy for ${handKey} vs dealer ${dealerKey}`);
    }
    
    debugLog(`[STRATEGY] Found: ${handKey} vs dealer ${dealerKey} = ${decision}`);
    console.log(`[STRATEGY] Decision for ${handKey} vs dealer ${dealerKey}: ${decision} (canDouble=${canDouble})`);
    
    // Handle special decisions
    if (decision === 'DoubleStand') {
      const result = canDouble ? 'Double' : 'Stand';
      debugLog(`[STRATEGY] DoubleStand -> ${result} (canDouble=${canDouble})`);
      return result;
    }
    if (decision === 'Double' && !canDouble) {
      console.log(`[STRATEGY] Double but can't double (canDouble=${canDouble}) -> returning Hit`);
      return 'Hit';
    }
    if (decision === 'Double' && canDouble) {
      console.log(`[STRATEGY] Double and CAN double -> returning Double`);
      return 'Double';
    }
    if (decision === 'Split' && !canSplit) {
      debugLog(`[STRATEGY] Split recommended but can't split (not a pair) -> looking for non-pair strategy`);
      // When we can't split (e.g., 10/6 instead of 8/8), use the regular hand strategy
      const fallbackKey = playerTotal.toString();
      const fallbackDecision = dealerStrategy[fallbackKey];
      if (fallbackDecision) {
        debugLog(`[STRATEGY] Using non-pair strategy for total ${fallbackKey}: ${fallbackDecision}`);
        if (fallbackDecision === 'Double' && !canDouble) return 'Hit';
        if (fallbackDecision === 'DoubleStand') return canDouble ? 'Double' : 'Stand';
        return fallbackDecision;
      }
      // If no non-pair strategy exists, stop the bot
      console.error(`[STRATEGY] ERROR: No non-pair strategy for ${fallbackKey} vs dealer ${dealerKey}`);
      this.log(`ERROR: No strategy for non-pair ${fallbackKey} vs ${dealerKey} - STOPPING BOT`, 'error');
      this.botRunning = false;
      this.stopBot();
      throw new Error(`No non-pair strategy for ${fallbackKey} vs dealer ${dealerKey}`);
    }
    if (decision === 'Split' && canSplit) {
      return 'Split';
    }
    if (decision === 'Surrender' && !canSurrender) {
      debugLog(`[STRATEGY] Surrender but can't surrender -> Hit`);
      return 'Hit';
    }
    
    debugLog(`[STRATEGY] Returning: ${decision}`);
    return decision;
  }
  

  async makeAction(action, cid = 0, betString = null, insf = null) {
    if (!this.gameData) {
      console.error('[BOT] No game data available');
      return { success: false, error: 'No game data' };
    }
    
    if (!this.gameData.requestUrl) {
      console.error('[BOT] No request URL in game data');
      return { success: false, error: 'No request URL' };
    }
    
    // Build params in the exact order as organic requests
    let body = `action=${action}`;
    body += `&symbol=${this.gameData.symbol}`;
    body += `&cid=${cid}`;
    
    // Add 'c' parameter BEFORE mgckey if it exists (critical for matching organic requests)
    if (betString) {
      body += `&c=${betString}`;  // Don't encode commas in betString
    }
    
    body += `&index=${this.currentIndex}`;
    body += `&counter=${this.currentCounter}`;
    body += `&repeat=0`;
    
    // Add mgckey without encoding @ and ~ characters
    body += `&mgckey=${this.gameData.mgckey}`;
    
    // Add insf if provided
    if (insf !== null) {
      body += `&insf=${insf}`;
    }
    
    debugLog('[BOT] Making request:', action, 'to', this.gameData.requestUrl);
    debugLog('[BOT] Request body:', body);
    
    // Add human-like delay before making the action
    await this.waitForHumanDelay();
    
    try {
      const response = await fetch(this.gameData.requestUrl, {
        method: 'POST',
        headers: {
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.9',
          'cache-control': 'no-cache',
          'content-type': 'application/x-www-form-urlencoded',
          'origin': this.gameData.origin,
          'pragma': 'no-cache',
          'priority': 'u=1, i'
        },
        body: body,
        credentials: 'include',
        mode: 'cors',
        cache: 'no-cache'
      });
      
      const text = await response.text();
      debugLog('[BOT] Response:', text.substring(0, 200));
      
      if (text.includes('frozen=') || text.includes('msg_code=7') || text.includes('SystemError')) {
        console.error('[BOT] ERROR: Game frozen or system error!');
        console.error('[BOT] Full response:', text);
        this.log('ERROR: Game frozen - please refresh the game', 'error');
        this.stopBot();
        return { success: false, error: 'Game frozen' };
      }
      
      const responseParams = {};
      text.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        responseParams[key] = value;
      });
      
      // After each response, set next values to be used
      if (responseParams.counter !== undefined && responseParams.index !== undefined) {
        const respIndex = parseInt(responseParams.index);
        const respCounter = parseInt(responseParams.counter);
        
        this.currentIndex = respIndex + 1;
        this.currentCounter = respCounter + 1;
        
        debugLog('[BOT] Response had index=' + respIndex + ', counter=' + respCounter);
        debugLog('[BOT] Next request will use index=' + this.currentIndex + ', counter=' + this.currentCounter);
        
        // Store for future sessions
        chrome.storage.local.set({ 
          lastIndex: respIndex,
          lastCounter: respCounter
        });
      }
      
      return { success: true, response: text };
    } catch (error) {
      console.error('[BOT] Request failed:', error);
      return { success: false, error: error.message };
    }
  }

  parseGameResponse(responseText) {
    const params = {};
    const pairs = responseText.split('&');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      params[key] = value;
    }
    
    const hands = [];
    for (let i = 0; i <= 5; i++) {
      const cpKey = 'cp' + i;
      const spKey = 'sp' + i;
      const statKey = 'stat' + i;
      
      if (params[cpKey]) {
        const cards = params[cpKey].split(',').map(c => parseInt(c));
        const spValue = params[spKey] || '0';
        
        hands.push({
          index: i,
          cards: cards,
          status: parseInt(params[statKey] || 1),
          serverTotal: spValue,
          isSoft: spValue.includes('/'),
          isPair: false
        });
      }
    }
    
    return {
      hands: hands,
      dealerValue: parseInt(params.sd || 10),
      currentHand: parseInt(params.hnd || 0),
      needsInsurance: params.inip === '1',
      gameEnded: params.end === '1',
      counter: parseInt(params.counter || 0),
      index: parseInt(params.index || 0),
      totalWin: parseFloat(params.win || 0),
      balance: params.balance,
      // All possible action flags from the game
      canHit: params.hiip === '1',
      canStand: params.stip === '1',
      canDouble: params.doip === '1',
      canSplit: params.spip === '1',
      canSurrender: params.suip === '1',
      canInsure: params.inip === '1'
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  log(message, level = 'info') {
    if (!this.initialized) return; // Don't log if not initialized
    
    // Prevent duplicate logs by checking last message
    const logKey = `${message}_${level}`;
    const now = Date.now();
    if (this.lastLogKey === logKey && (now - this.lastLogTime) < 100) {
      return; // Skip duplicate within 100ms
    }
    this.lastLogKey = logKey;
    this.lastLogTime = now;
    
    // Store logs per tab
    const tabLogKey = this.tabId ? `consoleLogs_${this.tabId}` : 'consoleLogs';
    chrome.storage.local.get([tabLogKey], (result) => {
      let logs = result[tabLogKey] || [];
      const logEntry = {
        timestamp: new Date().toLocaleTimeString(),
        message: message,
        level: level
      };
      
      logs.push(logEntry);
      
      if (logs.length > 100) {
        logs = logs.slice(-100);
      }
      
      chrome.storage.local.set({ [tabLogKey]: logs });
    });
    
    chrome.runtime.sendMessage({
      type: 'CONSOLE_LOG',
      message: message,
      level: level,
      tabId: this.tabId
    }).catch(() => {});
  }
}

// Create bot instance to detect gameService
const bot = new BlackjackBot();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  debugLog('[BOT] Received message:', msg.type, 'Initialized:', bot.initialized, 'HasGameService:', bot.hasGameService);
  
  if (msg.type === 'CHECK_GAME_STATUS') {
    // Check stored status too
    const checkStatus = async () => {
      let hasGame = bot.hasGameService || bot.initialized;
      
      // Also check stored status if we have a tab ID
      if (!hasGame && bot.tabId) {
        const tabKey = `tabHasGame_${bot.tabId}`;
        const stored = await chrome.storage.local.get([tabKey]);
        hasGame = stored[tabKey] || false;
      }
      
      sendResponse({ 
        hasGame: hasGame,
        initialized: bot.initialized,
        botRunning: bot.botRunning,
        tabId: bot.tabId,
        gameOrigin: bot.gameData?.origin || null,
        url: window.location.href
      });
    };
    
    // Wait a bit for game service detection if not ready yet
    if (!bot.hasGameService && !bot.initialized && !bot.tabId) {
      setTimeout(checkStatus, 500);
    } else {
      checkStatus();
    }
    return true;
  } else if (msg.type === 'START_BOT') {
    // Allow starting even if not initialized yet - will check gameData
    bot.startBot().then(() => {
      sendResponse({ success: true });
    });
    return true;
  } else if (msg.type === 'STOP_BOT') {
    debugLog('[BOT] Stop command received:', msg.reason || 'Manual stop');
    if (bot.initialized) {
      bot.log('Bot stopped: ' + (msg.reason || 'Manual stop'), 'error');
    }
    bot.stopBot().then(() => {
      sendResponse({ success: true });
    });
    return true;
  } else if (msg.type === 'UPDATE_BET_SIZE') {
    // Validate bet size before updating
    if (bot.availableBets && bot.availableBets.length > 0) {
      if (bot.availableBets.includes(msg.betSize)) {
        bot.betSize = msg.betSize;
        debugLog('[BOT] Bet size updated to:', bot.betSize);
      } else {
        // Invalid bet - use lowest
        const sortedBets = [...bot.availableBets].sort((a, b) => a - b);
        bot.betSize = sortedBets[0];
        debugLog('[BOT] Invalid bet size requested:', msg.betSize, '- using lowest:', bot.betSize);
        // Update storage with valid bet
        chrome.storage.local.set({ betSize: bot.betSize });
      }
    } else {
      bot.betSize = msg.betSize;
      debugLog('[BOT] Bet size updated to:', bot.betSize, '(will validate when bets are known)');
    }
    sendResponse({ success: true });
    return true;
  }
  
  // For other messages, check if initialized
  if (!bot.initialized) {
    debugLog('[BOT] Bot not initialized - no gameService in this frame');
    sendResponse({ success: false, error: 'No gameService detected' });
    return true;
  }
});