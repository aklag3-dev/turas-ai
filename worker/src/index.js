// Turas AI — Cloudflare Worker API Proxy
// Proxies: Aviationstack, Met Éireann, Irish Rail, TFI, VesselFinder, OpenRouteService

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/api/flights') {
        return await handleFlights(request, env, corsHeaders);
      }
      if (path === '/api/weather') {
        return await handleWeather(request, env, corsHeaders);
      }
      if (path === '/api/rail') {
        return await handleRail(request, corsHeaders);
      }
      if (path === '/api/transit') {
        return await handleTransit(request, corsHeaders);
      }
      if (path === '/api/ferries') {
        return await handleFerries(request, corsHeaders);
      }
      if (path === '/api/route') {
        return await handleRoute(request, env, corsHeaders);
      }
      if (path === '/api/hubs') {
        return await handleHubs(request, corsHeaders);
      }
      if (path === '/api/health') {
        return Response.json({ status: 'ok', version: env.WORKER_VERSION }, { headers: corsHeaders });
      }

      return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
    } catch (err) {
      return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
  }
};

async function handleFlights(request, env, corsHeaders) {
  const url = new URL(request.url);
  const city = url.searchParams.get('city') || 'dublin';
  const apiKey = env.AVIATIONSTACK_API_KEY;

  if (!apiKey) {
    return Response.json({
      error: 'Aviationstack API key not configured',
      simulated: true,
      data: generateSimulatedFlights(city)
    }, { headers: corsHeaders });
  }

  const airportCodes = {
    dublin: ['DUB'],
    cork: ['ORK'],
    shannon: ['SNN']
  };

  const airports = airportCodes[city] || ['DUB'];
  const results = [];

  for (const airport of airports) {
    try {
      const resp = await fetch(
        `http://api.aviationstack.com/v1/flights?access_key=${apiKey}&arr_iata=${airport}&flight_status=active&limit=50`
      );
      if (resp.ok) {
        const data = await resp.json();
        results.push(...(data.data || []));
      }
    } catch (e) {
      console.error(`Aviationstack error for ${airport}:`, e);
    }
  }

  if (results.length === 0) {
    return Response.json({
      data: generateSimulatedFlights(city),
      simulated: true,
      source: 'fallback'
    }, { headers: corsHeaders });
  }

  return Response.json({
    data: results.map(f => ({
      flightNumber: f.flight?.iata || 'Unknown',
      airline: f.airline?.name || 'Unknown',
      origin: f.departure?.iataCode || 'Unknown',
      destination: f.arrival?.iataCode || 'Unknown',
      scheduled: f.arrival?.scheduled || null,
      estimated: f.arrival?.estimated || null,
      status: f.flight_status || 'unknown',
      terminal: f.arrival?.terminal || null
    })),
    simulated: false,
    source: 'aviationstack'
  }, { headers: corsHeaders });
}

function generateSimulatedFlights(city) {
  const airports = { dublin: 'DUB', cork: 'ORK', shannon: 'SNN' };
  const origins = ['LHR', 'AMS', 'CDG', 'FRA', 'JFK', 'BOS'];
  const now = Date.now();
  const flights = [];

  for (let i = 0; i < 8; i++) {
    const etaMs = (Math.random() * 60 - 15) * 60000;
    flights.push({
      flightNumber: `FR${100 + i}`,
      airline: 'Ryanair',
      origin: origins[Math.floor(Math.random() * origins.length)],
      destination: airports[city] || 'DUB',
      scheduled: new Date(now + etaMs).toISOString(),
      estimated: new Date(now + etaMs + Math.random() * 10 * 60000).toISOString(),
      status: Math.random() > 0.8 ? 'delayed' : 'active',
      terminal: Math.random() > 0.5 ? 'T1' : 'T2',
      simulated: true
    });
  }
  return flights;
}

