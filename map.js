document.getElementById('app').innerHTML = `
  <h2 class="centered-heading">Safe Route</h2>

  <div id="location-inputs">
    <input type="text" id="start-address" placeholder="Enter start location" autocomplete="off" />
    <div id="start-suggestions" class="autocomplete-suggestions"></div>
    <input type="text" id="end-address" placeholder="Enter destination" autocomplete="off" />
    <div id="end-suggestions" class="autocomplete-suggestions"></div>

    <select id="travel-mode">
      <option value="foot-walking">🚶 Walking</option>
      <option value="cycling-regular">🚲 Cycling</option>
    </select>

    <button onclick="geocodeAndDrawRoute()">Plot Route</button>
  </div>

  <div id="map"></div>

  <h3>Live Feedback</h3>
  <div id="feedback-buttons">
    <button onclick="submitFeedback('crime')">⚠️ Crime</button>
    <button onclick="submitFeedback('lighting')">🔦 Poor Lighting</button>
    <button onclick="submitFeedback('pothole')">🕳️ Pothole</button>
    <button onclick="submitFeedback('safe')">✅ Safe Area</button>
  </div>

  <button id="panic-button" onclick="triggerPanic()">🚨 Panic</button>

  <div id="manual-feedback-section" style="margin: 24px 0 12px 0; text-align:center;">
    <input type="text" id="manual-feedback-street" placeholder="Enter street name for feedback" style="width:60%;padding:10px;border-radius:6px;border:1.5px solid #d0d7de;" />
    <select id="manual-feedback-type" style="padding:10px 18px;border-radius:6px;border:1.5px solid #d0d7de;">
      <option value="crime">⚠️ Crime</option>
      <option value="lighting">🔦 Poor Lighting</option>
      <option value="pothole">🕳️ Pothole</option>
      <option value="safe">✅ Safe Area</option>
    </select>
    <button id="manual-feedback-btn" style="padding:10px 18px;border-radius:6px;border:1.5px solid #d0d7de;background:#ffdddd;color:#b30000;font-weight:600;cursor:pointer;">Report Feedback</button>
  </div>

  <div id="danger-areas-table-section" style="margin: 0 0 24px 0; text-align:center;"></div>
`;

let map;
let startMarker, endMarker;
let routePolylines = [];

const southWest = L.latLng(-26.33, 27.95);
const northEast = L.latLng(-26.05, 28.20);
const joburgBounds = L.latLngBounds(southWest, northEast);

const reportedIssues = []; //[{ latlng: [lat, lng], type: 'crime' }]
//Test Data
reportedIssues.push(
  { latlng: [-26.1915, 28.0680], type: 'crime' },      //near Makers Valley
  { latlng: [-26.1922, 28.0715], type: 'lighting' },   //another nearby point
  { latlng: [-26.1950, 28.0650], type: 'pothole' }     //slightly west
);




setTimeout(() => {
  map = L.map('map', {
    maxBounds: joburgBounds,
    maxBoundsViscosity: 1.0,
    minZoom: 11,
    maxZoom: 18,
  }).setView([-26.1951, 28.0697], 13); //Center on Makers Valley

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  setupAutocomplete('start-address', 'start-suggestions');
  setupAutocomplete('end-address', 'end-suggestions');
}, 0);

function geocodeAddress(address, callback) {
  const apiKey = "5b3ce3597851110001cf6248837f3145429a4ad1aabe11c432e8d7ae"; //use your ORS key
  const url = `https://api.openrouteservice.org/geocode/search?api_key=${apiKey}&text=${encodeURIComponent(address)}&boundary.country=ZA&size=5`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data.features.length > 0) {
        const coords = data.features[0].geometry.coordinates;
        callback([coords[1], coords[0]]); // [lat, lng]
      } else {
        alert(`No results found for: ${address}`);
      }
    })
    .catch(err => {
      console.error(err);
      alert('Geocoding failed (ORS).');
    });
}


