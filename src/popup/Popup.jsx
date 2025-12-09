/**
 * Popup Component - Main UI
 * Working on game detection and bot controls
 *
 * TODO: Still need to integrate with content script for real game detection
 */

import { useState, useEffect } from 'react';
import { sendToBackground, MessageTypes, loadStats, saveStats } from '../utils/messaging';
import StrategyEditor from '../components/StrategyEditor';
import './Popup.css';

const DEBUG = true;

function debugLog(...args) {
    if (DEBUG) console.log('[Popup]', ...args);
}

function Popup() {
    // Settings state
    const [betSize, setBetSize] = useState('10');
    const [targetWager, setTargetWager] = useState('100');
    const [actionDelay, setActionDelay] = useState('0');
    const [delayStdDev, setDelayStdDev] = useState('0');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [delayError, setDelayError] = useState('');

    // UI state
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [lastResponse, setLastResponse] = useState(null);
    const [activeTab, setActiveTab] = useState('settings');

    // Game detection state - this is the main thing I'm working on
    const [gameDetected, setGameDetected] = useState(false);
    const [gameInitialized, setGameInitialized] = useState(false);
    const [currentTabId, setCurrentTabId] = useState(null);
    const [gameData, setGameData] = useState(null);
    const [checkingGame, setCheckingGame] = useState(true);
    const [botRunning, setBotRunning] = useState(false);

    // Stats
    const [stats, setStats] = useState({
        wins: 0,
        losses: 0,
        pushes: 0,
        totalGames: 0,
        totalWagered: 0,
        netProfit: 0
    });

    // Check if game is detected on current tab
    const checkGameStatus = async () => {
        debugLog("Checking game status...");
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                setCurrentTabId(tab.id);
                debugLog("Current tab:", tab.id, "status:", tab.status);

                if (tab.status === 'loading') {
                    debugLog("Tab still loading, clearing state");
                    setGameData(null);
                    setGameDetected(false);
                    setGameInitialized(false);
                    setBotRunning(false);
                    return;
                }

                // Check storage for game data
                const tabDataKey = `gameData_${tab.id}`;
                const stored = await chrome.storage.local.get([tabDataKey]);
                debugLog("Storage check:", tabDataKey, "=", stored[tabDataKey] ? "found" : "not found");

                if (stored[tabDataKey]) {
                    setGameData(stored[tabDataKey]);
                    setGameDetected(true);
                    setGameInitialized(true);
                    debugLog("Game detected!");
                } else {
                    setGameData(null);
                    setGameDetected(false);
                    setGameInitialized(false);
                    setBotRunning(false);
                    debugLog("No game detected");
                }
            }
        } finally {
            setCheckingGame(false);
        }
    };

    // Load everything on mount
    useEffect(() => {
        debugLog("Component mounted, loading data...");

        // Load bot stats and running state
        chrome.storage.local.get(['botStats', 'botRunning']).then(result => {
            debugLog("Loaded from storage:", result);
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
            if (result.botRunning) {
                setBotRunning(true);
            }
        });

        // Load saved settings
        chrome.storage.local.get(['betSize', 'targetWager', 'actionDelay', 'delayStdDev', 'strategy'], (result) => {
            debugLog("Loaded settings:", result);
            if (result.betSize) setBetSize(result.betSize);
            if (result.targetWager) setTargetWager(result.targetWager);
            if (result.actionDelay) setActionDelay(result.actionDelay);
            if (result.delayStdDev !== undefined) setDelayStdDev(result.delayStdDev);
        });

        // Initial game check
        checkGameStatus();

        // Listen for storage changes
        const storageListener = (changes, area) => {
            if (area === 'local') {
                debugLog("Storage changed:", Object.keys(changes));

                if (currentTabId) {
                    const tabDataKey = `gameData_${currentTabId}`;
                    if (changes[tabDataKey]) {
                        if (changes[tabDataKey].newValue) {
                            debugLog("Game data updated");
                            setGameData(changes[tabDataKey].newValue);
                            setGameDetected(true);
                            setGameInitialized(true);
                            setError('');
                        } else {
                            debugLog("Game data cleared");
                            setGameData(null);
                            setGameDetected(false);
                            setGameInitialized(false);
                            setBotRunning(false);
                            setCheckingGame(true);
                        }
                    }
                }

                // Watch for stats updates
                if (changes.botStats && changes.botStats.newValue) {
                    const botStats = changes.botStats.newValue;
                    debugLog("Stats updated:", botStats);
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

        // Poll for game status
        const interval = setInterval(checkGameStatus, 2000);

        return () => {
            chrome.storage.onChanged.removeListener(storageListener);
            clearInterval(interval);
        };
    }, [currentTabId]);

    // Validate delay settings (std dev should be reasonable)
    const validateDelays = (delay, stdDev) => {
        const d = parseInt(delay) || 0;
        const s = parseInt(stdDev) || 0;
        if (d > 0 && s > d / 5) {
            return `Std Dev should be at most ${Math.floor(d / 5)}ms`;
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
            sigma2: { min: Math.max(0, d - 2 * s), max: d + 2 * s, pct: '95%' },
            hardCap: { min: Math.max(0, d - 5 * s), max: d + 5 * s }
        };
    };

    // Progress towards target
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
        debugLog("Start button clicked");
        setError('');

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
            delayStdDev
        });

        try {
            debugLog("Sending START_GAME to background...");
            const response = await sendToBackground(MessageTypes.START_GAME, {
                betSize: parseFloat(betSize),
                targetWager: parseFloat(targetWager),
                actionDelay: parseInt(actionDelay),
                delayStdDev: parseInt(delayStdDev),
                autoRefresh
            });

            debugLog("Response:", response);
            if (response.success) {
                setBotRunning(true);
                chrome.storage.local.set({ botRunning: true });
                setLastResponse(response.data);
            } else {
                setError(response.error || 'Failed to start');
            }
        } catch (err) {
            debugLog("Error:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleStop = async () => {
        debugLog("Stop button clicked");
        setLoading(true);
        try {
            await sendToBackground(MessageTypes.STOP_GAME);
            setBotRunning(false);
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
        debugLog("Resetting stats");
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
            <h1>Blackjack Bot v0.2</h1>

            {/* Game Detection Status */}
            <div className={`game-status ${gameDetected ? 'detected' : 'not-detected'}`}>
                <span className="status-icon">
                    {checkingGame ? '...' : gameDetected ? 'OK' : '!'}
                </span>
                <span className="status-text">
                    {checkingGame
                        ? 'Checking...'
                        : gameDetected
                            ? gameInitialized
                                ? 'Game Ready'
                                : 'Initializing...'
                            : 'No Game Detected'}
                </span>
            </div>

            {/* Warning if no game */}
            {!checkingGame && !gameDetected && (
                <div className="warning-message">
                    <p>Navigate to a blackjack game first</p>
                    <p className="small-text">Extension will detect when game loads</p>
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
                    Stats
                </button>
            </div>

            {activeTab === 'settings' && (
                <form onSubmit={handleSubmit} className="game-form">
                    <h2>Bot Settings</h2>
                    <p className="settings-note">Plays 3 hands per round</p>

                    <div className="form-group">
                        <label htmlFor="betSize">Bet Size ($)</label>
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
                        <label htmlFor="actionDelay">Delay (ms)</label>
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

                    {/* Show delay distribution */}
                    {getDelayDistribution() && !delayError && (
                        <div className="delay-distribution">
                            <div className="distribution-header">Delay Distribution</div>
                            <table className="distribution-table">
                                <tbody>
                                    <tr>
                                        <td>68%</td>
                                        <td>{getDelayDistribution().sigma1.min} - {getDelayDistribution().sigma1.max}ms</td>
                                    </tr>
                                    <tr>
                                        <td>95%</td>
                                        <td>{getDelayDistribution().sigma2.min} - {getDelayDistribution().sigma2.max}ms</td>
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
                            {loading ? 'Stopping...' : 'Stop'}
                        </button>
                    ) : (
                        <button
                            type="submit"
                            disabled={loading || !gameDetected || !gameInitialized}
                            className="submit-btn"
                        >
                            {loading ? 'Starting...' : !gameDetected ? 'Waiting...' : 'Start'}
                        </button>
                    )}

                    {botRunning && (
                        <div className="bot-status running">
                            Bot running...
                        </div>
                    )}
                </form>
            )}

            {activeTab === 'stats' && (
                <div className="stats-section">
                    <div className="stats-header">
                        <h2>Stats</h2>
                        <button onClick={resetStats} className="reset-btn">Reset</button>
                    </div>

                    {/* Progress bar */}
                    <div className="progress-section">
                        <div className="progress-header">
                            <span>Progress</span>
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
                            <span className="stat-label">Net:</span>
                            <span className="stat-value">${stats.netProfit.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="error-message">
                    {error}
                </div>
            )}

            {lastResponse && DEBUG && (
                <div className="response-box">
                    <h3>Debug Response</h3>
                    <pre>{JSON.stringify(lastResponse, null, 2)}</pre>
                </div>
            )}
        </div>
    );
}

export default Popup;