async function handleWeather(request, env, corsHeaders) {
  const url = new URL(request.url);
  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');

  if (!lat || !lon) {
    return Response.json({ error: 'lat and lon required' }, { status: 400, headers: corsHeaders });
  }

  try {
    const resp = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,wind_speed_10m&timezone=Europe/Dublin&forecast_days=1`
    );
    if (resp.ok) {
      const data = await resp.json();
      return Response.json({
        data: data.hourly,
        simulated: false,
        source: 'open-meteo'
      }, { headers: corsHeaders });
    }
  } catch (e) {
    console.error('Weather API error:', e);
  }

  return Response.json({
    data: generateSimulatedWeather(),
    simulated: true,
    source: 'fallback'
  }, { headers: corsHeaders });
}

function generateSimulatedWeather() {
  const now = new Date();
  const times = [];
  const temps = [];
  const precips = [];
  const winds = [];

  for (let i = 0; i < 24; i++) {
    const hour = new Date(now.getTime() + i * 3600000);
    times.push(hour.toISOString());
    temps.push(Math.round((8 + Math.random() * 8) * 10) / 10);
    precips.push(Math.round(Math.random() * 6 * 10) / 10);
    winds.push(Math.round(Math.random() * 25));
  }

  return { time: times, temperature_2m: temps, precipitation: precips, wind_speed_10m: winds };
}

async function handleRail(request, corsHeaders) {
  const url = new URL(request.url);
  const station = url.searchParams.get('station');

  if (!station) {
    return Response.json({ error: 'station required' }, { status: 400, headers: corsHeaders });
  }

  const stationMap = {
    'dub-heuston': 'Heuston',
    'dub-connolly': 'Connolly',
    'cork-kent': 'Cork Kent',
    'limerick-colbert': 'Colbert'
  };

  const stationName = stationMap[station];
  if (!stationName) {
    return Response.json({ error: 'Unknown station' }, { status: 400, headers: corsHeaders });
  }

  try {
    const resp = await fetch(
      `https://api.irishrail.ie/realtime/realtime.asmx/getStationDataByNameXML?StationDesc=${encodeURIComponent(stationName)}`
    );
    if (resp.ok) {
      const text = await resp.text();
      return Response.json({
        raw: text,
        simulated: false,
        source: 'irishrail'
      }, { headers: corsHeaders });
    }
  } catch (e) {
    console.error('Irish Rail API error:', e);
  }

  return Response.json({
    data: generateSimulatedRail(stationName),
    simulated: true,
    source: 'fallback'
  }, { headers: corsHeaders });
}

function generateSimulatedRail(station) {
  const destinations = ['Galway', 'Cork', 'Limerick', 'Waterford', 'Sligo'];
  const now = Date.now();
  const trains = [];

  for (let i = 0; i < 4; i++) {
    const etaMs = (Math.random() * 45 + 5) * 60000;
    trains.push({
      destination: destinations[Math.floor(Math.random() * destinations.length)],
      scheduled: new Date(now + etaMs).toISOString(),
      eta: Math.round(etaMs / 60000),
      status: Math.random() > 0.85 ? 'delayed' : 'on_time',
      simulated: true
    });
  }
  return trains;
}

async function handleTransit(request, corsHeaders) {
  return Response.json({
    data: [],
    simulated: true,
    source: 'fallback',
    note: 'TFI GTFS-Realtime not available from browser'
  }, { headers: corsHeaders });
}

async function handleFerries(request, corsHeaders) {
  return Response.json({
    data: generateSimulatedFerries(),
    simulated: true,
    source: 'fallback',
    note: 'VesselFinder requires API key'
  }, { headers: corsHeaders });
}

function generateSimulatedFerries() {
  const ports = ['Dublin Port', 'Ringaskiddy'];
  const now = Date.now();
  const ferries = [];

  for (const port of ports) {
    for (let i = 0; i < 2; i++) {
      const etaMs = (Math.random() * 120 + 30) * 60000;
      ferries.push({
        port,
        operator: Math.random() > 0.5 ? 'Irish Ferries' : 'Stena Line',
        origin: port.includes('Dublin') ? 'Holyhead' : 'Roscoff',
        eta: new Date(now + etaMs).toISOString(),
        simulated: true
      });
    }
  }
  return ferries;
}

