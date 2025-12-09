/*
 * Popup.jsx
 * Working on the game detection UI and connecting to interceptor
 * need to finish the content script integration still
 */

import { useState, useEffect } from 'react';
import { sendMsg, MSG_TYPES, getStats, setStats } from '../utils/messaging';
import StrategyEditor from '../components/StrategyEditor';
import './Popup.css';

const DEFAULT_STATS = {
    wins: 0, losses: 0, pushes: 0,
    totalGames: 0, totalWagered: 0, netProfit: 0
};

const Popup = () => {
    // settings
    const [bet, setBet] = useState('10');
    const [target, setTarget] = useState('100');
    const [delay, setDelay] = useState('0');
    const [stddev, setStddev] = useState('0');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [delayErr, setDelayErr] = useState('');

    // ui
    const [isLoading, setIsLoading] = useState(false);
    const [err, setErr] = useState('');
    const [tab, setTab] = useState('settings');
    const [lastResp, setLastResp] = useState(null);

    // game state
    const [hasGame, setHasGame] = useState(false);
    const [gameReady, setGameReady] = useState(false);
    const [tabId, setTabId] = useState(null);
    const [checking, setChecking] = useState(true);
    const [running, setRunning] = useState(false);

    // stats
    const [stats, setStatsState] = useState(DEFAULT_STATS);

    // check for game on current tab
    const checkGame = async () => {
        try {
            const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!t) return;
            setTabId(t.id);

            if (t.status === 'loading') {
                setHasGame(false);
                setGameReady(false);
                setRunning(false);
                return;
            }

            const key = `gameData_${t.id}`;
            const data = await chrome.storage.local.get([key]);

            if (data[key]) {
                setHasGame(true);
                setGameReady(true);
            } else {
                setHasGame(false);
                setGameReady(false);
                setRunning(false);
            }
        } finally {
            setChecking(false);
        }
    };

    // on mount
    useEffect(() => {
        // load stats
        chrome.storage.local.get(['botStats', 'botRunning']).then(r => {
            if (r.botStats) {
                const s = r.botStats;
                setStatsState({
                    wins: s.handsWon || 0,
                    losses: s.handsLost || 0,
                    pushes: s.handsPushed || 0,
                    totalGames: s.handsPlayed || 0,
                    totalWagered: s.totalWagered || 0,
                    netProfit: (s.totalReturned || 0) - (s.totalWagered || 0)
                });
            }
            if (r.botRunning) setRunning(true);
        });

        // load settings
        chrome.storage.local.get(['betSize', 'targetWager', 'actionDelay', 'delayStdDev'], r => {
            if (r.betSize) setBet(r.betSize);
            if (r.targetWager) setTarget(r.targetWager);
            if (r.actionDelay) setDelay(r.actionDelay);
            if (r.delayStdDev) setStddev(r.delayStdDev);
        });

        checkGame();

        // watch storage changes
        const listener = (changes, area) => {
            if (area !== 'local') return;

            if (tabId && changes[`gameData_${tabId}`]) {
                const v = changes[`gameData_${tabId}`].newValue;
                setHasGame(!!v);
                setGameReady(!!v);
                if (!v) setRunning(false);
            }

            if (changes.botStats?.newValue) {
                const s = changes.botStats.newValue;
                setStatsState({
                    wins: s.handsWon || 0,
                    losses: s.handsLost || 0,
                    pushes: s.handsPushed || 0,
                    totalGames: s.handsPlayed || 0,
                    totalWagered: s.totalWagered || 0,
                    netProfit: (s.totalReturned || 0) - (s.totalWagered || 0)
                });
            }
        };

        chrome.storage.onChanged.addListener(listener);
        const poll = setInterval(checkGame, 2000);

        return () => {
            chrome.storage.onChanged.removeListener(listener);
            clearInterval(poll);
        };
    }, [tabId]);

    // validators
    const validateDelay = (d, s) => {
        const dv = parseInt(d) || 0;
        const sv = parseInt(s) || 0;
        if (dv > 0 && sv > dv / 5) return `stddev max: ${Math.floor(dv / 5)}ms`;
        return '';
    };

    const progress = () => {
        const t = parseFloat(target) || 0;
        return t === 0 ? 0 : Math.min(100, (stats.totalWagered / t) * 100);
    };

    // handlers
    const onDelayChange = v => {
        setDelay(v);
        setDelayErr(validateDelay(v, stddev));
    };

    const onStddevChange = v => {
        setStddev(v);
        setDelayErr(validateDelay(delay, v));
    };

    const onStart = async e => {
        e.preventDefault();
        setErr('');

        const validationErr = validateDelay(delay, stddev);
        if (validationErr) { setErr(validationErr); return; }

        setIsLoading(true);
        chrome.storage.local.set({ betSize: bet, targetWager: target, actionDelay: delay, delayStdDev: stddev });

        try {
            const resp = await sendMsg(MSG_TYPES.START_GAME, {
                betSize: parseFloat(bet),
                targetWager: parseFloat(target),
                actionDelay: parseInt(delay),
                delayStdDev: parseInt(stddev),
                autoRefresh
            });

            if (resp.success) {
                setRunning(true);
                chrome.storage.local.set({ botRunning: true });
                setLastResp(resp.data);
            } else {
                setErr(resp.error || 'failed');
            }
        } catch (e) {
            setErr(e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const onStop = async () => {
        setIsLoading(true);
        try {
            await sendMsg(MSG_TYPES.STOP_GAME);
            setRunning(false);
            await chrome.storage.local.remove(['botStats', 'botRunning']);
            setStatsState(DEFAULT_STATS);
        } catch (e) {
            setErr(e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const onReset = async () => {
        setStatsState(DEFAULT_STATS);
        await setStats(DEFAULT_STATS);
        setLastResp(null);
    };

    // render
    return (
        <div className="popup-container">
            <h1>BJ Helper v0.2</h1>

            {/* status */}
            <div className={`game-status ${hasGame ? 'detected' : 'not-detected'}`}>
                <span>{checking ? '...' : hasGame ? 'OK' : '!'}</span>
                <span>{checking ? 'Checking...' : hasGame ? (gameReady ? 'Ready' : 'Init...') : 'No game'}</span>
            </div>

            {!checking && !hasGame && (
                <div className="warning-message">
                    <p>Go to a blackjack game</p>
                    <small>Will detect automatically</small>
                </div>
            )}

            {/* tabs */}
            <div className="tabs">
                {['settings', 'strategy', 'stats'].map(t => (
                    <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>

            {/* settings tab */}
            {tab === 'settings' && (
                <form onSubmit={onStart} className="game-form">
                    <h2>Settings</h2>

                    <div className="form-group">
                        <label>Bet ($)</label>
                        <input type="number" min="1" step="0.01" value={bet}
                            onChange={e => setBet(e.target.value)} disabled={isLoading || running} required />
                    </div>

                    <div className="form-group">
                        <label>Target ($)</label>
                        <input type="number" min="1" step="0.01" value={target}
                            onChange={e => setTarget(e.target.value)} disabled={isLoading || running} required />
                    </div>

                    <div className="form-group">
                        <label>Delay (ms)</label>
                        <input type="number" min="0" max="5000" step="50" value={delay}
                            onChange={e => onDelayChange(e.target.value)} disabled={isLoading || running} />
                    </div>

                    <div className="form-group">
                        <label>Std Dev (ms)</label>
                        <input type="number" min="0" max="1000" step="10" value={stddev}
                            onChange={e => onStddevChange(e.target.value)} disabled={isLoading || running}
                            className={delayErr ? 'input-error' : ''} />
                    </div>

                    {delayErr && <div className="delay-error">{delayErr}</div>}

                    {running ? (
                        <button type="button" onClick={onStop} disabled={isLoading} className="submit-btn stop-btn">
                            {isLoading ? '...' : 'Stop'}
                        </button>
                    ) : (
                        <button type="submit" disabled={isLoading || !hasGame || !gameReady} className="submit-btn">
                            {isLoading ? '...' : !hasGame ? 'Waiting...' : 'Start'}
                        </button>
                    )}

                    {running && <div className="bot-status running">Running...</div>}
                </form>
            )}

            {/* strategy tab */}
            {tab === 'strategy' && (
                <StrategyEditor onStrategyChange={s => chrome.storage.local.set({ customStrategy: s })} />
            )}

            {/* stats tab */}
            {tab === 'stats' && (
                <div className="stats-section">
                    <div className="stats-header">
                        <h2>Stats</h2>
                        <button onClick={onReset} className="reset-btn">Reset</button>
                    </div>

                    <div className="progress-section">
                        <div className="progress-header">
                            <span>Progress</span>
                            <span>${stats.totalWagered.toFixed(2)} / ${parseFloat(target).toFixed(2)}</span>
                        </div>
                        <div className="progress-bar-container">
                            <div className="progress-bar-fill" style={{ width: `${progress()}%` }} />
                        </div>
                        <div className="progress-percentage">{progress().toFixed(1)}%</div>
                    </div>

                    <div className="stats-grid">
                        <div className="stat-item"><span>Rounds:</span><span>{stats.totalGames}</span></div>
                        <div className="stat-item wins"><span>Wins:</span><span>{stats.wins}</span></div>
                        <div className="stat-item losses"><span>Losses:</span><span>{stats.losses}</span></div>
                        <div className="stat-item"><span>Pushes:</span><span>{stats.pushes}</span></div>
                        <div className="stat-item"><span>Wagered:</span><span>${stats.totalWagered.toFixed(2)}</span></div>
                        <div className={`stat-item ${stats.netProfit >= 0 ? 'profit' : 'loss'}`}>
                            <span>Net:</span><span>${stats.netProfit.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            )}

            {err && <div className="error-message">{err}</div>}

            {lastResp && (
                <div className="response-box">
                    <pre>{JSON.stringify(lastResp, null, 2)}</pre>
                </div>
            )}
        </div>
    );
};

export default Popup;
