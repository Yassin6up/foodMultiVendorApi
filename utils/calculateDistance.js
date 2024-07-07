const calculateDistance = (startLocation, endLocation) => {
  const startLat = parseFloat(startLocation.lat);
  const startLng = parseFloat(startLocation.lng);
  const endLat = parseFloat(endLocation.lat);
  const endLng = parseFloat(endLocation.lng);

  if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
    return Infinity; // or handle NaN case appropriately
  }

  // Implement your distance calculation logic (Haversine formula or others)
  // Example: return distance in meters
  const earthRadius = 6371000; // meters
  const dLat = (endLat - startLat) * Math.PI / 180;
  const dLng = (endLng - startLng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(startLat * Math.PI / 180) * Math.cos(endLat * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = earthRadius * c;

  return distance;
};
  
module.exports = {calculateDistance}
