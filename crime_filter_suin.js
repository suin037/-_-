setTimeout(() => {
  console.log(state.crimeData['강남구']['2021']);
}, 5000);


// 데이터 로드 완료 후 실행되도록 대기
function waitForData(callback) {
  if (state.crimeData) {
    callback();
  } else {
    setTimeout(() => waitForData(callback), 100);
  }
}

// 범죄 유형 필터 상태
const crimeFilterState = {
  selectedType: null // null이면 전체(기존 방식), 아니면 'murder','robbery','theft','violence','rape'
};

// 변경 
const CRIME_LABEL = {
  murder: 'Murder',
  robbery: 'Robbery',
  theft: 'Theft',
  violence: 'Violence',
  rape: 'Sexual Assault'
};

// 사이드바에 범죄 유형 필터 UI 추가
function injectCrimeFilterUI() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const block = document.createElement('div');
  block.className = 'control-block';
  // 변경 후
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

  // 버튼 클릭 이벤트
  block.querySelectorAll('.crime-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      block.querySelectorAll('.crime-filter-btn').forEach(b => {
        b.style.background = 'var(--bg-tertiary)';
        b.style.borderColor = 'var(--border)';
        b.style.fontWeight = '400';
      });
      btn.style.background = 'var(--accent-crime-light)';
      btn.style.borderColor = 'var(--accent-crime)';
      btn.style.fontWeight = '700';

      const type = btn.dataset.type;
      crimeFilterState.selectedType = type === 'all' ? null : type;
      renderMainMapWithFilter();
    });
  });
}

// 선택된 범죄 유형 기준으로 색 계산
function getColorByType(guName) {
  const year = state.year;
  const crimeData = state.crimeData;

  if (!crimeData || !crimeData[guName] || !crimeData[guName][year]) {
    return 'rgba(230, 57, 70, 0.15)';
  }

  if (!crimeFilterState.selectedType) {
    // 전체: 기존 방식 그대로
    const val = state.metric === 'crime'
      ? crimeData[guName][year].crime
      : crimeData[guName][year].arrest;
    return getColor(val, state.metric);
  }
  // 범죄율(10만명당) 기준으로 색 계산
  const dataKey = state.metric === 'arrest' ? 'arrest_by_type' : 'crimeRate';

  const allValues = Object.keys(crimeData)
    .filter(g => crimeData[g][year] && crimeData[g][year][dataKey])
    .map(g => crimeData[g][year][dataKey][crimeFilterState.selectedType] || 0);

  const max = Math.max(...allValues);
  const val = crimeData[guName][year][dataKey][crimeFilterState.selectedType] || 0;
  const intensity = max > 0 ? val / max : 0;

  if (state.metric === 'arrest') {
    return `rgba(6, 167, 125, ${0.1 + intensity * 0.9})`;
    }
    return `rgba(230, 57, 70, ${0.1 + intensity * 0.9})`;
}

// 필터 적용된 메인맵 렌더링 (기존 renderMainMap 확장)
function renderMainMapWithFilter() {
  const mapSvg = document.getElementById('seoulMap');
  if (!mapSvg) return;

  const vb = SEOUL_DATA.viewBox;
  mapSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  mapSvg.innerHTML = '';

  Object.entries(SEOUL_DATA.districts).forEach(([guName, info]) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', info.d);
    path.setAttribute('fill', getColorByType(guName));
    path.setAttribute('stroke', '#ffffff');
    path.setAttribute('stroke-width', '2.5');

    let cls = 'gu-path';
    if (state.selectedGu === guName) cls += ' selected';
    else if (state.selectedGu) cls += ' dimmed';
    path.setAttribute('class', cls);

    path.addEventListener('click', (e) => {
      e.stopPropagation();
      selectGu(guName);
    });

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    const typeLabel = crimeFilterState.selectedType ? CRIME_LABEL[crimeFilterState.selectedType] : (state.metric === 'crime' ? '범죄율' : '검거율');
    title.textContent = `${guName} · ${typeLabel}`;
    path.appendChild(title);
    mapSvg.appendChild(path);

    // 구 라벨
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', info.label_x);
    text.setAttribute('y', info.label_y);
    text.setAttribute('class', state.selectedGu && state.selectedGu !== guName ? 'gu-label dim' : 'gu-label');
    text.textContent = guName;
    mapSvg.appendChild(text);
  });
  // 주소 마커 다시 그리기
  if (typeof renderAllMarkers === 'function') renderAllMarkers();
}

// 기존 renderMainMap을 필터 버전으로 교체
function overrideRenderMainMap() {
  window._originalRenderMainMap = renderMainMap;
  window.renderMainMap = renderMainMapWithFilter;
}

// 초기화
waitForData(() => {
  injectCrimeFilterUI();
  overrideRenderMainMap();
  renderMainMapWithFilter();
});