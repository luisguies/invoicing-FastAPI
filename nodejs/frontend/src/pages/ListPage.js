import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import LoadList from '../components/LoadList';
import InvoiceRules from '../components/InvoiceRules';
import GenerateInvoiceButton from '../components/GenerateInvoiceButton';
import { getLoadsGrouped, deleteLoad, generateInvoice, getDispatchers } from '../services/api';
import './ListPage.css';

const ListPage = () => {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedRule, setSelectedRule] = useState(null);
  const [includeUnconfirmed, setIncludeUnconfirmed] = useState(true);
  const [dispatchers, setDispatchers] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
    loadDispatchers();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Loads page: only show loads that have NOT been invoiced
      const data = await getLoadsGrouped({ invoiced: 'false' });
      setGroups(data);
    } catch (error) {
      alert('Failed to load loads: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const loadDispatchers = async () => {
    try {
      const data = await getDispatchers();
      setDispatchers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load dispatchers:', error);
    }
  };

  const handleLoadUpdate = (updatedLoad, options = {}) => {
    // For most updates we refresh to re-group/re-sort.
    // For driver assignment we keep the row in place until user refreshes.
    if (options.refresh) {
      loadData();
      return;
    }

    // If load is marked as invoiced, remove it from the list (invoiced loads should only appear in Invoiced Loads page)
    if (updatedLoad?.invoiced === true) {
      setGroups((prevGroups) => {
        return prevGroups.map((group) => {
          if (!group?.loads) return group;
          const filteredLoads = group.loads.filter((l) => l._id !== updatedLoad._id);
          if (filteredLoads.length === 0 && group.loads.length > 0) {
            // If this was the last load in the group, return null to filter it out
            return null;
          }
          return { ...group, loads: filteredLoads };
        }).filter(Boolean); // Remove null groups
      });
      return;
    }

    setGroups((prevGroups) => {
      if (!updatedLoad?._id) return prevGroups;

      return prevGroups.map((group) => {
        if (!group?.loads) return group;
        const idx = group.loads.findIndex((l) => l._id === updatedLoad._id);
        if (idx === -1) return group;

        const nextLoads = [...group.loads];
        nextLoads[idx] = updatedLoad;
        return { ...group, loads: nextLoads };
      });
    });
  };

  const subDispatchers = dispatchers.filter((d) => d.parent_id);

  const handleLoadDelete = async (loadId) => {
    if (!window.confirm('Are you sure you want to delete this load?')) {
      return;
    }
    try {
      await deleteLoad(loadId);
      loadData();
    } catch (error) {
      alert('Failed to delete load: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleGenerateInvoice = async () => {
    setGenerating(true);
    try {
      const invoiceData = {
        includeUnconfirmed
      };

      // Use rule if selected, otherwise use all non-cancelled loads
      if (selectedRule) {
        invoiceData.rule_id = selectedRule._id;
      } else {
        // Collect all non-cancelled load IDs
        const loadIds = [];
        groups.forEach(group => {
          group.loads.forEach(load => {
            if (!load.cancelled) {
              loadIds.push(load._id);
            }
          });
        });

        if (loadIds.length === 0) {
          alert('No loads available to generate invoice');
          return;
        }
        invoiceData.load_ids = loadIds;
      }

      const result = await generateInvoice(invoiceData);

      if (result.success) {
        const count = typeof result.count === 'number'
          ? result.count
          : (Array.isArray(result.invoices) ? result.invoices.length : 1);
        alert(count === 1 ? 'Invoice generated successfully!' : `Generated ${count} invoices successfully!`);
        navigate('/print');
      }
    } catch (error) {
      alert('Failed to generate invoice: ' + (error.response?.data?.error || error.message));
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading loads...</div>;
  }

  return (
    <div className="list-page">
      <div className="page-header">
        <h2>Loads</h2>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button onClick={() => navigate('/loads/new')} className="refresh-btn">
            Create Load
          </button>
          <button onClick={loadData} className="refresh-btn">Refresh</button>
        </div>
      </div>

      <InvoiceRules onRuleSelect={setSelectedRule} />

      <LoadList
        groups={groups}
        onLoadUpdate={handleLoadUpdate}
        onLoadDelete={handleLoadDelete}
        subDispatchers={subDispatchers}
      />

      <GenerateInvoiceButton
        onClick={handleGenerateInvoice}
        disabled={groups.length === 0}
        generating={generating}
        selectedRule={selectedRule}
        onClearRule={() => setSelectedRule(null)}
        includeUnconfirmed={includeUnconfirmed}
        onToggleIncludeUnconfirmed={setIncludeUnconfirmed}
      />
    </div>
  );
};

export default ListPage;

