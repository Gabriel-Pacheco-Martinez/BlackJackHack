(function() {
    console.log('[TRACKER] Interceptor script starting execution!');
    console.log('[TRACKER] Current URL:', window.location.href);
    console.log('[TRACKER] Window origin:', window.location.origin);

    // Debug logging wrapper
    let debugMode = false;

    // Check debug mode from data attribute (set by content script to avoid CSP issues)
    const debugAttr = document.documentElement.getAttribute('data-debug-mode');
    if (debugAttr === 'true') {
        debugMode = true;
    }

    function debugLog(...args) {
        if (debugMode) {
            console.log(...args);
        }
    }

    const originalFetch = window.fetch;
    const originalXHR = window.XMLHttpRequest.prototype.open;

    console.log('[TRACKER] Original XMLHttpRequest.prototype.open captured:', typeof originalXHR);
    console.log('[TRACKER] Original fetch captured:', typeof originalFetch);

    // Flag to mark this frame has gameService
    window.__hasGameService = false;

    // Intercept fetch
    window.fetch = function(...args) {
        const [url, options] = args;

        // Convert URL to string if it's a URL object or Request
        const urlString = typeof url === 'string' ? url : (url && url.toString ? url.toString() : '');

        if (urlString && urlString.includes('gameService')) {
            if (!window.__hasGameService) {
                window.__hasGameService = true;
                // Notify content script immediately
                window.postMessage({ type: 'HAS_GAME_SERVICE' }, '*');
                console.log('[TRACKER] GameService detected! Notifying content script.');
            }
            if (options && options.body) {
                const body = options.body;
                const params = new URLSearchParams(body);

                // Always update mgckey from the latest request (SESSION can change)
                const currentMgckey = params.get('mgckey');
                if (currentMgckey && window.__gameData) {
                    if (window.__gameData.mgckey !== currentMgckey) {
                        debugLog('[TRACKER] Updated mgckey (SESSION changed)');
                        window.__gameData.mgckey = currentMgckey;
                        // Notify content script about mgckey update
                        window.postMessage({
                            type: 'MGCKEY_UPDATE',
                            mgckey: currentMgckey
                        }, '*');
                    }
                }

                if (params.get('action') === 'doInit') {
                    const gameData = {
                        requestUrl: urlString,
                        origin: window.location.origin,
                        symbol: params.get('symbol'),
                        mgckey: params.get('mgckey'),
                        index: parseInt(params.get('index') || 0),
                        counter: parseInt(params.get('counter') || 0),
                        timestamp: new Date().toISOString()
                    };

                    window.__gameData = gameData;
                    debugLog('[TRACKER] CAPTURED doInit request!', gameData);
                }
            }

            return originalFetch.apply(this, args).then(response => {
                const clonedResponse = response.clone();
                clonedResponse.text().then(text => {
                    if (options && options.body) {
                        const params = new URLSearchParams(options.body);
                        const action = params.get('action');
                        debugLog('[GAME]', action, '→', text.substring(0, 100));

                        // Track balance for RTP
                        const balanceMatch = text.match(/balance=([0-9.]+)/);
                        if (balanceMatch) {
                            const balance = parseFloat(balanceMatch[1]);
                            window.__currentBalance = balance;
                            window.postMessage({
                                type: 'BALANCE_UPDATE',
                                balance: balance,
                                action: action
                            }, '*');
                        }

                        // Check for sc= parameter in ANY response to keep bets updated
                        const scMatch = text.match(/sc=([0-9.,]+)/);
                        if (scMatch) {
                            const scParam = scMatch[1];
                            const availableBets = scParam.split(',').map(b => parseFloat(b)).filter(b => !isNaN(b));
                            debugLog('[TRACKER] Updated available bets from', action, 'response:', availableBets);

                            window.postMessage({
                                type: 'AVAILABLE_BETS_UPDATE',
                                availableBets: availableBets
                            }, '*');
                        }

                        // If this is a doInit response, capture everything including available bets
                        if (action === 'doInit') {
                            debugLog('[TRACKER] Processing doInit response');

                            let availableBets = null;
                            if (scMatch) {
                                const scParam = scMatch[1];
                                availableBets = scParam.split(',').map(b => parseFloat(b)).filter(b => !isNaN(b));
                            }

                            if (window.__gameData) {
                                window.__gameData.availableBets = availableBets;
                                debugLog('[TRACKER] Sending GAME_DATA_CAPTURED with bets:', availableBets);
                                window.postMessage({
                                    type: 'GAME_DATA_CAPTURED',
                                    data: window.__gameData,
                                    availableBets: availableBets
                                }, '*');
                            }

                            // Also send counter info for next request
                            const responseParams = new URLSearchParams(text);
                            if (responseParams.get('counter')) {
                                const counter = parseInt(responseParams.get('counter'));
                                const index = parseInt(responseParams.get('index') || '1');
                                debugLog('[TRACKER] doInit response counters: index=' + index + ', counter=' + counter);
                                window.postMessage({
                                    type: 'INIT_RESPONSE',
                                    index: index,
                                    counter: counter
                                }, '*');
                            }
                        }
                    }
                });
                return response;
            });
        }

        return originalFetch.apply(this, args);
    };

    // Intercept XHR
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        const urlString = typeof url === 'string' ? url : (url && url.toString ? url.toString() : String(url));
        this._url = urlString;
        this._method = method;
        console.log('[TRACKER-XHR] XMLHttpRequest.open called:', method, urlString);
        return originalXHR.apply(this, [method, url, ...args]);
    };

    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
        console.log('[TRACKER-XHR] XMLHttpRequest.send called for URL:', this._url);

        if (this._url && this._url.includes('gameService')) {
            console.log('[TRACKER-XHR] DETECTED gameService URL!', this._url);
            if (!window.__hasGameService) {
                window.__hasGameService = true;
                // Notify content script immediately
                window.postMessage({ type: 'HAS_GAME_SERVICE' }, '*');
                console.log('[TRACKER] GameService detected via XHR! Notifying content script.');
            }
            let action = null;
            if (body) {
                const params = new URLSearchParams(body);
                action = params.get('action');

                const currentMgckey = params.get('mgckey');
                if (currentMgckey && window.__gameData) {
                    if (window.__gameData.mgckey !== currentMgckey) {
                        debugLog('[TRACKER] Updated mgckey (SESSION changed) - XHR');
                        window.__gameData.mgckey = currentMgckey;
                        window.postMessage({
                            type: 'MGCKEY_UPDATE',
                            mgckey: currentMgckey
                        }, '*');
                    }
                }

                if (action === 'doInit') {
                    const gameData = {
                        requestUrl: this._url,
                        origin: window.location.origin,
                        symbol: params.get('symbol'),
                        mgckey: params.get('mgckey'),
                        index: parseInt(params.get('index') || 0),
                        counter: parseInt(params.get('counter') || 0),
                        timestamp: new Date().toISOString()
                    };

                    window.__gameData = gameData;
                    debugLog('[TRACKER] CAPTURED doInit request (XHR)!', gameData);
                }
            }

            const originalOnReadyStateChange = this.onreadystatechange;
            this.onreadystatechange = function() {
                if (this.readyState === 4 && this.status === 200) {
                    const text = this.responseText;
                    debugLog('[GAME] XHR', action, '→', text.substring(0, 100));

                    const scMatch = text.match(/sc=([0-9.,]+)/);
                    if (scMatch) {
                        const scParam = scMatch[1];
                        const availableBets = scParam.split(',').map(b => parseFloat(b)).filter(b => !isNaN(b));
                        debugLog('[TRACKER] Updated available bets from XHR', action, 'response:', availableBets);

                        window.postMessage({
                            type: 'AVAILABLE_BETS_UPDATE',
                            availableBets: availableBets
                        }, '*');
                    }

                    if (action === 'doInit') {
                        debugLog('[TRACKER] Processing doInit response (XHR)');

                        let availableBets = null;
                        if (scMatch) {
                            const scParam = scMatch[1];
                            availableBets = scParam.split(',').map(b => parseFloat(b)).filter(b => !isNaN(b));
                        }

                        if (window.__gameData) {
                            window.__gameData.availableBets = availableBets;
                            debugLog('[TRACKER] Sending GAME_DATA_CAPTURED with bets:', availableBets);
                            window.postMessage({
                                type: 'GAME_DATA_CAPTURED',
                                data: window.__gameData,
                                availableBets: availableBets
                            }, '*');
                        }

                        const responseParams = new URLSearchParams(text);
                        if (responseParams.get('counter')) {
                            const counter = parseInt(responseParams.get('counter'));
                            const index = parseInt(responseParams.get('index') || '1');
                            debugLog('[TRACKER] doInit response counters: index=' + index + ', counter=' + counter);
                            window.postMessage({
                                type: 'INIT_RESPONSE',
                                index: index,
                                counter: counter
                            }, '*');
                        }
                    }
                }
                if (originalOnReadyStateChange) {
                    originalOnReadyStateChange.apply(this, arguments);
                }
            };
        }
        return originalSend.apply(this, arguments);
    };

    debugLog('[TRACKER] Interceptor installed');
    console.log('[TRACKER] Interceptor fully installed and ready!');
})();
