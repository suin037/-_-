/* eslint-disable no-undef */
/* global d3, state, SEOUL_DATA, DONG_DATA, scaleX, scaleY, normalizeDongName, cctvRadiusScale, renderMainMap, closeModal */

/* ============================================================
 * compare_two_jiyun.js  (SPA Sliding Panel + Fixed CSV Parsing)
 * Feature: 
 * 1. Load police station and CCTV data via a robust CSV parser handling quoted fields
 * 2. Single district → detail panel; two districts → comparison panel with slide animation
 * ========================================================== */

(function () {
  'use strict';

  const NS2 = 'http://www.w3.org/2000/svg';
  const compareTwoState = { active: false, guA: null, guB: null };
  const CRIME_TYPES = ['murder', 'robbery', 'theft', 'violence', 'rape'];

  /* =========================================================
   * 1. Async external CSV loader and robust parser
   * ========================================================= */
  
  // Splits a CSV line correctly, ignoring commas inside quoted fields
  function parseCSVLine(line) {
    const cols = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes; // toggle quoted state
      } else if (char === ',' && !inQuotes) {
        cols.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cols.push(current.trim());
    return cols;
  }

  function parseCctvCsv(csv) {
    const lines = csv.split(/\r?\n/).slice(2);
    const result = {};
    let currentGu = null;
    let maxRatio = 0;
    lines.forEach(line => {
      if (!line.trim()) return;
      const cols = parseCSVLine(line);
      const col0 = cols[0];
      const col1 = cols[1];
      const count = parseInt(cols[3]) || 0;
      const ratio = parseFloat(cols[4]) || 0;
      
      if (col0 && col0 !== '소계') {
        currentGu = col0;
        result[currentGu] = {};
      } else if (!col0 && col1 && col1 !== '소계' && currentGu) {
        result[currentGu][col1] = { count, ratio };
        if (ratio > maxRatio) maxRatio = ratio;
      }
    });
    return { data: result, maxRatio };
  }

  function parsePoliceCsv(csv) {
    const lines = csv.split(/\r?\n/).slice(1);
    return lines.map(line => {
      if (!line.trim()) return null;
      const cols = parseCSVLine(line);
      if (cols.length < 5) return null;
      
      // split coordinates (quotes already stripped, comma-separated)
      const coords = cols[4].split(',');
      return {
        station: cols[0],
        name:    cols[1],
        type:    cols[2],
        address: cols[3],
        lat: parseFloat(coords[0]) || 0,
        lng: parseFloat(coords[1]) || 0
      };
    }).filter(p => p && p.lat && p.lng);
  }

  async function loadExternalData() {
    try {
      const [cctvRes, policeRes] = await Promise.all([
        fetch('./data/cctv.csv'),
        fetch('./data/지구대_파출소.csv')
      ]);
      
      const cctvText = await cctvRes.text();
      const policeText = await policeRes.text();

      const { data, maxRatio } = parseCctvCsv(cctvText);
      state.cctvData = data;
      state.cctvMaxRatio = maxRatio;
      state.policeData = parsePoliceCsv(policeText);
      
      console.log('✅ External CSV data and police coordinates loaded successfully.');
    } catch (error) {
      console.error('❌ Failed to load CSV data.', error);
    }
  }

  /* =========================================================
   * 2. CSS — SPA styles + detail panel button
   * ========================================================= */
  function injectStyles() {
    if (document.getElementById('jiyunSpaStyles')) return;
    const s = document.createElement('style');
    s.id = 'jiyunSpaStyles';
    s.textContent = `
      .compare-two-btn { width: 100%; padding: 12px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-strong); border-radius: 10px; font-family: 'IBM Plex Sans KR', sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; margin-top: 4px; box-shadow: var(--shadow-sm); }
      .compare-two-btn:hover { background: var(--bg-secondary); }
      .compare-two-btn.selecting { background: var(--text-primary); color: white; border-color: var(--text-primary); }

      .app { transition: all 0.45s cubic-bezier(0.4, 0, 0.2, 1); }
      .app.jiyun-active { display: flex !important; width: 100vw; height: 100vh; overflow: hidden; }
      .app.jiyun-active .sidebar { 
        overflow: hidden;
        flex-shrink: 0;
        width: 320px;
        opacity: 1;
        transform: translateX(0);
        transition: width 0.45s cubic-bezier(0.4, 0, 0.2, 1),
                    opacity 0.3s ease,
                    transform 0.45s cubic-bezier(0.4, 0, 0.2, 1),
                    padding 0.45s;
      }
      .app.jiyun-active.panel-open .sidebar { 
      width: 0 !important; 
      opacity: 0; 
      padding: 0 !important;
      transform: translateX(-30px);
      pointer-events: none;
      }
      .app.jiyun-active .main { 
        flex: 1; overflow-y: auto; border-right: 1px solid var(--border); padding: 24px;
        transition: flex 0.45s cubic-bezier(0.4, 0, 0.2, 1);
        min-width: 0;
      }
      .app.jiyun-active.panel-open .main {
        flex: 0 0 38vw;
      }
      
      #jiyunSidePanel { 
        display: none; 
        flex-shrink: 0;
        width: 0;
        height: 100vh; 
        background: var(--bg-primary); 
        overflow: hidden;
        opacity: 0;
        transform: translateX(60px);
        transition: width 0.45s cubic-bezier(0.4, 0, 0.2, 1),
                    opacity 0.35s 0.1s ease,
                    transform 0.45s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .app.jiyun-active #jiyunSidePanel { display: flex; flex-direction: column; }
      .app.jiyun-active.panel-open #jiyunSidePanel { 
        width: 62vw;
        opacity: 1; 
        transform: translateX(0);
        overflow-y: auto;
      }

      .gu-path.compare-selected-a { stroke: var(--accent-blue) !important; stroke-width: 5 !important; filter: drop-shadow(0 0 6px rgba(59,130,246,0.6)); }
      .gu-path.compare-selected-b { stroke: var(--accent-orange) !important; stroke-width: 5 !important; filter: drop-shadow(0 0 6px rgba(249,115,22,0.6)); }

      .two-compare-header { padding: 24px 32px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: flex-start; position: sticky; top: 0; background: rgba(255,255,255,0.9); backdrop-filter: blur(8px); z-index: 10; }
      .two-compare-header h2 { font-family: 'Gowun Batang', serif; font-size: 26px; font-weight: 700; margin-bottom: 6px; }
      .two-compare-close { width: 36px; height: 36px; border-radius: 50%; background: var(--bg-tertiary); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; color: var(--text-secondary); transition: all 0.2s; }
      .two-compare-close:hover { background: var(--border-strong); transform: rotate(90deg); color: var(--text-primary); }
      
      .two-compare-body { padding: 32px; display: flex; flex-direction: column; gap: 32px; }
      .two-chart-section h3 { font-family: 'Gowun Batang', serif; font-size: 18px; font-weight: 700; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
      
      .two-map-row-vertical { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
      .two-map-card { border: 1px solid var(--border); border-radius: 16px; overflow: hidden; background: var(--bg-card); box-shadow: var(--shadow-sm); }
      .two-map-card.card-a { border-top: 5px solid var(--accent-blue); }
      .two-map-card.card-b { border-top: 5px solid var(--accent-orange); }
      .two-map-card-label { padding: 16px 20px 4px; font-weight: 700; font-size: 18px; text-align: center; }
      .two-map-card.card-a .two-map-card-label { color: var(--accent-blue); }
      .two-map-card.card-b .two-map-card-label { color: var(--accent-orange); }
      .two-map-card-sub { padding: 0 20px 16px; font-size: 13px; color: var(--text-tertiary); text-align: center; }
      .two-map-svg-wrap { padding: 0 16px 16px; min-height: 420px; display: flex; align-items: center; justify-content: center; }
      
      .two-stat-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
      .two-stat-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 16px; padding: 24px; }
      .two-stat-card.card-a { border-left: 5px solid var(--accent-blue); }
      .two-stat-card.card-b { border-left: 5px solid var(--accent-orange); }
      .two-stat-card h3 { font-family: 'Gowun Batang', serif; font-size: 20px; font-weight: 700; margin-bottom: 16px; border: none; padding: 0; }
      .two-stat-items { display: flex; gap: 24px; flex-wrap: wrap; }
      .two-stat-item-label { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px; }
      .two-stat-item-val { font-family: 'Gowun Batang', serif; font-size: 28px; font-weight: 700; }
      
      .two-chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
      
      .crime-filter-panel { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 16px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
      .crime-filter-title { font-weight: 700; font-size: 15px; color: var(--text-primary); }
      .crime-filter-list { display: flex; flex-direction: column; gap: 12px; }
      .crime-filter-item { display: flex; align-items: center; gap: 10px; font-size: 14px; cursor: pointer; }
      .crime-filter-item input[type=checkbox] { width: 18px; height: 18px; cursor: pointer; accent-color: var(--text-primary); }
      .crime-filter-dot { width: 12px; height: 12px; border-radius: 50%; }
    `;
    document.head.appendChild(s);
  }

  /* =========================================================
   * 3. DOM injection & event wiring
   * ========================================================= */
  function injectHTML() {
    if (!document.getElementById('jiyunSidePanel')) {
      const app = document.querySelector('.app');
      const panel = document.createElement('div');
      panel.id = 'jiyunSidePanel';
      app.appendChild(panel);
    }
    
    if (!document.getElementById('startCompareTwoBtn')) {
      const sb = document.querySelector('.sidebar');
      if (sb) {
        const block = document.createElement('div');
        block.className = 'control-block';
        block.innerHTML =
          '<div class="control-label"><span>District Analysis</span></div>' +
          '<button class="compare-two-btn" id="startCompareTwoBtn">🔍 Enable District Detail View</button>' +
          '<div style="font-size:11px;color:var(--text-tertiary);margin-top:6px;line-height:1.5;" id="compareTwoHint">Click a district on the map to open the detail panel on the right.</div>';
        sb.appendChild(block);
        document.getElementById('startCompareTwoBtn').addEventListener('click', toggleCompareTwoMode);
      }
    }
  }

  function toggleCompareTwoMode() {
    compareTwoState.active = !compareTwoState.active;
    const btn = document.getElementById('startCompareTwoBtn');
    const hint = document.getElementById('compareTwoHint');

    if (compareTwoState.active) {
      btn.textContent = '✕ Disable Detail View';
      btn.classList.add('selecting');
      hint.innerHTML = '<span style="color:var(--accent-orange);font-weight:600;">Detail view active.</span> Click a district on the map.';
    } else {
      resetCompareTwoMode();
    }
  }

  function resetCompareTwoMode() {
    compareTwoState.active = false;
    compareTwoState.guA = null;
    compareTwoState.guB = null;
    const btn = document.getElementById('startCompareTwoBtn');
    if (btn) {
      btn.textContent = '🔍 Enable District Detail View';
      btn.classList.remove('selecting');
    }
    const hint = document.getElementById('compareTwoHint');
    if (hint) hint.textContent = 'Enable the button and click a district to open the detail panel.';
    
    updateLayoutAndRender(); 
  }

  function setupIntercepts() {
    const _baseSelectGu = window.selectGu;
    window.selectGu = function(guName) {
      if (!compareTwoState.active) {
        if (typeof _baseSelectGu === 'function') _baseSelectGu(guName);
        return;
      }
      
      if (compareTwoState.guA === guName) {
        compareTwoState.guA = compareTwoState.guB;
        compareTwoState.guB = null;
      } else if (compareTwoState.guB === guName) {
        compareTwoState.guB = null;
      } else if (!compareTwoState.guA) {
        compareTwoState.guA = guName;
      } else if (!compareTwoState.guB) {
        compareTwoState.guB = guName;
      } else {
        compareTwoState.guB = guName; 
      }
      
      updateLayoutAndRender();
    };

    const _baseRenderMainMap = window.renderMainMap;
    window.renderMainMap = function() {
      if (typeof _baseRenderMainMap === 'function') _baseRenderMainMap();
      if (compareTwoState.active && (compareTwoState.guA || compareTwoState.guB)) {
        document.querySelectorAll('.gu-path').forEach(p => {
          const titleEl = p.querySelector('title');
          if (!titleEl) return;
          const gu = titleEl.textContent.split(' · ')[0];
          if (gu === compareTwoState.guA) {
            p.setAttribute('class', 'gu-path compare-selected-a');
          } else if (gu === compareTwoState.guB) {
            p.setAttribute('class', 'gu-path compare-selected-b');
          } else {
            p.setAttribute('class', 'gu-path dimmed');
          }
        });
      }
    };
  }

  window.closeJiyunPanel = function() {
    compareTwoState.guA = null;
    compareTwoState.guB = null;
    updateLayoutAndRender();
  };

  function updateLayoutAndRender() {
    const app = document.querySelector('.app');
    const panel = document.getElementById('jiyunSidePanel');

    if (!compareTwoState.guA) {
      // close panel: remove panel-open first → then remove jiyun-active after animation
      app.classList.remove('panel-open');
      setTimeout(() => {
        app.classList.remove('jiyun-active');
        panel.innerHTML = '';
      }, 460);
      if (typeof window.renderMainMap === 'function') window.renderMainMap();
      return;
    }

    // open panel: add jiyun-active first → add panel-open on next frame
    app.classList.add('jiyun-active');
    renderJiyunPanelContent();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => app.classList.add('panel-open'));
    });
    if (typeof window.renderMainMap === 'function') window.renderMainMap();
  }

  /* =========================================================
   * 4. Panel content and chart rendering
   * ========================================================= */
  function renderJiyunPanelContent() {
    const panel = document.getElementById('jiyunSidePanel');
    const guA = compareTwoState.guA;
    const guB = compareTwoState.guB;
    const yr = state.year;

    if (guA && !guB) {
      const dA = state.crimeData[guA]?.[yr] || {};
      const cctvA = state.cctvData?.[guA] ? Object.values(state.cctvData[guA]).reduce((s,d)=>s+d.count,0) : 0;
      
      panel.innerHTML = `
        <div class="two-compare-header">
          <div>
            <h2>${guA} Detail Analysis</h2>
            <div style="font-size:13px; color:var(--text-secondary); margin-top:6px;">
              <span style="color:var(--accent-blue); font-weight:700;">💡 Click another district on the map to start a multi-district comparison.</span>
            </div>
          </div>
          <button class="two-compare-close" onclick="closeJiyunPanel()">✕</button>
        </div>
        <div class="two-compare-body">
          <div class="two-chart-section">
            <h3>District Boundary & Safety Infrastructure</h3>
            <div class="two-map-card card-a" style="max-width: 600px; margin: 0 auto;">
              <div class="two-map-card-label">${guA}</div>
              <div class="two-map-card-sub">Crime Rate ${dA.crime?.toFixed(1)||'—'} · Arrest Rate ${dA.arrest?.toFixed(1)||'—'}% · CCTV ${cctvA.toLocaleString()}</div>
              <div class="two-map-svg-wrap" id="singleMapSvg" style="min-height:480px;"></div>
            </div>
            <div style="display:flex; gap:16px; margin-top:12px; justify-content:center; font-size:12px; color:var(--text-secondary);">
              <div style="display:flex; align-items:center; gap:6px;"><span style="width:12px;height:12px;border-radius:50%;background:#a78bfa;border:1.5px solid #7c3aed;"></span> CCTV Installation Ratio</div>
              <div style="display:flex; align-items:center; gap:6px;"><span style="width:12px;height:12px;border-radius:50%;background:#64748b;border:1.5px solid white;box-shadow:0 0 2px rgba(0,0,0,0.3)"></span> Police Station</div>
            </div>
          </div>
          <div class="two-chart-section">
            <h3>Annual Crime Count Trend</h3>
            <svg id="singleTrendSvg" width="100%" viewBox="0 0 800 280" preserveAspectRatio="xMidYMid meet"></svg>
          </div>
        </div>
      `;
      renderMiniMap2('singleMapSvg', guA, 'a', true);
      renderSingleTrendChart('singleTrendSvg', guA);

    } else if (guA && guB) {
      const dA = state.crimeData[guA]?.[yr] || {};
      const dB = state.crimeData[guB]?.[yr] || {};
      const cctvA = state.cctvData?.[guA] ? Object.values(state.cctvData[guA]).reduce((s,d)=>s+d.count,0) : 0;
      const cctvB = state.cctvData?.[guB] ? Object.values(state.cctvData[guB]).reduce((s,d)=>s+d.count,0) : 0;

      panel.innerHTML = `
        <div class="two-compare-header">
          <div>
            <h2>${guA} <span style="color:var(--text-tertiary); font-weight:400; font-size:18px; margin: 0 8px;">vs</span> ${guB}</h2>
            <div style="font-size:13px; color:var(--text-secondary); margin-top:6px;">Comparative analysis of public safety infrastructure and crime indicators</div>
          </div>
          <button class="two-compare-close" onclick="closeJiyunPanel()">✕</button>
        </div>
        <div class="two-compare-body">
          
          <div class="two-chart-section">
            <h3>Safety Infrastructure Distribution</h3>
            <div class="two-map-row-vertical">
              <div class="two-map-card card-a">
                <div class="two-map-card-label">${guA}</div>
                <div class="two-map-card-sub" id="twoMapSubA">Crime Rate ${dA.crime?.toFixed(1)||'—'} · Arrest Rate ${dA.arrest?.toFixed(1)||'—'}%</div>
                <div class="two-map-svg-wrap" id="twoMapSvgA"></div>
              </div>
              <div class="two-map-card card-b">
                <div class="two-map-card-label">${guB}</div>
                <div class="two-map-card-sub" id="twoMapSubB">Crime Rate ${dB.crime?.toFixed(1)||'—'} · Arrest Rate ${dB.arrest?.toFixed(1)||'—'}%</div>
                <div class="two-map-svg-wrap" id="twoMapSvgB"></div>
              </div>
            </div>
            <div style="display:flex; gap:16px; margin-top:12px; font-size:12px; color:var(--text-secondary);">
              <div style="display:flex; align-items:center; gap:6px;"><span style="width:12px;height:12px;border-radius:50%;background:#a78bfa;border:1.5px solid #7c3aed;"></span> CCTV Installation Ratio</div>
              <div style="display:flex; align-items:center; gap:6px;"><span style="width:12px;height:12px;border-radius:50%;background:#64748b;border:1.5px solid white;box-shadow:0 0 2px rgba(0,0,0,0.3)"></span> Police Station</div>
            </div>
          </div>

          <div class="two-chart-section">
            <h3>Key Safety Metrics (${yr})</h3>
            <div class="two-stat-row">
              <div class="two-stat-card card-a">
                <h3 id="twoStatNameA">${guA}</h3>
                <div class="two-stat-items">
                  <div class="two-stat-item">
                    <div class="two-stat-item-label">Crime Rate</div>
                    <div class="two-stat-item-val crime">${dA.crime?.toFixed(1)||'—'}</div>
                  </div>
                  <div class="two-stat-item">
                    <div class="two-stat-item-label">Arrest Rate</div>
                    <div class="two-stat-item-val arrest">${dA.arrest?.toFixed(1)||'—'}%</div>
                  </div>
                  <div class="two-stat-item">
                    <div class="two-stat-item-label">CCTV Count</div>
                    <div class="two-stat-item-val">${cctvA > 0 ? cctvA.toLocaleString() : '—'}</div>
                  </div>
                </div>
              </div>
              <div class="two-stat-card card-b">
                <h3 id="twoStatNameB">${guB}</h3>
                <div class="two-stat-items">
                  <div class="two-stat-item">
                    <div class="two-stat-item-label">Crime Rate</div>
                    <div class="two-stat-item-val crime">${dB.crime?.toFixed(1)||'—'}</div>
                  </div>
                  <div class="two-stat-item">
                    <div class="two-stat-item-label">Arrest Rate</div>
                    <div class="two-stat-item-val arrest">${dB.arrest?.toFixed(1)||'—'}%</div>
                  </div>
                  <div class="two-stat-item">
                    <div class="two-stat-item-label">CCTV Count</div>
                    <div class="two-stat-item-val">${cctvB > 0 ? cctvB.toLocaleString() : '—'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>



          <div class="two-chart-section">
            <h3>Incident Count by Crime Type</h3>
            <svg id="twoCrimeSvg" width="100%" viewBox="0 0 800 260" preserveAspectRatio="xMidYMid meet" style="display:block"></svg>
          </div>

          <div class="two-chart-section">
            <h3>Crime Rate Trend by Year</h3>
            <svg id="twoTrendSvg" width="100%" viewBox="0 0 800 240" preserveAspectRatio="xMidYMid meet" style="display:block"></svg>
          </div>

          <div class="two-chart-section">
            <h3>Seoul 25 Districts — Scatter Positioning <span style="font-size:13px;font-weight:400;color:var(--text-tertiary)">— x: crime rate, y: arrest rate</span></h3>
            <div style="font-size:12px;color:var(--text-tertiary);margin-bottom:10px;">See where the two selected districts stand among all 25 Seoul districts.</div>
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
              <span style="font-size:12px;font-weight:600;color:var(--text-secondary);">Year</span>
              <input type="range" id="twoScatterYearSlider" min="2021" max="2024" step="1" value="${yr}"
                style="flex:1;accent-color:var(--accent-blue);cursor:pointer;">
              <span id="twoScatterYearLabel" style="font-size:13px;font-weight:700;color:var(--accent-blue);min-width:36px;text-align:right;">${yr}</span>
            </div>
            <svg id="twoScatterSvg" width="100%" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet" style="display:block;border:1px solid var(--border);border-radius:12px;background:var(--bg-card);"></svg>
          </div>

          
        </div>
      `;

      renderMiniMap2('twoMapSvgA', guA, 'a');
      renderMiniMap2('twoMapSvgB', guB, 'b');
      renderTwoCrimeChart2(guA, guB, yr);
      renderTwoTrendChart2(guA, guB);
      renderTwoScatterChart(guA, guB, yr);

      // wire up filter events
      document.querySelectorAll('#crimeFilterList input[type=checkbox]').forEach(cb => {
        cb.onchange = () => {
          renderTwoCrimeChart2(guA, guB, state.year);
        };
      });
    }
  }

  function getSelectedCrimeTypes() {
    const selected = [];
    document.querySelectorAll('#crimeFilterList .crime-filter-item').forEach(item => {
      if (item.querySelector('input').checked) {
        selected.push(item.dataset.key);
      }
    });
    return selected.length > 0 ? selected : CRIME_TYPES;
  }

  /* =========================================================
   * Chart rendering functions — mini-map, scatter, radar, bar (projection fix applied)
   * ========================================================= */
  function renderMiniMap2(containerId, guName, slot, isLarge = false) {
    const container = document.getElementById(containerId);
    const info = SEOUL_DATA.districts[guName];
    if (!container || !info) return;

    const guPath = info.d;
    const dongs = (typeof DONG_DATA !== 'undefined' && DONG_DATA[guName]) ? DONG_DATA[guName] : [];
    const nums = (guPath.match(/-?\d+\.?\d*/g)||[]).map(Number);
    const xs = nums.filter((_,i)=>i%2===0), ys = nums.filter((_,i)=>i%2===1);
    const minx=Math.min(...xs), maxx=Math.max(...xs), miny=Math.min(...ys), maxy=Math.max(...ys);
    const pad = Math.max(maxx-minx, maxy-miny)*0.07;
    const vbX=minx-pad, vbY=miny-pad, vbW=(maxx-minx)+pad*2, vbH=(maxy-miny)+pad*2;
    const scale = Math.max(vbW,vbH)/600;
    const clipId = `miniclip-${slot}-${guName.replace(/[^a-zA-Z0-9]/g,'_')}`;
    const outerStroke = slot==='a' ? '#3b82f6' : '#f97316';
    const svgHeight = isLarge ? '500px' : '440px';

    let svg = `<svg viewBox="${vbX} ${vbY} ${vbW} ${vbH}" xmlns="${NS2}" style="width:100%;height:${svgHeight};display:block" preserveAspectRatio="xMidYMid meet">`;
    svg += `<defs><clipPath id="${clipId}"><path d="${guPath}"/></clipPath></defs>`;
    svg += `<path d="${guPath}" fill="#f8fafc" stroke="${outerStroke}" stroke-width="${3.5*scale}" stroke-linejoin="round"/>`;
    svg += `<g clip-path="url(#${clipId})">`;
    dongs.forEach((dong) => {
      if (!dong.d) return;
      svg += `<path d="${dong.d}" fill="rgba(241,243,245,.7)" stroke="#cbd2d9" stroke-width="${1.2*scale}" stroke-linejoin="round"/>`;
    });
    svg += `</g>`;
    svg += `<path d="${guPath}" fill="none" stroke="${outerStroke}" stroke-width="${3.5*scale}" stroke-linejoin="round"/>`;

    if (state.cctvData && state.cctvData[guName]) {
      const maxR = state.cctvMaxRatio || 520;
      dongs.forEach(dong => {
        const key = Object.keys(state.cctvData[guName]).find(k => dong.name===k || (typeof normalizeDongName==='function' && normalizeDongName(dong.name)===k));
        const info2 = key ? state.cctvData[guName][key] : null;
        if (info2 && info2.ratio > 0) {
          const r = (4 + (info2.ratio/maxR)*24) * scale;
          svg += `<circle cx="${dong.cx}" cy="${dong.cy}" r="${r}" fill="#a78bfa" fill-opacity=".32" stroke="#7c3aed" stroke-width="${1.1*scale}"><title>${dong.name} CCTV ratio: ${info2.ratio.toFixed(1)}</title></circle>`;
        }
      });
    }

    dongs.forEach(dong => {
      svg += `<text x="${dong.cx}" y="${dong.cy}" text-anchor="middle" dominant-baseline="middle" font-size="${11*scale}px" font-weight="600" fill="#1e293b" style="paint-order:stroke;stroke:rgba(255,255,255,.9);stroke-width:${3*scale}px">${dong.name}</text>`;
    });

    // 💡 경찰서 좌표계 완벽 연동 (메인 지도의 scaleX, scaleY 활용)
    if (state.policeData) {
      const guShort = guName.replace('구','');
      state.policeData.forEach(p => {
        if (p.address.includes(guShort)) {
          const px = scaleX(p.lng);
          const py = scaleY(p.lat);
          svg += `<g transform="translate(${px},${py})">
            <circle cx="0" cy="0" r="${3.5*scale}" fill="#64748b" stroke="white" stroke-width="${1.5*scale}">
              <title>${p.name} ${p.type}</title>
            </circle>
          </g>`;
        }
      });
    }
    svg += `</svg>`;
    container.innerHTML = svg;
    
    // 주소 마커 미니맵에도 표시
    if (typeof savedMarkers !== 'undefined' && savedMarkers.length > 0) {
      const miniSvg = container.querySelector('svg');
      if (miniSvg) {
        savedMarkers.forEach(({ lng, lat, addressName }) => {
          const x = scaleX(lng);
          const y = scaleY(lat);
      
          const circle = document.createElementNS(NS2, 'circle');
          circle.setAttribute('cx', x); circle.setAttribute('cy', y);
          circle.setAttribute('r', '6'); circle.setAttribute('fill', '#3b82f6');
          circle.setAttribute('stroke', '#ffffff'); circle.setAttribute('stroke-width', '3');
          miniSvg.appendChild(circle);

          const text = document.createElementNS(NS2, 'text');
          text.setAttribute('x', x); text.setAttribute('y', String(y - 18));
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('font-size', '11'); text.setAttribute('font-weight', '700');
          text.setAttribute('fill', '#1a202c');
          text.textContent = addressName;
          miniSvg.appendChild(text);
        });
      }
    }
  }

  function renderSingleTrendChart(svgId, guA) {
    const svg = document.getElementById(svgId);
    if (!svg || !state.crimeData) return;
    svg.innerHTML = '';
    const years = ['2021','2022','2023','2024'];
    const W=800, H=280, ml=56, mr=40, mt=34, mb=44, iW=W-ml-mr, iH=H-mt-mb;
    const aData = years.map(y=>state.crimeData[guA]?.[y]?.crime||0);
    const minV = Math.min(...aData)*0.85, maxV = Math.max(...aData)*1.1||1;
    const xP = i => ml+(iW/(years.length-1))*i;
    const yP = v => mt+iH-((v-minV)/(maxV-minV))*iH;

    for(let i=0;i<=4;i++){
      const y=mt+(iH/4)*i;
      const gl=document.createElementNS(NS2,'line');
      gl.setAttribute('x1',ml);gl.setAttribute('x2',W-mr);
      gl.setAttribute('y1',y);gl.setAttribute('y2',y);
      gl.setAttribute('stroke','#e2e8f0');gl.setAttribute('stroke-dasharray','4,4');
      svg.appendChild(gl);
      const gt=document.createElementNS(NS2,'text');
      gt.setAttribute('x',ml-6);gt.setAttribute('y',y+4);
      gt.setAttribute('text-anchor','end');gt.setAttribute('font-size','11');
      gt.setAttribute('fill','#94a3b8');gt.textContent=(maxV-((maxV-minV)/4)*i).toFixed(0);
      svg.appendChild(gt);
    }
    years.forEach((yr,i)=>{
      const xt=document.createElementNS(NS2,'text');
      xt.setAttribute('x',xP(i));xt.setAttribute('y',H-mb+18);
      xt.setAttribute('text-anchor','middle');xt.setAttribute('font-size','12');
      xt.setAttribute('fill','#64748b');xt.textContent=yr;
      svg.appendChild(xt);
    });

    let d='';
    aData.forEach((v,i)=>{ d+=(i===0?'M':'L')+`${xP(i)},${yP(v)}`; });
    const path=document.createElementNS(NS2,'path');
    path.setAttribute('d',d);path.setAttribute('fill','none');
    path.setAttribute('stroke','#3b82f6');path.setAttribute('stroke-width','3');
    svg.appendChild(path);

    aData.forEach((v,i)=>{
      const c=document.createElementNS(NS2,'circle');
      c.setAttribute('cx',xP(i));c.setAttribute('cy',yP(v));
      c.setAttribute('r','5');c.setAttribute('fill','#3b82f6');
      c.setAttribute('stroke','white');c.setAttribute('stroke-width','2');
      svg.appendChild(c);
      const t=document.createElementNS(NS2,'text');
      t.setAttribute('x',xP(i));t.setAttribute('y',yP(v)-12);
      t.setAttribute('text-anchor','middle');t.setAttribute('font-size','12');
      t.setAttribute('font-weight','700');t.setAttribute('fill','#3b82f6');
      t.textContent=v.toFixed(0);svg.appendChild(t);
    });
  }

  function renderTwoTrendChart2(guA, guB) {
    const svg = document.getElementById('twoTrendSvg');
    if (!svg || !state.crimeData) return;
    svg.innerHTML = '';
    const years = ['2021','2022','2023','2024'];
    const W=800, H=240, ml=56, mr=40, mt=34, mb=44, iW=W-ml-mr, iH=H-mt-mb;
    const aData = years.map(y=>state.crimeData[guA]?.[y]?.crime||0);
    const bData = years.map(y=>state.crimeData[guB]?.[y]?.crime||0);
    const allV = [...aData,...bData];
    const minV = Math.min(...allV)*0.85, maxV = Math.max(...allV)*1.1||1;
    const xP = i => ml+(iW/(years.length-1))*i;
    const yP = v => mt+iH-((v-minV)/(maxV-minV))*iH;

    for(let i=0;i<=4;i++){
      const y=mt+(iH/4)*i;
      const gl=document.createElementNS(NS2,'line');
      gl.setAttribute('x1',ml);gl.setAttribute('x2',W-mr);
      gl.setAttribute('y1',y);gl.setAttribute('y2',y);
      gl.setAttribute('stroke','#e2e8f0');gl.setAttribute('stroke-dasharray','4,4');
      svg.appendChild(gl);
      const val=maxV-((maxV-minV)/4)*i;
      const gt=document.createElementNS(NS2,'text');
      gt.setAttribute('x',ml-6);gt.setAttribute('y',y+4);
      gt.setAttribute('text-anchor','end');gt.setAttribute('font-size','11');
      gt.setAttribute('fill','#94a3b8');gt.textContent=val.toFixed(0);
      svg.appendChild(gt);
    }
    years.forEach((yr,i)=>{
      const xt=document.createElementNS(NS2,'text');
      xt.setAttribute('x',xP(i));xt.setAttribute('y',H-mb+18);
      xt.setAttribute('text-anchor','middle');xt.setAttribute('font-size','12');
      xt.setAttribute('fill','#64748b');xt.textContent=yr;
      svg.appendChild(xt);
    });

    [[aData,'#3b82f6',guA],[bData,'#f97316',guB]].forEach(([data,color,label],gi)=>{
      let d='';
      data.forEach((v,i)=>{ d+=(i===0?'M':'L')+`${xP(i)},${yP(v)}`; });
      const path=document.createElementNS(NS2,'path');
      path.setAttribute('d',d);path.setAttribute('fill','none');
      path.setAttribute('stroke',color);path.setAttribute('stroke-width','3');
      svg.appendChild(path);

      data.forEach((v,i)=>{
        const c=document.createElementNS(NS2,'circle');
        c.setAttribute('cx',xP(i));c.setAttribute('cy',yP(v));
        c.setAttribute('r','5');c.setAttribute('fill',color);
        c.setAttribute('stroke','white');c.setAttribute('stroke-width','2');
        svg.appendChild(c);
        const t=document.createElementNS(NS2,'text');
        t.setAttribute('x',xP(i));t.setAttribute('y',yP(v)+(gi===0?-12:20));
        t.setAttribute('text-anchor','middle');t.setAttribute('font-size','11');
        t.setAttribute('font-weight','700');t.setAttribute('fill',color);
        t.textContent=v.toFixed(0);svg.appendChild(t);
      });
      const lx=ml+gi*180, lc=document.createElementNS(NS2,'circle');
      lc.setAttribute('cx',lx);lc.setAttribute('cy',mt-16);
      lc.setAttribute('r','5');lc.setAttribute('fill',color);
      svg.appendChild(lc);
      const lt=document.createElementNS(NS2,'text');
      lt.setAttribute('x',lx+12);lt.setAttribute('y',mt-12);
      lt.setAttribute('font-size','13');lt.setAttribute('fill','#4a5568');
      lt.setAttribute('font-weight','700');lt.textContent=label;
      svg.appendChild(lt);
    });
  }

  function renderTwoScatterChart(guA, guB, yr) {
    const svg = document.getElementById('twoScatterSvg');
    if (!svg || !state.crimeData) return;

    const YEARS = ['2021','2022','2023','2024'];
    const W = 800, H = 400, ml = 60, mr = 30, mt = 24, mb = 54;
    const iW = W-ml-mr, iH = H-mt-mb;
    const allGu = Object.keys(SEOUL_DATA.districts);

    // fixed scale across all years
    const allCrime  = allGu.flatMap(gu => YEARS.map(y => state.crimeData[gu]?.[y]?.crime  || 0)).filter(v=>v>0);
    const allArrest = allGu.flatMap(gu => YEARS.map(y => state.crimeData[gu]?.[y]?.arrest || 0)).filter(v=>v>0);
    const minC = Math.min(...allCrime)*0.92,  maxC = Math.max(...allCrime)*1.05;
    const minA = Math.min(...allArrest)*0.92, maxA = Math.max(...allArrest)*1.05;
    const xP = v => ml+((v-minC)/(maxC-minC))*iW;
    const yP = v => mt+iH-((v-minA)/(maxA-minA))*iH;

    // draw for a given year
    function draw(selectedYr) {
      svg.innerHTML = '';
      const pts = allGu.map(gu=>({gu, crime:state.crimeData[gu]?.[selectedYr]?.crime||0, arrest:state.crimeData[gu]?.[selectedYr]?.arrest||0})).filter(p=>p.crime>0);
      const allPts = allGu.flatMap(gu => YEARS.map(y => ({
        crime:  state.crimeData[gu]?.[y]?.crime  || 0,
        arrest: state.crimeData[gu]?.[y]?.arrest || 0,
      }))).filter(p => p.crime > 0);
      const avgC = allPts.reduce((s,p)=>s+p.crime,0)/allPts.length;
      const avgA = allPts.reduce((s,p)=>s+p.arrest,0)/allPts.length;
      const mx=xP(avgC), my=yP(avgA);

      // quadrant backgrounds
      [{x:ml,y:mt,w:mx-ml,h:my-mt,f:'rgba(6,167,125,0.05)'},{x:mx,y:mt,w:W-mr-mx,h:my-mt,f:'rgba(249,115,22,0.05)'},
       {x:ml,y:my,w:mx-ml,h:H-mb-my,f:'rgba(59,130,246,0.05)'},{x:mx,y:my,w:W-mr-mx,h:H-mb-my,f:'rgba(230,57,70,0.05)'}].forEach(q=>{
        const r=document.createElementNS(NS2,'rect'); r.setAttribute('x',q.x);r.setAttribute('y',q.y);r.setAttribute('width',q.w);r.setAttribute('height',q.h);r.setAttribute('fill',q.f); svg.appendChild(r);
      });

      // avg lines
      [[mx,mt,mx,H-mb],[ml,my,W-mr,my]].forEach(([x1,y1,x2,y2])=>{
        const l=document.createElementNS(NS2,'line'); l.setAttribute('x1',x1);l.setAttribute('y1',y1);l.setAttribute('x2',x2);l.setAttribute('y2',y2);l.setAttribute('stroke','#cbd2d9');l.setAttribute('stroke-dasharray','5,4');l.setAttribute('stroke-width','1.5'); svg.appendChild(l);
      });

      // axes
      [[ml,mt,ml,H-mb],[ml,H-mb,W-mr,H-mb]].forEach(([x1,y1,x2,y2])=>{
        const l=document.createElementNS(NS2,'line'); l.setAttribute('x1',x1);l.setAttribute('y1',y1);l.setAttribute('x2',x2);l.setAttribute('y2',y2);l.setAttribute('stroke','#94a3b8');l.setAttribute('stroke-width','1.5'); svg.appendChild(l);
      });

      // ticks
      for(let i=0;i<=5;i++){
        const xv=minC+(maxC-minC)/5*i, x=xP(xv);
        const tk=document.createElementNS(NS2,'line'); tk.setAttribute('x1',x);tk.setAttribute('x2',x);tk.setAttribute('y1',H-mb);tk.setAttribute('y2',H-mb+5);tk.setAttribute('stroke','#94a3b8'); svg.appendChild(tk);
        const t=document.createElementNS(NS2,'text'); t.setAttribute('x',x);t.setAttribute('y',H-mb+18);t.setAttribute('text-anchor','middle');t.setAttribute('font-size','11');t.setAttribute('fill','#64748b');t.textContent=Math.round(xv); svg.appendChild(t);
        const yv=minA+(maxA-minA)/5*i, y=yP(yv);
        const yk=document.createElementNS(NS2,'line'); yk.setAttribute('x1',ml-5);yk.setAttribute('x2',ml);yk.setAttribute('y1',y);yk.setAttribute('y2',y);yk.setAttribute('stroke','#94a3b8'); svg.appendChild(yk);
        const yt=document.createElementNS(NS2,'text'); yt.setAttribute('x',ml-8);yt.setAttribute('y',y+4);yt.setAttribute('text-anchor','end');yt.setAttribute('font-size','11');yt.setAttribute('fill','#64748b');yt.textContent=yv.toFixed(1)+'%'; svg.appendChild(yt);
      }

      // axis labels
      const xl=document.createElementNS(NS2,'text'); xl.setAttribute('x',ml+iW/2);xl.setAttribute('y',H-6);xl.setAttribute('text-anchor','middle');xl.setAttribute('font-size','12');xl.setAttribute('font-weight','600');xl.setAttribute('fill','#475569');xl.textContent='Crime Rate (per 100k)'; svg.appendChild(xl);
      const yl=document.createElementNS(NS2,'text'); yl.setAttribute('transform','rotate(-90)');yl.setAttribute('x',-(mt+iH/2));yl.setAttribute('y',14);yl.setAttribute('text-anchor','middle');yl.setAttribute('font-size','12');yl.setAttribute('font-weight','600');yl.setAttribute('fill','#475569');yl.textContent='Arrest Rate (%)'; svg.appendChild(yl);

      // year label inside chart
      const ytl=document.createElementNS(NS2,'text'); ytl.setAttribute('x',W-mr-8);ytl.setAttribute('y',mt+20);ytl.setAttribute('text-anchor','end');ytl.setAttribute('font-size','22');ytl.setAttribute('font-weight','700');ytl.setAttribute('fill','#e2e8f0');ytl.textContent=selectedYr; svg.appendChild(ytl);

      // background dots (other districts)
      pts.forEach(p=>{
        if(p.gu===guA||p.gu===guB) return;
        const cx=xP(p.crime), cy=yP(p.arrest);
        const c=document.createElementNS(NS2,'circle'); c.setAttribute('cx',cx);c.setAttribute('cy',cy);c.setAttribute('r','5');c.setAttribute('fill','#94a3b8');c.setAttribute('fill-opacity','.5');c.setAttribute('stroke','white');c.setAttribute('stroke-width','1');
        const tt=document.createElementNS(NS2,'title'); tt.textContent=p.gu; c.appendChild(tt); svg.appendChild(c);
        const t=document.createElementNS(NS2,'text'); t.setAttribute('x',cx+7);t.setAttribute('y',cy+4);t.setAttribute('font-size','9');t.setAttribute('fill','#94a3b8');t.textContent=p.gu.replace('구',''); svg.appendChild(t);
      });

      // highlighted districts
      [[guA,'#3b82f6'],[guB,'#f97316']].forEach(([gu,color])=>{
        const p=pts.find(d=>d.gu===gu); if(!p) return;
        const cx=xP(p.crime), cy=yP(p.arrest);
        const glow=document.createElementNS(NS2,'circle'); glow.setAttribute('cx',cx);glow.setAttribute('cy',cy);glow.setAttribute('r','18');glow.setAttribute('fill',color);glow.setAttribute('fill-opacity','.18'); svg.appendChild(glow);
        const c=document.createElementNS(NS2,'circle'); c.setAttribute('cx',cx);c.setAttribute('cy',cy);c.setAttribute('r','9');c.setAttribute('fill',color);c.setAttribute('stroke','white');c.setAttribute('stroke-width','2'); svg.appendChild(c);
        const label=`${gu}  ${p.crime.toFixed(0)} / ${p.arrest.toFixed(1)}%`;
        const t=document.createElementNS(NS2,'text'); t.setAttribute('x',cx+14);t.setAttribute('y',cy-10);t.setAttribute('font-size','12');t.setAttribute('font-weight','700');t.setAttribute('fill',color);
        t.style.paintOrder='stroke'; t.style.stroke='white'; t.style.strokeWidth='3px';
        t.textContent=label; svg.appendChild(t);
      });
    }

    // initial draw
    draw(yr);

    // wire up slider (created fresh each time panel opens)
    const slider = document.getElementById('twoScatterYearSlider');
    const label  = document.getElementById('twoScatterYearLabel');
    if (slider) {
      slider.value = yr;
      // remove previous listener by replacing element
      const newSlider = slider.cloneNode(true);
      slider.parentNode.replaceChild(newSlider, slider);
      newSlider.addEventListener('input', e => {
        const y = e.target.value;
        if (label) label.textContent = y;
        draw(y);
      });
    }
  }

  function renderTwoRadarChart(guA, guB, yr) {
    const svg = document.getElementById('twoRadarSvg');
    if (!svg || !state.crimeData) return; 
    svg.innerHTML = '';
    
    const W = 500, H = 420, cx = W/2, cy = H/2 - 10, R = 150;
    const types = getSelectedCrimeTypes();
    const LABELS = {murder:'Murder', robbery:'Robbery', theft:'Theft', violence:'Violence', rape:'Sexual Assault'};
    const COLORS = {murder:'#e63946', robbery:'#f97316', theft:'#eab308', violence:'#06a77d', rape:'#3b82f6'};
    
    if (types.length < 3) {
      const t = document.createElementNS(NS2, 'text');
      t.setAttribute('x', cx); t.setAttribute('y', cy);
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '14');
      t.setAttribute('fill', '#94a3b8'); t.textContent = 'Select at least 3 crime types to display the radar chart';
      svg.appendChild(t);
      return;
    }

    const n = types.length, angle = i => (Math.PI*2/n)*i - Math.PI/2;
    const dA = state.crimeData[guA]?.[yr]?.occur || {};
    const dB = state.crimeData[guB]?.[yr]?.occur || {};
    const maxVal = Math.max(...types.map(k => Math.max(dA[k]||0, dB[k]||0)), 1);

    [0.25, 0.5, 0.75, 1].forEach(ratio => {
      const pts = types.map((_, i) => `${cx + R*ratio*Math.cos(angle(i))},${cy + R*ratio*Math.sin(angle(i))}`).join(' ');
      const poly = document.createElementNS(NS2, 'polygon');
      poly.setAttribute('points', pts); poly.setAttribute('fill', 'none'); poly.setAttribute('stroke', '#e2e8f0'); 
      svg.appendChild(poly);
    });
    
    types.forEach((_, i) => {
      const l = document.createElementNS(NS2, 'line');
      l.setAttribute('x1', cx); l.setAttribute('y1', cy); l.setAttribute('x2', cx + R*Math.cos(angle(i))); l.setAttribute('y2', cy + R*Math.sin(angle(i))); l.setAttribute('stroke', '#e2e8f0'); 
      svg.appendChild(l);
    });

    [[dA, '#3b82f6', 0.5], [dB, '#f97316', 0.45]].forEach(([d, color, op]) => {
      const pts = types.map((k, i) => `${cx + ((d[k]||0)/maxVal)*R*Math.cos(angle(i))},${cy + ((d[k]||0)/maxVal)*R*Math.sin(angle(i))}`).join(' ');
      const poly = document.createElementNS(NS2, 'polygon');
      poly.setAttribute('points', pts); poly.setAttribute('fill', color); poly.setAttribute('fill-opacity', op); poly.setAttribute('stroke', color); poly.setAttribute('stroke-width', '2'); 
      svg.appendChild(poly);
    });

    types.forEach((k, i) => {
      const t = document.createElementNS(NS2, 'text');
      t.setAttribute('x', cx + (R+26)*Math.cos(angle(i))); t.setAttribute('y', cy + (R+26)*Math.sin(angle(i)));
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle'); t.setAttribute('font-size', '13'); t.setAttribute('font-weight', '700'); t.setAttribute('fill', COLORS[k]); t.textContent = LABELS[k]; 
      svg.appendChild(t);
    });
  }

  

  function renderTwoCrimeChart2(guA, guB, yr) {
    const svg = document.getElementById('twoCrimeSvg');
    if (!svg || !state.crimeData) return; 
    svg.innerHTML = '';
    
    const W=800, H=260, ml=56, mr=20, mt=30, mb=54, iW=W-ml-mr, iH=H-mt-mb;
    const types = getSelectedCrimeTypes(); 
    if(!types.length) return;
    
    const LABELS={murder:'Murder', robbery:'Robbery', theft:'Theft', violence:'Violence', rape:'Sexual Assault'};
    const dA=state.crimeData[guA]?.[yr]?.occur||{}, dB=state.crimeData[guB]?.[yr]?.occur||{};
    const maxV=Math.max(...types.flatMap(k=>[dA[k]||0,dB[k]||0]),1);
    const step=iW/types.length, barW=step*.28;

    for(let i=0;i<=4;i++){
      const y=mt+(iH/4)*i, gl=document.createElementNS(NS2,'line');
      gl.setAttribute('x1',ml);gl.setAttribute('x2',W-mr);gl.setAttribute('y1',y);gl.setAttribute('y2',y);gl.setAttribute('stroke','#e2e8f0');gl.setAttribute('stroke-dasharray','3,3'); svg.appendChild(gl);
    }
    
    types.forEach((k,i)=>{
      const cx=ml+step*i+step/2;
      [[dA[k]||0,'#3b82f6',guA],[dB[k]||0,'#f97316',guB]].forEach(([v,color,name],j)=>{
        const bh=Math.max((v/maxV)*iH,1), bx=cx+(j===0?-barW-2:2);
        const r=document.createElementNS(NS2,'rect'); 
        r.setAttribute('x',bx); r.setAttribute('y',mt+iH-bh); r.setAttribute('width',barW); r.setAttribute('height',bh); r.setAttribute('fill',color); r.setAttribute('rx','3'); 
        svg.appendChild(r);
        
        if(v>0){
          const vt=document.createElementNS(NS2,'text'); 
          vt.setAttribute('x',bx+barW/2); vt.setAttribute('y',mt+iH-bh-4); vt.setAttribute('text-anchor','middle'); vt.setAttribute('font-size','11'); vt.setAttribute('font-weight','600'); vt.setAttribute('fill',color); vt.textContent=v; 
          svg.appendChild(vt);
        }
      });
      const xt=document.createElementNS(NS2,'text'); 
      xt.setAttribute('x',cx); xt.setAttribute('y',H-mb+18); xt.setAttribute('text-anchor','middle'); xt.setAttribute('font-size','13'); xt.setAttribute('font-weight','600'); xt.setAttribute('fill','#4a5568'); xt.textContent=LABELS[k]; 
      svg.appendChild(xt);
    });
  }

  /* =========================================================
   * 5. Initialization and async data load
   * ========================================================= */
  waitForData(async () => {
    await loadExternalData(); 
    injectStyles();
    injectHTML();
    setupIntercepts();
  });

})();
