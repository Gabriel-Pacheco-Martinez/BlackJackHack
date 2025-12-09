// Check if this frame has gameService and notify content script
if (window.__hasGameService) {
    window.postMessage({ type: 'HAS_GAME_SERVICE' }, '*');
    console.log('[CHECKER] Frame has gameService, notifying content script');
}
