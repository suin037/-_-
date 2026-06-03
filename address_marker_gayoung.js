const savedMarkers = [];

// Get search button and input field elements
const searchBtn = document.getElementById('addressSearchBtn');
const addressInput = document.getElementById('addressInput');

// ★ Insert your Vworld API key here! ★
const VWORLD_API_KEY = 'ED781C53-FF4A-306E-A6DD-6A9D35D1EC34';

// Execute search on button click
searchBtn.addEventListener('click', () => {
    const address = addressInput.value.trim();
    if (!address) {
        alert("Please enter an address!");
        return;
    }
    geocodeAndMarkWithVworld(address);
});

// Trigger search on Enter key press
addressInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchBtn.click();
    }
});

// Get the reset button element
const resetBtn = document.getElementById('resetBtn');

// Add event listener for the reset button
resetBtn.addEventListener('click', () => {
    savedMarkers.length = 0; // empty the array
    // Remove every marker; the dedicated marker layer itself can stay in place.
    d3.selectAll('.address-marker-group').remove();
    console.log("All markers have been removed.");
});


// 1. Function to convert address to coordinates (Vworld API - JSONP method)
function geocodeAndMarkWithVworld(address) {
    console.log("1. Search started! Entered address:", address); // For debugging in F12 console

    const callbackName = 'vworldCallback_' + Math.round(100000 * Math.random());

    window[callbackName] = function(data) {
        console.log("3. Data received from Vworld!", data); // For debugging in F12 console
        
        delete window[callbackName];
        document.getElementById(callbackName).remove();

        if (data.response.status !== 'OK' || !data.response.result) {
            alert("Address not found. Please try again with a 'road name address'! (e.g., 서울특별시 서대문구 연세로 50)");
            return;
        }

        const point = data.response.result.point;
        console.log("4. Found coordinates:", point.x, point.y); // For debugging in F12 console
        
        // Call the function to draw a marker on the map
        drawMarkerOnMap(parseFloat(point.x), parseFloat(point.y), address);
    };

    const script = document.createElement('script');
    script.id = callbackName;
    
    script.src = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&address=${encodeURIComponent(address)}&refine=true&simple=false&format=jsonp&type=road&key=${VWORLD_API_KEY}&callback=${callbackName}`;

    script.onerror = function() {
        alert("Connection blocked by Vworld server! Please check if your URL is 127.0.0.1:5500.");
        delete window[callbackName];
        script.remove();
    };

    console.log("2. Sending data request to Vworld..."); // For debugging in F12 console
    document.body.appendChild(script);
}

function drawMarkerOnMap(lng, lat, addressName) {
  savedMarkers.push({ lng, lat, addressName });
  renderAllMarkers();
}

// Keep a single dedicated layer for all address markers. Because every marker
// lives inside this one <g> and the layer is always raised to be the LAST child
// of the SVG, the markers stay on top of every district path. They also opt out
// of the district dimming effect (opacity / pointer hover blur on .gu-path) so
// the point always renders sharply, even while hovering over another district.
function getMarkerLayer() {
  const mapSvg = d3.select('#seoulMap');
  let layer = mapSvg.select('.address-marker-layer');

  if (layer.empty()) {
    layer = mapSvg.append('g').attr('class', 'address-marker-layer');
  }

  // Force the marker layer above all district paths and at full opacity,
  // shielding it from any inherited dimming/blur state on the map.
  layer
    .style('opacity', 1)
    .style('filter', 'none')
    .raise();

  return layer;
}

function renderAllMarkers() {
  const layer = getMarkerLayer();
  // Clear only the markers, not the whole layer node, so it stays on top.
  layer.selectAll('*').remove();

  savedMarkers.forEach(({ lng, lat, addressName }) => {
    const x = scaleX(lng);
    const y = scaleY(lat);

    const markerGroup = layer.append('g')
      .attr('class', 'address-marker-group')
      .style('opacity', 1)
      .style('cursor', 'pointer')
      .style('filter', 'drop-shadow(0px 2px 4px rgba(0,0,0,0.45))')
      .on('click', function() {
        const idx = savedMarkers.findIndex(m => m.lng === lng && m.lat === lat);
        if (idx !== -1) savedMarkers.splice(idx, 1);
        d3.select(this).remove();
      });

    // White halo behind the pin for strong contrast on any district color.
    markerGroup.append('circle')
      .attr('cx', x).attr('cy', y).attr('r', 16)
      .attr('fill', '#ffffff');

    // Vivid red pin — clearly distinct from the blue police-station markers.
    markerGroup.append('circle')
      .attr('cx', x).attr('cy', y).attr('r', 12)
      .attr('fill', '#ef2d56').attr('stroke', '#ffffff').attr('stroke-width', 3.5);

    markerGroup.append('text')
      .attr('x', x).attr('y', y - 20)
      .attr('text-anchor', 'middle')
      .attr('font-size', '22px').attr('font-weight', '800').attr('fill', '#b91c3c')
      .style('paint-order', 'stroke')
      .style('stroke', 'rgba(255, 255, 255, 0.95)').style('stroke-width', '4.5px')
      .text(addressName);
  });

  // Re-assert top stacking order after (re)drawing the markers.
  layer.raise();
}