// Route fetcher using ORS
function drawRouteWithORS(startCoords, endCoords, mode) {
  const apiKey = "5b3ce3597851110001cf6248837f3145429a4ad1aabe11c432e8d7ae";

  // Build avoid polygons GeoJSON from dangerAreas
  let avoidPolygons = null;
  if (dangerAreas.length > 0) {
    avoidPolygons = {
      type: "MultiPolygon",
      coordinates: dangerAreas.map(area => [[
        [area.minLon, area.minLat],
        [area.maxLon, area.minLat],
        [area.maxLon, area.maxLat],
        [area.minLon, area.maxLat],
        [area.minLon, area.minLat]
      ]])
    };
  }

  // Prepare POST body for ORS
  const body = {
    coordinates: [
      [startCoords[1], startCoords[0]],
      [endCoords[1], endCoords[0]]
    ],
    format: "geojson"
  };
  if (avoidPolygons) {
    body.options = { avoid_polygons: avoidPolygons };
  }

  // Remove previous route polylines
  if (routePolylines && routePolylines.length) {
    routePolylines.forEach(line => map.removeLayer(line));
    routePolylines = [];
  }

  fetch(`https://api.openrouteservice.org/v2/directions/${mode}/geojson`, {
    method: "POST",
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
    .then(res => res.json())
    .then(data => {
      console.log('ORS route API response:', data); // Debug log
      if (!data.features || data.features.length === 0) {
        alert("No route found that avoids all reported danger areas. Please try a different start or end point.");
        return;
      }
      const coords = data.features[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
      if (!coords || coords.length < 2) {
        alert("Route data is incomplete. This may happen if the start or end location is not on a routable street, or if the route is blocked. Try different locations.");
        return;
      }
      // Draw segment-by-segment with appropriate color
      for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i];
        const p2 = coords[i + 1];
        const isUnsafe = reportedIssues.some(issue => {
          const midpoint = [
            (p1[0] + p2[0]) / 2,
            (p1[1] + p2[1]) / 2
          ];
          return map.distance(midpoint, issue.latlng) < 50;
        });
        const polyline = L.polyline([p1, p2], {
          color: isUnsafe ? 'red' : 'green',
          weight: 5,
          opacity: 0.9
        }).addTo(map);
        routePolylines.push(polyline);
      }
      // Add start/end markers
      if (startMarker) map.removeLayer(startMarker);
      if (endMarker) map.removeLayer(endMarker);
      startMarker = L.marker(startCoords).addTo(map).bindPopup('Start').openPopup();
      endMarker = L.marker(endCoords).addTo(map).bindPopup('End').openPopup();
      map.fitBounds(L.polyline(coords).getBounds());
      // Warn if near any reported issues
      let dangerFound = false;
      for (let i = 0; i < coords.length; i++) {
        for (let issue of reportedIssues) {
          const dist = map.distance(coords[i], issue.latlng);
          if (dist < 50) {
            dangerFound = true;
            break;
          }
        }
        if (dangerFound) break;
      }
      if (dangerFound) {
        alert("Warning: This route passes through a reported unsafe area!");
      }
    })
    .catch((err) => {
      console.error("Routing error:", err);
      alert("Failed to retrieve route. Please try again.");
    });
}

// Entry point from UI
function geocodeAndDrawRoute() {
  const startInput = document.getElementById('start-address');
  const endInput = document.getElementById('end-address');
  const startAddress = startInput.value;
  const endAddress = endInput.value;
  const mode = document.getElementById('travel-mode').value;

  if (!startAddress || !endAddress) {
    alert('Please enter both start and end locations.');
    return;
  }

  // Use selectedPlace if available, else fallback to geocode
  function getCoords(input, cb) {
    if (input.selectedPlace && input.selectedPlace.lat && input.selectedPlace.lon) {
      cb([parseFloat(input.selectedPlace.lat), parseFloat(input.selectedPlace.lon)]);
    } else {
      geocodeAddress(input.value, cb);
    }
  }

  getCoords(startInput, (startCoords) => {
    getCoords(endInput, (endCoords) => {
      drawRouteWithORS(startCoords, endCoords, mode);
    });
  });
}

// Gather feedback from the user to later assign to the map itself
function submitFeedback(type) {
  if (!navigator.geolocation) {
    alert("Geolocation not supported.");
    return;
  }

  navigator.geolocation.getCurrentPosition((position) => {
    const feedback = {
      type,
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      timestamp: new Date().toISOString()
    };

    // Load existing feedbacks
    const existing = JSON.parse(localStorage.getItem("feedbacks") || "[]");

    // Add new feedback
    existing.push(feedback);

    // Save updated feedbacks
    localStorage.setItem("feedbacks", JSON.stringify(existing));

    alert(`✅ Feedback submitted: ${type}`);
    L.marker([feedback.lat, feedback.lon])
      .addTo(map)
      .bindPopup(`${type} reported here`)
      .openPopup();
  }, () => {
    alert("❌ Could not get your location.");
  });
}


// Panic button
function triggerPanic() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;
      alert(`🚨 Panic alert sent!\nLocation: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
      L.marker([latitude, longitude]).addTo(map).bindPopup("🚨 Panic Location").openPopup();
    });
  } else {
    alert("Geolocation not supported.");
  }
}
// --- Enhanced Manual Feedback by Street Autofill ---
const manualStreetInput = document.getElementById('manual-feedback-street');
const manualSuggestions = document.createElement('div');
manualSuggestions.className = 'autocomplete-suggestions';
manualSuggestions.style.position = 'absolute';
manualSuggestions.style.left = manualStreetInput.offsetLeft + 'px';
manualSuggestions.style.top = (manualStreetInput.offsetTop + manualStreetInput.offsetHeight) + 'px';
manualSuggestions.style.width = manualStreetInput.offsetWidth + 'px';
manualSuggestions.style.zIndex = '2000';
manualSuggestions.style.maxHeight = '220px';
manualSuggestions.style.overflowY = 'auto';
manualSuggestions.style.background = '#fff';
manualSuggestions.style.borderRadius = '6px';
manualSuggestions.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
manualSuggestions.style.border = '1.5px solid #d0d7de';
manualSuggestions.style.fontSize = '1rem';
manualSuggestions.style.padding = '0';
manualSuggestions.style.marginTop = '2px';
manualStreetInput.parentNode.appendChild(manualSuggestions);

// Keep suggestions box in sync with input width on resize
window.addEventListener('resize', function() {
  manualSuggestions.style.width = manualStreetInput.offsetWidth + 'px';
  manualSuggestions.style.left = manualStreetInput.offsetLeft + 'px';
});

let manualFetchId = 0;
let selectedManualPlace = null;

manualStreetInput.addEventListener('input', function() {
  const query = manualStreetInput.value.trim();
  selectedManualPlace = null;
  if (query.length < 1) {
    manualSuggestions.innerHTML = '';
    return;
  }
  manualSuggestions.innerHTML = '<div class="suggestion">Loading...</div>';
  const fetchId = ++manualFetchId;
  fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Johannesburg, South Africa')}&addressdetails=1&limit=10&countrycodes=za`)
    .then(res => res.json())
    .then(data => {
      if (fetchId !== manualFetchId) return;
      manualSuggestions.innerHTML = '';
      if (!data.length) {
        manualSuggestions.innerHTML = '<div class="suggestion">No streets found</div>';
        return;
      }
      data.forEach(place => {
        const div = document.createElement('div');
        div.className = 'suggestion';
        div.textContent = place.display_name;
        div.style.padding = '10px 16px';
        div.style.cursor = 'pointer';
        div.onmouseover = () => div.style.background = '#f2f2f2';
        div.onmouseout = () => div.style.background = '';
        div.onclick = () => {
          manualStreetInput.value = place.display_name;
          selectedManualPlace = place;
          manualSuggestions.innerHTML = '';
          manualStreetInput.dispatchEvent(new Event('change'));
        };
        manualSuggestions.appendChild(div);
      });
      if (!manualSuggestions.innerHTML) manualSuggestions.innerHTML = '<div class="suggestion">No streets found</div>';
    })
    .catch(() => {
      manualSuggestions.innerHTML = '<div class="suggestion">Error loading suggestions</div>';
    });
});

