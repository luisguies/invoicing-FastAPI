import React, { useState, useEffect } from 'react';
import { getLoadsGrouped, getDrivers } from '../services/api';
import { formatDate } from '../utils/dateUtils';
import './CalendarPage.css';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Generate a color for a driver based on their ID
const getDriverColor = (driverId, driverName) => {
  if (!driverId) return '#cccccc'; // Gray for unassigned
  
  // Generate a consistent color based on driver ID
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52BE80',
    '#EC7063', '#5DADE2', '#58D68D', '#F4D03F', '#AF7AC5',
    '#85C1E9', '#F1948A', '#73C6B6', '#F9E79F', '#A569BD'
  ];
  
  // Use driver ID to consistently assign a color
  const hash = driverId.toString().split('').reduce((acc, char) => {
    return acc + char.charCodeAt(0);
  }, 0);
  
  return colors[hash % colors.length];
};

const CalendarPage = () => {
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [driverColors, setDriverColors] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load drivers and loads in parallel (calendar shows both invoiced and non-invoiced loads)
      const [groups, drivers] = await Promise.all([getLoadsGrouped(), getDrivers()]);
      
      // Flatten groups into a single array of loads
      const allLoads = [];
      groups.forEach(group => {
        if (group.loads && Array.isArray(group.loads)) {
          group.loads.forEach(load => {
            if (!load.cancelled) {
              allLoads.push(load);
            }
          });
        }
      });
      
      setLoads(allLoads);
      
      // Build driver color map - use stored colors from drivers, fallback to auto-generated
      const colorMap = {};
      const driverColorMap = {};
      
      // Create a map of driver IDs to their stored colors
      drivers.forEach(driver => {
        if (driver._id && driver.color) {
          driverColorMap[driver._id] = driver.color;
        }
      });
      
      // Build color map for all drivers in loads
      allLoads.forEach(load => {
        if (load.driver_id) {
          const driverId = typeof load.driver_id === 'object' ? load.driver_id._id : load.driver_id;
          const driverName = typeof load.driver_id === 'object' ? load.driver_id.name : 'Unknown';
          if (!colorMap[driverId]) {
            // Use stored color if available, otherwise generate one
            colorMap[driverId] = driverColorMap[driverId] || getDriverColor(driverId, driverName);
          }
        }
      });
      setDriverColors(colorMap);
    } catch (error) {
      alert('Failed to load loads: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const daysInMonth = lastDay.getUTCDate();
    const startingDayOfWeek = firstDay.getUTCDay();
    
    return { daysInMonth, startingDayOfWeek, year, month };
  };

  const getLoadsForDate = (date) => {
    return loads.filter(load => {
      if (!load.pickup_date || !load.delivery_date) return false;
      
      // Parse everything as UTC for consistent comparison
      const pickupStr = load.pickup_date.split('T')[0];
      const deliveryStr = load.delivery_date.split('T')[0];
      const [pY, pM, pD] = pickupStr.split('-').map(Number);
      const [dY, dM, dD] = deliveryStr.split('-').map(Number);
      
      const pickup = new Date(Date.UTC(pY, pM - 1, pD));
      const delivery = new Date(Date.UTC(dY, dM - 1, dD));
      
      // Create UTC date for the check date
      const checkDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      
      return checkDate >= pickup && checkDate <= delivery;
    });
  };

  const getLoadSpanInfo = (load) => {
    // Parse everything as UTC to avoid timezone issues
    const pickupStr = load.pickup_date.split('T')[0];
    const deliveryStr = load.delivery_date.split('T')[0];
    
    const [pY, pM, pD] = pickupStr.split('-').map(Number);
    const [dY, dM, dD] = deliveryStr.split('-').map(Number);
    const pickup = new Date(Date.UTC(pY, pM - 1, pD));
    const delivery = new Date(Date.UTC(dY, dM - 1, dD));
    
    const { year, month, startingDayOfWeek } = getDaysInMonth(currentDate);
    const firstDay = new Date(Date.UTC(year, month, 1));
    const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0));
    
    // Calculate load start and end relative to month start
    const loadStart = pickup >= firstDay ? pickup : firstDay;
    const loadEnd = delivery <= lastDayOfMonth ? delivery : lastDayOfMonth;
    
    // Calculate which day of the calendar grid (including empty cells at start)
    const loadStartDay = Math.floor((loadStart - firstDay) / (1000 * 60 * 60 * 24));
    const loadEndDay = Math.floor((loadEnd - firstDay) / (1000 * 60 * 60 * 24));
    
    // Calculate grid position (including empty cells)
    const gridStart = startingDayOfWeek + loadStartDay;
    const gridEnd = startingDayOfWeek + loadEndDay;
    const spanDays = gridEnd - gridStart + 1;
    
    // Check if pickup/delivery are within the visible month
    const pickupInMonth = pickup >= firstDay && pickup <= lastDayOfMonth;
    const deliveryInMonth = delivery >= firstDay && delivery <= lastDayOfMonth;
    const pickupBeforeMonth = pickup < firstDay;
    const deliveryAfterMonth = delivery > lastDayOfMonth;
    
    return { 
      gridStart, 
      gridEnd, 
      spanDays, 
      loadStartDay, 
      loadEndDay,
      isVisible: loadEnd >= firstDay && loadStart <= lastDayOfMonth,
      loadStartDate: loadStart,
      loadEndDate: loadEnd,
      pickupDate: pickup,
      deliveryDate: delivery,
      pickupInMonth,
      deliveryInMonth,
      pickupBeforeMonth,
      deliveryAfterMonth
    };
  };

  const getLoadWeekSegments = (spanInfo) => {
    const startWeekRow = Math.floor(spanInfo.gridStart / 7);
    const endWeekRow = Math.floor(spanInfo.gridEnd / 7);
    const segments = [];

    const isSameDay =
      spanInfo.pickupInMonth &&
      spanInfo.deliveryInMonth &&
      spanInfo.pickupDate.getTime() === spanInfo.deliveryDate.getTime();

    for (let weekRow = startWeekRow; weekRow <= endWeekRow; weekRow += 1) {
      const weekStartGrid = weekRow * 7;
      const weekEndGrid = weekStartGrid + 6;

      const segGridStart = Math.max(spanInfo.gridStart, weekStartGrid);
      const segGridEnd = Math.min(spanInfo.gridEnd, weekEndGrid);

      const startCol = segGridStart % 7;
      const endCol = segGridEnd % 7;
      const dayCount = endCol - startCol + 1;

      const isFirstSegment = weekRow === startWeekRow;
      const isLastSegment = weekRow === endWeekRow;

      // Only clip on pickup day if pickup is the first visible day of the load.
      const clipStartHalf =
        !isSameDay &&
        isFirstSegment &&
        spanInfo.pickupInMonth &&
        spanInfo.pickupDate.getTime() === spanInfo.loadStartDate.getTime();

      // Only clip on delivery day if delivery is the last visible day of the load.
      const clipEndHalf =
        !isSameDay &&
        isLastSegment &&
        spanInfo.deliveryInMonth &&
        spanInfo.deliveryDate.getTime() === spanInfo.loadEndDate.getTime();

      let clipPath = null;
      if (clipStartHalf || clipEndHalf) {
        const dayPortionPercent = 100 / dayCount;
        const startX = clipStartHalf ? 0.5 * dayPortionPercent : 0;
        const endX = clipEndHalf ? 100 - 0.5 * dayPortionPercent : 100;
        clipPath = `polygon(${startX}% 0%, ${endX}% 0%, ${endX}% 100%, ${startX}% 100%)`;
      }

      const centerGrid = spanInfo.gridStart + Math.floor((spanInfo.spanDays - 1) / 2);
      const isCenterSegment = centerGrid >= segGridStart && centerGrid <= segGridEnd;

      segments.push({
        weekRow,
        startCol,
        dayCount,
        isFirstSegment,
        isCenterSegment,
        clipPath
      });
    }

    return segments;
  };

  const navigateMonth = (direction) => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + direction);
      return newDate;
    });
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  if (loading) {
    return <div className="loading">Loading calendar...</div>;
  }

  const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentDate);
  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const days = [];
  
  // Add empty cells for days before the first day of the month
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null);
  }
  
  // Add cells for each day of the month (using UTC to match load dates)
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(Date.UTC(year, month, day)));
  }

  // Pad trailing cells so the last week is complete (helps overlay math).
  while (days.length % 7 !== 0) {
    days.push(null);
  }
  
  // Visible loads in this month view
  const visibleLoads = loads.filter(load => {
    if (!load.pickup_date || !load.delivery_date) return false;
    const spanInfo = getLoadSpanInfo(load);
    return spanInfo.isVisible;
  });

  // Build driver rows (one row per driver across the calendar, per week).
  const driverRowMap = new Map(); // key -> { id, key, name, color }
  let hasUnassigned = false;
  visibleLoads.forEach(load => {
    if (!load.driver_id) {
      hasUnassigned = true;
      return;
    }
    const driverId = typeof load.driver_id === 'object' ? load.driver_id._id : load.driver_id;
    const driverName = typeof load.driver_id === 'object' ? load.driver_id.name : 'Unknown';
    if (!driverRowMap.has(driverId)) {
      driverRowMap.set(driverId, {
        id: driverId,
        key: driverId,
        name: driverName,
        color: driverColors[driverId] || getDriverColor(driverId, driverName)
      });
    }
  });

  const driverRows = Array.from(driverRowMap.values()).sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
  );
  if (hasUnassigned) {
    driverRows.push({ id: null, key: 'unassigned', name: 'Unassigned', color: '#cccccc' });
  }

  const driverIndexByKey = new Map(driverRows.map((d, idx) => [d.key, idx]));
  const rowCount = driverRows.length;

  // Layout sizing for "rows per driver" inside each day cell/week.
  const dayNumberHeight = 25;
  const topOffset = 5;
  const laneHeight = 22; // 20px bar + 2px gap
  const baseDayHeight = 45; // space for date + padding
  const dynamicDayHeight = Math.max(120, baseDayHeight + rowCount * laneHeight + topOffset);

  return (
    <div className="calendar-page">
      <div className="calendar-header">
        <h2>Load Calendar</h2>
        <div className="calendar-controls">
          <button onClick={() => navigateMonth(-1)} className="nav-btn">‹ Previous</button>
          <button onClick={goToToday} className="today-btn">Today</button>
          <button onClick={() => navigateMonth(1)} className="nav-btn">Next ›</button>
          <button onClick={loadData} className="refresh-btn">Refresh</button>
        </div>
      </div>

      <div className="calendar-month-header">
        <h3>{monthName}</h3>
      </div>

      <div className="calendar-legend">
        <h4>Drivers:</h4>
        <div className="legend-items">
          {driverRows.map(driver => (
            <div key={driver.id || 'unassigned'} className="legend-item">
              <span 
                className="legend-color" 
                style={{ backgroundColor: driver.color }}
              ></span>
              <span className="legend-name">{driver.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="calendar-grid">
        <div className="calendar-weekdays">
          <div className="weekday">Sun</div>
          <div className="weekday">Mon</div>
          <div className="weekday">Tue</div>
          <div className="weekday">Wed</div>
          <div className="weekday">Thu</div>
          <div className="weekday">Fri</div>
          <div className="weekday">Sat</div>
        </div>
        
        <div className="calendar-days">
          {days.map((date, index) => {
            if (!date) {
              return <div key={`empty-${index}`} className="calendar-day empty"></div>;
            }
            
            const today = new Date();
            const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
            const isToday = date.getTime() === todayUTC.getTime();
            
            return (
              <div 
                key={date.toISOString()} 
                className={`calendar-day ${isToday ? 'today' : ''}`}
                style={{ minHeight: `${dynamicDayHeight}px` }}
              >
                <div className="day-number">{date.getUTCDate()}</div>
                <div className="day-loads">
                  <div className="day-divider"></div>
                </div>
              </div>
            );
          })}

          {/* Driver row labels: overlay over the bars for each row (full row width, on top) */}
          {(() => {
            const weekCount = Math.ceil(days.length / 7);
            const labels = [];

            for (let weekRow = 0; weekRow < weekCount; weekRow += 1) {
              for (let rowIdx = 0; rowIdx < driverRows.length; rowIdx += 1) {
                const driver = driverRows[rowIdx];
                const topPx =
                  weekRow * dynamicDayHeight +
                  dayNumberHeight +
                  topOffset +
                  rowIdx * laneHeight;

                labels.push(
                  <div
                    key={`driver-label-${weekRow}-${driver.key}`}
                    className="driver-row-label"
                    style={{
                      position: 'absolute',
                      left: '0%',
                      width: '100%',
                      top: `${topPx}px`,
                      height: `${laneHeight - 2}px`
                    }}
                    title={driver.name}
                  >
                    {driver.name}
                  </div>
                );
              }
            }

            return labels;
          })()}
          
          {/* Render load bars as week segments so they continue into next week */}
          {visibleLoads.flatMap((load) => {
            const driverId = load.driver_id 
              ? (typeof load.driver_id === 'object' ? load.driver_id._id : load.driver_id)
              : null;
            const driverName = load.driver_id 
              ? (typeof load.driver_id === 'object' ? load.driver_id.name : 'Unknown')
              : 'Unassigned';
            const color = driverId ? driverColors[driverId] : '#cccccc';
            const spanInfo = getLoadSpanInfo(load);
            
            if (!spanInfo.isVisible) return [];

            const driverKey = driverId || 'unassigned';
            const rowIdx = driverIndexByKey.get(driverKey) ?? 0;

            const segments = getLoadWeekSegments(spanInfo).map((seg) => {
              const leftPercent = (seg.startCol / 7) * 100;
              const widthPercent = (seg.dayCount / 7) * 100;
              const topPx =
                seg.weekRow * dynamicDayHeight +
                dayNumberHeight +
                topOffset +
                rowIdx * laneHeight;

              const showLabel = seg.isCenterSegment;

              return (
                <div
                  key={`${load._id}-${seg.weekRow}-${seg.startCol}`}
                  className="load-bar-spanning"
                  style={{
                    position: 'absolute',
                    left: `${leftPercent}%`,
                    width: `${widthPercent}%`,
                    top: `${topPx}px`,
                    backgroundColor: color,
                    zIndex: 10,
                    clipPath: seg.clipPath || 'none'
                  }}
                  title={`${load.load_number} - ${driverName}\n${formatDate(load.pickup_date)} to ${formatDate(load.delivery_date)}\n${load.pickup_city}, ${load.pickup_state} → ${load.delivery_city}, ${load.delivery_state}`}
                >
                  {showLabel && (
                    <span className="load-label">
                      {load.load_number}
                    </span>
                  )}
                </div>
              );
            });

            return segments;
          })}
        </div>
      </div>
    </div>
  );
};

export default CalendarPage;
