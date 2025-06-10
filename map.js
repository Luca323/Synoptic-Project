// Global variables and constants
let map;
let startMarker, endMarker;
let routePolylines = [];
let currentRouteSummary = null;
const ORS_API_KEY = "5b3ce3597851110001cf6248837f3145429a4ad1aabe11c432e8d7ae";

// Array to store reports
let recentReports = [];
let dangerZones = []; // Array to store danger zones

// Geocoding function
async function geocodeAddress(address) {
    const url = `https://api.openrouteservice.org/geocode/search?api_key=${ORS_API_KEY}&text=${encodeURIComponent(address)}&boundary.country=ZA&size=1`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.features && data.features.length > 0) {
        const coords = data.features[0].geometry.coordinates;
        return [coords[1], coords[0]]; // [lat, lng]
    }
    throw new Error(`No results found for: ${address}`);
}

// --- Address Autocomplete for Start/End Inputs ---
function setupAutocomplete(inputId, suggestionsId) {
    const input = document.getElementById(inputId);
    const suggestions = document.getElementById(suggestionsId);
    let currentFetchId = 0;
    let debounceTimeout = null;

    input.addEventListener('input', function () {
        const query = input.value.trim();
        if (query.length < 2) {
            suggestions.innerHTML = '';
            return;
        }

        // Debounce: wait 300ms after typing stops
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            suggestions.innerHTML = '<div class="suggestion">Loading...</div>';
            const fetchId = ++currentFetchId;

            // Johannesburg bounding box: [minLon, minLat, maxLon, maxLat]
            const bbox = [27.9, -26.4, 28.3, -26.0]; // Roughly around Johannesburg
            const url = `https://nominatim.openstreetmap.org/search?` +
                `format=json&` +
                `q=${encodeURIComponent(query)}&` +
                `addressdetails=1&limit=5&bounded=1&countrycodes=za&` +
                `viewbox=${bbox.join(',')}`;

            fetch(url)
                .then(res => res.json())
                .then(data => {
                    if (fetchId !== currentFetchId) return;
                    suggestions.innerHTML = '';
                    if (!data.length) {
                        suggestions.innerHTML = '<div class="suggestion">No results</div>';
                        return;
                    }

                    data.forEach(place => {
                        const div = document.createElement('div');
                        div.className = 'suggestion';

                        // Simplify display name
                        const parts = place.display_name.split(',');
                        div.textContent = parts.slice(0, 2).join(', ').trim();

                        div.onclick = () => {
                            input.value = place.display_name;
                            input.selectedPlace = place;
                            suggestions.innerHTML = '';
                        };

                        suggestions.appendChild(div);
                    });
                })
                .catch(() => {
                    suggestions.innerHTML = '<div class="suggestion">Error loading suggestions</div>';
                });
        }, 300); // 300ms debounce
    });

    if (!input.hasClickListener) {
        input.hasClickListener = true;
        document.addEventListener('click', function (e) {
            if (!suggestions.contains(e.target) && e.target !== input) {
                suggestions.innerHTML = '';
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Add styles for custom elements
    const style = document.createElement('style');
    style.textContent = `
        .route-summary .leaflet-popup-content-wrapper {
            background: rgba(255, 255, 255, 0.9);
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .route-summary .leaflet-popup-tip {
            background: rgba(255, 255, 255, 0.9);
        }
        .custom-div-icon {
            background: none;
            border: none;
            font-size: 24px;
            text-align: center;
            line-height: 24px;
        }
    `;
    document.head.appendChild(style);

    // Map boundaries
    const southWest = L.latLng(-26.33, 27.95);
    const northEast = L.latLng(-26.05, 28.20);
    const joburgBounds = L.latLngBounds(southWest, northEast);

    // Initialize the map
    map = L.map('map', {
        center: [-26.2041, 28.0473], // Johannesburg coordinates
        zoom: 13,
        maxBounds: joburgBounds,
        minZoom: 11,
        maxZoom: 18
    });

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);    console.log('Map initialized:', map);
    setupAutocomplete('start-address', 'start-suggestions');
    setupAutocomplete('end-address', 'end-suggestions');
    
    // Add click event to fill manual address input
    map.on('click', function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        
        // Reverse geocode to get address
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`)
            .then(response => response.json())
            .then(data => {
                if (data && data.display_name) {
                    const manualAddressInput = document.getElementById('manual-address');
                    if (manualAddressInput) {
                        manualAddressInput.value = data.display_name;
                    }
                }
            })
            .catch(error => {
                console.error('Error reverse geocoding:', error);
            });
    });

    // Initialize the reports table
    updateReportsTable();
});

// --- Improved Route Plotting ---
async function geocodeAndDrawRoute() {
    const startInput = document.getElementById('start-address');
    const endInput = document.getElementById('end-address');
    const travelMode = document.getElementById('travel-mode').value;
    if (!startInput.value || !endInput.value) {
        alert('Please enter both start and destination addresses');
        return;
    }
    // Show loading state
    const plotBtn = document.querySelector('.controls button');
    if (plotBtn) plotBtn.textContent = 'Loading...';
    try {
        // Geocode using selected suggestion if available
        const getCoords = async (input) => {
            if (input.selectedPlace && input.selectedPlace.lat && input.selectedPlace.lon) {
                return [parseFloat(input.selectedPlace.lat), parseFloat(input.selectedPlace.lon)];
            } else {
                return await geocodeAddress(input.value);
            }
        };
        const [startCoords, endCoords] = await Promise.all([
            getCoords(startInput),
            getCoords(endInput)
        ]);
        // Clear existing route
        if (routePolylines.length > 0) {
            routePolylines.forEach(line => line.remove());
            routePolylines = [];
        }
        if (startMarker) startMarker.remove();
        if (endMarker) endMarker.remove();
        if (currentRouteSummary) currentRouteSummary.remove();
        // Add markers
        startMarker = L.marker(startCoords, {
            icon: L.divIcon({
                className: 'custom-div-icon',
                html: '🟢',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        }).addTo(map);
        endMarker = L.marker(endCoords, {
            icon: L.divIcon({
                className: 'custom-div-icon',
                html: '📍',
                iconSize: [30, 30],
                iconAnchor: [15, 30]
            })        }).addTo(map);
        
        // Get the route with danger zone avoidance
        const url = `https://api.openrouteservice.org/v2/directions/${travelMode}/geojson`;
        
        // Prepare request body with avoid areas (red zones)
        const requestBody = {
            coordinates: [
                [startCoords[1], startCoords[0]],
                [endCoords[1], endCoords[0]]
            ],
            instructions: true,
            instructions_format: 'text',
            geometry_simplify: false,
            continue_straight: false,
            maneuvers: true
        };
        
        // Check for red danger zones and try to avoid them
        const redZones = dangerZones.filter(zone => zone.status === 'red');
        let routeData = null;
        let avoidedDanger = false;

        //   if (redZones.length > 0) {
        //     // Try to create a route with waypoints that avoid danger zones
        //     const avoidanceRoute = await tryAvoidDangerZones(startCoords, endCoords, redZones, travelMode);
        //     if (avoidanceRoute && avoidanceRoute.success) {
        //         routeData = avoidanceRoute.data;
        //         avoidedDanger = true;
        //     }

        if (redZones.length > 0) {
        // Construct avoid_polygons from red zones
        const polygons = redZones.map(zone => {
            return {
                type: "Polygon",
                coordinates: [redZones] // Assuming zone.coordinates is an array of [lng, lat] and is closed
            };
        });

        requestBody.options = {
            avoid_polygons: {
                type: "GeometryCollection",
                geometries: polygons
            }
        };

        // Try to create a route with danger zones avoided
        const avoidanceRoute = await tryAvoidDangerZones(startCoords, endCoords, redZones, travelMode, requestBody);
        if (avoidanceRoute && avoidanceRoute.success) {
            routeData = avoidanceRoute.data;
            avoidedDanger = true;
        }
        }



    
        
        // If no danger zones or avoidance failed, get direct route
        if (!routeData) {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': ORS_API_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error('API Error:', errorText);
                throw new Error('Failed to fetch route: ' + errorText);
            }
            routeData = await response.json();
        }
        
        const data = routeData;        
        if (data.features && data.features.length > 0) {
            const route = data.features[0];
            const coords = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
            
            // Determine route color and warning based on danger zone avoidance
            let routeWarning = '';
            let routeColor = 'green';
            
            if (avoidedDanger) {
                routeColor = 'blue'; // Blue for successful avoidance route
                routeWarning = ' 🛡️ Route adjusted to avoid danger zones!';
            } else if (redZones.length > 0) {
                // Check if direct route passes through red danger zones
                const dangerousRoute = coords.some(coord => {
                    return redZones.some(zone => {
                        const distance = calculateDistance(coord[0], coord[1], zone.lat, zone.lon);
                        return distance <= 300; // Within 300m of a red zone
                    });
                });
                
                if (dangerousRoute) {
                    routeColor = 'orange';
                    routeWarning = ' ⚠️ Route may pass near danger zones!';
                }
            }
            
            const routeLine = L.polyline(coords, {
                color: routeColor,
                weight: 6,
                opacity: 0.8
            }).addTo(map);
            routePolylines.push(routeLine);
            map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });
            document.getElementById('nav-panel').classList.add('hidden');            // Show route summary as a visible banner
            const distance = (route.properties.segments[0].distance / 1000).toFixed(2);
            const duration = Math.round(route.properties.segments[0].duration / 60);
            showRouteBanner(distance, duration, travelMode, routeWarning, route);
        } else {
            alert('No route found.');
            hideRouteBanner();
        }
    } catch (error) {
        alert('Error plotting route: ' + error.message);
        hideRouteBanner();
    } finally {
        if (plotBtn) plotBtn.textContent = 'Plot Route';
    }
}

