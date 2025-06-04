document.getElementById('app').innerHTML = `
  <h2>Your Safe Route</h2>
  <div id="map" style="height: 300px;"></div>

  <h3>Live Feedback</h3>
  <div id="feedback-buttons">
    <button onclick="submitFeedback('crime')">⚠️ Crime</button>
    <button onclick="submitFeedback('lighting')">🔦 Poor Lighting</button>
    <button onclick="submitFeedback('pothole')">🕳️ Pothole</button>
    <button onclick="submitFeedback('safe')">✅ Safe Area</button>
  </div>

  <button id="panic-button" onclick="triggerPanic()">🚨 Panic Button</button>
`;

function submitFeedback(type) {
  alert(`Feedback submitted: ${type}`);
  // Optional: Send to server or store locally
}

function triggerPanic() {
  const userLocation = "Simulated Location"; // Use geolocation API here
  alert(`🚨 Panic alert sent with location: ${userLocation}`);
  // Optionally: store, email, or simulate send
}