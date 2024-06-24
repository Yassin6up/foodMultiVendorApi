function calculateDistance(point1, point2) {
    const R = 6371e3; // Earth radius in meters
    const φ1 = toRadians(point1.lat); // Latitude of point 1 in radians
    const φ2 = toRadians(point2.lat); // Latitude of point 2 in radians
    const Δφ = toRadians(point2.lat - point1.lat); // Difference in latitudes in radians
    const Δλ = toRadians(point2.lng - point1.lng); // Difference in longitudes in radians
  
    // Haversine formula
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in meters
  
    return distance;
  }
  
  // Function to convert degrees to radians
  function toRadians(degrees) {
    return degrees * Math.PI / 180;
  }
  
module.exports = {calculateDistance}