document.addEventListener('click', function(e) {
  if (!manualSuggestions.contains(e.target) && e.target !== manualStreetInput) {
    manualSuggestions.innerHTML = '';
  }
});

// --- Map Click to Autofill Feedback Street ---
setTimeout(() => {
  if (map) {
    map.on('click', function(e) {
      const { lat, lng } = e.latlng;
      // Show loading in input
      manualStreetInput.value = 'Loading street name...';
      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`)
        .then(res => res.json())
        .then(data => {
          if (data && data.display_name) {
            manualStreetInput.value = data.display_name;
            selectedManualPlace = {
              display_name: data.display_name,
              boundingbox: data.boundingbox || [lat-0.0005, lat+0.0005, lng-0.0005, lng+0.0005]
            };
            manualStreetInput.focus();
          } else {
            manualStreetInput.value = '';
            alert('Could not find a street at this location.');
          }
        })
        .catch(() => {
          manualStreetInput.value = '';
          alert('Error finding street for this location.');
        });
    });
  }
}, 500);

// --- Enhanced Address Autofill for Start/End Inputs ---
function setupAutocomplete(inputId, suggestionsId) {
  const input = document.getElementById(inputId);
  const suggestions = document.getElementById(suggestionsId);
  const johannesburgBBox = [27.90, -26.05, 28.30, -26.33];
  let currentFetchId = 0;
  // Store selected place object for routing
  input.selectedPlace = null;
  input.addEventListener('input', function() {
    const query = input.value.trim();
    input.selectedPlace = null;
    if (query.length < 1) {
      suggestions.innerHTML = '';
      return;
    }
    suggestions.innerHTML = '<div class="suggestion">Loading...</div>';
    const fetchId = ++currentFetchId;
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Johannesburg, South Africa')}&addressdetails=1&limit=10&countrycodes=za&viewbox=${johannesburgBBox[0]},${johannesburgBBox[1]},${johannesburgBBox[2]},${johannesburgBBox[3]}&bounded=1`)
      .then(res => res.json())
      .then(data => {
        if (fetchId !== currentFetchId) return;
        suggestions.innerHTML = '';
        // Only allow routable types (but fallback to all if none found)
        const routableTypes = ['road', 'residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'service', 'living_street', 'trunk', 'motorway', 'street', 'avenue', 'drive', 'lane', 'boulevard', 'way'];
        let filtered = data.filter(place => {
          const lat = parseFloat(place.lat);
          const lon = parseFloat(place.lon);
          return (
            place.type && routableTypes.includes(place.type)
            && lon >= Math.min(johannesburgBBox[0], johannesburgBBox[2]) && lon <= Math.max(johannesburgBBox[0], johannesburgBBox[2])
            && lat >= Math.min(johannesburgBBox[3], johannesburgBBox[1]) && lat <= Math.max(johannesburgBBox[3], johannesburgBBox[1])
          );
        });
        // If no routable types found, show all results (so user can still select places, suburbs, etc)
        if (filtered.length === 0) {
          filtered = data.filter(place => {
            const lat = parseFloat(place.lat);
            const lon = parseFloat(place.lon);
            return (
              lon >= Math.min(johannesburgBBox[0], johannesburgBBox[2]) && lon <= Math.max(johannesburgBBox[0], johannesburgBBox[2]) &&
              lat >= Math.min(johannesburgBBox[3], johannesburgBBox[1]) && lat <= Math.max(johannesburgBBox[3], johannesburgBBox[1])
            );
          });
        }
        if (filtered.length === 0) {
          suggestions.innerHTML = '<div class="suggestion">No results in Johannesburg</div>';
          return;
        }
        filtered.forEach(place => {
          const div = document.createElement('div');
          div.className = 'suggestion';
          div.textContent = place.display_name;
          div.onclick = () => {
            input.value = place.display_name;
            input.selectedPlace = place;
            suggestions.innerHTML = '';
            input.dispatchEvent(new Event('change'));
          };
          suggestions.appendChild(div);
        });
      })
      .catch(() => {
        suggestions.innerHTML = '<div class="suggestion">Error loading suggestions</div>';
      });
  });
  // Hide suggestions on outside click
  document.addEventListener('click', function(e) {
    if (!suggestions.contains(e.target) && e.target !== input) {
      suggestions.innerHTML = '';
    }
  });
  // Autofill on Enter key
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && suggestions.firstChild && suggestions.firstChild.className === 'suggestion') {
      input.value = suggestions.firstChild.textContent;
      // Find the matching place object
      const text = suggestions.firstChild.textContent;
      const allDivs = Array.from(suggestions.children);
      const idx = allDivs.findIndex(d => d.textContent === text);
      if (idx !== -1 && input.lastResults && input.lastResults[idx]) {
        input.selectedPlace = input.lastResults[idx];
      }
      suggestions.innerHTML = '';
      input.dispatchEvent(new Event('change'));
    }
  });
}