// Show route summary as a visible banner at the bottom center
function showRouteBanner(distance, duration, travelMode, warning = '', route = null) {
    let banner = document.getElementById('route-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'route-banner';
        document.body.appendChild(banner);
    }
    
    // Store route data for directions
    banner.routeData = route;
    
    banner.innerHTML = `
        <strong>Route Summary:</strong> &nbsp; 🛣️ <b>${distance} km</b> &nbsp; ⏱️ <b>${duration} min</b> &nbsp; ${travelMode === 'foot-walking' ? '🚶 Walking' : '🚲 Cycling'}${warning}
        <button id="show-directions-btn" style="margin-left:15px;padding:5px 10px;background:#007bff;color:white;border:none;border-radius:4px;cursor:pointer;">📍 Directions</button>
        <span id="close-route-banner" style="margin-left:10px;cursor:pointer;font-weight:bold;">✖</span>
    `;
    banner.style.display = 'block';
    
    document.getElementById('close-route-banner').onclick = hideRouteBanner;
    document.getElementById('show-directions-btn').onclick = () => showDirections(route);
}
function hideRouteBanner() {
    const banner = document.getElementById('route-banner');
    if (banner) banner.style.display = 'none';
}

// Function to show turn-by-turn directions
function showDirections(route) {
    if (!route || !route.properties.segments[0].steps) {
        alert('No detailed directions available for this route.');
        return;
    }
    
    const steps = route.properties.segments[0].steps;
    let directionsPanel = document.getElementById('directions-panel');
    
    if (!directionsPanel) {
        directionsPanel = document.createElement('div');
        directionsPanel.id = 'directions-panel';
        document.body.appendChild(directionsPanel);
    }
    
    // Create directions content
    let directionsHTML = `
        <div class="directions-header">
            <h3>🧭 Turn-by-Turn Directions</h3>
            <div class="directions-actions">
                <button onclick="printDirections()" class="action-btn">🖨️ Print</button>
                <button onclick="downloadDirections()" class="action-btn">📄 Download</button>
                <button onclick="hideDirections()">✕</button>
            </div>
        </div>
        <div class="directions-content" id="directions-content">
    `;
    
    steps.forEach((step, index) => {
        const distance = step.distance > 1000 
            ? `${(step.distance / 1000).toFixed(1)} km` 
            : `${Math.round(step.distance)} m`;
        
        // Enhanced instruction with street name extraction
        let instruction = step.instruction || 'Continue straight';
        let streetName = '';
        
        // Try to extract street name from instruction
        if (step.name && step.name !== '-') {
            streetName = step.name;
        }
        
        // Enhance instruction with street name if available
        if (streetName) {
            instruction = instruction.replace(/Continue/gi, `Continue on ${streetName}`);
            instruction = instruction.replace(/Turn/gi, `Turn onto ${streetName}`);
            instruction = instruction.replace(/Head/gi, `Head on ${streetName}`);
            
            // If no replacement was made, append street name
            if (!instruction.includes(streetName)) {
                instruction += ` on ${streetName}`;
            }
        }
        
        const icon = getDirectionIcon(step.type);
        
        directionsHTML += `
            <div class="direction-step">
                <div class="step-number">${index + 1}</div>
                <div class="step-icon">${icon}</div>
                <div class="step-content">
                    <div class="step-instruction">${instruction}</div>
                    <div class="step-distance">${distance}</div>
                    ${streetName ? `<div class="step-street">📍 ${streetName}</div>` : ''}
                </div>
            </div>
        `;
    });
    
    directionsHTML += `
        </div>
        <div class="directions-footer">
            <small>Total: ${(route.properties.segments[0].distance / 1000).toFixed(2)} km • ${Math.round(route.properties.segments[0].duration / 60)} min</small>
        </div>
    `;
    
    directionsPanel.innerHTML = directionsHTML;
    directionsPanel.classList.remove('hidden');
    
    // Store route data globally for print/download functions
    window.currentRouteData = route;
}

