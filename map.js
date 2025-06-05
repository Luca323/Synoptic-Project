document.getElementById('app').innerHTML = `
  <h2>Your Safe Route</h2>

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
`;

let map;
let startMarker, endMarker, routeLine;

const southWest = L.latLng(-26.33, 27.95);
const northEast = L.latLng(-26.05, 28.20);
const joburgBounds = L.latLngBounds(southWest, northEast);

const reportedIssues = []; // [{ latlng: [lat, lng], type: 'crime' }]
// Test Data
reportedIssues.push(
  { latlng: [-26.1915, 28.0680], type: 'crime' },      // near Makers Valley
  { latlng: [-26.1922, 28.0715], type: 'lighting' },   // another nearby point
  { latlng: [-26.1950, 28.0650], type: 'pothole' }     // slightly west
);




setTimeout(() => {
  map = L.map('map', {
    maxBounds: joburgBounds,
    maxBoundsViscosity: 1.0,
    minZoom: 11,
    maxZoom: 18,
  }).setView([-26.1951, 28.0697], 13); // Center on Makers Valley

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  //setupAutocomplete('start-address', 'start-suggestions');
  //setupAutocomplete('end-address', 'end-suggestions');
}, 0);

function geocodeAddress(address, callback) {
  const apiKey = "5b3ce3597851110001cf6248837f3145429a4ad1aabe11c432e8d7ae"; // use your ORS key
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
  const apiKey = "5b3ce3597851110001cf6248837f3145429a4ad1aabe11c432e8d7ae"; // ← Replace with your ORS key
  const url = `https://api.openrouteservice.org/v2/directions/${mode}?api_key=${apiKey}&start=${startCoords[1]},${startCoords[0]}&end=${endCoords[1]},${endCoords[0]}`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (!data.features || data.features.length === 0) {
        alert("No route found from OpenRouteService.");
        return;
      }

      const coords = data.features[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);

      if (!coords || coords.length < 2) {
        alert("Route data is incomplete.");
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

        L.polyline([p1, p2], {
          color: isUnsafe ? 'red' : 'green',
          weight: 5,
          opacity: 0.9
        }).addTo(map);
      }


      // Add start/end markers
      if (startMarker) map.removeLayer(startMarker);
      if (endMarker) map.removeLayer(endMarker);

      startMarker = L.marker(startCoords).addTo(map).bindPopup('Start').openPopup();
      endMarker = L.marker(endCoords).addTo(map).bindPopup('End').openPopup();

      map.fitBounds(L.polyline(coords).getBounds());

      //map.fitBounds(routeLine.getBounds());
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
  const startAddress = document.getElementById('start-address').value;
  const endAddress = document.getElementById('end-address').value;
  const mode = document.getElementById('travel-mode').value;

  if (!startAddress || !endAddress) {
    alert('Please enter both start and end locations.');
    return;
  }

  geocodeAddress(startAddress, (startCoords) => {
    geocodeAddress(endAddress, (endCoords) => {
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
/*
// --- Autocomplete logic for address fields ---
function setupAutocomplete(inputId, suggestionsId) {
  const input = document.getElementById(inputId);
  const suggestions = document.getElementById(suggestionsId);

  input.addEventListener('input', function() {
    const query = input.value.trim();
    if (query.length < 3) {
      suggestions.innerHTML = '';
      return;
    }
    
    // Restrict search to South Africa using countrycodes=za
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5&countrycodes=za`)
      .then(res => res.json())
      .then(data => {
        suggestions.innerHTML = '';
        data.forEach(place => {
          const div = document.createElement('div');
          div.className = 'suggestion';
          div.textContent = place.display_name;
          div.onclick = () => {
            input.value = place.display_name;
            suggestions.innerHTML = '';
          };
          suggestions.appendChild(div);
        });
      });
  });

  // Hide suggestions when clicking outside
  document.addEventListener('click', function(e) {
    if (!suggestions.contains(e.target) && e.target !== input) {
      suggestions.innerHTML = '';
    }
  });
}

setTimeout(() => {
  setupAutocomplete('start-address', 'start-suggestions');
  setupAutocomplete('end-address', 'end-suggestions');
}, 0);*/
