// ★ CSS 간섭 방어막
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
    d3.selectAll('.address-marker-group').remove();
    console.log("All markers have been removed.");
});


// 1. Function to convert address to coordinates (Vworld API - JSONP method)
function geocodeAndMarkWithVworld(address) {
    const callbackName = 'vworldCallback_' + Math.round(100000 * Math.random());

    window[callbackName] = function(data) {
        delete window[callbackName];
        document.getElementById(callbackName).remove();

        if (data.response.status !== 'OK' || !data.response.result) {
            alert("Address not found. Please try again with a 'road name address'! (e.g., 서울특별시 서대문구 연세로 50)");
            return;
        }

        const point = data.response.result.point;
        drawMarkerOnMap(parseFloat(point.x), parseFloat(point.y), address);
    };

    const script = document.createElement('script');
    script.id = callbackName;
    script.src = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&address=${encodeURIComponent(address)}&refine=true&simple=false&format=jsonp&type=road&key=${VWORLD_API_KEY}&callback=${callbackName}`;

    script.onerror = function() {
        alert("Connection blocked by Vworld server!");
        delete window[callbackName];
        script.remove();
    };

    document.body.appendChild(script);
}

function drawMarkerOnMap(lng, lat, addressName) {
  savedMarkers.push({ lng, lat, addressName });
  renderAllMarkers();
}

function getMarkerLayer() {
  const mapSvg = d3.select('#seoulMap');
  let layer = mapSvg.select('.address-marker-layer');

  if (layer.empty()) {
    layer = mapSvg.append('g').attr('class', 'address-marker-layer');
    
    // 💡 깡패 감시자: 지도의 다른 구역이 앞으로 튀어나와도 마커 레이어를 즉시 최상단으로 다시 끌어올림!
    const observer = new MutationObserver(() => {
        const node = layer.node();
        const parent = node.parentNode;
        // 누군가 내 앞으로 오면(내가 마지막 자식이 아니면), 내가 다시 맨 뒤(화면상 맨 앞)로 간다!
        if (parent && parent.lastElementChild !== node) {
            parent.appendChild(node); 
        }
    });
    observer.observe(document.getElementById('seoulMap'), { childList: true });
  }

  layer.style('opacity', 1).style('filter', 'none').raise();
  return layer;
}

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
        const idx = savedMarkers.findIndex(m => m.lng === lng && m.lat === lat);
        if (idx !== -1) savedMarkers.splice(idx, 1);
        d3.select(this).remove();
      })
      .on('mouseover', function(event) {
        event.stopPropagation();
      })
      .on('mouseout', function(event) {
        event.stopPropagation();
      });

    markerGroup.append('circle')
      .attr('cx', 0).attr('cy', 0)
      .attr('r', 16)
      .attr('fill', '#ffffff');

    markerGroup.append('circle')
      .attr('cx', 0).attr('cy', 0)
      .attr('r', 12)
      .attr('fill', '#008000')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 3.5);

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