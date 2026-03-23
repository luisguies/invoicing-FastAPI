import React, { useCallback, useState } from 'react';
import LoadItem from './LoadItem';
import { getDriversByCarrier } from '../services/api';
import './LoadList.css';

const LoadList = ({ groups, onLoadUpdate, onLoadDelete, subDispatchers = [] }) => {
  const [driversByCarrier, setDriversByCarrier] = useState({});
  const [driversLoadingByCarrier, setDriversLoadingByCarrier] = useState({});

  const ensureDriversLoaded = useCallback(async (carrierId) => {
    if (!carrierId) return;
    if (driversByCarrier[carrierId] || driversLoadingByCarrier[carrierId]) return;

    setDriversLoadingByCarrier((prev) => ({ ...prev, [carrierId]: true }));
    try {
      const drivers = await getDriversByCarrier(carrierId);
      setDriversByCarrier((prev) => ({ ...prev, [carrierId]: Array.isArray(drivers) ? drivers : [] }));
    } catch (error) {
      // Don't block rendering; fall back to UNASSIGNED
      console.error('Failed to load drivers for carrier:', carrierId, error);
      setDriversByCarrier((prev) => ({ ...prev, [carrierId]: [] }));
    } finally {
      setDriversLoadingByCarrier((prev) => ({ ...prev, [carrierId]: false }));
    }
  }, [driversByCarrier, driversLoadingByCarrier]);

  if (!groups || groups.length === 0) {
    return <p className="no-loads">No loads found.</p>;
  }

  return (
    <div className="load-list">
      {groups.map((group) => (
        <div key={group.carrier._id || 'unassigned'} className="carrier-group">
          <h3 className="carrier-name">
            {group.carrier.name}
            {group.carrier.aliases && group.carrier.aliases.length > 0 && (
              <span className="aliases"> ({group.carrier.aliases.join(', ')})</span>
            )}
          </h3>
          <table className="loads-table">
            <thead>
              <tr>
                <th>Load #</th>
                <th>Pickup Date</th>
                <th>Delivery Date</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Amount</th>
                <th>Driver</th>
                <th>Sub-dispatcher</th>
                <th>Carrier</th>
                <th>Invoiced</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {group.loads.map((load) => (
                <LoadItem
                  key={load._id}
                  load={load}
                  onUpdate={onLoadUpdate}
                  onDelete={onLoadDelete}
                  drivers={group?.carrier?._id ? driversByCarrier[group.carrier._id] : []}
                  driversLoading={group?.carrier?._id ? !!driversLoadingByCarrier[group.carrier._id] : false}
                  ensureDriversLoaded={ensureDriversLoaded}
                  subDispatchers={subDispatchers}
                />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

export default LoadList;

