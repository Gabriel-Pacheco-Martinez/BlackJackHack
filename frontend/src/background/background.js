// Background service worker for Chrome extension
const API_ENDPOINT = 'https://webhook.site/b0b9bec6-557d-4bfd-bd90-a05f0b6e47c3';

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_GAME') {
    handleGameRequest(request.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    
    // Return true to indicate async response
    return true;
  }
});

// Make API call to backend
async function handleGameRequest(gameData) {
  try {
    console.log('Sending to API:', gameData);
    
    // Add delay if requested
    if (gameData.useDelays) {
      await delay(Math.random() * 2000 + 1000); // 1-3 second delay
    }
    
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        betSize: gameData.betSize,
        targetWager: gameData.targetWager,
        useDelays: gameData.useDelays
      })
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('API response:', data);
    
    return data;
  } catch (error) {
    console.error('Background script error:', error);
    throw error;
  }
}

// Helper delay function
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Log when background script loads
console.log('Blackjack Helper background script loaded');