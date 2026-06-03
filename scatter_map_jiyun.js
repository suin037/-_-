/* ============================================================
 *  scatter_map_jiyun.js  (jiyun)
 *  Feature: scatter plot linked to choropleth map
 *   - CSS transform-based dot animation on year transition
 *   - always-on district-name label + collision avoidance
 *   - hover → map highlight  /  click → district modal
 * ========================================================== */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function waitForData(cb) {
    if (typeof state !== 'undefined' && state.crimeData) cb();
    else setTimeout(() => waitForData(cb), 100);
  }

  function injectStyles() {
    if (document.getElementById('scatterMapJiyunStyles')) return;
    const css = document.createElement('style');
    css.id = 'scatterMapJiyunStyles';
    css.textContent = `
      .gu-path.scatter-hover {
        stroke: var(--accent-blue, #3b82f6) !important;
        stroke-width: 4 !important;
        vector-effect: non-scaling-stroke;   /* render stroke in real screen px */
      }
      .gu-label.scatter-hover-label { fill: var(--accent-blue, #3b82f6); font-weight: 800; }

      /* dot group — position is animated via JS rAF tween (see _runDotTween) */
      .scatter-dot-g circle.main-dot {
        transition: r 0.15s, fill 0.15s, fill-opacity 0.15s;
      }
      .scatter-point-label {
        font-size: 10px; font-weight: 500; fill: var(--text-tertiary, #8b95a1);
        text-anchor: middle; pointer-events: none;
        paint-order: stroke; stroke: var(--bg-card, #fff); stroke-width: 3px;
        stroke-linejoin: round;
        transition: fill .15s;
      }
      .scatter-point-label.active { fill: var(--accent-blue, #3b82f6); font-weight: 700; font-size: 12px; }
    `;
    document.head.appendChild(css);
  }

  function tagGuPaths() {
    const keys = Object.keys(SEOUL_DATA.districts);
    document.querySelectorAll('#seoulMap .gu-path').forEach((p, i) => {
      if (keys[i]) p.setAttribute('data-gu', keys[i]);
    });
    document.querySelectorAll('#seoulMap .gu-label').forEach(l => {
      if (l.textContent) l.setAttribute('data-gu-label', l.textContent);
    });
  }

  function highlightMapGu(guName) {
    if (typeof state !== 'undefined' && state.selectedGu) return;
    const mapSvg = document.getElementById('seoulMap');
    if (!mapSvg) return;
    mapSvg.querySelectorAll('.gu-path').forEach(p => {
      if (p.getAttribute('data-gu') === guName) { p.classList.add('scatter-hover'); mapSvg.appendChild(p); }
    });
    const lab = mapSvg.querySelector(`[data-gu-label="${guName}"]`);
    if (lab) { lab.classList.add('scatter-hover-label'); mapSvg.appendChild(lab); }
  }

  function clearMapHighlight() {
    const mapSvg = document.getElementById('seoulMap');
    if (!mapSvg) return;
    mapSvg.querySelectorAll('.gu-path').forEach(p => p.classList.remove('scatter-hover', 'scatter-dim'));
    mapSvg.querySelectorAll('.gu-label').forEach(l => l.classList.remove('scatter-hover-label'));
  }

  /* ── fixed scale across all years ── */
  function getFixedScales(allGu) {
    const allYears = Object.keys(state.crimeData[allGu[0]] || {});
    const allCrime  = allGu.flatMap(gu => allYears.map(yr => state.crimeData[gu]?.[yr]?.crime  || 0)).filter(v => v > 0);
    const allArrest = allGu.flatMap(gu => allYears.map(yr => state.crimeData[gu]?.[yr]?.arrest || 0)).filter(v => v > 0);
    return {
      minC: Math.min(...allCrime)  * 0.92, maxC: Math.max(...allCrime)  * 1.05,
      minA: Math.min(...allArrest) * 0.92, maxA: Math.max(...allArrest) * 1.05,
    };
  }

  /* ── label collision avoidance ── */
  const _FS = 10, _R = 7, _charW = 9.6;
  const _estW = t => t.length * _charW + 4;
  const _ov   = (a, b) => !(a.x2<=b.x1||a.x1>=b.x2||a.y2<=b.y1||a.y1>=b.y2);
  const _inB  = (b, ml, mr, mt, mb, W, H) =>
    b.x1>=ml-2 && b.x2<=W-mr+2 && b.y1>=mt-2 && b.y2<=H-mb+2;
  const _box  = (cand, w) => {
    const x1 = cand.anchor==='middle' ? cand.tx-w/2 : cand.anchor==='start' ? cand.tx : cand.tx-w;
    return { x1, x2:x1+w, y1:cand.ty-_FS, y2:cand.ty+2 };
  };
  const _cands = (cx, cy) => ([
    { tx:cx,        ty:cy-_R-7,  anchor:'middle', leader:false },
    { tx:cx,        ty:cy+_R+13, anchor:'middle', leader:false },
    { tx:cx+_R+5,   ty:cy+3.5,   anchor:'start',  leader:false },
    { tx:cx-_R-5,   ty:cy+3.5,   anchor:'end',    leader:false },
    { tx:cx,        ty:cy-_R-19, anchor:'middle', leader:true  },
    { tx:cx,        ty:cy+_R+25, anchor:'middle', leader:true  },
    { tx:cx+_R+6,   ty:cy-11,    anchor:'start',  leader:true  },
    { tx:cx-_R-6,   ty:cy-11,    anchor:'end',    leader:true  },
    { tx:cx+_R+6,   ty:cy+18,    anchor:'start',  leader:true  },
    { tx:cx-_R-6,   ty:cy+18,    anchor:'end',    leader:true  },
  ]);

  /* ── static layer: axes, quadrants, labels ── */
  function renderStaticLayer(svg, W, H, ml, mr, mt, mb, xP, yP, avgC, avgA, minC, maxC, minA, maxA) {
    const iW = W-ml-mr, iH = H-mt-mb;
    const mx = xP(avgC), my = yP(avgA);

    // quadrant backgrounds
    [
      {x:ml,  y:mt,  w:mx-ml,   h:my-mt,   fill:'rgba(6,167,125,0.05)'},
      {x:mx,  y:mt,  w:W-mr-mx, h:my-mt,   fill:'rgba(249,115,22,0.05)'},
      {x:ml,  y:my,  w:mx-ml,   h:H-mb-my, fill:'rgba(59,130,246,0.05)'},
      {x:mx,  y:my,  w:W-mr-mx, h:H-mb-my, fill:'rgba(230,57,70,0.05)'},
    ].forEach(q => {
      const r = document.createElementNS(NS,'rect');
      r.setAttribute('x',q.x); r.setAttribute('y',q.y);
      r.setAttribute('width',q.w); r.setAttribute('height',q.h);
      r.setAttribute('fill',q.fill); svg.appendChild(r);
    });

    // average reference lines
    [[mx,mt,mx,H-mb],[ml,my,W-mr,my]].forEach(([x1,y1,x2,y2]) => {
      const l = document.createElementNS(NS,'line');
      l.setAttribute('x1',x1); l.setAttribute('y1',y1);
      l.setAttribute('x2',x2); l.setAttribute('y2',y2);
      l.setAttribute('stroke','#cbd2d9'); l.setAttribute('stroke-dasharray','5,4');
      l.setAttribute('stroke-width','1.5'); svg.appendChild(l);
    });

    // axes
    [[ml,mt,ml,H-mb],[ml,H-mb,W-mr,H-mb]].forEach(([x1,y1,x2,y2]) => {
      const l = document.createElementNS(NS,'line');
      l.setAttribute('x1',x1); l.setAttribute('y1',y1);
      l.setAttribute('x2',x2); l.setAttribute('y2',y2);
      l.setAttribute('stroke','#94a3b8'); l.setAttribute('stroke-width','1.5'); svg.appendChild(l);
    });

    // ticks
    for(let i=0;i<=5;i++){
      const xv = minC+(maxC-minC)/5*i, x = xP(xv);
      const tl=document.createElementNS(NS,'line');
      tl.setAttribute('x1',x);tl.setAttribute('x2',x);tl.setAttribute('y1',H-mb);tl.setAttribute('y2',H-mb+5);tl.setAttribute('stroke','#94a3b8'); svg.appendChild(tl);
      const tt=document.createElementNS(NS,'text');
      tt.setAttribute('x',x);tt.setAttribute('y',H-mb+18);tt.setAttribute('text-anchor','middle');tt.setAttribute('font-size','11');tt.setAttribute('fill','#64748b');tt.textContent=Math.round(xv); svg.appendChild(tt);

      const yv = minA+(maxA-minA)/5*i, y = yP(yv);
      const yl=document.createElementNS(NS,'line');
      yl.setAttribute('x1',ml-5);yl.setAttribute('x2',ml);yl.setAttribute('y1',y);yl.setAttribute('y2',y);yl.setAttribute('stroke','#94a3b8'); svg.appendChild(yl);
      const yt=document.createElementNS(NS,'text');
      yt.setAttribute('x',ml-10);yt.setAttribute('y',y+4);yt.setAttribute('text-anchor','end');yt.setAttribute('font-size','11');yt.setAttribute('fill','#64748b');yt.textContent=yv.toFixed(1)+'%'; svg.appendChild(yt);
    }

    // axis labels
    const xl=document.createElementNS(NS,'text');
    xl.setAttribute('x',ml+iW/2);xl.setAttribute('y',H-4);xl.setAttribute('text-anchor','middle');xl.setAttribute('font-size','12');xl.setAttribute('font-weight','600');xl.setAttribute('fill','#475569');xl.textContent='Crime Rate (per 100k)'; svg.appendChild(xl);
    const yl2=document.createElementNS(NS,'text');
    yl2.setAttribute('transform','rotate(-90)');yl2.setAttribute('x',-(mt+iH/2));yl2.setAttribute('y',12);yl2.setAttribute('text-anchor','middle');yl2.setAttribute('font-size','12');yl2.setAttribute('font-weight','600');yl2.setAttribute('fill','#475569');yl2.textContent='Arrest Rate (%)'; svg.appendChild(yl2);

    // quadrant text labels
    [
      {x:ml+8,   y:mt+16,  text:'Crime↓ Arrest↑', color:'#06a77d'},
      {x:W-mr-8, y:mt+16,  text:'Crime↑ Arrest↑', color:'#f97316', anchor:'end'},
      {x:ml+8,   y:H-mb-8, text:'Crime↓ Arrest↓', color:'#3b82f6'},
      {x:W-mr-8, y:H-mb-8, text:'Crime↑ Arrest↓', color:'#e63946', anchor:'end'},
    ].forEach(q => {
      const t=document.createElementNS(NS,'text');
      t.setAttribute('x',q.x);t.setAttribute('y',q.y);t.setAttribute('font-size','11');t.setAttribute('font-weight','600');t.setAttribute('fill',q.color);t.setAttribute('opacity','0.7');
      if(q.anchor) t.setAttribute('text-anchor',q.anchor);
      t.textContent=q.text; svg.appendChild(t);
    });
  }

  /* ── dot layer — DOM created once, position updated on re-render ── */
  const _dotMap = {}; // gu → { g, circle, glow, lbl, leaderLine }

  // tracks currently brushed districts (set by onBrushUpdate)
  const _brushedSet = new Set();

  // currently hovered district (module-scope so a re-render can clear it → no ghost dot)
  let _hoveredGu = null;

  // ---- JS rAF tween for dot position (reliable year-change animation across browsers) ----
  let _dotAnimRAF = null;
  function _runDotTween(list, dur) {
    if (_dotAnimRAF) cancelAnimationFrame(_dotAnimRAF);
    if (!list.length) return;
    const t0 = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3); // easeOutCubic
    function frame(now) {
      const k = Math.min(1, (now - t0) / dur), e = ease(k);
      for (const it of list) {
        const x = it.fromX + (it.toX - it.fromX) * e;
        const y = it.fromY + (it.toY - it.fromY) * e;
        it.g.setAttribute('transform', `translate(${x}, ${y})`);
        const lx = it.flx + (it.tlx - it.flx) * e;
        const ly = it.fly + (it.tly - it.fly) * e;
        it.lbl.setAttribute('x', lx); it.lbl.setAttribute('y', ly);
        if (it.leaderLine) {
          it.leaderLine.setAttribute('x1', x); it.leaderLine.setAttribute('y1', y);
          it.leaderLine.setAttribute('x2', lx); it.leaderLine.setAttribute('y2', ly - 3);
        }
      }
      if (k < 1) _dotAnimRAF = requestAnimationFrame(frame);
      else _dotAnimRAF = null;
    }
    _dotAnimRAF = requestAnimationFrame(frame);
  }

  function applyBrushedStyles() {
    Object.entries(_dotMap).forEach(([gu, d]) => {
      const brushed = _brushedSet.has(gu);
      d.circle.setAttribute('r', brushed ? '10' : '7');
      d.circle.setAttribute('fill', brushed ? '#2563eb' : '#64748b');
      d.circle.setAttribute('fill-opacity', brushed ? '1' : '0.65');
      d.circle.setAttribute('stroke-width', brushed ? '2.2' : '1.5');
      d.glow.setAttribute('r', brushed ? '24' : '20');
      d.glow.setAttribute('fill-opacity', brushed ? '0.22' : '0');
      d.lbl.classList.toggle('active', brushed);
      d.g.style.opacity = '';
      d.lbl.style.opacity = '';
    });
  }

  function resetAllDots() {
    const tooltip = document.getElementById('scatterTooltip');
    applyBrushedStyles();
    clearMapHighlight();
    if (tooltip) tooltip.style.display = 'none';
  }

  function renderDotsLayer(svg, points, xP, yP, W, H, ml, mr, mt, mb) {
    const tooltip = document.getElementById('scatterTooltip');

    // document-level pointer tracking — never misses mouseleave
    if (!svg._jiyunMoveSet) {
      const tooltip = document.getElementById('scatterTooltip');

      document.addEventListener('pointermove', function(e) {
        // among ALL dots stacked under the cursor, pick the one whose center is
        // nearest the cursor — so a dot hidden behind another is still hoverable
        const stack = document.elementsFromPoint(e.clientX, e.clientY);
        let newGu = null, _bestD = Infinity;
        for (const node of stack) {
          const gu = node.dataset && node.dataset.gu;
          if (!gu || !_dotMap[gu]) continue;
          const rb = node.getBoundingClientRect();
          const dx = e.clientX - (rb.left + rb.width / 2);
          const dy = e.clientY - (rb.top + rb.height / 2);
          const d2 = dx * dx + dy * dy;
          if (d2 < _bestD) { _bestD = d2; newGu = gu; }
        }

        // update tooltip position if same dot
        if (newGu === _hoveredGu) {
          if (newGu && tooltip && tooltip.style.display === 'block') {
            const wrap = svg.closest('div');
            if (wrap) {
              const rect = wrap.getBoundingClientRect();
              tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
              tooltip.style.top  = (e.clientY - rect.top  - 40) + 'px';
            }
          }
          return;
        }

        // un-hover previous dot (restore to base or brushed state)
        if (_hoveredGu && _dotMap[_hoveredGu]) {
          const prev = _dotMap[_hoveredGu];
          const isBrushed = _brushedSet.has(_hoveredGu);
          prev.circle.setAttribute('r', isBrushed ? '10' : '7');
          prev.circle.setAttribute('fill', isBrushed ? '#2563eb' : '#64748b');
          prev.circle.setAttribute('fill-opacity', isBrushed ? '1' : '0.65');
          prev.circle.setAttribute('stroke-width', isBrushed ? '2.2' : '1.5');
          prev.glow.setAttribute('r', isBrushed ? '24' : '20');
          prev.glow.setAttribute('fill-opacity', isBrushed ? '0.22' : '0');
          prev.lbl.classList.toggle('active', isBrushed);
          clearMapHighlight();
          if (tooltip) tooltip.style.display = 'none';
        }

        _hoveredGu = newGu;
        if (!newGu || !_dotMap[newGu]) return;

        // hover new dot — no dimming, just highlight this one
        const { g, circle, glow, lbl } = _dotMap[newGu];
        circle.setAttribute('r', '13');
        circle.setAttribute('fill', '#3b82f6');
        circle.setAttribute('fill-opacity', '1');
        circle.setAttribute('stroke', 'white');
        circle.setAttribute('stroke-width', '3');
        glow.setAttribute('r', '28');
        glow.setAttribute('fill-opacity', '0.3');
        lbl.classList.add('active');
        svg.appendChild(g);
        svg.appendChild(lbl);

        highlightMapGu(newGu);

        const yr = typeof state !== 'undefined' ? state.year : null;
        const crime  = yr ? state.crimeData?.[newGu]?.[yr]?.crime  : null;
        const arrest = yr ? state.crimeData?.[newGu]?.[yr]?.arrest : null;

        if (tooltip) {
          tooltip.style.display = 'block';
          tooltip.innerHTML = `
            <span style="font-size:14px;font-weight:700">${newGu}</span><br>
            <span style="color:#fca5a5">Crime Rate ${crime ? crime.toFixed(1) : '—'}</span>
            &nbsp;<span style="opacity:0.4">|</span>&nbsp;
            <span style="color:#6ee7b7">Arrest Rate ${arrest ? arrest.toFixed(1) : '—'}%</span>`;
          const wrap = svg.closest('div');
          if (wrap) {
            const rect = wrap.getBoundingClientRect();
            tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
            tooltip.style.top  = (e.clientY - rect.top  - 40) + 'px';
          }
        }
      });

      svg._jiyunMoveSet = true;
    }

    // compute collision-aware label positions
    const _placed = [];
    points.map(p => ({ p, cx: xP(p.crime), cy: yP(p.arrest) }))
          .sort((a, b) => a.cx - b.cx)
          .forEach(({ p, cx, cy }) => {
            const w = _estW(p.gu);
            let best = null, bestScore = Infinity;
            for (const cand of _cands(cx, cy)) {
              const box = _box(cand, w);
              let s = 0;
              if (!_inB(box, ml, mr, mt, mb, W, H)) s += 1000;
              for (const pb of _placed) {
                if (_ov(box, pb)) {
                  const ox = Math.min(box.x2,pb.x2)-Math.max(box.x1,pb.x1);
                  const oy = Math.min(box.y2,pb.y2)-Math.max(box.y1,pb.y1);
                  s += Math.max(0,ox)*Math.max(0,oy);
                }
              }
              if (!cand.leader) s -= 6;
              if (s < bestScore) { bestScore = s; best = { cand, box }; }
              if (s <= 0) break;
            }
            p._label = best.cand;
            _placed.push(best.box);
          });

    const seenGu = new Set();
    const _animList = [];   // existing dots to tween from old → new position

    // fully reset hover state before re-render so a hovered dot doesn't leave a ghost
    // (a dot hovered during a year change would otherwise keep its enlarged/blue look
    //  and glide to the new spot via the transform transition)
    _hoveredGu = null;
    applyBrushedStyles();          // restore every dot to its base (or brushed) look + opacity
    clearMapHighlight();
    const _tt = document.getElementById('scatterTooltip');
    if (_tt) _tt.style.display = 'none';

    points.forEach(p => {
      seenGu.add(p.gu);
      const cx = xP(p.crime), cy = yP(p.arrest);
      const lab = p._label || { tx: cx, ty: cy - 12, anchor: 'middle', leader: false };

      if (_dotMap[p.gu]) {
        // existing dot: tween from its current position to the new one (JS rAF)
        const { g, circle, glow, lbl, leaderLine } = _dotMap[p.gu];
        glow.setAttribute('cx', 0); glow.setAttribute('cy', 0);
        circle.setAttribute('cx', 0); circle.setAttribute('cy', 0);
        lbl.setAttribute('text-anchor', lab.anchor);

        // read current (from) positions straight off the DOM
        const tm = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(g.getAttribute('transform') || '');
        const fromX = tm ? parseFloat(tm[1]) : cx;
        const fromY = tm ? parseFloat(tm[2]) : cy;
        let flx = parseFloat(lbl.getAttribute('x')); if (isNaN(flx)) flx = lab.tx;
        let fly = parseFloat(lbl.getAttribute('y')); if (isNaN(fly)) fly = lab.ty;

        _animList.push({
          g, lbl, leaderLine,
          fromX, fromY, toX: cx, toY: cy,
          flx, fly, tlx: lab.tx, tly: lab.ty,
        });

      } else {
        // new dot: create DOM elements
        const g = document.createElementNS(NS, 'g');
        g.setAttribute('class', 'scatter-dot-g');
        g.setAttribute('transform', `translate(${cx}, ${cy})`);

        const glow = document.createElementNS(NS, 'circle');
        glow.setAttribute('cx', 0); glow.setAttribute('cy', 0);
        glow.setAttribute('r', '20'); glow.setAttribute('fill', '#3b82f6');
        glow.setAttribute('fill-opacity', '0');
        g.appendChild(glow);

        const circle = document.createElementNS(NS, 'circle');
        circle.setAttribute('cx', 0); circle.setAttribute('cy', 0);
        circle.setAttribute('r', '7'); circle.setAttribute('fill', '#64748b');
        circle.setAttribute('fill-opacity', '0.65');
        circle.setAttribute('stroke', 'white'); circle.setAttribute('stroke-width', '1.5');
        circle.setAttribute('class', 'main-dot');
        circle.style.cursor = 'pointer';
        g.appendChild(circle);

        // large transparent hit area so overlapping dots are easier to hover
        const hitArea = document.createElementNS(NS, 'circle');
        hitArea.setAttribute('cx', 0); hitArea.setAttribute('cy', 0);
        hitArea.setAttribute('r', '14'); hitArea.setAttribute('fill', 'transparent');
        hitArea.setAttribute('stroke', 'none');
        hitArea.dataset.gu = p.gu;
        hitArea.style.cursor = 'pointer';
        hitArea.addEventListener('click', () => selectGu(p.gu));
        g.appendChild(hitArea);

        svg.appendChild(g);

        // leader line when label is far from point
        let leaderLine = null;
        if (lab.leader) {
          leaderLine = document.createElementNS(NS, 'line');
          leaderLine.setAttribute('x1', cx); leaderLine.setAttribute('y1', cy);
          leaderLine.setAttribute('x2', lab.tx); leaderLine.setAttribute('y2', lab.ty - 3);
          leaderLine.setAttribute('stroke', '#cbd2d9'); leaderLine.setAttribute('stroke-width', '0.8');
          svg.appendChild(leaderLine);
        }

        // label
        const lbl = document.createElementNS(NS, 'text');
        lbl.setAttribute('x', lab.tx); lbl.setAttribute('y', lab.ty);
        lbl.setAttribute('class', 'scatter-point-label');
        lbl.setAttribute('text-anchor', lab.anchor);
        lbl.textContent = p.gu;
        svg.appendChild(lbl);

        circle.addEventListener('click', () => selectGu(p.gu));
        circle.dataset.gu = p.gu;

        _dotMap[p.gu] = { g, circle, glow, lbl, leaderLine };
      }
    });

    // animate all existing dots from their old positions to the new ones
    _runDotTween(_animList, 550);

    // remove dots for districts no longer in data
    Object.keys(_dotMap).forEach(gu => {
      if (!seenGu.has(gu)) {
        const { g, lbl, leaderLine } = _dotMap[gu];
        g.remove(); lbl.remove(); if (leaderLine) leaderLine.remove();
        delete _dotMap[gu];
      }
    });
  }

  /* ── main render function ── */
  let _staticRendered = false;
  let _lastScaleKey = '';

  function renderMainScatterEnhanced() {
    const svg = document.getElementById('mainScatterSvg');
    if (!svg || !state.crimeData) return;

    const W = 800, H = 280;
    const ml = 58, mr = 20, mt = 20, mb = 52;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.maxHeight = '280px';
    const iW = W-ml-mr, iH = H-mt-mb;
    const allGu = Object.keys(SEOUL_DATA.districts);

    const { minC, maxC, minA, maxA } = getFixedScales(allGu);
    const xP = v => ml + ((v-minC)/(maxC-minC))*iW;
    const yP = v => mt + iH - ((v-minA)/(maxA-minA))*iH;

    const points = allGu.map(gu => ({
      gu,
      crime:  state.crimeData[gu]?.[state.year]?.crime  || 0,
      arrest: state.crimeData[gu]?.[state.year]?.arrest || 0,
    })).filter(p => p.crime > 0);

    const allYears = ['2021','2022','2023','2024'];
    const allPoints = allGu.flatMap(gu => allYears.map(yr => ({
      crime:  state.crimeData[gu]?.[yr]?.crime  || 0,
      arrest: state.crimeData[gu]?.[yr]?.arrest || 0,
    }))).filter(p => p.crime > 0);
    const avgC = allPoints.reduce((a,b)=>a+b.crime, 0)  / allPoints.length;
    const avgA = allPoints.reduce((a,b)=>a+b.arrest, 0) / allPoints.length;

    // always redraw static layer (avg lines change per year)
    [...svg.querySelectorAll(':not(.scatter-dot-g):not(.scatter-point-label):not(.scatter-dot-g *)')].forEach(el => el.remove());
    renderStaticLayer(svg, W, H, ml, mr, mt, mb, xP, yP, avgC, avgA, minC, maxC, minA, maxA);

    // update dot layer (CSS transition handles animation)
    renderDotsLayer(svg, points, xP, yP, W, H, ml, mr, mt, mb);

    // re-append all dots and labels on top of static layer
    Object.values(_dotMap).forEach(d => {
      svg.appendChild(d.g);
      svg.appendChild(d.lbl);
    });
  }

  // ---- bootstrap ----
  waitForData(() => {
    injectStyles();

    if (!window._jiyunMapWrapped && typeof window.renderMainMap === 'function') {
      const origMap = window.renderMainMap;
      window.renderMainMap = function () { origMap.apply(this, arguments); tagGuPaths(); };
      window._jiyunMapWrapped = true;
    }

    window.renderMainScatter = renderMainScatterEnhanced;

    if (typeof window.renderMainMap === 'function') window.renderMainMap();
    renderMainScatterEnhanced();

    // receive brush selection from brushing_hyewon.js — keeps highlighted dots fixed
    window.onBrushUpdate = function(brushedGus) {
      _brushedSet.clear();
      brushedGus.forEach(gu => _brushedSet.add(gu));

      // if dots not yet rendered, trigger a render first
      if (Object.keys(_dotMap).length === 0) {
        renderMainScatterEnhanced();
        return;
      }
      applyBrushedStyles();
    };
  });
})();
