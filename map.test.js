//Unit tests for core functions
const {
  calculateDistance,
  calculateBearing,
  calculateDestinationPoint,
  calculateMidpoint,
  getReportEmoji,
  getInitialZoneStatus,
  createCircleCoordinates,
  calculateAvoidanceWaypoints
} = require('./map');

describe('map.js core functions', () => {
  test('calculateDistance returns correct value for known points', () => {
    //Johannesburg to Petoria (approx 54km)
    const dist = calculateDistance(-26.2041, 28.0473, -25.7479, 28.2293);
    const km = Math.round(dist / 1000);
    expect(km).toBeGreaterThanOrEqual(52);
    expect(km).toBeLessThanOrEqual(54);
  });

  test('calculateBearing returns correct bearing', () => {
    //North (0 degrees)
    expect(Math.round(calculateBearing(0, 0, 1, 0))).toBe(0);
    //East (90 degrees)
    expect(Math.round(calculateBearing(0, 0, 0, 1))).toBe(90);
  });

  test('calculateDestinationPoint returns a point at the correct distance', () => {
    const start = { lat: 0, lon: 0 };
    const dest = calculateDestinationPoint(start.lat, start.lon, 1000, 90); //1km east
    const dist = calculateDistance(start.lat, start.lon, dest.lat, dest.lon);
    expect(Math.round(dist)).toBe(1000);
  });

  test('calculateMidpoint returns the midpoint', () => {
    const mid = calculateMidpoint(0, 0, 2, 2);
    expect(mid.lat).toBe(1);
    expect(mid.lon).toBe(1);
  });

  test('getReportEmoji returns correct emoji', () => {
    expect(getReportEmoji('crime')).toBe('🚨');
    expect(getReportEmoji('lighting')).toBe('🔦');
    expect(getReportEmoji('pothole')).toBe('🕳️');
    expect(getReportEmoji('safe')).toBe('✅');
    expect(getReportEmoji('panic')).toBe('🚨');
    expect(getReportEmoji('other')).toBe('📍');
  });

  test('getInitialZoneStatus returns correct status', () => {
    expect(getInitialZoneStatus('crime')).toBe('red');
    expect(getInitialZoneStatus('lighting')).toBe('orange');
    expect(getInitialZoneStatus('pothole')).toBe('orange');
    expect(getInitialZoneStatus('safe')).toBe('safe');
    expect(getInitialZoneStatus('other')).toBe('safe');
  });

  test('createCircleCoordinates returns correct number of points', () => {
    const points = createCircleCoordinates(0, 0, 1000);
    expect(Array.isArray(points)).toBe(true);
    expect(points.length).toBeGreaterThan(70);
    expect(points[0]).toEqual(points[points.length - 1]);
  });

  test('calculateAvoidanceWaypoints returns array', () => {
    //No red zones, should return empty array
    const waypoints = calculateAvoidanceWaypoints([0,0],[1,1],[]);
    expect(Array.isArray(waypoints)).toBe(true);
  });
});
