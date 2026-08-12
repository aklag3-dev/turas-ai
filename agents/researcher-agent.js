// Turas AI — Resident Researcher Agent
// ES-module: exports TurasResearcher class
// Uses Cloudflare Worker proxy for live API calls with simulated fallback

const WORKER_URL = 'https://turas-ai-proxy.femihall.workers.dev';

const HUB_DEFINITIONS = {
  dublin: [
    { hubId: 'dub-t1', name: 'Dublin Airport T1', lat: 53.4213, lng: -6.2700, kHub: 450, modes: ['flight'] },
    { hubId: 'dub-t2', name: 'Dublin Airport T2', lat: 53.4273, lng: -6.2437, kHub: 450, modes: ['flight'] },
    { hubId: 'dub-heuston', name: 'Dublin Heuston', lat: 53.3460, lng: -6.2947, kHub: 250, modes: ['train'] },
    { hubId: 'dub-connolly', name: 'Dublin Connolly', lat: 53.3521, lng: -6.2483, kHub: 200, modes: ['train'] },
    { hubId: 'dub-port', name: 'Dublin Port', lat: 53.3494, lng: -6.2120, kHub: 180, modes: ['ferry'] },
  ],
  cork: [
    { hubId: 'ork', name: 'Cork Airport', lat: 51.8414, lng: -8.4906, kHub: 120, modes: ['flight'] },
    { hubId: 'cork-kent', name: 'Cork Kent', lat: 51.8969, lng: -8.4664, kHub: 150, modes: ['train'] },
    { hubId: 'ringaskiddy', name: 'Ringaskiddy', lat: 51.8167, lng: -8.2833, kHub: 100, modes: ['ferry'] },
  ],
  shannon: [
    { hubId: 'snn', name: 'Shannon Airport', lat: 52.7019, lng: -8.9243, kHub: 100, modes: ['flight'] },
    { hubId: 'limerick-colbert', name: 'Limerick Colbert', lat: 52.6597, lng: -8.6282, kHub: 120, modes: ['train'] },
    { hubId: 'shannon-foynes', name: 'Shannon Foynes Port', lat: 52.6200, lng: -9.1000, kHub: 80, modes: ['ferry'] },
  ],
};

const CITY_COORDS = {
  dublin: { lat: 53.3498, lng: -6.2603 },
  cork: { lat: 51.8985, lng: -8.4756 },
  shannon: { lat: 52.7019, lng: -8.9243 },
};

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

function generateSimulatedWeather(city, rand) {
  const precip = Math.round(rand() * 8 * 10) / 10;
  const temp = Math.round((rand() * 15 + 3) * 10) / 10;
  const wind = Math.round(rand() * 30);
  return { precipMmHr: precip, tempC: temp, wind, warnings: [], simulated: true, source: 'simulated' };
}

function generateSimulatedArrivals(hub, windowMinutes, rand) {
  const arrivals = [];
  const count = Math.floor(rand() * 6) + 2;
  for (let i = 0; i < count; i++) {
    const mode = hub.modes[Math.floor(rand() * hub.modes.length)];
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
      const terminal = f.terminal;
      if (hub.hubId === 'dub-t1' && terminal !== 'T1') return false;
      if (hub.hubId === 'dub-t2' && terminal !== 'T2') return false;
      return true;
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
    .filter(f => {
      if (hub.hubId === 'dub-port' && !f.port?.includes('Dublin')) return false;
      if (hub.hubId === 'ringaskiddy' && !f.port?.includes('Ringaskiddy')) return false;
      return true;
    })
    .map(f => ({
      mode: 'ferry',
      origin: f.origin || 'Unknown',
      operator: f.operator || 'Unknown',
      etaMinutes: f.eta ? Math.round((new Date(f.eta) - Date.now()) / 60000) : 60,
      simulated: f.simulated || false,
      source: ferryResp.source || 'fallback'
    }));
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
    this.hubDefinitions = HUB_DEFINITIONS;
  }

  async collect(config) {
    const { city = 'dublin', platform = 'freenow', mode = 'stationary', sessionId } = config;
    const hubs = this.hubDefinitions[city] || [];
    const generatedAt = new Date().toISOString();
    const coords = CITY_COORDS[city] || CITY_COORDS.dublin;
    const hubData = [];

    const [flightResp, weatherResp, ferryResp] = await Promise.all([
      fetchFromWorker('/api/flights', { city }),
      fetchFromWorker('/api/weather', { lat: coords.lat, lon: coords.lng }),
      fetchFromWorker('/api/ferries'),
    ]);

    const weather = processWeatherData(weatherResp);

    for (const hub of hubs) {
      const rand = seededRandom(`${hub.hubId}-${generatedAt.slice(0, 13)}`);
      let arrivals = [];
      let hubWeather = weather || generateSimulatedWeather(city, rand);
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

      if (hub.modes.includes('ferry') && ferryResp) {
        const ferryArrivals = processFerryData(ferryResp, hub);
        arrivals.push(...ferryArrivals);
      }

      if (arrivals.length === 0) {
        arrivals = generateSimulatedArrivals(hub, 30, rand);
      }

      hubData.push({
        hubId: hub.hubId,
        name: hub.name,
        lat: hub.lat,
        lng: hub.lng,
        kHub: hub.kHub,
        arrivals,
        weather: hubWeather,
        disruptions,
      });
    }

    return {
      generatedAt,
      sessionId: sessionId || crypto.randomUUID(),
      city,
      mode,
      platform,
      hubs: hubData,
    };
  }
}
