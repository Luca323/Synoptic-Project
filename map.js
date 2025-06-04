document.getElementById('app').innerHTML = `
  <h2>Your Safe Route</h2>
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

// Delay map setup so #map exists
setTimeout(() => {
  const map = L.map('map').setView([-26.1951, 28.0697], 16); // Makers Valley, Johannesburg

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  L.marker([-26.1951, 28.0697]).addTo(map).bindPopup('Makers Valley').openPopup();
}, 0);

// Feedback logic
function submitFeedback(type) {
  alert(`Feedback submitted: ${type}`);
}

// Panic button logic
function triggerPanic() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;
      alert(`🚨 Panic alert sent!\nLocation: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
      L.marker([latitude, longitude])
        .addTo(L.map('map'))
        .bindPopup("🚨 Panic Location")
        .openPopup();
    });
  } else {
    alert("Geolocation not supported.");
  }
}