// --- Danger Area Storage and Drawing ---
let dangerAreas = JSON.parse(localStorage.getItem('dangerAreas') || '[]');
let dangerBoxes = [];

function saveDangerAreas() {
  localStorage.setItem('dangerAreas', JSON.stringify(dangerAreas));
}

function drawDangerBoxes() {
  if (!map) return;
  dangerBoxes.forEach(box => map.removeLayer(box));
  dangerBoxes = [];
  dangerAreas.forEach(area => {
    const bounds = [[area.minLat, area.minLon], [area.maxLat, area.maxLon]];
    const rectangle = L.rectangle(bounds, {
      color: 'red',
      weight: 2,
      fillOpacity: 0.4
    }).addTo(map);
    dangerBoxes.push(rectangle);
  });
}

// --- Manual Feedback by Street ---
document.getElementById('manual-feedback-btn').onclick = function() {
  const street = document.getElementById('manual-feedback-street').value.trim();
  const type = document.getElementById('manual-feedback-type').value;
  if (!street) return alert('Please enter a street name.');
  fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(street + ', Johannesburg, South Africa')}&addressdetails=1&limit=1&countrycodes=za`)
    .then(res => res.json())
    .then(data => {
      if (!data.length) return alert('Could not find that street.');
      const bbox = data[0].boundingbox;
      const expand = 0.0015;
      const area = {
        minLat: parseFloat(bbox[0]) - expand,
        maxLat: parseFloat(bbox[1]) + expand,
        minLon: parseFloat(bbox[2]) - expand,
        maxLon: parseFloat(bbox[3]) + expand,
        display_name: data[0].display_name,
        type: type
      };
      if (dangerAreas.some(a => a.minLat === area.minLat && a.minLon === area.minLon)) {
        alert('This street is already marked.');
        return;
      }
      dangerAreas.push(area);
      saveDangerAreas();
      drawDangerBoxes();
      renderDangerAreasTable();
      alert('Feedback reported and marked on map!');
      document.getElementById('manual-feedback-street').value = '';
    });
};

// --- Manual Feedback by Street (with autofill selection) ---
document.getElementById('manual-feedback-btn').onclick = function() {
  let street = manualStreetInput.value.trim();
  const type = document.getElementById('manual-feedback-type').value;
  if (!street) return alert('Please enter a street name.');
  // If the input contains a comma, use only the part before the first comma for search
  if (street.includes(',')) {
    street = street.split(',')[0].trim();
  }
  // Use selected suggestion if available, else fallback to first suggestion
  if (selectedManualPlace) {
    const bbox = selectedManualPlace.boundingbox;
    const expand = 0.0015;
    const area = {
      minLat: parseFloat(bbox[0]) - expand,
      maxLat: parseFloat(bbox[1]) + expand,
      minLon: parseFloat(bbox[2]) - expand,
      maxLon: parseFloat(bbox[3]) + expand,
      display_name: selectedManualPlace.display_name,
      type: type
    };
    if (dangerAreas.some(a => a.minLat === area.minLat && a.minLon === area.minLon)) {
      alert('This street is already marked.');
      return;
    }
    dangerAreas.push(area);
    saveDangerAreas();
    drawDangerBoxes();
    renderDangerAreasTable();
    alert('Feedback reported and marked on map!');
    manualStreetInput.value = '';
    selectedManualPlace = null;
  } else {
    // Try to fetch the first suggestion and use it
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(street + ', Johannesburg, South Africa')}&addressdetails=1&limit=1&countrycodes=za`)
      .then(res => res.json())
      .then(data => {
        if (!data.length) return alert('Could not find that street.');
        const bbox = data[0].boundingbox;
        const expand = 0.0015;
        const area = {
          minLat: parseFloat(bbox[0]) - expand,
          maxLat: parseFloat(bbox[1]) + expand,
          minLon: parseFloat(bbox[2]) - expand,
          maxLon: parseFloat(bbox[3]) + expand,
          display_name: data[0].display_name,
          type: type
        };
        if (dangerAreas.some(a => a.minLat === area.minLat && a.minLon === area.minLon)) {
          alert('This street is already marked.');
          return;
        }
        dangerAreas.push(area);
        saveDangerAreas();
        drawDangerBoxes();
        renderDangerAreasTable();
        alert('Feedback reported and marked on map!');
        manualStreetInput.value = '';
      });
  }
};

