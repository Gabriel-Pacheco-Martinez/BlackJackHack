# BlackJackHack
This is the repository for our CS 5784 project

## Ideas - development
Maybe we don't need to reconginize the HTTP network request. We could determine we are in a Betting site using the manifest.json. This cab be done with:
"content_scripts":[
    {
        "matches": ["https://bettingsite.com/*"]
    }
]

This is what allows to send messages to the backend.
"host_permissions": [
    "https://api.myserver.com/*"
  ],


The background/background.js is what makes calls to the external backend. (It has permission to make network requests).Sends responses back to the popup
Can't directly access or modify the popup DOM - communication happens via messaging API


```pgsql
┌────────────────────────────────────────────────────┐
│                    Vite (builder)                  │
│  Reads vite.config.js                              │
│  ↓                                                  │
│  Bundles:                                           │
│   • React popup (index.html → main.jsx → Popup.jsx) │
│   • background.js                                   │
│   • utils/messaging.js                              │
│  ↓                                                  │
│  Uses manifest.json (via CRX plugin)                │
│  ↓                                                  │
│  Produces Chrome Extension ready build              │
└────────────────────────────────────────────────────┘

messaging.js is the bridge between the popup (React UI) and the background script,
not between the background and the backend.

```scss
Popup.jsx
   ↓
sendToBackground()   ← from messaging.js
   ↓
background.js
   ↓
fetch()  ← makes the actual REST call
   ↓
api.myserver.com