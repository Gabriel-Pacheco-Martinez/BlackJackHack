import { useState, useEffect } from 'react';
import './StrategyEditor.css';

const DEALER_CARDS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
const PLAYER_HANDS = [
  '5-7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17+',
  'A,2', 'A,3', 'A,4', 'A,5', 'A,6', 'A,7', 'A,8', 'A,9',
  '2,2', '3,3', '4,4', '5,5', '6,6', '7,7', '8,8', '9,9', '10,10', 'A,A'
];

const ACTIONS = {
  'H': { label: 'H', color: '#4ade80', description: 'Hit' },
  'S': { label: 'S', color: '#f87171', description: 'Stand' },
  'D': { label: 'D', color: '#60a5fa', description: 'Double/Hit' },
  'Ds': { label: 'Ds', color: '#67e8f9', description: 'Double/Stand' },
  'P': { label: 'P', color: '#ffffff', description: 'Split' },
  'H*': { label: 'H*', color: '#fde047', description: 'Hit 2, Stand 3+' }
};

function StrategyEditor({ onStrategyChange }) {
  const [strategy, setStrategy] = useState({});
  const [selectedAction, setSelectedAction] = useState('H');
  const [hoveredCell, setHoveredCell] = useState(null);
  const [strategyType, setStrategyType] = useState('basic');
  const [testHand, setTestHand] = useState({ player: '16', dealer: '10' });
  const [analysisResult, setAnalysisResult] = useState(null);

  // Load default strategy on mount
  useEffect(() => {
    loadDefaultStrategy();
  }, []);

  const loadDefaultStrategy = async () => {
    try {
      const response = await fetch(chrome.runtime.getURL('strategy.json'));
      const strategyData = await response.json();

      // Convert to editor format
      const editorFormat = {};
      PLAYER_HANDS.forEach(hand => {
        editorFormat[hand] = {};
        DEALER_CARDS.forEach(dealer => {
          const dealerKey = dealer === 'A' ? '1/11' : dealer;
          const handKey = convertHandToKey(hand);

          if (strategyData[dealerKey] && strategyData[dealerKey][handKey]) {
            const action = strategyData[dealerKey][handKey];
            editorFormat[hand][dealer] = convertActionToEditor(action);
          } else {
            editorFormat[hand][dealer] = 'H'; // Default
          }
        });
      });

      setStrategy(editorFormat);
    } catch (error) {
      console.error('Failed to load strategy:', error);
      // Initialize with all Hit
      const defaultStrategy = {};
      PLAYER_HANDS.forEach(hand => {
        defaultStrategy[hand] = {};
        DEALER_CARDS.forEach(dealer => {
          defaultStrategy[hand][dealer] = 'H';
        });
      });
      setStrategy(defaultStrategy);
    }
  };

  const convertHandToKey = (hand) => {
    // Convert display format to strategy.json format
    if (hand === '5-7') return '7';
    if (hand === '17+') return '17';

    // Check for pairs FIRST (before soft hands)
    if (hand.includes(',')) {
      const [first, second] = hand.split(',');

      // A,A is a pair
      if (first === 'A' && second === 'A') return '2/12s';

      // Other pairs (2,2 through 10,10)
      if (first === second) {
        const total = parseInt(first) * 2;
        return `${total}s`;
      }

      // Soft hands (A,2 through A,9)
      if (first === 'A') {
        const secondVal = parseInt(second);
        const soft = secondVal + 1;
        const hard = soft + 10;
        return `${soft}/${hard}`;
      }
    }

    return hand;
  };

  const convertActionToEditor = (action) => {
    if (action === 'DoubleStand') return 'Ds';
    if (action === 'Double') return 'D';
    if (action === 'Hit') return 'H';
    if (action === 'Stand') return 'S';
    if (action === 'Split') return 'P';
    return 'H';
  };

  const handleCellClick = (hand, dealer) => {
    // Auto-switch to custom when editing
    if (strategyType !== 'custom') {
      setStrategyType('custom');
      console.log('Switched to custom strategy due to edit');
    }

    const newStrategy = { ...strategy };
    if (!newStrategy[hand]) newStrategy[hand] = {};
    newStrategy[hand][dealer] = selectedAction;
    setStrategy(newStrategy);

    // Notify parent component
    if (onStrategyChange) {
      onStrategyChange(convertToGameFormat(newStrategy));
    }
  };

  const convertToGameFormat = (editorStrategy) => {
    // Convert editor format back to game format
    const gameFormat = {};

    DEALER_CARDS.forEach(dealer => {
      const dealerKey = dealer === 'A' ? '1/11' : dealer;
      gameFormat[dealerKey] = {};

      PLAYER_HANDS.forEach(hand => {
        const handKey = convertHandToKey(hand);
        const action = editorStrategy[hand]?.[dealer] || 'H';

        let gameAction = 'Hit';
        if (action === 'H') gameAction = 'Hit';
        else if (action === 'S') gameAction = 'Stand';
        else if (action === 'D') gameAction = 'Double';
        else if (action === 'Ds') gameAction = 'DoubleStand';
        else if (action === 'P') gameAction = 'Split';

        gameFormat[dealerKey][handKey] = gameAction;
      });
    });

    return gameFormat;
  };

  const getCellColor = (hand, dealer) => {
    const action = strategy[hand]?.[dealer];
    return ACTIONS[action]?.color || '#4ade80';
  };

  const getCellLabel = (hand, dealer) => {
    const action = strategy[hand]?.[dealer];
    return ACTIONS[action]?.label || 'H';
  };

  const exportStrategy = () => {
    const gameFormat = convertToGameFormat(strategy);
    const blob = new Blob([JSON.stringify(gameFormat, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'custom-strategy.json';
    a.click();
  };

  const importStrategy = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const importedStrategy = JSON.parse(text);

        // Convert from game format to editor format
        const editorFormat = {};
        PLAYER_HANDS.forEach(hand => {
          editorFormat[hand] = {};
          DEALER_CARDS.forEach(dealer => {
            const dealerKey = dealer === 'A' ? '1/11' : dealer;
            const handKey = convertHandToKey(hand);

            if (importedStrategy[dealerKey] && importedStrategy[dealerKey][handKey]) {
              const action = importedStrategy[dealerKey][handKey];
              editorFormat[hand][dealer] = convertActionToEditor(action);
            } else {
              editorFormat[hand][dealer] = 'H';
            }
          });
        });

        setStrategy(editorFormat);
        setStrategyType('custom');

        // Notify parent component
        if (onStrategyChange) {
          onStrategyChange(importedStrategy);
        }

        console.log('Strategy imported successfully');
      } catch (error) {
        console.error('Failed to import strategy:', error);
        alert('Failed to import strategy. Please check the file format.');
      }
    };
    input.click();
  };

  const testHandAnalysis = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ANALYZE_HAND',
        data: {
          playerHand: testHand.player,
          dealerCard: testHand.dealer,
          strategy: strategyType
        }
      });
      setAnalysisResult(response);
    } catch (error) {
      console.error('Analysis failed:', error);
    }
  };

  const handleStrategyTypeChange = async (newType) => {
    setStrategyType(newType);

    if (newType === 'basic') {
      await loadDefaultStrategy();
    } else if (newType === 'aggressive') {
      await loadAggressiveStrategy();
    } else if (newType === 'conservative') {
      await loadConservativeStrategy();
    } else if (newType === 'custom') {
      // Keep current edits
      console.log('Using custom strategy');
    }
  };

  const loadAggressiveStrategy = async () => {
    // Aggressive strategy - more doubles and splits
    const aggressiveStrategy = {};
    PLAYER_HANDS.forEach(hand => {
      aggressiveStrategy[hand] = {};
      DEALER_CARDS.forEach(dealer => {
        // More aggressive doubling on 9, 10, 11
        if (hand === '9' && ['3', '4', '5', '6'].includes(dealer)) {
          aggressiveStrategy[hand][dealer] = 'D';
        } else if (hand === '10' || hand === '11') {
          if (dealer !== 'A') {
            aggressiveStrategy[hand][dealer] = 'D';
          } else {
            aggressiveStrategy[hand][dealer] = 'H';
          }
        } else if (hand.includes(',') && !['5,5', '10,10'].includes(hand)) {
          // Split more pairs
          aggressiveStrategy[hand][dealer] = 'P';
        } else {
          // Default to basic for other hands
          aggressiveStrategy[hand][dealer] = getBasicAction(hand, dealer);
        }
      });
    });
    setStrategy(aggressiveStrategy);
  };

  const loadConservativeStrategy = async () => {
    // Conservative strategy - less doubling, more standing
    const conservativeStrategy = {};
    PLAYER_HANDS.forEach(hand => {
      conservativeStrategy[hand] = {};
      DEALER_CARDS.forEach(dealer => {
        const handValue = parseInt(hand) || 0;

        if (handValue >= 12 && handValue <= 16) {
          // Stand more often against low dealer cards
          if (['2', '3', '4', '5', '6'].includes(dealer)) {
            conservativeStrategy[hand][dealer] = 'S';
          } else {
            conservativeStrategy[hand][dealer] = 'H';
          }
        } else if (handValue >= 17) {
          conservativeStrategy[hand][dealer] = 'S';
        } else {
          // Default to basic for other situations
          conservativeStrategy[hand][dealer] = getBasicAction(hand, dealer);
        }
      });
    });
    setStrategy(conservativeStrategy);
  };

  const getBasicAction = (hand, dealer) => {
    // Simplified basic strategy logic
    const handValue = parseInt(hand) || 0;

    if (handValue <= 8) return 'H';
    if (handValue >= 17) return 'S';
    if (handValue === 11) return dealer === 'A' ? 'H' : 'D';
    if (handValue === 10) return ['10', 'A'].includes(dealer) ? 'H' : 'D';
    if (handValue === 9) return ['3', '4', '5', '6'].includes(dealer) ? 'D' : 'H';

    // 12-16
    if (['2', '3', '4', '5', '6'].includes(dealer)) {
      return handValue === 12 && ['2', '3'].includes(dealer) ? 'H' : 'S';
    }
    return 'H';
  };

  return (
    <div className="strategy-editor">
      <h3>Strategy Configuration & Editor</h3>

      {/* Strategy Type Selector */}
      <div className="strategy-type-selector">
        <label>Strategy Type:</label>
        <select
          value={strategyType}
          onChange={(e) => handleStrategyTypeChange(e.target.value)}
          className="strategy-select"
        >
          <option value="basic">Basic Strategy</option>
          <option value="aggressive">Aggressive</option>
          <option value="conservative">Conservative</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {/* Hand Analysis Tester */}
      <div className="hand-tester">
        <div className="test-inputs">
          <input
            type="text"
            value={testHand.player}
            onChange={(e) => setTestHand({...testHand, player: e.target.value})}
            placeholder="Hand (e.g. 16)"
            className="test-input"
          />
          <span>vs</span>
          <input
            type="text"
            value={testHand.dealer}
            onChange={(e) => setTestHand({...testHand, dealer: e.target.value})}
            placeholder="Dealer (e.g. 10)"
            className="test-input"
          />
          <button onClick={testHandAnalysis} className="test-btn">
            Analyze
          </button>
        </div>
        {analysisResult && (
          <div className="analysis-result">
            Action: <strong>{analysisResult.action}</strong> - {analysisResult.reason}
          </div>
        )}
      </div>

      <div className="action-selector">
        <span>Select Action:</span>
        {Object.entries(ACTIONS).map(([key, action]) => (
          <button
            key={key}
            className={`action-btn ${selectedAction === key ? 'selected' : ''}`}
            style={{ backgroundColor: action.color }}
            onClick={() => setSelectedAction(key)}
            title={action.description}
          >
            {action.label}
          </button>
        ))}
      </div>

      <div className="strategy-table-container">
        <table className="strategy-table">
          <thead>
            <tr>
              <th className="hand-header">Your Hand</th>
              <th colSpan={10} className="dealer-header">Dealer's Face-up Card</th>
            </tr>
            <tr>
              <th></th>
              {DEALER_CARDS.map(card => (
                <th key={card} className="dealer-card">{card}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLAYER_HANDS.map((hand, idx) => (
              <tr key={hand} className={idx === 11 ? 'section-divider' : idx === 19 ? 'section-divider' : ''}>
                <td className="hand-label">{hand}</td>
                {DEALER_CARDS.map(dealer => (
                  <td
                    key={`${hand}-${dealer}`}
                    className="strategy-cell"
                    style={{ backgroundColor: getCellColor(hand, dealer) }}
                    onClick={() => handleCellClick(hand, dealer)}
                    onMouseEnter={() => setHoveredCell(`${hand}-${dealer}`)}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    {getCellLabel(hand, dealer)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="strategy-legend">
        {Object.entries(ACTIONS).map(([key, action]) => (
          <div key={key} className="legend-item">
            <span
              className="legend-color"
              style={{ backgroundColor: action.color }}
            >
              {action.label}
            </span>
            <span className="legend-desc">{action.description}</span>
          </div>
        ))}
      </div>

      <div className="strategy-actions">
        <button onClick={loadDefaultStrategy} className="reset-strategy-btn">
          Reset
        </button>
        <button onClick={importStrategy} className="import-strategy-btn">
          Import
        </button>
        <button onClick={exportStrategy} className="export-strategy-btn">
          Export
        </button>
      </div>

      {hoveredCell && (
        <div className="tooltip">
          Cell: {hoveredCell}
        </div>
      )}
    </div>
  );
}

export default StrategyEditor;