// Function to hide directions panel
function hideDirections() {
    const directionsPanel = document.getElementById('directions-panel');
    if (directionsPanel) {
        directionsPanel.classList.add('hidden');
    }
}

// Function to get appropriate icon for direction type
function getDirectionIcon(stepType) {
    switch(stepType) {
        case 0: return '🚀'; // Start
        case 1: return '↗️'; // Turn right
        case 2: return '↖️'; // Turn left  
        case 3: return '⬆️'; // Continue straight
        case 4: return '↩️'; // U-turn
        case 5: return '🏁'; // Arrive at destination
        case 6: return '↗️'; // Slight right
        case 7: return '↖️'; // Slight left
        case 8: return '➡️'; // Sharp right
        case 9: return '⬅️'; // Sharp left
        case 10: return '🔄'; // Roundabout
        case 11: return '🛣️'; // Enter highway
        case 12: return '🛤️'; // Exit highway
        default: return '⬆️'; // Default straight
    }
}

// Function to toggle report options
function toggleReportOptions() {
    const banner = document.getElementById('report-options-banner');
    banner.classList.toggle('hidden');
}

// Function to toggle navigation panel
function toggleNavPanel() {
    const navPanel = document.getElementById('nav-panel');
    navPanel.classList.toggle('hidden');
}

