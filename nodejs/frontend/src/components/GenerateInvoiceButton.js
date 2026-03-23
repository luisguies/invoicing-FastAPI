import React from 'react';
import './GenerateInvoiceButton.css';

const GenerateInvoiceButton = ({ 
  onClick, 
  disabled, 
  generating, 
  selectedRule,
  onClearRule,
  includeUnconfirmed,
  onToggleIncludeUnconfirmed
}) => {
  return (
    <div className="generate-invoice-section">
      {selectedRule && (
        <div className="selected-rule-info">
          <span><strong>Using Rule:</strong> {selectedRule.rule_name}</span>
          {onClearRule && (
            <button onClick={onClearRule} className="clear-rule-btn">
              Clear Rule
            </button>
          )}
        </div>
      )}
      <label className="include-unconfirmed-toggle">
        <input
          type="checkbox"
          checked={!!includeUnconfirmed}
          onChange={(e) => onToggleIncludeUnconfirmed && onToggleIncludeUnconfirmed(e.target.checked)}
          disabled={generating}
        />
        Include unconfirmed loads
      </label>
      <button
        className="generate-invoice-btn"
        onClick={onClick}
        disabled={disabled || generating}
      >
        {generating ? (
          <>
            <span className="spinner-small"></span>
            Generating Invoice...
          </>
        ) : (
          'Generate Invoices'
        )}
      </button>
      <p className="generate-hint">
        {includeUnconfirmed
          ? 'Only non-cancelled loads will be included in the invoice.'
          : 'Only non-cancelled, confirmed loads will be included in the invoice.'}
      </p>
    </div>
  );
};

export default GenerateInvoiceButton;

