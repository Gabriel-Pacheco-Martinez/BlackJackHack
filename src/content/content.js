// Content script for game interception
// Feature: F006 - Game Interception & DOM Manipulation

class BlackjackInterceptor {
  constructor() {
    this.gameState = {
      playerHand: [],
      dealerCard: '',
      currentBet: 0,
      balance: 0,
      isPlaying: false
    };

    this.selectors = {
      // Common selectors for blackjack game elements
      playerCards: '.player-cards, .player-hand, #player-cards',
      dealerCards: '.dealer-cards, .dealer-hand, #dealer-cards',
      hitButton: 'button[data-action="hit"], .hit-button, #hit',
      standButton: 'button[data-action="stand"], .stand-button, #stand',
      doubleButton: 'button[data-action="double"], .double-button, #double',
      splitButton: 'button[data-action="split"], .split-button, #split',
      dealButton: 'button[data-action="deal"], .deal-button, #deal',
      betInput: 'input[type="number"].bet, #bet-amount',
      balanceDisplay: '.balance, .player-balance, #balance'
    };

    this.init();
  }

  init() {
    console.log('Blackjack Interceptor initialized');
    this.attachEventListeners();
    this.observeGameChanges();
    this.injectCustomStyles();
  }

  // Attach event listeners to game buttons
  attachEventListeners() {
    // Intercept hit button
    this.interceptButton(this.selectors.hitButton, 'hit');

    // Intercept stand button
    this.interceptButton(this.selectors.standButton, 'stand');

    // Intercept double button
    this.interceptButton(this.selectors.doubleButton, 'double');

    // Intercept split button
    this.interceptButton(this.selectors.splitButton, 'split');

    // Intercept deal button
    this.interceptButton(this.selectors.dealButton, 'deal');
  }

  // Generic button interceptor
  interceptButton(selector, action) {
    const buttons = document.querySelectorAll(selector);
    buttons.forEach(button => {
      // Clone and replace to remove existing listeners
      const newButton = button.cloneNode(true);
      button.parentNode.replaceChild(newButton, button);

      // Add our interceptor
      newButton.addEventListener('click', (e) => {
        console.log(`Intercepted ${action} action`);
        this.handleGameAction(action, e);
      }, true);
    });
  }

  // Handle intercepted game actions
  handleGameAction(action, event) {
    // Capture current game state
    this.captureGameState();

    // Send to background for analysis
    chrome.runtime.sendMessage({
      type: 'GAME_ACTION',
      action: action,
      gameState: this.gameState,
      timestamp: Date.now()
    }, response => {
      if (response && response.shouldProceed) {
        console.log(`Proceeding with ${action}`);
        // Allow the original action to proceed
      } else if (response && response.suggestedAction) {
        console.log(`Overriding with suggested action: ${response.suggestedAction}`);
        event.preventDefault();
        event.stopPropagation();
        // Execute suggested action instead
        this.executeAction(response.suggestedAction);
      }
    });
  }

  // Capture current game state from DOM
  captureGameState() {
    try {
      // Capture player cards
      const playerCardsElement = document.querySelector(this.selectors.playerCards);
      if (playerCardsElement) {
        this.gameState.playerHand = this.extractCards(playerCardsElement);
      }

      // Capture dealer card
      const dealerCardsElement = document.querySelector(this.selectors.dealerCards);
      if (dealerCardsElement) {
        const dealerCards = this.extractCards(dealerCardsElement);
        this.gameState.dealerCard = dealerCards[0] || '';
      }

      // Capture balance
      const balanceElement = document.querySelector(this.selectors.balanceDisplay);
      if (balanceElement) {
        this.gameState.balance = parseFloat(balanceElement.textContent.replace(/[^0-9.-]/g, ''));
      }

      // Capture current bet
      const betInput = document.querySelector(this.selectors.betInput);
      if (betInput) {
        this.gameState.currentBet = parseFloat(betInput.value) || 0;
      }

      console.log('Game state captured:', this.gameState);
    } catch (error) {
      console.error('Error capturing game state:', error);
    }
  }

  // Extract card values from DOM element
  extractCards(element) {
    const cards = [];
    const cardElements = element.querySelectorAll('.card, [data-card]');

    cardElements.forEach(card => {
      const value = card.getAttribute('data-card') ||
                   card.getAttribute('data-value') ||
                   card.textContent.trim();
      if (value) {
        cards.push(this.normalizeCardValue(value));
      }
    });

    return cards;
  }

