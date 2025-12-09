import { useState, useEffect } from 'react';
import { sendToBackground, MessageTypes, loadStats, saveStats } from '../utils/messaging';
import StrategyEditor from '../components/StrategyEditor';
import './Popup.css';

// main popup component
function Popup() {
  // form state
  const [betSize, setBetSize] = useState('10');
  const [targetWager, setTargetWager] = useState('100');
  const [useDelays, setUseDelays] = useState(true);
  const [actionDelay, setActionDelay] = useState('500');
  const [strategy, setStrategy] = useState('basic');
  const [autoRefresh, setAutoRefresh] = useState(false);

  // ui state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastResponse, setLastResponse] = useState(null);
  const [activeTab, setActiveTab] = useState('settings');

  // stats - will track wins/losses
  const [stats, setStats] = useState({
    wins: 0,
    losses: 0,
    pushes: 0,
    totalGames: 0,
    totalWagered: 0,
    netProfit: 0
  });

  // load saved stuff when popup opens
  useEffect(() => {
    // get stats
    loadStats().then(s => {
      setStats(s);
    });

    // get settings
    chrome.storage.local.get(['betSize', 'targetWager', 'actionDelay', 'strategy'], (result) => {
      if (result.betSize) setBetSize(result.betSize);
      if (result.targetWager) setTargetWager(result.targetWager);
      if (result.actionDelay) setActionDelay(result.actionDelay);
      if (result.strategy) setStrategy(result.strategy);
    });
  }, []);

  // when user clicks start
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // save for next time
    chrome.storage.local.set({
      betSize,
      targetWager,
      actionDelay,
      strategy
    });

    try {
      const response = await sendToBackground(MessageTypes.START_GAME, {
        betSize: parseFloat(betSize),
        targetWager: parseFloat(targetWager),
        useDelays,
        actionDelay: parseInt(actionDelay),
        strategy,
        autoRefresh
      });

      if (response.success) {
        console.log("started!");
        setLastResponse(response.data);
        // reload stats after playing
        loadStats().then(s => setStats(s));
      } else {
        setError(response.error || 'something went wrong');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // clear stats
  const resetStats = async () => {
    const empty = {
      wins: 0,
      losses: 0,
      pushes: 0,
      totalGames: 0,
      totalWagered: 0,
      netProfit: 0
    };
    setStats(empty);
    await saveStats(empty);
    setLastResponse(null);
  };

  return (
    <div className="popup-container">
      <h1>Blackjack Helper</h1>
      <p style={{fontSize: '10px', color: '#888'}}>v0.1 - ohm's build</p>

      {/* tabs */}
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

      {/* settings tab */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSubmit} className="game-form">
          <h2>Game Settings</h2>

          <div className="form-group">
            <label htmlFor="betSize">Bet Size ($)</label>
            <input
              id="betSize"
              type="number"
              min="1"
              step="0.01"
              value={betSize}
              onChange={(e) => setBetSize(e.target.value)}
              disabled={loading}
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
              disabled={loading}
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
              step="100"
              value={actionDelay}
              onChange={(e) => setActionDelay(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={useDelays}
                onChange={(e) => setUseDelays(e.target.checked)}
                disabled={loading}
              />
              Use Delays
            </label>
          </div>

          {/* TODO: add auto-refresh option */}

          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Running...' : 'Start (simulated)'}
          </button>

          <p style={{fontSize: '10px', color: '#f80', marginTop: '10px'}}>
            Note: real game connection not implemented yet
          </p>
        </form>
      )}

      {/* strategy tab */}
      {activeTab === 'strategy' && (
        <StrategyEditor
          onStrategyChange={(newStrat) => {
            chrome.storage.local.set({ customStrategy: newStrat });
            console.log('strategy saved');
          }}
        />
      )}

      {/* stats tab */}
      {activeTab === 'stats' && (
        <div className="stats-section">
          <div className="stats-header">
            <h2>Statistics</h2>
            <button onClick={resetStats} className="reset-btn">Reset</button>
          </div>

          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Games:</span>
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
              <span className="stat-label">Profit:</span>
              <span className="stat-value">${stats.netProfit.toFixed(2)}</span>
            </div>
          </div>

          <p style={{fontSize: '10px', color: '#888', marginTop: '10px'}}>
            (these are simulated results)
          </p>
        </div>
      )}

      {/* error display */}
      {error && (
        <div className="error-message">
          Error: {error}
        </div>
      )}

      {/* show last response for debugging */}
      {lastResponse && (
        <div className="response-box">
          <h3>Response</h3>
          <pre>{JSON.stringify(lastResponse, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default Popup;
