// Turas AI — Resident Researcher Agent
// ES-module: exports TurasResearcher class
// Uses Cloudflare Worker proxy for live API calls with simulated fallback
// Radius-based hub discovery: fetches hubs from Worker API on session start

const WORKER_URL = 'https://turas-ai-proxy.symphony-driver-assist.workers.dev';

// ─── Hubs cache (loaded from Worker API) ───
let ALL_HUBS = [];
let hubsLoaded = false;
let hubsLoadPromise = null;

// ─── Haversine distance (km) ───
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Find hubs within radius (using haversine for fast filtering) ───
function findHubsInRadius(driverLat, driverLng, radiusKm) {
  return ALL_HUBS
    .map(hub => ({
      ...hub,
      distanceKm: Math.round(haversineKm(driverLat, driverLng, hub.lat, hub.lng) * 10) / 10
    }))
    .filter(hub => hub.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

// ─── Fetch driving distance and time from OSRM for a single hub ───
async function fetchDrivingInfo(originLat, originLng, destLat, destLng) {
  try {
    const resp = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=false`
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
        const drivingTimeMin = Math.round(route.duration / 60);
        return { distanceKm, drivingTimeMin };
      }
    }
  } catch (err) {
    console.warn(`[Turas AI] OSRM routing failed for hub at ${destLat},${destLng}:`, err);
  }
  return null; // Return null if routing fails (will fall back to haversine)
}

// ─── Update hubs with driving distances and times (replaces haversine with actual driving data) ───
async function updateWithDrivingDistances(driverLat, driverLng, hubs) {
  // Get current time for ETA calculation
  const now = new Date();
  
  // Fetch driving distances in parallel (limited concurrency to avoid rate limits)
  const batchSize = 5; // Process 5 hubs at a time
  for (let i = 0; i < hubs.length; i += batchSize) {
    const batch = hubs.slice(i, i + batchSize);
    const promises = batch.map(async (hub) => {
      const drivingInfo = await fetchDrivingInfo(driverLat, driverLng, hub.lat, hub.lng);
      if (drivingInfo !== null) {
        hub.distanceKm = drivingInfo.distanceKm; // Replace haversine with driving distance
        hub.drivingTimeMin = drivingInfo.drivingTimeMin;
        // Calculate ETA
        const etaTime = new Date(now.getTime() + drivingInfo.drivingTimeMin * 60000);
        hub.eta = etaTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        hub.distanceType = 'driving';
      } else {
        hub.distanceType = 'haversine'; // Fallback
        // Estimate driving time from haversine distance (assume avg 40 km/h in urban areas)
        hub.drivingTimeMin = Math.round((hub.distanceKm / 40) * 60);
        const etaTime = new Date(now.getTime() + hub.drivingTimeMin * 60000);
        hub.eta = etaTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    });
    await Promise.all(promises);
  }
  // Re-sort by updated distance
  hubs.sort((a, b) => a.distanceKm - b.distanceKm);
  return hubs;
}

// ─── Load hubs from Worker API ───
async function loadHubsFromAPI() {
  if (hubsLoaded) return ALL_HUBS;
  if (hubsLoadPromise) return hubsLoadPromise;
  
  hubsLoadPromise = (async () => {
    try {
      const resp = await fetch(`${WORKER_URL}/api/hubs`);
      if (!resp.ok) throw new Error(`Failed to fetch hubs: ${resp.status}`);
      
      const data = await resp.json();
      ALL_HUBS = data.hubs || [];
      hubsLoaded = true;
      
      console.log(`[Turas AI] Loaded ${ALL_HUBS.length} hubs from Worker API`);
      return ALL_HUBS;
    } catch (err) {
      console.error('[Turas AI] Failed to load hubs from API:', err);
      return [];
    }
  })();
  
  return hubsLoadPromise;
}

function seededRandom(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = ((s << 5) - s + seed.charCodeAt(i)) | 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

async function fetchFromWorker(endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${WORKER_URL}${endpoint}${qs ? '?' + qs : ''}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function generateSimulatedWeather(rand) {
  const precip = Math.round(rand() * 8 * 10) / 10;
  const temp = Math.round((rand() * 15 + 3) * 10) / 10;
  const wind = Math.round(rand() * 30);
  return { precipMmHr: precip, tempC: temp, wind, warnings: [], simulated: true, source: 'simulated' };
}

function generateSimulatedArrivals(hub, windowMinutes, rand) {
  const arrivals = [];
  const count = Math.floor(rand() * 6) + 2;
  const modes = (hub && Array.isArray(hub.modes) && hub.modes.length > 0) ? hub.modes : ['train'];
  for (let i = 0; i < count; i++) {
    const mode = modes[Math.floor(rand() * modes.length)];
    const etaMinutes = Math.floor(rand() * windowMinutes * 2);
    let origin = 'Unknown';
    if (mode === 'flight') origin = rand() > 0.5 ? 'London' : 'Amsterdam';
    else if (mode === 'train') origin = 'Galway';
    else origin = 'Holyhead';
    arrivals.push({ mode, origin, etaMinutes, simulated: true, source: 'simulated' });
  }
  return arrivals;
}

function processFlightData(flights, hub) {
  if (!flights || !Array.isArray(flights)) return [];
  return flights
    .filter(f => {
      // Match flights to hub by IATA code in hub name or ID
      const hubName = hub.name.toLowerCase();
      const hubId = hub.hubId.toLowerCase();
      
      if (hubId.includes('dub1') || hubName.includes('terminal 1')) {
        return f.destination === 'DUB' && f.terminal === 'T1';
      }
      if (hubId.includes('dub2') || hubName.includes('terminal 2')) {
        return f.destination === 'DUB' && f.terminal === 'T2';
      }
      if (hubId.includes('ork') || hubName.includes('cork')) {
        return f.destination === 'ORK';
      }
      if (hubId.includes('snn') || hubName.includes('shannon')) {
        return f.destination === 'SNN';
      }
      if (hubId.includes('noc') || hubName.includes('knock')) {
        return f.destination === 'NOC';
      }
      if (hubId.includes('kir') || hubName.includes('kerry')) {
        return f.destination === 'KIR';
      }
      
      return false;
    })
    .map(f => ({
      mode: 'flight',
      origin: f.origin || 'Unknown',
      flightNumber: f.flightNumber || 'Unknown',
      etaMinutes: f.estimated ? Math.round((new Date(f.estimated) - Date.now()) / 60000) : 15,
      status: f.status || 'active',
      simulated: false,
      source: 'aviationstack'
    }))
    .filter(a => a.etaMinutes >= -5 && a.etaMinutes <= 45);
}

function processRailData(railResp, hub) {
  if (!railResp) return [];
  if (railResp.simulated && railResp.data) {
    return railResp.data.map(t => ({
      mode: 'train',
      origin: t.destination || 'Unknown',
      etaMinutes: t.eta || 15,
      status: t.status || 'on_time',
      simulated: true,
      source: 'fallback'
    }));
  }
  return [];
}

function processFerryData(ferryResp, hub) {
  if (!ferryResp || !ferryResp.data) return [];
  return ferryResp.data
    .map(f => {
      // Use etaMinutes directly if provided (AISStream), otherwise calculate from eta
      let etaMinutes = f.etaMinutes;
      if (etaMinutes == null && f.eta) {
        const etaDate = new Date(f.eta);
        etaMinutes = Math.round((etaDate - Date.now()) / 60000);
      }
      if (etaMinutes == null && f.etaAIS) {
        const now = new Date();
        const parts = f.etaAIS.split(' ');
        if (parts.length === 2) {
          const [monthDay, time] = parts;
          const [month, day] = monthDay.split('-').map(Number);
          const [hour, min] = time.split(':').map(Number);
          const etaDate = new Date(now.getFullYear(), month - 1, day, hour, min);
          etaMinutes = Math.round((etaDate - Date.now()) / 60000);
        }
      }
      return {
        mode: 'ferry',
        name: f.name || 'Unknown Vessel',
        origin: f.origin || 'Unknown',
        operator: f.operator || 'Unknown',
        etaMinutes: etaMinutes != null ? etaMinutes : 60,
        eta: f.eta || null,
        mmsi: f.mmsi || null,
        imo: f.imo || null,
        speed: f.speed || null,
        distanceNm: f.distanceNm || null,
        simulated: f.simulated || false,
        source: ferryResp.source || 'fallback'
      };
    })
    .filter(f => f.etaMinutes > 0); // Only future arrivals
}

function processWeatherData(weatherResp) {
  if (!weatherResp || !weatherResp.data) return null;
  const data = weatherResp.data;

  if (weatherResp.simulated) {
    const now = new Date();
    const currentHour = now.getHours();
    const idx = data.time?.findIndex(t => new Date(t).getHours() >= currentHour) || 0;
    return {
      precipMmHr: data.precipitation?.[idx] || 0,
      tempC: data.temperature_2m?.[idx] || 10,
      wind: data.wind_speed_10m?.[idx] || 0,
      warnings: [],
      simulated: true,
      source: 'fallback'
    };
  }

  const now = new Date();
  const currentHour = now.getHours();
  const idx = data.time?.findIndex(t => new Date(t).getHours() >= currentHour) || 0;
  return {
    precipMmHr: data.precipitation?.[idx] || 0,
    tempC: data.temperature_2m?.[idx] || 10,
    wind: data.wind_speed_10m?.[idx] || 0,
    warnings: [],
    simulated: false,
    source: 'open-meteo'
  };
}

export class TurasResearcher {
  constructor() {
    this.allHubs = ALL_HUBS;
  }

  // Quick discovery: hubs + weather only (no arrivals data)
  // Used on page load to show hub list before "Begin Search"
  async discoverHubs(config) {
    await loadHubsFromAPI();
    
    const {
      driverCoords = null,
      radiusKm = 10,
      sessionId
    } = config;

    const generatedAt = new Date().toISOString();
    const hubData = [];

    const originLat = driverCoords?.lat || 53.3498;
    const originLng = driverCoords?.lng || -6.2603;

    const hubsInRangeRaw = findHubsInRadius(originLat, originLng, radiusKm);
    // Update with driving distances for initial discovery as well
    const hubsInRange = await updateWithDrivingDistances(originLat, originLng, hubsInRangeRaw);

    // Fetch weather for driver's location
    const weatherResp = await fetchFromWorker('/api/weather', {
      lat: originLat,
      lon: originLng
    });
    const weather = processWeatherData(weatherResp);

    for (const hub of hubsInRange) {
      const rand = seededRandom(`${hub.hubId}-${generatedAt.slice(0, 13)}`);
      const hubWeather = weather || null;

      hubData.push({
        hubId: hub.hubId,
        name: hub.name,
        lat: hub.lat,
        lng: hub.lng,
        kHub: hub.kHub,
        region: hub.region,
        modes: hub.modes || [],
        distanceKm: hub.distanceKm,
        drivingTimeMin: hub.drivingTimeMin,
        eta: hub.eta,
        distanceType: hub.distanceType,
        arrivals: [],  // No arrivals yet — shown as "--%"
        weather: hubWeather,
        disruptions: [],
        preSearch: true  // Flag for dashboard to show "--%"
      });
    }

    return {
      generatedAt,
      sessionId: sessionId || crypto.randomUUID(),
      driverCoords: { lat: originLat, lng: originLng },
      radiusKm,
      hubs: hubData,
      preSearch: true
    };
  }

  // Full pipeline: hubs + weather + arrivals + P_fare calculation
  // Triggered by "Begin Search" button
  async collect(config) {
    await loadHubsFromAPI();
    
    const {
      driverCoords = null,
      radiusKm = 10,
      platform = 'freenow',
      mode = 'stationary',
      sessionId
    } = config;

    const generatedAt = new Date().toISOString();
    const hubData = [];

    // If no driver coords, fall back to Dublin city center
    const originLat = driverCoords?.lat || 53.3498;
    const originLng = driverCoords?.lng || -6.2603;

    // Find all hubs within radius (using haversine for fast initial filtering)
    let hubsInRange = findHubsInRadius(originLat, originLng, radiusKm);
    
    // Update with actual driving distances from OSRM (replaces haversine distances)
    hubsInRange = await updateWithDrivingDistances(originLat, originLng, hubsInRange);

    // Fetch weather for driver's location
    const weatherResp = await fetchFromWorker('/api/weather', {
      lat: originLat,
      lon: originLng
    });
    const weather = processWeatherData(weatherResp);

    // Fetch flights for all airports in range
    const airportsInRange = hubsInRange.filter(h => h.modes.includes('flight'));
    let flightResp = null;
    if (airportsInRange.length > 0) {
      // Determine which city's airports to query
      const regions = [...new Set(airportsInRange.map(h => h.region))];
      const primaryRegion = regions[0] || 'dublin';
      flightResp = await fetchFromWorker('/api/flights', { city: primaryRegion });
    }

    // Fetch ferries — done per-hub inside the loop below (each port has different arrivals)

    for (const hub of hubsInRange) {
      const rand = seededRandom(`${hub.hubId}-${generatedAt.slice(0, 13)}`);
      let arrivals = [];
      const hubWeather = weather || null;
      const disruptions = [];

      if (hub.modes.includes('flight') && flightResp) {
        const flightArrivals = processFlightData(flightResp.data, hub);
        arrivals.push(...flightArrivals);
      }

      if (hub.modes.includes('train')) {
        const railResp = await fetchFromWorker('/api/rail', { station: hub.hubId });
        const railArrivals = processRailData(railResp, hub);
        arrivals.push(...railArrivals);
      }

      if (hub.modes.includes('ferry')) {
        const ferryResp = await fetchFromWorker('/api/ferries', { port: hub.hubId });
        const ferryArrivals = processFerryData(ferryResp, hub);
        arrivals.push(...ferryArrivals);
      }

      // Note: If no live arrivals found, arrivals array remains empty (honest representation)
      // Previously fell back to generateSimulatedArrivals, but user requested honest data

      hubData.push({
        hubId: hub.hubId,
        name: hub.name,
        lat: hub.lat,
        lng: hub.lng,
        kHub: hub.kHub,
        region: hub.region,
        modes: hub.modes || [],
        distanceKm: hub.distanceKm,
        drivingTimeMin: hub.drivingTimeMin,
        eta: hub.eta,
        distanceType: hub.distanceType,
        arrivals,
        weather: hubWeather,
        disruptions,
      });
    }

    return {
      generatedAt,
      sessionId: sessionId || crypto.randomUUID(),
      driverCoords: { lat: originLat, lng: originLng },
      radiusKm,
      mode,
      platform,
      hubs: hubData,
    };
  }
}

// Export function to get loaded hubs
export function getLoadedHubs() {
  return ALL_HUBS;
}

// Export function to check if hubs are loaded
export function areHubsLoaded() {
  return hubsLoaded;
}