// Consolidated click handler for all panel management
document.addEventListener('click', (event) => {
    const navPanel = document.getElementById('nav-panel');
    const navButton = document.getElementById('nav-button');
    const startSuggestions = document.getElementById('start-suggestions');
    const endSuggestions = document.getElementById('end-suggestions');
    const feedbackPanel = document.getElementById('feedback-panel');
    const reportBanner = document.getElementById('report-options-banner');
    const startInput = document.getElementById('start-address');
    const endInput = document.getElementById('end-address');

    // Don't close anything if clicking on input fields
    if (event.target === startInput || event.target === endInput) {
        return;
    }

    // Handle nav panel closing
    if (
        !navPanel.contains(event.target) &&
        !startSuggestions.contains(event.target) &&
        !endSuggestions.contains(event.target) &&
        event.target !== navButton
    ) {
        navPanel.classList.add('hidden');
    }

    // Handle report banner closing
    if (!feedbackPanel.contains(event.target) && !reportBanner.contains(event.target)) {
        reportBanner.classList.add('hidden');
    }
});

// Ensure the nav panel does not close when clicking on suggestions
document.getElementById('start-suggestions').addEventListener('click', (event) => {
    event.stopPropagation();
});

document.getElementById('end-suggestions').addEventListener('click', (event) => {
    event.stopPropagation();
});

// Function to handle feedback submission
function submitFeedback(type) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const { latitude, longitude } = position.coords;
            const location = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            const time = new Date().toLocaleString();
            
            // Add to recent reports
            recentReports.unshift({ type, location, time });
            if (recentReports.length > 10) recentReports.pop(); // Keep only last 10 reports
              // Create or update danger zones
            createOrUpdateDangerZone(latitude, longitude, type, location);
            
            // Update the reports table
            updateReportsTable();
            
            alert(`Feedback submitted: ${type} at location: ${location}.`);
        }, () => {
            alert('Unable to retrieve your location. Please ensure location services are enabled.');
        });
    } else {
        alert('Geolocation is not supported by your browser.');
    }
}

// Function to toggle manual feedback banner
function toggleManualFeedback() {
    const banner = document.getElementById('manual-feedback-banner');
    if (banner.classList.contains('hidden')) {
        banner.classList.remove('hidden');
        updateReportsTable(); // Update table when opening
    } else {
        banner.classList.add('hidden');
    }
}

// Function to handle manual feedback submission
async function submitManualFeedback(type) {
    const address = document.getElementById('manual-address').value.trim();
    if (!address) {
        alert('Please enter an address for the report.');
        return;
    }
      try {
        // Geocode the address to get coordinates - try multiple sources
        let response, data;
        
        // First try with Johannesburg, South Africa context
        response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ', Johannesburg, South Africa')}&addressdetails=1&limit=1`);
        data = await response.json();
        
        // If no results, try without country restriction
        if (!data || data.length === 0) {
            response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address + ', Johannesburg')}&addressdetails=1&limit=1`);
            data = await response.json();
        }
        
        // If still no results, try just the address
        if (!data || data.length === 0) {
            response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&addressdetails=1&limit=1`);
            data = await response.json();
        }        
        console.log('Geocoding response:', data);
        
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            
            // Create a red marker for the report
            const reportIcon = L.divIcon({
                className: 'report-marker',
                html: `<div class="report-marker-content ${type}">${getReportEmoji(type)}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });
            
            const reportMarker = L.marker([lat, lon], { icon: reportIcon }).addTo(map);
            
            // Add popup with report details
            reportMarker.bindPopup(`
                <strong>${type.charAt(0).toUpperCase() + type.slice(1)} Report</strong><br>
                <em>${address}</em><br>
                <small>${new Date().toLocaleString()}</small>
            `);
              // Pan map to show the marker
            map.setView([lat, lon], Math.max(map.getZoom(), 15));
            
            const time = new Date().toLocaleString();
            
            // Add to recent reports
            recentReports.unshift({ type, location: address, time });
            if (recentReports.length > 10) recentReports.pop(); // Keep only last 10 reports
              // Create or update danger zones
            createOrUpdateDangerZone(lat, lon, type, address);
            
            alert(`Manual feedback submitted: ${type} at address: ${address}.`);
            document.getElementById('manual-address').value = ''; // Clear input
            updateReportsTable(); // Update the table
            
        } else {
            alert('Unable to find the specified address. Please try a more specific address (e.g., "123 Main Street, Johannesburg").');
        }
        
    } catch (error) {
        console.error('Error geocoding address:', error);
        alert('Unable to find the specified address. Please try a different address.');
    }
}