async function handleRoute(request, env, corsHeaders) {
  const url = new URL(request.url);
  const startLat = url.searchParams.get('start_lat');
  const startLon = url.searchParams.get('start_lon');
  const endLat = url.searchParams.get('end_lat');
  const endLon = url.searchParams.get('end_lon');

  if (!startLat || !startLon || !endLat || !endLon) {
    return Response.json({ error: 'start_lat, start_lon, end_lat, end_lon required' }, { status: 400, headers: corsHeaders });
  }

  const apiKey = env.ORS_API_KEY;
  if (!apiKey) {
    return Response.json({
      data: generateSimulatedRoute(startLat, startLon, endLat, endLon),
      simulated: true,
      source: 'fallback'
    }, { headers: corsHeaders });
  }

  try {
    const resp = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify({
        coordinates: [
          [parseFloat(startLon), parseFloat(startLat)],
          [parseFloat(endLon), parseFloat(endLat)]
        ]
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      const feature = data.features?.[0];
      return Response.json({
        data: {
          geometry: feature?.geometry,
          duration: feature?.properties?.summary?.duration,
          distance: feature?.properties?.summary?.distance
        },
        simulated: false,
        source: 'openrouteservice'
      }, { headers: corsHeaders });
    }
  } catch (e) {
    console.error('ORS API error:', e);
  }

  return Response.json({
    data: generateSimulatedRoute(startLat, startLon, endLat, endLon),
    simulated: true,
    source: 'fallback'
  }, { headers: corsHeaders });
}

function generateSimulatedRoute(startLat, startLon, endLat, endLon) {
  const dLat = endLat - startLat;
  const dLon = endLon - startLon;
  const dist = Math.sqrt(dLat * dLat + dLon * dLon) * 111;
  const duration = dist * 120;

  return {
    geometry: {
      type: 'LineString',
      coordinates: [
        [parseFloat(startLon), parseFloat(startLat)],
        [parseFloat(endLon), parseFloat(endLat)]
      ]
    },
    duration: Math.round(duration),
    distance: Math.round(dist * 1000)
  };
}

async function handleHubs(request, corsHeaders) {
  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1SM1HlDJCCxJiXu8-kUR8UEbB55kXP-bCqApxiqePXOs/export?format=csv&gid=0&sheet=Transit_Hubs';
  
  try {
    const resp = await fetch(SHEET_URL);
    if (!resp.ok) {
      throw new Error(`Failed to fetch sheet: ${resp.status}`);
    }
    
    const csv = await resp.text();
    const hubs = parseHubCSV(csv);
    
    return Response.json({
      hubs,
      count: hubs.length,
      source: 'google-sheets',
      timestamp: new Date().toISOString()
    }, { headers: corsHeaders });
  } catch (e) {
    console.error('Hubs fetch error:', e);
    return Response.json({
      hubs: [],
      count: 0,
      error: e.message,
      source: 'error'
    }, { headers: corsHeaders });
  }
}

function parseHubCSV(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const hubs = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < headers.length) continue;
    
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx]?.trim() || '';
    });
    
    const hub = {
      hubId: row['Location ID'] || `hub-${i}`,
      name: row['Name'] || 'Unknown Hub',
      lat: parseFloat(row['Latitude']) || 0,
      lng: parseFloat(row['Longitude']) || 0,
      kHub: getKHubForType(row['Transit Type']),
      modes: getModesForType(row['Transit Type']),
      region: getRegionForLocation(parseFloat(row['Latitude']), parseFloat(row['Longitude'])),
      address: row['Address'] || '',
      countryCode: row['Country Code'] || 'IE',
      postalCode: row['Postal Code'] || '',
    };
    
    if (hub.lat !== 0 && hub.lng !== 0) {
      hubs.push(hub);
    }
  }
  
  return hubs;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

function getKHubForType(transitType) {
  const type = transitType?.toLowerCase() || '';
  if (type.includes('airport')) return 300;
  if (type.includes('train') || type.includes('rail')) return 200;
  if (type.includes('ferry') || type.includes('port')) return 150;
  if (type.includes('bus')) return 100;
  return 150;
}

function getModesForType(transitType) {
  const type = transitType?.toLowerCase() || '';
  if (type.includes('airport')) return ['flight'];
  if (type.includes('train') || type.includes('rail')) return ['train'];
  if (type.includes('ferry') || type.includes('port')) return ['ferry'];
  if (type.includes('bus')) return ['bus'];
  return ['train'];
}

function getRegionForLocation(lat, lng) {
  if (lat > 53.2 && lat < 53.5 && lng > -6.5 && lng < -6.0) return 'dublin';
  if (lat > 51.8 && lat < 52.0 && lng > -8.6 && lng < -8.3) return 'cork';
  if (lat > 52.5 && lat < 52.8 && lng > -9.1 && lng < -8.7) return 'shannon';
  return 'other';
}