// --- Danger Area Table ---
function renderDangerAreasTable() {
  const section = document.getElementById('danger-areas-table-section');
  if (!dangerAreas.length) {
    section.innerHTML = '<div style="color:#888;">No reported danger areas yet.</div>';
    return;
  }
  // Map feedback type to emoji icon
  const typeIcons = {
    crime: '⚠️',
    lighting: '🔦',
    pothole: '🕳️',
    safe: '✅'
  };
  let html = `<style>
    .danger-table { border-collapse: separate; border-spacing: 0; width: 90%; max-width: 700px; margin: 0 auto 10px auto; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.07); font-size: 1rem; border: 2.5px solid #111; }
    .danger-table th, .danger-table td { padding: 14px 18px; text-align: left; }
    .danger-table th { background: #f2f2f2; color: #222; font-weight: 700; }
    .danger-table tr { background: #fff; transition: background 0.2s; }
    .danger-table tr:nth-child(even) { background: #f9f9f9; }
    .danger-table tr:hover { background: #ffeaea; }
    .danger-table td button { color: #b30000; font-weight: bold; border: none; background: none; cursor: pointer; font-size: 1.1em; }
    .danger-table td { border-bottom: 1px solid #eee; }
    .danger-table tr:last-child td { border-bottom: none; }
    .danger-type-icon { font-size: 1.3em; margin-right: 8px; vertical-align: middle; }
  </style>`;
  html += '<table class="danger-table">';
  html += '<tr><th>Type</th><th>Street</th><th>Remove</th></tr>';
  dangerAreas.forEach((area, idx) => {
    // Choose icon based on type
    let icon = '';
    switch (area.type) {
      case 'crime': icon = '⚠️'; break;
      case 'lighting': icon = '🔦'; break;
      case 'pothole': icon = '🕳️'; break;
      case 'safe': icon = '✅'; break;
      default: icon = '';
    }
    html += `<tr>
      <td>${icon} ${area.type ? area.type.charAt(0).toUpperCase() + area.type.slice(1) : ''}</td>
      <td>${area.display_name || ''}</td>
      <td><button data-idx="${idx}" class="remove-danger-btn">Remove</button></td>
    </tr>`;
  });
  html += '</table>';
  section.innerHTML = html;
  // Add remove handlers
  Array.from(document.getElementsByClassName('remove-danger-btn')).forEach(btn => {
    btn.onclick = function() {
      const idx = parseInt(this.getAttribute('data-idx'));
      dangerAreas.splice(idx, 1);
      saveDangerAreas();
      drawDangerBoxes();
      renderDangerAreasTable();
    };
  });
}

// Draw danger boxes on map load
setTimeout(() => {
  drawDangerBoxes();
  renderDangerAreasTable();
}, 0);