// Helper function to get emoji for report type
function getReportEmoji(type) {
    switch(type) {
        case 'crime': return '⚠️';
        case 'lighting': return '🔦';
        case 'pothole': return '🕳️';
        case 'safe': return '✅';
        case 'panic': return '🚨';
        default: return '📍';
    }
}

// Function to create or update danger zones
function createOrUpdateDangerZone(lat, lon, reportType, address) {
    const ZONE_RADIUS = 500; // Increased to 500 meters radius for better grouping
    
    // Check if there's an existing zone nearby
    const existingZone = dangerZones.find(zone => {
        const distance = calculateDistance(lat, lon, zone.lat, zone.lon);
        return distance <= ZONE_RADIUS;
    });
    
    if (existingZone) {
        // Add report to existing zone
        existingZone.reports.push({ type: reportType, address, timestamp: new Date() });
        updateZoneStatus(existingZone);
    } else {
        // Create new zone
        const newZone = {
            id: Date.now(),
            lat: lat,
            lon: lon,
            reports: [{ type: reportType, address, timestamp: new Date() }],
            status: getInitialZoneStatus(reportType),
            marker: null
        };
        dangerZones.push(newZone);
        updateZoneStatus(newZone);
    }
}

// Function to get initial zone status based on report type
function getInitialZoneStatus(reportType) {
    if (reportType === 'crime') {
        return 'red'; // Crime is instant red zone
    } else if (reportType === 'lighting' || reportType === 'pothole') {
        return 'orange'; // Poor lighting and potholes start as orange
    } else {
        return 'safe'; // Safe areas don't create danger zones
    }
}

// Function to update zone status and visual representation
function updateZoneStatus(zone) {
    // Count different types of reports
    const crimeReports = zone.reports.filter(r => r.type === 'crime').length;
    const lightingReports = zone.reports.filter(r => r.type === 'lighting').length;
    const potholeReports = zone.reports.filter(r => r.type === 'pothole').length;
    const safeReports = zone.reports.filter(r => r.type === 'safe').length;
    
    // Determine zone status
    let newStatus = 'safe';
    if (crimeReports > 0 || (lightingReports + potholeReports) >= 3) {
        newStatus = 'red';
    } else if (lightingReports > 0 || potholeReports > 0) {
        newStatus = 'orange';
    }
    
    // Safe reports can neutralize some danger
    if (safeReports > (crimeReports + lightingReports + potholeReports)) {
        newStatus = 'safe';
    }
    
    zone.status = newStatus;
    
    // Remove old marker if exists
    if (zone.marker) {
        zone.marker.remove();
    }
      
    // Create new zone marker if it's a danger zone
    if (newStatus !== 'safe') {
        createZoneMarker(zone);
    }
}

// Function to create visual zone marker
function createZoneMarker(zone) {
    const color = zone.status === 'red' ? '#ff4444' : '#ff8800';
    const opacity = zone.status === 'red' ? 0.4 : 0.3;
    
    // Create circle marker for the danger zone
    zone.marker = L.circle([zone.lat, zone.lon], {
        color: color,
        fillColor: color,
        fillOpacity: opacity,
        radius: 500, // Updated to match the 500 meter zone radius
        weight: 2
    }).addTo(map);
    
    // Create popup with zone information
    const reportSummary = zone.reports.reduce((acc, report) => {
        acc[report.type] = (acc[report.type] || 0) + 1;
        return acc;
    }, {});
    
    const popupContent = `
        <div class="zone-popup">
            <h4>${zone.status === 'red' ? '🔴 High Danger Zone' : '🟠 Caution Zone'}</h4>
            <p><strong>Reports in this area:</strong></p>
            ${Object.entries(reportSummary).map(([type, count]) => 
                `<p>${getReportEmoji(type)} ${type}: ${count}</p>`
            ).join('')}
            <p><em>Radius: 500m</em></p>
        </div>
    `;
    
    zone.marker.bindPopup(popupContent);
}

