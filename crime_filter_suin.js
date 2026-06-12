// ─────────────────────────────────────────────────────────────
// crime_filter_suin.js
// Adds a crime-type filter UI to the sidebar and re-renders
// the choropleth map based on the selected crime category.
// ─────────────────────────────────────────────────────────────

/**
 * Polls until state.crimeData is ready, then calls the callback.
 * Used by all modules that depend on the shared data store.
 *
 * @param {Function} callback - Function to call once data is loaded
 */
function waitForData(callback) {
  if (state.crimeData) {
    callback();
  } else {
    setTimeout(() => waitForData(callback), 100);
  }
}

// Tracks the currently selected crime type filter.
// null = show all crimes (aggregate view).
const crimeFilterState = {
  selectedType: null // one of: null | 'murder' | 'robbery' | 'theft' | 'violence' | 'rape'
};

// Human-readable labels for each crime type key
const CRIME_LABEL = {
  murder:   'Murder',
  robbery:  'Robbery',
  theft:    'Theft',
  violence: 'Violence',
  rape:     'Sexual Assault'
};

/**
 * Injects the crime-type filter button group into the sidebar.
 * Buttons update crimeFilterState and trigger a map re-render.
 */
function injectCrimeFilterUI() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const block = document.createElement('div');
  block.className = 'control-block';
  block.innerHTML = `
    <div class="control-label">Crime Type Filter</div>
    <div id="crimeTypeFilter" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px;">
      <button class="crime-filter-btn active" data-type="all"
        style="padding:5px 4px; border-radius:6px; border:1.5px solid var(--border);
        background:var(--bg-tertiary); color:var(--text-primary); cursor:pointer; font-size:11px; font-weight:600; text-align:center;">
        All
      </button>
      ${Object.entries(CRIME_LABEL).map(([key, label]) => `
        <button class="crime-filter-btn" data-type="${key}"
          style="padding:5px 4px; border-radius:6px; border:1.5px solid var(--border);
          background:var(--bg-tertiary); color:var(--text-primary); cursor:pointer; font-size:11px; font-weight:600; text-align:center;">
          ${label}
        </button>
      `).join('')}
    </div>
  `;
  document.getElementById('sidebar-crime-filter').appendChild(block);

  /**
   * Returns the highlight colors for the active filter button,
   * adapting to the current metric (crime = red, arrest = green).
   */
  function activeFilterColors() {
    return state.metric === 'arrest'
      ? { bg: 'var(--accent-arrest-light)', border: 'var(--accent-arrest)' }
      : { bg: 'var(--accent-crime-light)',  border: 'var(--accent-crime)'  };
  }

  /**
   * Re-applies metric-aware highlight colors to the active filter button
   * and resets all inactive buttons to their default style.
   */
  function refreshFilterButtonColors() {
    const filter = document.getElementById('crimeTypeFilter');
    if (!filter) return;
    const colors = activeFilterColors();
    filter.querySelectorAll('.crime-filter-btn').forEach(b => {
      if (b.classList.contains('active')) {
        b.style.background    = colors.bg;
        b.style.borderColor   = colors.border;
        b.style.fontWeight    = '700';
      } else {
        b.style.background    = 'var(--bg-tertiary)';
        b.style.borderColor   = 'var(--border)';
        b.style.fontWeight    = '400';
      }
    });
  }

  // Update filter state and re-render map on button click
  block.querySelectorAll('.crime-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      block.querySelectorAll('.crime-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const type = btn.dataset.type;
      crimeFilterState.selectedType = type === 'all' ? null : type;
      refreshFilterButtonColors();
      renderMainMapWithFilter();
    });
  });

  // Re-color the active button whenever the crime/arrest metric toggle changes.
  // setTimeout(0) ensures state.metric is already updated by the original handler.
  document.querySelectorAll('.metric-toggle button').forEach(mb => {
    mb.addEventListener('click', () => {
      setTimeout(refreshFilterButtonColors, 0);
    });
  });
}

/**
 * Computes the fill color for a district based on the active crime filter
 * and the current metric (crime rate or arrest rate).
 *
 * @param {string} guName - District name (e.g. "강남구")
 * @returns {string} An rgba color string
 */
function getColorByType(guName) {
  const year      = state.year;
  const crimeData = state.crimeData;

  // Return a light default color if data is missing
  if (!crimeData || !crimeData[guName] || !crimeData[guName][year]) {
    return 'rgba(230, 57, 70, 0.15)';
  }

  // Aggregate mode: use the shared getColor helper
  if (!crimeFilterState.selectedType) {
    const val = state.metric === 'crime'
      ? crimeData[guName][year].crime
      : crimeData[guName][year].arrest;
    return getColor(val, state.metric);
  }

  // Per-type mode: normalize against the max value across all districts
  const dataKey = state.metric === 'arrest' ? 'arrest_by_type' : 'crimeRate';

  const allValues = Object.keys(crimeData)
    .filter(g => crimeData[g][year] && crimeData[g][year][dataKey])
    .map(g => crimeData[g][year][dataKey][crimeFilterState.selectedType] || 0);

  const max       = Math.max(...allValues);
  const val       = crimeData[guName][year][dataKey][crimeFilterState.selectedType] || 0;
  const intensity = max > 0 ? val / max : 0;

  if (state.metric === 'arrest') {
    return `rgba(6, 167, 125, ${0.1 + intensity * 0.9})`;
  }
  return `rgba(230, 57, 70, ${0.1 + intensity * 0.9})`;
}

/**
 * Draws all district paths onto the main SVG map using the active
 * crime filter. Also re-renders address markers if available.
 * This function replaces the original renderMainMap.
 */
function renderMainMapWithFilter() {
  const mapSvg = document.getElementById('seoulMap');
  if (!mapSvg) return;

  const vb = SEOUL_DATA.viewBox;
  mapSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  mapSvg.innerHTML = '';

  Object.entries(SEOUL_DATA.districts).forEach(([guName, info]) => {
    // Draw district path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d',            info.d);
    path.setAttribute('fill',         getColorByType(guName));
    path.setAttribute('stroke',       '#ffffff');
    path.setAttribute('stroke-width', '2.5');

    let cls = 'gu-path';
    if      (state.selectedGu === guName) cls += ' selected';
    else if (state.selectedGu)            cls += ' dimmed';
    path.setAttribute('class', cls);

    path.addEventListener('click', (e) => {
      e.stopPropagation();
      selectGu(guName);
    });

    // Tooltip title shown on hover
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    const typeLabel = crimeFilterState.selectedType
      ? CRIME_LABEL[crimeFilterState.selectedType]
      : (state.metric === 'crime' ? 'Crime rate' : 'Arrest rate');
    title.textContent = `${guName} · ${typeLabel}`;
    path.appendChild(title);
    mapSvg.appendChild(path);

    // District name label
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', info.label_x);
    text.setAttribute('y', info.label_y);
    text.setAttribute('class', state.selectedGu && state.selectedGu !== guName ? 'gu-label dim' : 'gu-label');
    text.textContent = guName;
    mapSvg.appendChild(text);
  });

  // Re-draw address markers on top of the updated map
  if (typeof renderAllMarkers === 'function') renderAllMarkers();
}

/**
 * Replaces the global renderMainMap with the filter-aware version
 * so all callers automatically benefit from the crime filter.
 */
function overrideRenderMainMap() {
  window._originalRenderMainMap = renderMainMap;
  window.renderMainMap = renderMainMapWithFilter;
}

// ── Bootstrap ────────────────────────────────────────────────
waitForData(() => {
  injectCrimeFilterUI();
  overrideRenderMainMap();
  renderMainMapWithFilter();
});
