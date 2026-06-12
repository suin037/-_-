// ─────────────────────────────────────────────────────────────
// address_marker_gayoung.js
// Geocodes user-entered addresses via the Vworld API and pins
// them as SVG markers on the Seoul choropleth map.
// ─────────────────────────────────────────────────────────────

// ── Prevent the map's dim/transition styles from hiding markers ──
const markerStyle = document.createElement('style');
markerStyle.innerHTML = `
  #seoulMap .address-marker-group,
  #seoulMap .address-marker-group circle,
  #seoulMap .address-marker-group text {
    opacity: 1 !important;
    fill-opacity: 1 !important;
    stroke-opacity: 1 !important;
    transition: none !important;
    pointer-events: auto !important;
  }
  #seoulMap .address-marker-group:hover {
    filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.6)) !important;
  }
`;
document.head.appendChild(markerStyle);

// In-memory array of all currently pinned addresses
const savedMarkers = [];

// DOM references
const searchBtn   = document.getElementById('addressSearchBtn');
const addressInput = document.getElementById('addressInput');

// Vworld API key for road-address geocoding
const VWORLD_API_KEY = 'ED781C53-FF4A-306E-A6DD-6A9D35D1EC34';

// Trigger geocoding on button click
searchBtn.addEventListener('click', () => {
    const address = addressInput.value.trim();
    if (!address) {
        alert("Please enter an address!");
        return;
    }
    geocodeAndMarkWithVworld(address);
});

// Also trigger on Enter key press inside the input field
addressInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchBtn.click();
    }
});

// Remove all markers from the map and clear the saved list
const resetBtn = document.getElementById('resetBtn');
resetBtn.addEventListener('click', () => {
    savedMarkers.length = 0;
    d3.selectAll('.address-marker-group').remove();
});

// ── Geocoding ────────────────────────────────────────────────

/**
 * Converts a Korean road-name address to WGS-84 coordinates
 * using the Vworld API (JSONP), then places a marker on the map.
 *
 * @param {string} address - Road-name address string
 */
function geocodeAndMarkWithVworld(address) {
    // Generate a unique callback name to avoid collisions
    const callbackName = 'vworldCallback_' + Math.round(100000 * Math.random());

    window[callbackName] = function(data) {
        delete window[callbackName];
        document.getElementById(callbackName).remove();

        if (data.response.status !== 'OK' || !data.response.result) {
            alert("Address not found. Please try again with a 'road name address'!\n(e.g., 서울특별시 서대문구 연세로 50)");
            return;
        }

        const point = data.response.result.point;
        drawMarkerOnMap(parseFloat(point.x), parseFloat(point.y), address);
    };

    const script = document.createElement('script');
    script.id  = callbackName;
    script.src = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&address=${encodeURIComponent(address)}&refine=true&simple=false&format=jsonp&type=road&key=${VWORLD_API_KEY}&callback=${callbackName}`;

    script.onerror = function() {
        alert("Connection blocked by Vworld server!");
        delete window[callbackName];
        script.remove();
    };

    document.body.appendChild(script);
}

// ── Marker rendering ─────────────────────────────────────────

/**
 * Saves a marker to the list and triggers a full re-render.
 *
 * @param {number} lng         - Longitude (WGS-84)
 * @param {number} lat         - Latitude  (WGS-84)
 * @param {string} addressName - Label text shown next to the pin
 */
function drawMarkerOnMap(lng, lat, addressName) {
    savedMarkers.push({ lng, lat, addressName });
    renderAllMarkers();
}

/**
 * Returns (or lazily creates) the SVG layer that holds all markers.
 * A MutationObserver keeps the layer at the top of the z-order so
 * it is never obscured by map re-renders.
 *
 * @returns {d3.Selection} The marker layer <g> element
 */
function getMarkerLayer() {
    const mapSvg = d3.select('#seoulMap');
    let layer = mapSvg.select('.address-marker-layer');

    if (layer.empty()) {
        layer = mapSvg.append('g').attr('class', 'address-marker-layer');

        // Watch the SVG for new children; always keep the marker layer last
        // (= visually on top) so district re-renders don't bury the markers.
        const observer = new MutationObserver(() => {
            const node   = layer.node();
            const parent = node.parentNode;
            if (parent && parent.lastElementChild !== node) {
                parent.appendChild(node);
            }
        });
        observer.observe(document.getElementById('seoulMap'), { childList: true });
    }

    layer.style('opacity', 1).style('filter', 'none').raise();
    return layer;
}

/**
 * Clears and re-draws every saved marker on the map.
 * Clicking a marker removes it from the saved list.
 */
function renderAllMarkers() {
    const layer = getMarkerLayer();
    layer.selectAll('*').remove();

    savedMarkers.forEach(({ lng, lat, addressName }) => {
        const x = scaleX(lng);
        const y = scaleY(lat);

        const markerGroup = layer.append('g')
            .attr('class', 'address-marker-group')
            .attr('transform', `translate(${x}, ${y})`)
            .style('cursor', 'pointer')
            .style('filter', 'drop-shadow(0px 2px 4px rgba(0,0,0,0.45))')
            .on('click', function(event) {
                event.stopPropagation();
                // Remove only this marker
                const idx = savedMarkers.findIndex(m => m.lng === lng && m.lat === lat);
                if (idx !== -1) savedMarkers.splice(idx, 1);
                d3.select(this).remove();
            })
            .on('mouseover', (event) => event.stopPropagation())
            .on('mouseout',  (event) => event.stopPropagation());

        // White halo (background circle for contrast)
        markerGroup.append('circle')
            .attr('cx', 0).attr('cy', 0)
            .attr('r', 16)
            .attr('fill', '#ffffff');

        // Colored filled circle (pin body)
        markerGroup.append('circle')
            .attr('cx', 0).attr('cy', 0)
            .attr('r', 12)
            .attr('fill', '#008000')
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 3.5);

        // Address label above the pin
        markerGroup.append('text')
            .attr('x', 0).attr('y', -20)
            .attr('text-anchor', 'middle')
            .attr('font-size', '22px')
            .attr('font-weight', '800')
            .attr('fill', '#008000')
            .style('paint-order', 'stroke')
            .style('stroke', 'rgba(255, 255, 255, 0.95)')
            .style('stroke-width', '4.5px')
            .text(addressName);
    });

    layer.raise();
}