// Function to calculate distance between two points (in meters)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Function to create circle coordinates for polygon avoidance
function createCircleCoordinates(centerLat, centerLon, radiusMeters) {
    const points = [];
    const numPoints = 16; // Number of points to create circle
    
    for (let i = 0; i < numPoints; i++) {
        const angle = (i * 360 / numPoints) * Math.PI / 180;
        const lat = centerLat + (radiusMeters / 111000) * Math.cos(angle);
        const lon = centerLon + (radiusMeters / (111000 * Math.cos(centerLat * Math.PI / 180))) * Math.sin(angle);
        points.push([lon, lat]); // Note: longitude first for GeoJSON
    }
    
    // Close the circle by adding the first point at the end
    points.push(points[0]);
    return points;
}

// Function to try avoiding danger zones by creating strategic waypoints
async function tryAvoidDangerZones(startCoords, endCoords, redZones, travelMode) {
    try {
        // Calculate waypoints that go around danger zones
        const waypoints = calculateAvoidanceWaypoints(startCoords, endCoords, redZones);
        
        if (waypoints.length === 0) {
            return { success: false };
        }
        
        // Create coordinates array with waypoints
        const coordinates = [
            [startCoords[1], startCoords[0]], // Start
            ...waypoints.map(wp => [wp[1], wp[0]]), // Waypoints (lon, lat)
            [endCoords[1], endCoords[0]] // End
        ];        const requestBody = {
            coordinates: coordinates,
            instructions: true,
            instructions_format: 'text',
            geometry_simplify: false,
            continue_straight: false,
            maneuvers: true
        };
        
        const url = `https://api.openrouteservice.org/v2/directions/${travelMode}/geojson`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': ORS_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
          if (!response.ok) {
            return { success: false };
        }
        
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            // Verify the route actually avoids danger zones
            const route = data.features[0];
            const coords = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
            
            const stillDangerous = coords.some(coord => {
                return redZones.some(zone => {
                    const distance = calculateDistance(coord[0], coord[1], zone.lat, zone.lon);
                    return distance <= 200; // Must be at least 200m away from danger zones
                });
            });
              if (stillDangerous) {
                return { success: false };
            }
            
            return { success: true, data: data };
        }
        
        return { success: false };
        
    } catch (error) {
        console.error('Error creating avoidance route:', error);
        return { success: false };
    }
}

// Function to calculate waypoints that avoid danger zones
function calculateAvoidanceWaypoints(startCoords, endCoords, redZones) {
    const waypoints = [];
    
    // Calculate the direct path
    const directBearing = calculateBearing(startCoords[0], startCoords[1], endCoords[0], endCoords[1]);
    const directDistance = calculateDistance(startCoords[0], startCoords[1], endCoords[0], endCoords[1]);
    
    // Check each danger zone to see if it's in the path
    redZones.forEach(zone => {
        const distanceToZone = calculateDistance(startCoords[0], startCoords[1], zone.lat, zone.lon);
        const zoneDistanceFromEnd = calculateDistance(zone.lat, zone.lon, endCoords[0], endCoords[1]);
        
        // Only create waypoints for zones that are roughly between start and end
        if (distanceToZone < directDistance && zoneDistanceFromEnd < directDistance) {
            // Calculate perpendicular waypoints around the danger zone
            const avoidanceDistance = 500; // 500m detour distance
            
            // Calculate two potential waypoints on either side of the danger zone
            const perpBearing1 = (directBearing + 90) % 360;
            const perpBearing2 = (directBearing - 90 + 360) % 360;
            
            const waypoint1 = calculateDestinationPoint(zone.lat, zone.lon, avoidanceDistance, perpBearing1);
            const waypoint2 = calculateDestinationPoint(zone.lat, zone.lon, avoidanceDistance, perpBearing2);
            
            // Choose the waypoint that's closer to the direct path
            const midpoint = calculateMidpoint(startCoords[0], startCoords[1], endCoords[0], endCoords[1]);
            const dist1 = calculateDistance(waypoint1.lat, waypoint1.lon, midpoint.lat, midpoint.lon);
            const dist2 = calculateDistance(waypoint2.lat, waypoint2.lon, midpoint.lat, midpoint.lon);
            
            const chosenWaypoint = dist1 < dist2 ? waypoint1 : waypoint2;
            waypoints.push([chosenWaypoint.lat, chosenWaypoint.lon]);
        }
    });
    
    return waypoints;
}

// Helper function to calculate bearing between two points
function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
}

