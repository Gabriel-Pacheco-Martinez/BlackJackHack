# Blackjack Helper - Iteration 1

**Sprint 1 - Story F010: Settings Management**
**Assignee:** MD
**Version:** 0.1.0

## Implemented Features

### F010 - Settings Management
Complete game configuration interface allowing users to customize:
- **Bet Size**: Individual bet amount configuration
- **Target Wager**: Total wagering goal
- **Action Delay**: Time between automated actions
- **Random Delays**: Option to vary delays for more human-like behavior
- **Auto-Refresh**: Automatic page refresh after 10 minutes
- **Strategy Selection**: Choose between Basic, Aggressive, Conservative, or Custom strategies

## Technical Implementation
- Chrome Extension using Manifest V3
- React-based popup interface
- Chrome Storage API for settings persistence
- Background service worker for message handling
- Settings automatically saved on change

## Project Structure
```
Scrum2-Iteration1/
├── src/
│   ├── background/
│   │   └── background.js      # Settings management handler
│   ├── popup/
│   │   ├── Popup.jsx         # Main settings UI
│   │   ├── Popup.css         # Styling
│   │   └── main.jsx          # React entry point
│   └── utils/
│       └── messaging.js      # Chrome message API utilities
├── public/
│   ├── manifest.json         # Chrome extension config
│   ├── strategy.json         # Basic strategy rules
│   └── wizard.png            # Extension icon
└── package.json             # Dependencies
```

## Installation
1. Run `npm install` to install dependencies
2. Run `npm run build` to build the extension
3. Load the `dist` folder as an unpacked extension in Chrome

## Usage
1. Click the extension icon to open the popup
2. Configure your desired settings
3. Settings are automatically saved
4. Click "Start Game" to initialize with current settings

## Development Status
This iteration implements the foundation for the Blackjack Helper extension with complete settings management functionality. The settings are persisted using Chrome's storage API and can be configured through an intuitive UI.