  // Normalize card values to consistent format
  normalizeCardValue(value) {
    // Convert face cards and normalize format
    const normalized = value.toUpperCase().trim();
    if (normalized === 'A' || normalized === '1' || normalized === '11') return 'A';
    if (normalized === 'K' || normalized === '13') return 'K';
    if (normalized === 'Q' || normalized === '12') return 'Q';
    if (normalized === 'J' || normalized === '11') return 'J';
    if (normalized === 'T' || normalized === '10') return '10';
    return normalized;
  }

  // Execute an action programmatically
  executeAction(action) {
    let button;
    switch(action.toLowerCase()) {
      case 'hit':
        button = document.querySelector(this.selectors.hitButton);
        break;
      case 'stand':
        button = document.querySelector(this.selectors.standButton);
        break;
      case 'double':
        button = document.querySelector(this.selectors.doubleButton);
        break;
      case 'split':
        button = document.querySelector(this.selectors.splitButton);
        break;
      default:
        console.warn('Unknown action:', action);
        return;
    }

    if (button && !button.disabled) {
      console.log(`Executing action: ${action}`);
      button.click();
    } else {
      console.warn(`Button for action ${action} not found or disabled`);
    }
  }

  // Observe DOM changes to detect game state updates
  observeGameChanges() {
    const observer = new MutationObserver((mutations) => {
      // Check if game state has changed
      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          // Debounced game state capture
          clearTimeout(this.captureTimeout);
          this.captureTimeout = setTimeout(() => {
            this.captureGameState();
            this.sendStateUpdate();
          }, 100);
          break;
        }
      }
    });

    // Start observing the game container
    const gameContainer = document.querySelector('.game-container, #game, .blackjack-table');
    if (gameContainer) {
      observer.observe(gameContainer, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-card', 'data-value', 'class']
      });
      console.log('Observing game container for changes');
    } else {
      console.warn('Game container not found, retrying in 2 seconds...');
      setTimeout(() => this.observeGameChanges(), 2000);
    }
  }

  // Send state update to background
  sendStateUpdate() {
    chrome.runtime.sendMessage({
      type: 'GAME_STATE_UPDATE',
      gameState: this.gameState,
      timestamp: Date.now()
    });
  }

  // Inject custom styles for visual feedback
  injectCustomStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* Visual indicator for intercepted elements */
      .blackjack-intercepted {
        position: relative;
      }

      .blackjack-intercepted::after {
        content: '🎯';
        position: absolute;
        top: -10px;
        right: -10px;
        font-size: 12px;
        z-index: 10000;
      }

      /* Highlight suggested actions */
      .suggested-action {
        box-shadow: 0 0 10px rgba(255, 215, 0, 0.8) !important;
        animation: pulse 1s infinite;
      }

      @keyframes pulse {
        0% { box-shadow: 0 0 10px rgba(255, 215, 0, 0.8); }
        50% { box-shadow: 0 0 20px rgba(255, 215, 0, 1); }
        100% { box-shadow: 0 0 10px rgba(255, 215, 0, 0.8); }
      }
    `;
    document.head.appendChild(style);
  }

  // Highlight suggested action button
  highlightSuggestedAction(action) {
    // Remove previous highlights
    document.querySelectorAll('.suggested-action').forEach(el => {
      el.classList.remove('suggested-action');
    });

    // Add highlight to suggested button
    let selector;
    switch(action.toLowerCase()) {
      case 'hit':
        selector = this.selectors.hitButton;
        break;
      case 'stand':
        selector = this.selectors.standButton;
        break;
      case 'double':
        selector = this.selectors.doubleButton;
        break;
      case 'split':
        selector = this.selectors.splitButton;
        break;
    }

    if (selector) {
      const button = document.querySelector(selector);
      if (button) {
        button.classList.add('suggested-action');
      }
    }
  }
}

// Initialize interceptor when page is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new BlackjackInterceptor();
  });
} else {
  new BlackjackInterceptor();
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'HIGHLIGHT_ACTION') {
    const interceptor = window.blackjackInterceptor || new BlackjackInterceptor();
    interceptor.highlightSuggestedAction(message.action);
    sendResponse({ success: true });
  }
});