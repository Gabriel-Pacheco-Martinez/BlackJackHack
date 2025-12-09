import { useState, useEffect } from 'react';
import { sendToBackground, MessageTypes, loadStats, saveStats } from '../utils/messaging';
import StrategyEditor from '../components/StrategyEditor';
import './Popup.css';

function Popup() {
  const [betSize, setBetSize] = useState('10');
  const [targetWager, setTargetWager] = useState('100');
  const [actionDelay, setActionDelay] = useState('0');
  const [delayStdDev, setDelayStdDev] = useState('0');
  const [strategy, setStrategy] = useState('basic');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [delayError, setDelayError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastResponse, setLastResponse] = useState(null);
  const [activeTab, setActiveTab] = useState('settings');

  // Game detection states
  const [gameDetected, setGameDetected] = useState(false);
  const [gameInitialized, setGameInitialized] = useState(false);
  const [currentTabId, setCurrentTabId] = useState(null);
  const [gameData, setGameData] = useState(null);
  const [checkingGame, setCheckingGame] = useState(true);
  const [botRunning, setBotRunning] = useState(false);

  const [stats, setStats] = useState({
    wins: 0,
    losses: 0,
    pushes: 0,
    totalGames: 0,
    totalWagered: 0,
    netProfit: 0
  });

  // Check game detection status
  const checkGameStatus = async () => {
    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        setCurrentTabId(tab.id);

        // If tab is still loading, don't check for game data yet
        if (tab.status === 'loading') {
          setGameData(null);
          setGameDetected(false);
          setGameInitialized(false);
          setBotRunning(false);
          return;
        }

        // Check for game data in storage only
        const tabDataKey = `gameData_${tab.id}`;
        const stored = await chrome.storage.local.get([tabDataKey]);

        if (stored[tabDataKey]) {
          setGameData(stored[tabDataKey]);
          setGameDetected(true);
          setGameInitialized(true);
        } else {
          // No game data - reset state
          setGameData(null);
          setGameDetected(false);
          setGameInitialized(false);
          setBotRunning(false);
        }
      }
    } finally {
      setCheckingGame(false);
    }
  };

  // Load stats and bot status on mount
  useEffect(() => {
    // Load stats and bot running state
    chrome.storage.local.get(['botStats', 'botRunning']).then(result => {
      if (result.botStats) {
        const botStats = result.botStats;
        setStats({
          wins: botStats.handsWon || 0,
          losses: botStats.handsLost || 0,
          pushes: botStats.handsPushed || 0,
          totalGames: botStats.handsPlayed || 0,
          totalWagered: botStats.totalWagered || 0,
          netProfit: (botStats.totalReturned || 0) - (botStats.totalWagered || 0)
        });
      }
      // Restore bot running state
      if (result.botRunning) {
        setBotRunning(true);
      }
    });

    // Load saved settings
    chrome.storage.local.get(['betSize', 'targetWager', 'actionDelay', 'delayStdDev', 'strategy'], (result) => {
      if (result.betSize) setBetSize(result.betSize);
      if (result.targetWager) setTargetWager(result.targetWager);
      if (result.actionDelay) setActionDelay(result.actionDelay);
      if (result.delayStdDev !== undefined) setDelayStdDev(result.delayStdDev);
      if (result.strategy) setStrategy(result.strategy);
    });

    // Check game status
    checkGameStatus();

    // Listen for storage changes (auto-detect when game is captured or cleared)
    const storageListener = (changes, area) => {
      if (area === 'local') {
        // Check for tab-specific game data changes
        if (currentTabId) {
          const tabDataKey = `gameData_${currentTabId}`;
          if (changes[tabDataKey]) {
            if (changes[tabDataKey].newValue) {
              setGameData(changes[tabDataKey].newValue);
              setGameDetected(true);
              setGameInitialized(true);
              setError('');
            } else {
              // Game data was cleared (page refresh/navigation)
              setGameData(null);
              setGameDetected(false);
              setGameInitialized(false);
              setBotRunning(false);
              setCheckingGame(true);
            }
          }
        }

        // Listen for bot stats updates
        if (changes.botStats && changes.botStats.newValue) {
          const botStats = changes.botStats.newValue;
          setStats({
            wins: botStats.handsWon || 0,
            losses: botStats.handsLost || 0,
            pushes: botStats.handsPushed || 0,
            totalGames: botStats.handsPlayed || 0,
            totalWagered: botStats.totalWagered || 0,
            netProfit: (botStats.totalReturned || 0) - (botStats.totalWagered || 0)
          });
        }
      }
    };

    chrome.storage.onChanged.addListener(storageListener);

    // Check status periodically
    const interval = setInterval(checkGameStatus, 2000);

    return () => {
      chrome.storage.onChanged.removeListener(storageListener);
      clearInterval(interval);
    };
  }, [currentTabId]);

  // Validate delay settings
  const validateDelays = (delay, stdDev) => {
    const d = parseInt(delay) || 0;
    const s = parseInt(stdDev) || 0;
    if (d > 0 && s > d / 5) {
      return `Std Dev must be at most ${Math.floor(d / 5)}ms (1/5 of delay)`;
    }
    return '';
  };

  // Calculate delay distribution for display
  const getDelayDistribution = () => {
    const d = parseInt(actionDelay) || 0;
    const s = parseInt(delayStdDev) || 0;
    if (d === 0) return null;

    return {
      base: d,
      stdDev: s,
      sigma1: { min: Math.max(0, d - s), max: d + s, pct: '68%' },
      sigma2: { min: Math.max(0, d - 2*s), max: d + 2*s, pct: '95%' },
      sigma3: { min: Math.max(0, d - 3*s), max: d + 3*s, pct: '99.7%' },
      hardCap: { min: Math.max(0, d - 5*s), max: d + 5*s }
    };
  };

  // Calculate progress percentage
  const getProgress = () => {
    const target = parseFloat(targetWager) || 0;
    if (target === 0) return 0;
    return Math.min(100, (stats.totalWagered / target) * 100);
  };

  const handleDelayChange = (value) => {
    setActionDelay(value);
    setDelayError(validateDelays(value, delayStdDev));
  };

  const handleStdDevChange = (value) => {
    setDelayStdDev(value);
    setDelayError(validateDelays(actionDelay, value));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate delays
    const delayValidation = validateDelays(actionDelay, delayStdDev);
    if (delayValidation) {
      setError(delayValidation);
      return;
    }

    setLoading(true);

    // Save settings
    chrome.storage.local.set({
      betSize,
      targetWager,
      actionDelay,
      delayStdDev,
      strategy
    });

    try {
      const response = await sendToBackground(MessageTypes.START_GAME, {
        betSize: parseFloat(betSize),
        targetWager: parseFloat(targetWager),
        actionDelay: parseInt(actionDelay),
        delayStdDev: parseInt(delayStdDev),
        strategy,
        autoRefresh
      });

      if (response.success) {
        console.log("Game started successfully");
        setBotRunning(true);
        chrome.storage.local.set({ botRunning: true });
        setLastResponse(response.data);
      } else {
        setError(response.error || 'Unknown error occurred');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };


  const handleStop = async () => {
    setLoading(true);
    try {
      await sendToBackground(MessageTypes.STOP_GAME);
      setBotRunning(false);
      // Clear stats and bot state when manually stopped
      await chrome.storage.local.remove(['botStats', 'botRunning']);
      setStats({
        wins: 0,
        losses: 0,
        pushes: 0,
        totalGames: 0,
        totalWagered: 0,
        netProfit: 0
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetStats = async () => {
    const emptyStats = {
      wins: 0,
      losses: 0,
      pushes: 0,
      totalGames: 0,
      totalWagered: 0,
      netProfit: 0
    };
    setStats(emptyStats);
    await saveStats(emptyStats);
    setLastResponse(null);
  };

  return (
    <div className="popup-container">
      <h1>🃏 Blackjack Helper v0.3</h1>

      {/* Game Detection Status */}
      <div className={`game-status ${gameDetected ? 'detected' : 'not-detected'}`}>
        <span className="status-icon">
          {checkingGame ? '🔍' : gameDetected ? '✅' : '⚠️'}
        </span>
        <span className="status-text">
          {checkingGame
            ? 'Checking for game...'
            : gameDetected
              ? gameInitialized
                ? 'Game Ready'
                : 'Game Detected (Initializing...)'
              : 'No Game Detected'}
        </span>
      </div>

      {/* Show warning if no game detected */}
      {!checkingGame && !gameDetected && (
        <div className="warning-message">
          <p>⚠️ Please navigate to a Pragmatic Play Blackjack game</p>
          <p className="small-text">The extension will automatically detect when a game loads</p>
        </div>
      )}

      <div className="tabs">
        <button
          className={activeTab === 'settings' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
        <button
          className={activeTab === 'strategy' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('strategy')}
        >
          Strategy
        </button>
        <button
          className={activeTab === 'stats' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('stats')}
        >
          Statistics
        </button>
      </div>

      {activeTab === 'settings' && (
        <form onSubmit={handleSubmit} className="game-form">
          <div className="settings-header-group">
            <h2>Bot Settings</h2>
            <p className="settings-note">Plays 3 hands per round - actual wager may slightly exceed target</p>
          </div>
          <div className="form-group">
            <label htmlFor="betSize">Bet Size per Hand ($)</label>
            <input
              id="betSize"
              type="number"
              min="1"
              step="0.01"
              value={betSize}
              onChange={(e) => setBetSize(e.target.value)}
              disabled={loading || botRunning}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="targetWager">Target Wager ($)</label>
            <input
              id="targetWager"
              type="number"
              min="1"
              step="0.01"
              value={targetWager}
              onChange={(e) => setTargetWager(e.target.value)}
              disabled={loading || botRunning}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="actionDelay">Action Delay (ms)</label>
            <input
              id="actionDelay"
              type="number"
              min="0"
              max="5000"
              step="50"
              value={actionDelay}
              onChange={(e) => handleDelayChange(e.target.value)}
              disabled={loading || botRunning}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="delayStdDev">Delay Std Dev (ms)</label>
            <input
              id="delayStdDev"
              type="number"
              min="0"
              max="1000"
              step="10"
              value={delayStdDev}
              onChange={(e) => handleStdDevChange(e.target.value)}
              disabled={loading || botRunning}
              className={delayError ? 'input-error' : ''}
            />
          </div>

          {delayError && (
            <div className="delay-error">{delayError}</div>
          )}

          {getDelayDistribution() && !delayError && (
            <div className="delay-distribution">
              <div className="distribution-header">Delay Distribution</div>
              <table className="distribution-table">
                <tbody>
                  <tr>
                    <td className="sigma-label">±1σ ({getDelayDistribution().sigma1.pct})</td>
                    <td className="sigma-range">{getDelayDistribution().sigma1.min} - {getDelayDistribution().sigma1.max}ms</td>
                  </tr>
                  <tr>
                    <td className="sigma-label">±2σ ({getDelayDistribution().sigma2.pct})</td>
                    <td className="sigma-range">{getDelayDistribution().sigma2.min} - {getDelayDistribution().sigma2.max}ms</td>
                  </tr>
                  <tr>
                    <td className="sigma-label">±3σ ({getDelayDistribution().sigma3.pct})</td>
                    <td className="sigma-range">{getDelayDistribution().sigma3.min} - {getDelayDistribution().sigma3.max}ms</td>
                  </tr>
                  <tr className="hard-cap-row">
                    <td className="sigma-label">Hard cap (±5σ)</td>
                    <td className="sigma-range">{getDelayDistribution().hardCap.min} - {getDelayDistribution().hardCap.max}ms</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {botRunning ? (
            <button
              type="button"
              onClick={handleStop}
              disabled={loading}
              className="submit-btn stop-btn"
            >
              {loading ? 'Stopping...' : '⏹ Stop Bot'}
            </button>
          ) : (
            <button
              type="submit"
              disabled={loading || !gameDetected || !gameInitialized}
              className="submit-btn"
              title={!gameDetected ? 'Please wait for game detection' : !gameInitialized ? 'Game is initializing...' : ''}
            >
              {loading ? 'Starting...' : !gameDetected ? 'Waiting for Game...' : '▶ Start Bot'}
            </button>
          )}

          {botRunning && (
            <div className="bot-status running">
              🤖 Bot is running...
            </div>
          )}
        </form>
      )}

      {activeTab === 'strategy' && (
        <StrategyEditor
          onStrategyChange={(newStrategy) => {
            // Save custom strategy to storage
            chrome.storage.local.set({ customStrategy: newStrategy });
            console.log('Strategy updated:', newStrategy);
          }}
        />
      )}

      {activeTab === 'stats' && (
        <div className="stats-section">
          <div className="stats-header">
            <h2>Session Statistics</h2>
            <button onClick={resetStats} className="reset-btn">Reset</button>
          </div>

          {/* Progress Bar */}
          <div className="progress-section">
            <div className="progress-header">
              <span>Progress to Target</span>
              <span className="progress-text">
                ${stats.totalWagered.toFixed(2)} / ${parseFloat(targetWager).toFixed(2)}
              </span>
            </div>
            <div className="progress-bar-container">
              <div
                className="progress-bar-fill"
                style={{ width: `${getProgress()}%` }}
              />
            </div>
            <div className="progress-percentage">{getProgress().toFixed(1)}%</div>
          </div>

          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Rounds:</span>
              <span className="stat-value">{stats.totalGames}</span>
            </div>
            <div className="stat-item wins">
              <span className="stat-label">Wins:</span>
              <span className="stat-value">{stats.wins}</span>
            </div>
            <div className="stat-item losses">
              <span className="stat-label">Losses:</span>
              <span className="stat-value">{stats.losses}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Pushes:</span>
              <span className="stat-value">{stats.pushes}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Wagered:</span>
              <span className="stat-value">${stats.totalWagered.toFixed(2)}</span>
            </div>
            <div className={`stat-item ${stats.netProfit >= 0 ? 'profit' : 'loss'}`}>
              <span className="stat-label">Net Profit:</span>
              <span className="stat-value">${stats.netProfit.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="error-message">
          ⚠️ {error}
        </div>
      )}

      {lastResponse && (
        <div className="response-box">
          <h3>Last Response</h3>
          <pre>{JSON.stringify(lastResponse, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default Popup;
