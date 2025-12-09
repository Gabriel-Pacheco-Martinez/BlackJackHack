<!-- PROJECT HEADER -->
<h1 align="center">
  <p align="center">
    <img src="images/ss1" alt="Screenshot 1" width="220" />
    <img src="images/ss2" alt="Screenshot 2" width="220" />
    <img src="images/ss3" alt="Screenshot 3" width="220" />
    <br>
    BLACKJACK BOT
  </p>
</h1>

<p align="center">
  A pipeline for customizing large language models (LLMs) based on context and user requirements.
  <br />
  <a href="#about">About</a>
  ·
  <a href="#instructions">Instructions</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-Apache%202.0-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/React-19.1.1-61DAFB?style=flat-square" alt="React Version" />
  <img src="https://img.shields.io/badge/Vite-7.1.7-646CFF?style=flat-square" alt="Vite Version" />
</p>

## About

This is a Chrome extension that provides an assistant bot to play blackjack.  
The bot activates when specific HTTP requests from supported casinos are detected.  
The extension allows you to customize:
- target wager  
- bet size  
- delay  
- type of strategy  
- real-time statistics  

## Instructions

### 1. Clone the repository
Clone the repository.  
The folder `unobf-code` contains the full codebase used to build the bot. With the use of vite the `dist` folder can be built.
The folder `dist` contains the production build that Chrome uses for the extension.

### 2. Build the extension
1. Go to: `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist` folder  
You should now see the extension **“Blackjack Bot 1.0.0”** activated and ready to use.

### 3. Open the extension
Enter a blackjack game in Chrome, then open the extension.  
Once the game begins, the bot activates and you can configure its settings as needed.
