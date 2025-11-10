import React, { useState, useEffect } from 'react';
import './Popup.css';
import { sendToBackground, MessageTypes, saveSettings, loadSettings } from '../utils/messaging';

const Popup = () => {
  const [settings, setSettings] = useState({
    betSize: '10',
    targetWager: '100',
    actionDelay: '500',
    useDelays: true,
    autoRefresh: false,
    strategy: 'basic'
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastResponse, setLastResponse] = useState(null);

  useEffect(() => {
    // Load saved settings on mount
    loadSettings().then(saved => {
      if (saved) {
        setSettings(prev => ({
          ...prev,
          ...saved
        }));
      }
    });
  }, []);

  const handleSettingsChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;

    setSettings(prev => ({
      ...prev,
      [name]: newValue
    }));

    // Save settings to storage
    const updatedSettings = {
      ...settings,
      [name]: newValue
    };
    saveSettings(updatedSettings);
  };

  const handleStartGame = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setLastResponse(null);

    try {
      const response = await sendToBackground(MessageTypes.START_GAME, {
        betSize: parseFloat(settings.betSize),
        targetWager: parseFloat(settings.targetWager),
        useDelays: settings.useDelays,
        actionDelay: parseInt(settings.actionDelay),
        strategy: settings.strategy,
        autoRefresh: settings.autoRefresh
      });

      if (response.success) {
        setLastResponse(response);
      } else {
        setError(response.error || 'Game initialization failed');
      }
    } catch (err) {
      setError(err.message || 'Failed to start game');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="popup">
      <header className="header">
        <h1>🃏 Blackjack Helper v0.1</h1>
        <div className="subtitle">Settings Management - F010</div>
      </header>

      <main className="content">
        <form onSubmit={handleStartGame} className="settings-form">
          <div className="form-group">
            <label htmlFor="betSize">
              Bet Size ($)
            </label>
            <input
              type="number"
              id="betSize"
              name="betSize"
              value={settings.betSize}
              onChange={handleSettingsChange}
              min="1"
              step="0.01"
              required
              disabled={isLoading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="targetWager">
              Target Wager ($)
            </label>
            <input
              type="number"
              id="targetWager"
              name="targetWager"
              value={settings.targetWager}
              onChange={handleSettingsChange}
              min="1"
              step="0.01"
              required
              disabled={isLoading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="actionDelay">
              Action Delay (ms)
            </label>
            <input
              type="number"
              id="actionDelay"
              name="actionDelay"
              value={settings.actionDelay}
              onChange={handleSettingsChange}
              min="0"
              max="5000"
              step="100"
              required
              disabled={isLoading}
            />
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                name="useDelays"
                checked={settings.useDelays}
                onChange={handleSettingsChange}
                disabled={isLoading}
              />
              <span>Use Random Delays</span>
            </label>
          </div>

          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                name="autoRefresh"
                checked={settings.autoRefresh}
                onChange={handleSettingsChange}
                disabled={isLoading}
              />
              <span>Auto-Refresh After 10 mins</span>
            </label>
          </div>

          <div className="form-group">
            <label htmlFor="strategy">
              Strategy
            </label>
            <select
              id="strategy"
              name="strategy"
              value={settings.strategy}
              onChange={handleSettingsChange}
              disabled={isLoading}
            >
              <option value="basic">Basic</option>
              <option value="aggressive">Aggressive</option>
              <option value="conservative">Conservative</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <button
            type="submit"
            className="start-button"
            disabled={isLoading}
          >
            {isLoading ? 'Starting...' : 'Start Game'}
          </button>
        </form>

        {error && (
          <div className="error-message">
            ⚠️ {error}
          </div>
        )}

        {lastResponse && (
          <div className="response-display">
            <h3>Last Response:</h3>
            <pre>{JSON.stringify(lastResponse, null, 2)}</pre>
          </div>
        )}
      </main>
    </div>
  );
};

export default Popup;