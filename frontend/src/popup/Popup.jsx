import { useState, useEffect } from 'react';
import { sendToBackground, MessageTypes, loadStats, saveStats } from '../utils/messaging';
import './Popup.css';

function Popup() {
  const [betSize, setBetSize] = useState('10');
  const [targetWager, setTargetWager] = useState('100');
  const [useDelays, setUseDelays] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastResponse, setLastResponse] = useState(null);
  
  const [stats, setStats] = useState({
    wins: 0,
    losses: 0,
    pushes: 0,
    totalGames: 0,
    totalWagered: 0,
    netProfit: 0
  });

  // Load stats on mount
  useEffect(() => {
    loadStats().then(savedStats => {
      setStats(savedStats);
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const response = await sendToBackground(MessageTypes.START_GAME, {
        betSize: parseFloat(betSize),
        targetWager: parseFloat(targetWager),
        useDelays
      });
      
      if (response.success) {
        setLastResponse(response.data);
        
        // Update stats based on API response
        // This is example logic - adjust based on your API response structure
        const newStats = {
          ...stats,
          totalGames: stats.totalGames + 1,
          totalWagered: stats.totalWagered + parseFloat(betSize)
        };
        
        // Example: if API returns result field
        if (response.data.result === 'win') {
          newStats.wins += 1;
          newStats.netProfit += parseFloat(betSize);
        } else if (response.data.result === 'loss') {
          newStats.losses += 1;
          newStats.netProfit -= parseFloat(betSize);
        } else if (response.data.result === 'push') {
          newStats.pushes += 1;
        }
        
        setStats(newStats);
        await saveStats(newStats);
      } else {
        setError(response.error || 'Unknown error occurred');
      }
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
      <h1>🃏 Blackjack Helper</h1>
      
      <form onSubmit={handleSubmit} className="game-form">
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
        
        <button type="submit" disabled={loading} className="submit-btn">
          {loading ? 'Processing...' : 'Start Game'}
        </button>
      </form>
      
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
      
      <div className="stats-section">
        <div className="stats-header">
          <h2>Statistics</h2>
          <button onClick={resetStats} className="reset-btn">Reset</button>
        </div>
        
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-label">Total Games:</span>
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
            <span className="stat-label">Total Wagered:</span>
            <span className="stat-value">${stats.totalWagered.toFixed(2)}</span>
          </div>
          <div className={`stat-item ${stats.netProfit >= 0 ? 'profit' : 'loss'}`}>
            <span className="stat-label">Net Profit:</span>
            <span className="stat-value">${stats.netProfit.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Popup;