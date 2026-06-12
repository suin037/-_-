/* eslint-disable no-undef */
/* global d3, SEOUL_DATA, state */

/* ─────────────────────────────────────────────────────────────
 * brushing_hyewon.js
 * Paintbrush-style multi-district selection plugin.
 *
 * Chart modes based on selected district count:
 *   0 selected  → dual bar chart for all 25 districts
 *   1 selected  → pie chart (crime composition)
 *   2+ selected → stacked bar chart with baseline-shift "dance"
 * ───────────────────────────────────────────────────────────── */

(function() {

  // ── Constants ──────────────────────────────────────────────
  const LINE_COLORS  = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
  const CRIME_TYPES  = ['murder', 'robbery', 'theft', 'violence', 'rape'];
  const CRIME_LABELS = { murder: 'Murder', robbery: 'Robbery', theft: 'Theft', violence: 'Violence', rape: 'Sexual Assault' };
  const CRIME_COLORS = { murder: '#e63946', robbery: '#f97316', theft: '#eab308', violence: '#06a77d', rape: '#3b82f6' };

  // ── Module state ────────────────────────────────────────────
  let brushedGus    = [];       // Currently selected district names
  let isPainting    = false;    // True while the pointer is held down on the map
  let isDragged     = false;    // True if the pointer moved after pointerdown (drag vs click)
  let currentSortKey = 'total'; // Active sort key for the stacked bar chart

  /**
   * Returns true when the compare-two panel (jiyun mode) is active.
   * In that state, brush interactions are suppressed so clicks are
   * passed through to the district comparison handler instead.
   */
  function isJiyunMode() {
    const btn = document.getElementById('startCompareTwoBtn');
    return btn && btn.classList.contains('selecting');
  }

  /**
   * Initialises the plugin once shared data and the map DOM are ready.
   * Wraps window.selectGu to intercept single-click district selection.
   */
  function initPlugin() {
    const _originalSelectGu = window.selectGu;
    window.selectGu = function(guName) {
      if (isDragged) return; // Ignore if the user was drag-brushing
      if (isJiyunMode()) {
        // Let the comparison plugin handle the click
        if (typeof _originalSelectGu === 'function') _originalSelectGu(guName);
      } else {
        brushedGus = [guName];
        highlightMap();
        updateCharts();
      }
    };

    injectCSS();
    injectUI();
    setupPaintingEvents();

    updateCharts(); // Draw the default all-districts view on load

    // Re-sync highlight and charts whenever the map SVG is re-rendered
    const observer = new MutationObserver(() => {
      if (!isJiyunMode()) {
        highlightMap();
        updateCharts();
      }
    });
    observer.observe(document.getElementById('seoulMap'), { childList: true });
  }

  // ── Polling bootstrap: wait until data + DOM are ready ─────
  const checkInterval = setInterval(() => {
    if (typeof state !== 'undefined' && state.crimeData && document.querySelector('.map-area')) {
      clearInterval(checkInterval);
      initPlugin();
    }
  }, 300);

  // ── CSS injection ───────────────────────────────────────────

  /** Appends all plugin-specific styles to the document head. */
  function injectCSS() {
    const style = document.createElement('style');
    style.innerHTML = `
      #comp-container { margin-top: 24px; animation: fadeIn 0.4s ease; padding: 24px; display: block; }
      .comp-line { fill: none; stroke-width: 3.5px; stroke-linecap: round; stroke-linejoin: round; }
      .comp-dot { stroke: var(--bg-card); stroke-width: 2px; cursor: pointer; }

      /* Disable text selection and default touch scrolling on the map */
      #seoulMap { user-select: none; -webkit-user-select: none; touch-action: none; }
      #seoulMap .gu-path { cursor: pointer; transition: fill 0.15s ease, filter 0.15s ease; }

      .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 16px; }
      .sub-chart-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; }

      .legend-btn { cursor: pointer; transition: opacity 0.2s, transform 0.1s; display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: var(--text-secondary); padding: 4px 6px; border-radius: 4px; }
      .legend-btn:hover { opacity: 1 !important; transform: translateY(-1px); background: var(--bg-tertiary); }
      .legend-btn.active { opacity: 1; background: var(--bg-tertiary); color: var(--text-primary); }

      /* Suppress D3 entrance animations on bar/tick elements */
      #svgBar .tick, #svgBar rect, #svgAll .tick, #svgAll rect { transition: none !important; }

      /* Hover tooltip for the line chart */
      .d3-custom-tooltip { position: absolute; background: rgba(15, 23, 42, 0.85); color: white; padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; pointer-events: none; opacity: 0; transition: opacity 0.15s ease; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.15); backdrop-filter: blur(4px); }
      .d3-tooltip-title { font-size: 11px; color: #94a3b8; margin-bottom: 2px; }

      @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
  }

  // ── DOM injection ───────────────────────────────────────────

  /**
   * Inserts the #comp-container chart section below the scatter plot.
   * Contains the all-districts dual bar chart and the per-selection
   * line + pie/bar chart grid.
   */
  function injectUI() {
    const mapArea = document.querySelector('.map-area');
    const compDiv = document.createElement('div');
    compDiv.id = 'comp-container';
    compDiv.className = 'chart-section';
    compDiv.innerHTML = `
      <div class="chart-header" style="margin-bottom: 8px;">
        <div>
          <h2 id="comp-title" style="font-family: var(--font-heading); font-size: 20px; font-weight: 700; margin-bottom:4px;">Safety Ranking Across Seoul’s 25 Districts</h2>
          <div class="subtitle" id="comp-subtitle" style="font-size: 13px; color: var(--text-secondary);">Selected Districts: None</div>
        </div>
      </div>
      
      <div id="all-districts-wrapper">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:8px;">
          <div>
            <div style="font-size:12px; font-weight:700; color:#e63946; margin-bottom:6px; font-family:var(--font-mono); letter-spacing:0.08em;">▌ CRIME RATE (per 100k)</div>
            <svg id="svgCrime" width="100%" height="460" viewBox="0 0 680 520"></svg>
          </div>
            <div>
            <div style="font-size:12px; font-weight:700; color:#06a77d; margin-bottom:6px; font-family:var(--font-mono); letter-spacing:0.08em;">▌ ARREST RATE (%)</div>
            <svg id="svgArrest" width="100%" height="460" viewBox="0 0 680 520"></svg>
          </div>
        </div>
      </div>
      
      <div class="chart-grid" id="comp-grid" style="display: none;">
        <div>
          <div class="sub-chart-title">📈 Trends in Rates (Arrest Rate / Crime Rate)</div>
          <div id="legend-line" class="chart-legend" style="display: flex; flex-wrap: wrap; gap: 8px; height: 26px;"></div>
          <svg id="svgLine" width="100%" height="260" viewBox="0 0 400 260"></svg>
        </div>
        
        <div>
          <div class="sub-chart-title" id="title-bar">📊 Five Major Crimes Overview</div>
          <div id="bar-hint" style="font-size:11px; color:var(--text-primary); margin-bottom:4px; height: 16px;"></div>
          <div id="legend-bar" class="chart-legend" style="display: flex; flex-wrap: wrap; gap: 4px; height: 26px;"></div>
          <svg id="svgBar" width="100%" height="260" viewBox="0 0 400 260"></svg>
        </div>
      </div>
    `;
    // Insert the chart container directly after the scatter section
    const scatterSection = document.querySelector('.scatter-section');
    mapArea.parentNode.insertBefore(compDiv, scatterSection.nextSibling);
  }

  // ── Brush / painting interaction ────────────────────────────

  /**
   * Attaches pointer events to the map SVG for drag-brush selection.
   * - pointerdown on a district: start painting, select that district
   * - pointermove (while painting): add hovered districts to selection
   * - pointerup: end painting; reset isDragged after a short delay
   *   so the selectGu wrapper can distinguish drag from click.
   */
  function setupPaintingEvents() {
    const mapSvg = document.getElementById('seoulMap');

    mapSvg.addEventListener('pointerdown', (e) => {
      if (isJiyunMode()) return; 
      const path = e.target.closest('.gu-path');
      if (path) {
        e.preventDefault();
        isPainting = true;
        isDragged = false; 
        brushedGus = [getGuNameFromPath(path)]; 
        highlightMap();
        updateCharts();
      } else {
        // Click on empty map area: deselect all districts
        brushedGus = [];
        highlightMap();
        updateCharts();
      }
    });

    mapSvg.addEventListener('pointermove', (e) => {
      if (!isPainting || isJiyunMode()) return;
      isDragged = true; 
      
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const path = el ? el.closest('.gu-path') : null;
      
      if (path) {
        const gu = getGuNameFromPath(path);
        if (gu && !brushedGus.includes(gu)) {
          brushedGus.push(gu);
          highlightMap();
          updateCharts();
        }
      }
    });

    window.addEventListener('pointerup', () => {
      isPainting = false;
      setTimeout(() => { isDragged = false; }, 50);
    });
  }

  // ── Map helpers ─────────────────────────────────────────────

  /**
   * Extracts the district name from a <path> element by reading its
   * <title> child (format: "구이름 · metric").
   * Falls back to matching the path's index against SEOUL_DATA.districts.
   *
   * @param {Element} path - A .gu-path SVG element
   * @returns {string|null} District name, or null if not found
   */
  function getGuNameFromPath(path) {
    const titleEl = path.querySelector('title');
    if (titleEl) {
      return titleEl.textContent.split(' · ')[0].trim();
    }
    
    const paths = Array.from(document.querySelectorAll('#seoulMap .gu-path'));
    const idx = paths.indexOf(path);
    if (idx > -1 && typeof SEOUL_DATA !== 'undefined') return Object.keys(SEOUL_DATA.districts)[idx];
    
    return null;
  }

  /**
   * Applies selected/dimmed CSS classes to map paths and labels
   * based on the current brushedGus array.
   * Also notifies scatter_map_jiyun.js via window.onBrushUpdate.
   */
  function highlightMap() {
    if (typeof window.onBrushUpdate === 'function') window.onBrushUpdate(brushedGus.slice());

    const paths = document.querySelectorAll('#seoulMap .gu-path');
    const labels = document.querySelectorAll('#seoulMap .gu-label');

    if (brushedGus.length === 0) {
      paths.forEach(p => p.setAttribute('class', 'gu-path'));
      labels.forEach(l => l.setAttribute('class', 'gu-label'));
      return;
    }

    paths.forEach(path => {
      const gu = getGuNameFromPath(path);
      if (gu) {
        path.setAttribute('class', brushedGus.includes(gu) ? 'gu-path selected' : 'gu-path dimmed');
      }
    });
    
    labels.forEach(label => {
      const gu = label.textContent.trim();
      if (gu) {
        label.setAttribute('class', brushedGus.includes(gu) ? 'gu-label' : 'gu-label dim');
      }
    });
  }

  // ── Chart routing ────────────────────────────────────────────

  /**
   * Hides the original per-district chart section and renders the
   * correct brushing chart based on selection count:
   *   0 → all-districts dual bar chart
   *   1 → line chart + pie chart
   *   2+ → line chart + stacked bar chart
   */
  function updateCharts() {
    const originalChart = document.getElementById('chartTitle')?.closest('.chart-section');
    if (originalChart) originalChart.style.display = 'none'; // Hide original single-district chart
    
    const compGrid = document.getElementById('comp-grid');
    const allWrapper = document.getElementById('all-districts-wrapper');
    const compTitle = document.getElementById('comp-title');
    const subtitle = document.getElementById('comp-subtitle');
    
    if (brushedGus.length === 0) {
      compGrid.style.display = 'none';
      allWrapper.style.display = 'block';
      drawAllDistrictsChart();
      return;
    }

    compGrid.style.display = 'grid';
    allWrapper.style.display = 'none';
    
    compTitle.textContent = 'Multi-District Visual Analysis';
    subtitle.textContent = `Selected Districts: ${brushedGus.join(', ')}`;
    
    d3.select('#svgLine').selectAll('*').remove();
    drawLineChart();
    
    if (brushedGus.length === 1) {
      drawPieChart();
    } else {
      drawStackedBarChart();
    }
  }

  // ── Chart: all-districts dual bar (0 selected) ──────────────

  /**
   * Draws side-by-side bar charts for all 25 Seoul districts,
   * sorted by crime rate (left) and arrest rate (right).
   * A dashed line marks the average value on each chart.
   */
  function drawAllDistrictsChart() {
    const year = state.year;
    const allGus = Object.keys(SEOUL_DATA.districts);

    let barData = allGus.map(gu => ({
      gu,
      crime: state.crimeData[gu]?.[year]?.crime || 0,
      arrest: state.crimeData[gu]?.[year]?.arrest || 0
    }));

    const compTitle = document.getElementById('comp-title');
    const subtitle = document.getElementById('comp-subtitle');
    compTitle.textContent = `Safety Ranking Across Seoul's 25 Districts`;
    subtitle.textContent = `(${year})  ▌ Crime Rate  vs  ▌ Arrest Rate — dashed line = average`;

    const avgCrime  = d3.mean(barData, d => d.crime);
    const avgArrest = d3.mean(barData, d => d.arrest);

    // ── Shared layout constants ─────────────────────────────────
    const W = 680, H = 460;
    const margin = { top: 36, right: 30, bottom: 110, left: 45 };
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top  - margin.bottom;
    const t = d3.transition().duration(600).ease(d3.easeCubicOut);

    // ── Single-chart drawing helper ─────────────────────────────
    /**
     * Renders one bar chart into the specified SVG element.
     *
     * @param {string} svgId    - ID of the target SVG element
     * @param {Array}  data     - Array of {gu, crime, arrest} objects
     * @param {string} valueKey - Data key to plot ('crime' or 'arrest')
     * @param {string} color    - Bar fill color
     * @param {number} avgVal   - Average value (for the dashed reference line)
     * @param {string} label    - Axis label text (unused, kept for clarity)
     */
    function drawSingle(svgId, data, valueKey, color, avgVal, label) {
      const svg = d3.select('#' + svgId);
      svg.selectAll('*').remove();

      const sorted = [...data].sort((a, b) => b[valueKey] - a[valueKey]);

      const xScale = d3.scaleBand()
        .domain(sorted.map(d => d.gu))
        .range([margin.left, W - margin.right])
        .padding(0.28);

      const maxVal = d3.max(sorted, d => d[valueKey]) || 1;
      const yScale = d3.scaleLinear()
        .domain([0, maxVal * 1.15])
        .range([H - margin.bottom, margin.top]);

      const avgY = yScale(avgVal);

      // Grid lines
      svg.selectAll('.grid-line')
        .data(yScale.ticks(5))
        .enter().append('line')
        .attr('x1', margin.left).attr('x2', W - margin.right)
        .attr('y1', d => yScale(d)).attr('y2', d => yScale(d))
        .attr('stroke', 'var(--border)')
        .attr('stroke-dasharray', '3,3')
        .attr('stroke-width', 1);

      // Y-axis tick labels
      svg.selectAll('.y-tick')
        .data(yScale.ticks(5))
        .enter().append('text')
        .attr('x', margin.left - 4)
        .attr('y', d => yScale(d) + 4)
        .attr('text-anchor', 'end')
        .attr('font-size', '12px')
        .attr('fill', 'var(--text-tertiary)')
        .text(d => valueKey === 'arrest' ? d.toFixed(0) + '%' : Math.round(d));

      // Bars
      svg.selectAll('.bar')
        .data(sorted)
        .enter().append('rect')
        .attr('class', 'bar')
        .attr('x', d => xScale(d.gu))
        .attr('width', xScale.bandwidth())
        .attr('rx', 3)
        .attr('fill', color)
        .attr('opacity', 0.85)
        .attr('y', H - margin.bottom)
        .attr('height', 0)
        .transition(t)
        .attr('y', d => yScale(d[valueKey]))
        .attr('height', d => Math.max(0, (H - margin.bottom) - yScale(d[valueKey])));

      // Dashed average reference line
      svg.append('line')
        .attr('x1', margin.left).attr('x2', W - margin.right)
        .attr('y1', avgY).attr('y2', avgY)
        .attr('stroke', color)
        .attr('stroke-width', 1.8)
        .attr('stroke-dasharray', '6,4')
        .attr('opacity', 0)
        .transition(t)
        .attr('opacity', 1);

      // "avg" label at the right end of the reference line
      svg.append('text')
        .attr('x', W - margin.right + 2)
        .attr('y', avgY + 4)
        .attr('font-size', '13px')
        .attr('font-weight', '700')
        .attr('fill', color)
        .attr('opacity', 0)
        .text('avg')
        .transition(t)
        .attr('opacity', 1);

      // Numeric average value above the reference line
      svg.append('text')
        .attr('x', margin.left + 4)
        .attr('y', avgY - 5)
        .attr('font-size', '9px')
        .attr('fill', color)
        .attr('opacity', 0)
        .text(valueKey === 'arrest' ? avgVal.toFixed(1) + '%' : Math.round(avgVal))
        .transition(t)
        .attr('opacity', 1);

      // Rotated X-axis district name labels
      svg.selectAll('.x-label')
        .data(sorted)
        .enter().append('text')
        .attr('class', 'x-label')
        .attr('x', d => xScale(d.gu) + xScale.bandwidth() / 2)
        .attr('y', H - margin.bottom + 6)
        .attr('text-anchor', 'end')
        .attr('transform', d => `rotate(-55, ${xScale(d.gu) + xScale.bandwidth() / 2+20}, ${H - margin.bottom + 6})`)
        .attr('font-size', '13px')
        .attr('font-weight', '600')
        .attr('fill', 'var(--text-primary)')
        .text(d => d.gu);
    }

    drawSingle('svgCrime',  barData, 'crime',  '#e63946', avgCrime,  'Crime Rate');
    drawSingle('svgArrest', barData, 'arrest', '#06a77d', avgArrest, 'Arrest Rate');
  }

  // ── Chart: line chart (1+ selected, left panel) ─────────────

  /**
   * Draws a multi-line chart showing the arrest-rate/crime-rate ratio
   * trend (2021–2024) for each selected district.
   * Each dot shows a tooltip on hover via a document-level pointermove listener.
   */
  function drawLineChart() {
    const svg = d3.select('#svgLine');
    const width = 400, height = 260; 
    const margin = { top: 20, right: 40, bottom: 30, left: 40 }; 
    const years = ['2021', '2022', '2023', '2024'];

    // Create a singleton tooltip element at the body level
    let tooltip = d3.select('.d3-custom-tooltip');
    if (tooltip.empty()) {
      tooltip = d3.select('body').append('div').attr('class', 'd3-custom-tooltip');
    }

    const chartData = brushedGus.map((gu, i) => {
      const values = years.map(yr => {
        let ratio = 0;
        if (state.crimeData && state.crimeData[gu] && state.crimeData[gu][yr]) {
          const arrest = state.crimeData[gu][yr].arrest || 0;
          const crime = state.crimeData[gu][yr].crime || 0;
          if (crime > 0) ratio = arrest / crime;
        }
        return { year: yr, value: ratio };
      });
      return { gu, color: LINE_COLORS[i % LINE_COLORS.length], values, index: i };
    });

    const minVal = d3.min(chartData, d => d3.min(d.values, v => v.value)) || 0;
    const maxVal = d3.max(chartData, d => d3.max(d.values, v => v.value)) || 0.1;
    const yPadding = (maxVal - minVal) * 0.1 || 0.02;

    const xScale = d3.scalePoint().domain(years).range([margin.left, width - margin.right]).padding(0.2);
    const yScale = d3.scaleLinear().domain([Math.max(0, minVal - yPadding), maxVal + yPadding]).range([height - margin.bottom, margin.top]);

    svg.selectAll('.y-grid').data(yScale.ticks(5)).enter().append('line')
      .attr('x1', margin.left).attr('x2', width - margin.right)
      .attr('y1', d => yScale(d)).attr('y2', d => yScale(d))
      .attr('stroke', 'var(--border)').attr('stroke-width', 1).attr('stroke-dasharray', '4,4');

    svg.selectAll('.y-label').data(yScale.ticks(5)).enter().append('text')
      .attr('x', margin.left - 8).attr('y', d => yScale(d) + 4)
      .attr('text-anchor', 'end').attr('font-size', '10px').attr('fill', 'var(--text-secondary)')
      .text(d => d.toFixed(3));

    svg.selectAll('.x-label').data(years).enter().append('text')
      .attr('x', d => xScale(d)).attr('y', height - margin.bottom + 20)
      .attr('text-anchor', 'middle').attr('font-size', '11px').attr('fill', 'var(--text-primary)').attr('font-weight', '600')
      .text(d => d);

    const lineGen = d3.line().x(d => xScale(d.year)).y(d => yScale(d.value)).curve(d3.curveMonotoneX); 

    chartData.forEach(series => {
      svg.append('path').datum(series.values).attr('class', 'comp-line').attr('d', lineGen).attr('stroke', series.color);
      
      // Tooltip mouse events for each dot
      const dots = svg.selectAll('.cd-' + series.index).data(series.values).enter().append('circle')
        .attr('class', 'comp-dot')
        .attr('cx', d => xScale(d.year))
        .attr('cy', d => yScale(d.value))
        .attr('r', 4.5)
        .attr('fill', series.color);

      dots.on('mouseover', function(event, d) {
          // D3 v5/v6 compatibility: datum may arrive as second arg or via d3.event
          const datum = d || event;
          const e = d ? event : d3.event;

          d3.select(this).transition().duration(200).attr('r', 7); // Enlarge dot on hover
          tooltip.style('opacity', 1)
                 .html(`<div class="d3-tooltip-title">${series.gu} (${datum.year})</div><div style="color: ${series.color};">Ratio: ${datum.value.toFixed(4)}</div>`)
                 .style('left', (e.pageX + 15) + 'px')
                 .style('top',  (e.pageY - 28) + 'px');
      })
      .on('mousemove', function(event, d) {
          const e = d ? event : d3.event;
          tooltip.style('left', (e.pageX + 15) + 'px')
                 .style('top',  (e.pageY - 28) + 'px');
      })
      .on('mouseout', function() {
          d3.select(this).transition().duration(200).attr('r', 4.5); // Restore original size
          tooltip.style('opacity', 0);
      });
    });

    document.getElementById('legend-line').innerHTML = chartData.map(s => 
      `<div style="display:flex; align-items:center; gap:4px; font-size:11px; font-weight:600; color:var(--text-secondary);"><span style="width:10px; height:10px; border-radius:2px; background:${s.color};"></span>${s.gu}</div>`
    ).join('');
  }

  // ── Chart: pie chart (1 selected, right panel) ──────────────

  /**
   * Draws a pie chart showing the 2021–2024 cumulative breakdown of
   * five major crime types for the single selected district.
   */
  function drawPieChart() {
    const svg = d3.select('#svgBar');
    svg.selectAll('*').remove();
    
    const width = 400, height = 260;
    const radius = Math.min(width, height) / 2 - 20;
    const gu = brushedGus[0];
    const years = ['2021', '2022', '2023', '2024'];

    document.getElementById('title-bar').innerHTML = `📊 Five Major Crime Composition<br><span style="font-size: 13px; font-weight: 500; color: var(--text-secondary);">(${gu}, 2021–2024 Total)</span>`;
    document.getElementById('bar-hint').textContent = ''; 

    document.getElementById('legend-bar').innerHTML = CRIME_TYPES.map(k => 
      `<div style="display:flex; align-items:center; gap:4px; font-size:11px; font-weight:600; color:var(--text-secondary); padding:4px 6px;">
        <span style="width:10px; height:10px; border-radius:2px; background:${CRIME_COLORS[k]};"></span>${CRIME_LABELS[k]}
       </div>`
    ).join('');

    let m = 0, rb = 0, t = 0, v = 0, rp = 0;
    years.forEach(yr => {
      if (state.crimeData && state.crimeData[gu] && state.crimeData[gu][yr]) {
        const occur = state.crimeData[gu][yr].occur || {};
        m += occur.murder || 0; rb += occur.robbery || 0; t += occur.theft || 0; v += occur.violence || 0; rp += occur.rape || 0;
      }
    });
    const total = m + rb + t + v + rp;

    const pieData = [
      { key: 'murder', value: m }, { key: 'robbery', value: rb }, { key: 'theft', value: t }, { key: 'violence', value: v }, { key: 'rape', value: rp }
    ].filter(d => d.value > 0);

    const pie = d3.pie().value(d => d.value).sort((a, b) => b.value - a.value); 
    const data_ready = pie(pieData);

    const arcGenerator = d3.arc().innerRadius(0).outerRadius(radius);
    const arcLabel = d3.arc().innerRadius(radius * 0.6).outerRadius(radius * 0.6);

    const g = svg.append('g').attr('transform', `translate(${width / 2}, ${height / 2})`);

    const slices = g.selectAll('path')
      .data(data_ready).join('path')
      .attr('fill', d => CRIME_COLORS[d.data.key])
      .attr('stroke', 'white')
      .style('stroke-width', '2px')
      .style('cursor', 'pointer')
      .style('outline', 'none'); 
      
    slices.append('title')
      .text(d => `${CRIME_LABELS[d.data.key]}: ${d.data.value} cases (${(d.data.value / total * 100).toFixed(1)}%)`);

    slices.transition().duration(800)
      .attrTween("d", function(d) {
          const i = d3.interpolate({ startAngle: 0, endAngle: 0 }, d);
          return function(t) { return arcGenerator(i(t)); };
      });

    g.selectAll('text')
      .data(data_ready).join('text')
      .transition().delay(800).duration(400) 
      .text(d => {
        const pct = (d.data.value / total * 100);
        return pct > 5 ? `${CRIME_LABELS[d.data.key]} ${pct.toFixed(1)}%` : '';
      })
      .attr('transform', d => `translate(${arcLabel.centroid(d)})`)
      .style('text-anchor', 'middle')
      .style('font-size', '11px')
      .style('font-weight', '700')
      .style('fill', 'white')
      .style('text-shadow', '0px 1px 3px rgba(0,0,0,0.5)');
  }

  // ── Chart: stacked bar chart (2+ selected, right panel) ─────

  /**
   * Draws a stacked bar chart showing cumulative crime counts
   * (2021–2024) for each selected district.
   * Clicking a legend item or a bar segment "dances" that crime type
   * to the baseline, enabling visual comparison across districts.
   */
  function drawStackedBarChart() {
    const svg = d3.select('#svgBar');
    
    if (svg.select('.layers-container').empty()) svg.selectAll('*').remove();

    const width = 400, height = 260;
    const margin = { top: 20, right: 20, bottom: 30, left: 50 }; 
    const years = ['2021', '2022', '2023', '2024']; 

    const sortLabel = currentSortKey === 'total' ? 'Total' : CRIME_LABELS[currentSortKey];
    document.getElementById('title-bar').innerHTML = `📊 Cumulative Incidents of Five Major Crimes<br><span style="font-size: 13px; font-weight: 500; color: var(--text-secondary);">(2021–2024, sorted by ${sortLabel})</span>`;
    document.getElementById('bar-hint').textContent = '💡 Click the legend or chart segments below to sort districts by the selected crime type.';

    let barData = brushedGus.map(gu => {
      let m = 0, rb = 0, t = 0, v = 0, rp = 0;
      years.forEach(yr => {
        if (state.crimeData && state.crimeData[gu] && state.crimeData[gu][yr]) {
          const occur = state.crimeData[gu][yr].occur || {};
          m += occur.murder || 0; rb += occur.robbery || 0; t += occur.theft || 0; v += occur.violence || 0; rp += occur.rape || 0;
        }
      });
      const total = m + rb + t + v + rp;
      return { gu, murder: m, robbery: rb, theft: t, violence: v, rape: rp, total };
    });

    barData.sort((a, b) => b[currentSortKey] - a[currentSortKey]);

    if (svg.select('.y-axis').empty()) {
      svg.append('g').attr('class', 'y-axis').attr('transform', `translate(${margin.left}, 0)`);
      svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0, ${height - margin.bottom})`);
      svg.append('line').attr('class', 'zero-line'); 
      svg.append('g').attr('class', 'layers-container');
    }

    const xScale = d3.scaleBand().domain(barData.map(d => d.gu)).range([margin.left, width - margin.right]).padding(0.35); 
    
    /**
     * Computes the y-offset for a crime key so that the selected key
     * aligns to the baseline (y=0), enabling the "dance" effect.
     *
     * @param {Object} d   - Bar datum
     * @param {string} key - Crime type key
     * @returns {number} Cumulative offset of all types before `key`
     */
    function getOffset(d, key) {
      if (key === 'total') return 0;
      let offset = 0;
      for (let k of CRIME_TYPES) {
        if (k === key) break;
        offset += d[k] || 0;
      }
      return offset;
    }

    const minVal = d3.min(barData, d => 0 - getOffset(d, currentSortKey));
    const maxVal = d3.max(barData, d => d.total - getOffset(d, currentSortKey));
    
    const yScale = d3.scaleLinear()
      .domain([minVal > 0 ? 0 : minVal * 1.1, maxVal * 1.1])
      .range([height - margin.bottom, margin.top]);

    const t = svg.transition().duration(600).ease(d3.easeCubicOut);

    const yAxisG = svg.select('.y-axis');
    yAxisG.transition(t).call(d3.axisLeft(yScale).ticks(5).tickSize(-(width - margin.left - margin.right)));
    yAxisG.select(".domain").remove();
    yAxisG.selectAll(".tick line").attr("stroke", "var(--border)").attr("stroke-dasharray", "4,4");
    yAxisG.selectAll(".tick text").attr("fill", "var(--text-secondary)").attr("x", -8).attr("font-size", "10px");

    const xAxisG = svg.select('.x-axis');
    xAxisG.transition(t).call(d3.axisBottom(xScale).tickSizeOuter(0));
    xAxisG.select(".domain").remove();
    xAxisG.selectAll('text').attr('font-size', '11px').attr('font-weight', '600').attr('fill', 'var(--text-primary)');

    svg.select('.zero-line').transition(t)
      .attr('x1', margin.left).attr('x2', width - margin.right)
      .attr('y1', yScale(0)).attr('y2', yScale(0))
      .attr('stroke', 'var(--text-primary)').attr('stroke-width', 2);

    const stack = d3.stack().keys(CRIME_TYPES);
    const stackedSeries = stack(barData);

    const layers = svg.select('.layers-container').selectAll('.crime-layer')
      .data(stackedSeries, d => d.key)
      .join('g').attr('class', 'crime-layer').attr('fill', d => CRIME_COLORS[d.key]);

    const rects = layers.selectAll('rect')
      .data(d => d, d => d.data.gu)
      .join(
        enter => enter.append('rect')
          .attr('x', d => xScale(d.data.gu))
          .attr('y', d => yScale(d[1] - getOffset(d.data, currentSortKey)))
          .attr('width', xScale.bandwidth())
          .attr('height', d => Math.max(0, yScale(d[0]) - yScale(d[1])))
          .attr('stroke', 'none')
          .style('outline', 'none')
          .style("cursor", "pointer")
          .style('opacity', 0)
      )
      .on('click', function() {
        const clickedKey = d3.select(this.parentNode).datum().key;
        danceToBaseline(clickedKey);
      });

    rects.transition(t)
      .style('opacity', 1)
      .attr('x', d => xScale(d.data.gu))
      .attr('y', d => yScale(d[1] - getOffset(d.data, currentSortKey)))
      .attr('width', xScale.bandwidth())
      .attr('height', d => Math.max(0, yScale(d[0]) - yScale(d[1])));

    rects.selectAll('title').remove();
    rects.append('title').text(function(d) {
      const key = d3.select(this.parentNode).datum().key;
      return `${d.data.gu} [${CRIME_LABELS[key]}]: ${d[1] - d[0]} cases`;
    });

    const legendBar = document.getElementById('legend-bar');
    let legendHTML = `<div class="legend-btn" data-key="total"><span style="width:10px; height:10px; border-radius:2px; background:var(--text-primary);"></span>Total</div>`;
    legendHTML += CRIME_TYPES.map(k => 
      `<div class="legend-btn" data-key="${k}">
        <span style="width:10px; height:10px; border-radius:2px; background:${CRIME_COLORS[k]};"></span>${CRIME_LABELS[k]}
       </div>`
    ).join('');
    legendBar.innerHTML = legendHTML;

    d3.selectAll('.legend-btn').style('opacity', function() {
      return d3.select(this).attr('data-key') === currentSortKey ? 1 : 0.4;
    }).classed('active', function() {
      return d3.select(this).attr('data-key') === currentSortKey;
    });

    /**
     * Updates the sort key and redraws the chart so the chosen
     * crime type dances to the baseline.
     *
     * @param {string} crimeKey - Crime type key or 'total'
     */
    function danceToBaseline(crimeKey) {
      currentSortKey = crimeKey;
      drawStackedBarChart();
    }

    d3.selectAll('.legend-btn').on('click', function() {
      danceToBaseline(d3.select(this).attr('data-key'));
    });
  }

})();