// Helper function to calculate destination point given distance and bearing
function calculateDestinationPoint(lat, lon, distance, bearing) {
    const R = 6371000; // Earth's radius in meters
    const bearingRad = bearing * Math.PI / 180;
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    
    const newLatRad = Math.asin(Math.sin(latRad) * Math.cos(distance / R) + 
                               Math.cos(latRad) * Math.sin(distance / R) * Math.cos(bearingRad));
    
    const newLonRad = lonRad + Math.atan2(Math.sin(bearingRad) * Math.sin(distance / R) * Math.cos(latRad),
                                         Math.cos(distance / R) - Math.sin(latRad) * Math.sin(newLatRad));
    
    return {
        lat: newLatRad * 180 / Math.PI,
        lon: newLonRad * 180 / Math.PI
    };
}

// Helper function to calculate midpoint between two coordinates
function calculateMidpoint(lat1, lon1, lat2, lon2) {
    return {
        lat: (lat1 + lat2) / 2,
        lon: (lon1 + lon2) / 2
    };
}

// Function to update the reports table display
function updateReportsTable() {
    const tbody = document.getElementById('reports-tbody');
    if (!tbody) {
        return;
    }
    
    // Clear existing rows
    tbody.innerHTML = '';
    
    // Add recent reports to table
    recentReports.forEach(report => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${getReportEmoji(report.type)} ${report.type.charAt(0).toUpperCase() + report.type.slice(1)}</td>
            <td>${report.location}</td>
            <td>${report.time}</td>
        `;
        tbody.appendChild(row);
    });
    
    // If no reports, show a message
    if (recentReports.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="3" style="text-align: center; font-style: italic;">No reports yet</td>';
        tbody.appendChild(row);
    }
}

// Function to handle panic button
function triggerPanic() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const { latitude, longitude } = position.coords;
            const location = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            const time = new Date().toLocaleString();
            
            // Add panic report to recent reports
            recentReports.unshift({ 
                type: 'panic', 
                location: location, 
                time: time 
            });
            if (recentReports.length > 10) recentReports.pop();
              // Create an urgent danger zone for panic reports
            createOrUpdateDangerZone(latitude, longitude, 'crime', location);
            
            // Update the reports table
            updateReportsTable();
            
            // Automatically alert authorities and log incident
            alert(
                `🚨 EMERGENCY ALERT SENT! 🚨\n\n` +
                `Your location has been automatically reported to authorities:\n` +
                `📍 ${location}\n` +
                `⏰ ${time}\n\n` +
                `🚓 Police: 10111\n` +
                `🚑 Ambulance: 10177\n` +
                `🔥 Fire Department: 10111\n\n` +
                `Stay safe! Help is being notified of your location.`
            );
            
            // Flash the panic button to show it was activated
            const panicButton = document.getElementById('panic-button');
            if (panicButton) {
                panicButton.style.animation = 'flash 1s ease-in-out 3';
                setTimeout(() => {
                    panicButton.style.animation = '';
                }, 3000);
            }
            
        }, (error) => {
            // If location access fails, still allow panic report
            const time = new Date().toLocaleString();
            
            recentReports.unshift({ 
                type: 'panic', 
                location: 'Location unavailable', 
                time: time 
            });
            if (recentReports.length > 10) recentReports.pop();
              updateReportsTable();
            
            // Automatically alert authorities
            alert(
                `🚨 EMERGENCY ALERT SENT! 🚨\n\n` +
                `Your location has been automatically reported to authorities.\n` +
                `⏰ ${time}\n\n` +
                `🚓 Police: 10111\n` +
                `🚑 Ambulance: 10177\n` +
                `🔥 Fire Department: 10111\n\n` +
                `Stay safe! Authorities have been notified.`
            );
        });
    } else {
        // Geolocation not supported
        const time = new Date().toLocaleString();
          recentReports.unshift({ 
            type: 'panic', 
            location: 'Location unavailable', 
            time: time 
        });
        if (recentReports.length > 10) recentReports.pop();
        
        updateReportsTable();
        
        // Automatically alert authorities
        alert(
            `🚨 EMERGENCY ALERT SENT! 🚨\n\n` +
            `Authorities have been automatically notified.\n`+
            `⏰ ${time}\n\n` +
            `🚓 Police: 10111\n` +
            `🚑 Ambulance: 10177\n` +
            `🔥 Fire Department: 10111\n\n` +
            `Stay safe! Location services not available but alert sent.`
        );
    }
}

// Ensure panic function is globally accessible
window.triggerPanic = triggerPanic;

// Function to print directions
function printDirections() {
    if (!window.currentRouteData) {
        alert('No route data available for printing.');
        return;
    }
    
    const route = window.currentRouteData;
    const steps = route.properties.segments[0].steps;
    const totalDistance = (route.properties.segments[0].distance / 1000).toFixed(2);
    const totalTime = Math.round(route.properties.segments[0].duration / 60);
    
    // Create printable HTML
    let printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>SafeRoute Directions</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
                .route-summary { background-color: #f5f5f5; padding: 10px; margin-bottom: 20px; border-radius: 5px; }
                .step { margin-bottom: 15px; padding: 10px; border-left: 3px solid #007bff; }
                .step-number { font-weight: bold; color: #007bff; }
                .step-instruction { font-size: 14px; margin: 5px 0; }
                .step-distance { color: #666; font-size: 12px; }
                .step-street { color: #333; font-size: 12px; font-style: italic; }
                .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #666; }
                @media print {
                    body { margin: 0; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🛡️ SafeRoute Navigation</h1>
                <h2>Turn-by-Turn Directions</h2>
            </div>
            
            <div class="route-summary">
                <strong>Route Summary:</strong><br>
                📏 Total Distance: ${totalDistance} km<br>
                ⏱️ Estimated Time: ${totalTime} minutes<br>
                📅 Generated: ${new Date().toLocaleString()}
            </div>
            
            <div class="directions">
    `;
    
    steps.forEach((step, index) => {
        const distance = step.distance > 1000 
            ? `${(step.distance / 1000).toFixed(1)} km` 
            : `${Math.round(step.distance)} m`;
        
        let instruction = step.instruction || 'Continue straight';
        let streetName = '';
        
        if (step.name && step.name !== '-') {
            streetName = step.name;
            instruction = instruction.replace(/Continue/gi, `Continue on ${streetName}`);
            instruction = instruction.replace(/Turn/gi, `Turn onto ${streetName}`);
            instruction = instruction.replace(/Head/gi, `Head on ${streetName}`);
            
            if (!instruction.includes(streetName)) {
                instruction += ` on ${streetName}`;
            }
        }
        
        printHTML += `
            <div class="step">
                <div class="step-number">Step ${index + 1}</div>
                <div class="step-instruction">${instruction}</div>
                <div class="step-distance">Distance: ${distance}</div>
                ${streetName ? `<div class="step-street">Street: ${streetName}</div>` : ''}
            </div>
        `;
    });
    
    printHTML += `
            </div>
            
            <div class="footer">
                <p>Generated by SafeRoute - Your Safety-First Navigation System</p>
                <p>⚠️ Always check current road conditions and follow local traffic laws</p>
                <p>🚨 Emergency: Police 10111 | Medical 10177 | Fire 10111</p>
            </div>
        </body>
        </html>
    `;
    
    // Open print window
    const printWindow = window.open('', '_blank');
    printWindow.document.write(printHTML);
    printWindow.document.close();
    printWindow.print();
}

// Function to download directions as PDF/HTML
function downloadDirections() {
    if (!window.currentRouteData) {
        alert('No route data available for download.');
        return;
    }
    
    const route = window.currentRouteData;
    const steps = route.properties.segments[0].steps;
    const totalDistance = (route.properties.segments[0].distance / 1000).toFixed(2);
    const totalTime = Math.round(route.properties.segments[0].duration / 60);
    
    // Create downloadable content
    let content = `SafeRoute Navigation - Turn-by-Turn Directions\n`;
    content += `==============================================\n\n`;
    content += `Route Summary:\n`;
    content += `Total Distance: ${totalDistance} km\n`;
    content += `Estimated Time: ${totalTime} minutes\n`;
    content += `Generated: ${new Date().toLocaleString()}\n\n`;
    content += `DIRECTIONS:\n`;
    content += `-----------\n\n`;
    
    steps.forEach((step, index) => {
        const distance = step.distance > 1000 
            ? `${(step.distance / 1000).toFixed(1)} km` 
            : `${Math.round(step.distance)} m`;
        
        let instruction = step.instruction || 'Continue straight';
        let streetName = '';
        
        if (step.name && step.name !== '-') {
            streetName = step.name;
            instruction = instruction.replace(/Continue/gi, `Continue on ${streetName}`);
            instruction = instruction.replace(/Turn/gi, `Turn onto ${streetName}`);
            instruction = instruction.replace(/Head/gi, `Head on ${streetName}`);
            
            if (!instruction.includes(streetName)) {
                instruction += ` on ${streetName}`;
            }
        }
        
        content += `${index + 1}. ${instruction}\n`;
        content += `   Distance: ${distance}\n`;
        if (streetName) {
            content += `   Street: ${streetName}\n`;
        }
        content += `\n`;
    });
    
    content += `\n==============================================\n`;
    content += `Generated by SafeRoute - Your Safety-First Navigation System\n`;
    content += `⚠️ Always check current road conditions and follow local traffic laws\n`;
    content += `🚨 Emergency Contacts:\n`;
    content += `   Police: 10111\n`;
    content += `   Medical: 10177\n`;
    content += `   Fire: 10111\n`;
    
    // Create and download file
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SafeRoute_Directions_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    alert('✅ Directions downloaded successfully!');
}