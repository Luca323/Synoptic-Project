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

setTimeout(() => {
  map = L.map('map').setView([-26.1951, 28.0697], 16);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
}, 0);

// Geocoding helper
function geocodeAddress(address, callback) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
  fetch(url)
    .then(res => res.json())
    .then(data => {
      if (data.length > 0) {
        const { lat, lon } = data[0];
        callback([parseFloat(lat), parseFloat(lon)]);
      } else {
        alert(`No results found for: ${address}`);
      }
    })
    .catch(() => alert('Geocoding failed.'));
}

// Route fetcher using ORS
function drawRouteWithORS(startCoords, endCoords, mode) {
  const apiKey = "5b3ce3597851110001cf6248837f3145429a4ad1aabe11c432e8d7ae"; // ← Replace with your ORS key
  const url = `https://api.openrouteservice.org/v2/directions/${mode}?api_key=${apiKey}&start=${startCoords[1]},${startCoords[0]}&end=${endCoords[1]},${endCoords[0]}`;

  fetch(url)
    .then(res => res.json())
    .then(data => {
      const coords = data.features[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);

      if (routeLine) map.removeLayer(routeLine);
      routeLine = L.polyline(coords, { color: 'green', weight: 5 }).addTo(map);

      if (startMarker) map.removeLayer(startMarker);
      if (endMarker) map.removeLayer(endMarker);

      startMarker = L.marker(startCoords).addTo(map).bindPopup('Start').openPopup();
      endMarker = L.marker(endCoords).addTo(map).bindPopup('End').openPopup();

      map.fitBounds(routeLine.getBounds());
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

// Feedback
function submitFeedback(type) {
  alert(`Feedback submitted: ${type}`);
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
}, 0);