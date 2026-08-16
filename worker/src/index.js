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
        return await handleFerries(request, env, corsHeaders);
      }
      if (path === '/api/route') {
        return await handleRoute(request, env, corsHeaders);
      }
      if (path === '/api/hubs') {
        return await handleHubs(request, corsHeaders);
      }
      if (path === '/api/chat') {
        return await handleChat(request, env, corsHeaders);
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
      data: [],
      source: 'aviationstack'
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
      data: [],
      source: 'aviationstack',
      note: 'No active flights found'
    }, { headers: corsHeaders });
  }

  return Response.json({
    data: results.map(f => ({
      flightNumber: f.flight?.iata || f.flight?.number || 'Unknown',
      airline: f.airline?.name || 'Unknown',
      origin: f.departure?.airport || f.departure?.iata || 'Unknown',
      destination: f.arrival?.iata || 'Unknown',
      destinationAirport: f.arrival?.airport || 'Unknown',
      scheduled: f.arrival?.scheduled || null,
      estimated: f.arrival?.estimated || null,
      status: f.flight_status || 'unknown',
      terminal: f.arrival?.terminal ? String(f.arrival.terminal).replace(/^T/i, '') : null
    })),
    simulated: false,
    source: 'aviationstack'
  }, { headers: corsHeaders });
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
    error: 'Weather data unavailable',
    data: [],
    source: 'open-meteo'
  }, { headers: corsHeaders });
}

async function handleRail(request, corsHeaders) {
  const url = new URL(request.url);
  const station = url.searchParams.get('station');

  if (!station) {
    return Response.json({ error: 'station required' }, { status: 400, headers: corsHeaders });
  }

  // Map hub IDs (from Google Sheet) to official Irish Rail station descriptions (StationDesc)
  const stationMap = {
    'IE-TRN-ADC': 'Adamstown',
    'IE-TRN-ARD': 'Ardrahan',
    'IE-TRN-ARE': 'Arklow',
    'IE-TRN-ASF': 'Ashtown',
    'IE-TRN-ATG': 'Athenry',
    'IE-TRN-ATH': 'Athlone',
    'IE-TRN-ATI': 'Athy',
    'IE-TRN-ATJ': 'Attymon',
    'IE-TRN-BAK': 'Balbriggan',
    'IE-TRN-BAL': 'Ballina',
    'IE-TRN-BAM': 'Ballinasloe',
    'IE-TRN-BAN': 'Ballybrophy',
    'IE-TRN-BAO': 'Ballyhaunis',
    'IE-TRN-BAP': 'Ballymote',
    'IE-TRN-BAQ': 'Banteer',
    'IE-TRN-BIR': 'Birdhill',
    'IE-TRN-BOS': 'Boyle',
    'IE-TRN-BRT': 'Broombridge',
    'IE-TRN-CAU': 'Cahir',
    'IE-TRN-CAV': 'Carlow',
    'IE-TRN-CAW': 'Carrick on Shannon',
    'IE-TRN-CAX': 'Carrick on Suir',
    'IE-TRN-CAY': 'Carrigaloe',
    'IE-TRN-CAZ': 'Carrigtwohill',
    'IE-TRN-CAA': 'Castlebar',
    'IE-TRN-CAB': 'Castleconnell',
    'IE-TRN-CAC': 'Castleknock',
    'IE-TRN-CAD': 'Castlerea',
    'IE-TRN-CHE': 'Charleville',
    'IE-TRN-CLF': 'Clara',
    'IE-TRN-CLG': 'Claremorris',
    'IE-TRN-CLH': 'Clondalkin',
    'IE-TRN-CLI': 'Clonmel',
    'IE-TRN-CLJ': 'Clonsilla',
    'IE-TRN-CLK': 'Cloughjordan',
    'IE-TRN-COL': 'Cobh',
    'IE-TRN-COM': 'Collooney',
    'IE-TRN-CON': 'Dublin Connolly',
    'IE-TRN-COO': 'Cork',
    'IE-TRN-CRP': 'Craughwell',
    'IE-TRN-DOQ': 'Docklands',
    'IE-TRN-DOR': 'Donabate',
    'IE-TRN-DRS': 'Drogheda',
    'IE-TRN-DRT': 'Dromod',
    'IE-TRN-DRU': 'Drumcondra',
    'IE-TRN-DUV': 'Dublin Heuston',
    'IE-TRN-DUW': 'Dunboyne',
    'IE-TRN-DUX': 'Dundalk',
    'IE-TRN-EDY': 'Edgeworthstown',
    'IE-TRN-ENZ': 'Enfield',
    'IE-TRN-ENA': 'Ennis',
    'IE-TRN-ENB': 'Enniscorthy',
    'IE-TRN-FAC': 'Farranfore',
    'IE-TRN-FOD': 'Fota',
    'IE-TRN-FOE': 'Foxford',
    'IE-TRN-GAF': 'Galway',
    'IE-TRN-GLG': 'Glounthaune',
    'IE-TRN-GOH': 'Gorey',
    'IE-TRN-GOI': 'Gormanston',
    'IE-TRN-GOJ': 'Gort',
    'IE-TRN-HAK': 'Hansfield',
    'IE-TRN-HAL': 'Hazelhatch',
    'IE-TRN-KIM': 'Kilcock',
    'IE-TRN-KIN': 'Kilcoole',
    'IE-TRN-KIO': 'Kildare',
    'IE-TRN-KIP': 'Kilkenny',
    'IE-TRN-KIQ': 'Killarney',
    'IE-TRN-LAR': 'Laytown',
    'IE-TRN-LES': 'Leixlip (Confey)',
    'IE-TRN-LET': 'Leixlip (Louisa Bridge)',
    'IE-TRN-LIU': 'Limerick',
    'IE-TRN-LIV': 'Limerick Junction',
    'IE-TRN-LIW': 'LittleIsland',
    'IE-TRN-LOX': 'Longford',
    'IE-TRN-M3Y': 'M3 Parkway',
    'IE-TRN-MAZ': 'Mallow',
    'IE-TRN-MAA': 'Manulla Junction',
    'IE-TRN-MAB': 'Maynooth',
    'IE-TRN-MIC': 'Midleton',
    'IE-TRN-MID': 'Millstreet',
    'IE-TRN-MOE': 'Monasterevin',
    'IE-TRN-MUF': 'Muine Bheag',
    'IE-TRN-MUG': 'Mullingar',
    'IE-TRN-NAH': 'Navan Road Parkway',
    'IE-TRN-NEI': 'Nenagh',
    'IE-TRN-NEJ': 'Newbridge',
    'IE-TRN-ORK': 'Oranmore',
    'IE-TRN-PAL': 'Park West and Cherry Orchard',
    'IE-TRN-POM': 'Portarlington',
    'IE-TRN-PON': 'Portlaoise',
    'IE-TRN-RAO': 'Rathdrum',
    'IE-TRN-RAP': 'Rathmore',
    'IE-TRN-ROQ': 'Roscommon',
    'IE-TRN-ROR': 'Roscrea',
    'IE-TRN-ROS': 'Rosslare Europort',
    'IE-TRN-ROT': 'Rosslare Strand',
    'IE-TRN-RUU': 'Rush and Lusk',
    'IE-TRN-RUV': 'Rushbrooke',
    'IE-TRN-SAW': 'Sallins',
    'IE-TRN-SAX': 'Salthill and Monkstown',
    'IE-TRN-SIY': 'Sixmilebridge',
    'IE-TRN-SKZ': 'Skerries',
    'IE-TRN-SLA': 'Sligo',
    'IE-TRN-TEB': 'Templemore',
    'IE-TRN-THC': 'Thomastown',
    'IE-TRN-THD': 'Thurles',
    'IE-TRN-TIE': 'Tipperary',
    'IE-TRN-TRF': 'Tralee',
    'IE-TRN-TUG': 'Tullamore',
    'IE-TRN-WAH': 'Waterford',
    'IE-TRN-WEI': 'Westport',
    'IE-TRN-WEJ': 'Wexford',
    'IE-TRN-WIK': 'Wicklow',
    'IE-TRN-WOL': 'Woodlawn'
  };

  const stationName = stationMap[station];
  if (!stationName) {
    return Response.json({ error: 'Unknown station', stationId: station }, { status: 400, headers: corsHeaders });
  }

  try {
    const resp = await fetch(
      `https://api.irishrail.ie/realtime/realtime.asmx/getStationDataByNameXML?StationDesc=${encodeURIComponent(stationName)}`,
      { headers: { 'User-Agent': 'TurasAI/1.0' } }
    );
    if (resp.ok) {
      const text = await resp.text();
      const trains = parseIrishRailXML(text);
      return Response.json({
        data: trains,
        count: trains.length,
        station: stationName,
        simulated: false,
        source: 'irishrail'
      }, { headers: corsHeaders });
    }
  } catch (e) {
    console.error('Irish Rail API error:', e);
  }

  return Response.json({
    error: 'Rail data unavailable',
    data: [],
    source: 'irishrail'
  }, { headers: corsHeaders });
}

function parseIrishRailXML(xmlStr) {
  const trains = [];
  if (!xmlStr || typeof xmlStr !== 'string') return trains;
  const items = xmlStr.split(/<objStationData>/i);
  for (let i = 1; i < items.length; i++) {
    const block = items[i].split(/<\/objStationData>/i)[0];
    const getTag = (tag) => {
      const match = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
      return match ? match[1].trim() : null;
    };
    const dueInStr = getTag('Duein');
    const dueIn = dueInStr != null && dueInStr !== '' ? parseInt(dueInStr, 10) : null;
    trains.push({
      trainCode: getTag('Traincode'),
      stationFullName: getTag('Stationfullname'),
      stationCode: getTag('Stationcode'),
      origin: getTag('Origin') || 'Unknown',
      destination: getTag('Destination') || 'Unknown',
      status: getTag('Status') || 'active',
      lastLocation: getTag('Lastlocation'),
      dueIn: dueIn,
      etaMinutes: dueIn != null ? dueIn : 15,
      late: parseInt(getTag('Late') || '0', 10),
      expArrival: getTag('Exparrival'),
      schArrival: getTag('Scharrival'),
      direction: getTag('Direction'),
      trainType: getTag('Traintype'),
      locationType: getTag('Locationtype')
    });
  }
  return trains;
}

async function handleTransit(request, corsHeaders) {
  return Response.json({
    data: [],
    source: 'tfi',
    note: 'TFI GTFS-Realtime not available'
  }, { headers: corsHeaders });
}

// ─── VesselAPI for live ferry arrivals ───
// Map hub IDs to UN/LOCODEs for Irish ferry ports
const FERRY_PORT_LOCODES = {
  'IE-FRY-DUB': 'IEDUB',  // Dublin Port
  'IE-FRY-DUN': 'IEDLR',  // Dún Laoghaire
  'IE-FRY-ROS': 'IEROS', // Rosslare Europort
  'IE-FRY-WAT': 'IEWAT',  // Waterford
  'IE-FRY-RIN': 'IERING', // Ringaskiddy (Cork)
  'IE-FRY-COB': 'IECOB',  // Cobh
  'IE-FRY-RSV': 'IERSS',  // Rossaveel
  'IE-FRY-GAL': 'IEGAL',  // Galway
  'IE-FRY-TAR': 'IETAR',  // Tarbert
  'IE-FRY-KLY': 'IEKLY',  // Killybegs
};

// Cache for VesselAPI data
let vesselApiCache = { data: null, timestamp: 0 };
const VESSELAPI_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Fetch inbound vessels from VesselAPI
async function fetchInboundVessels(apiKey, locode) {
  try {
    const response = await fetch(`https://api.vesselapi.com/v1/port/${locode}/inbound`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('VesselAPI error:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();
    return data.vesselETAs || [];
  } catch (e) {
    console.error('VesselAPI fetch error:', e);
    return null;
  }
}

// Convert VesselAPI inbound vessel data to our format
function formatVesselApiInbound(vesselEta, hubId) {
  // Calculate ETA in minutes
  let etaMinutes = null;
  if (vesselEta.eta) {
    const etaDate = new Date(vesselEta.eta);
    etaMinutes = Math.round((etaDate - Date.now()) / 60000);
  }

  return {
    name: vesselEta.vesselName || vesselEta.vessel_name || vesselEta.name || vesselEta.shipName || 'Unknown Vessel',
    mmsi: vesselEta.mmsi || null,
    imo: vesselEta.imo || null,
    destination: vesselEta.destinationPort || hubId,
    lat: null, // VesselAPI inbound doesn't include position
    lng: null,
    speed: null,
    course: null,
    heading: null,
    eta: vesselEta.eta || null,
    etaMinutes: etaMinutes,
    port: hubId,
    navStatus: null,
    shipType: null,
    simulated: false,
    source: 'vesselapi'
  };
}

async function handleFerries(request, env, corsHeaders) {
  const url = new URL(request.url);
  const port = url.searchParams.get('port');  // Hub ID (e.g., IE-FRY-DUB)

  const apiKey = env.VESSELAPI_KEY;
  if (!apiKey) {
    return Response.json({
      error: 'VesselAPI key not configured',
      data: [],
      source: 'vesselapi'
    }, { headers: corsHeaders });
  }

  try {
    // If specific port requested, fetch just that port
    if (port && FERRY_PORT_LOCODES[port]) {
      const locode = FERRY_PORT_LOCODES[port];
      console.log('Fetching inbound vessels for', port, '(', locode, ')');
      
      const vesselEtas = await fetchInboundVessels(apiKey, locode);
      
      if (!vesselEtas || vesselEtas.length === 0) {
        return Response.json({
          data: [],
          source: 'vesselapi',
          port: port,
          count: 0,
          note: `No live inbound data for ${port}`
        }, { headers: corsHeaders });
      }

      const arrivals = vesselEtas
        .map(v => formatVesselApiInbound(v, port))
        .filter(a => a.etaMinutes !== null && a.etaMinutes > 0)
        .sort((a, b) => a.etaMinutes - b.etaMinutes);

      return Response.json({
        data: arrivals,
        simulated: false,
        source: 'vesselapi',
        port: port,
        count: arrivals.length
      }, { headers: corsHeaders });
    }

    // If no port specified or invalid port, fetch all Irish ports
    console.log('Fetching inbound vessels for all Irish ferry ports');
    const allArrivals = [];

    for (const [hubId, locode] of Object.entries(FERRY_PORT_LOCODES)) {
      const vesselEtas = await fetchInboundVessels(apiKey, locode);
      if (vesselEtas) {
        const arrivals = vesselEtas
          .map(v => formatVesselApiInbound(v, hubId))
          .filter(a => a.etaMinutes !== null && a.etaMinutes > 0);
        allArrivals.push(...arrivals);
      }
    }

    // Sort by ETA
    allArrivals.sort((a, b) => a.etaMinutes - b.etaMinutes);

    return Response.json({
      data: allArrivals,
      simulated: false,
      source: 'vesselapi',
      port: 'all',
      count: allArrivals.length
    }, { headers: corsHeaders });

  } catch (e) {
    console.error('VesselAPI error:', e);
  }

  return Response.json({
    error: 'Ferry data unavailable',
    data: [],
    source: 'vesselapi'
  }, { headers: corsHeaders });
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
      error: 'ORS API key not configured',
      data: null,
      source: 'openrouteservice'
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
    error: 'Route data unavailable',
    data: null,
    source: 'openrouteservice'
  }, { headers: corsHeaders });
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

async function handleChat(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { message, context, apiKey: userApiKey, history = [] } = body;
    const apiKey = userApiKey || request.headers.get('X-Gemini-Key') || env.GEMINI_API_KEY || env.GEMINI_KEY;

    if (!message) {
      return Response.json({ error: 'Message parameter is required' }, { status: 400, headers: corsHeaders });
    }

    const systemPrompt = `You are Turas AI, an intelligent driver assistant for transport hubs in Ireland, powered by AI.
Your purpose:
1. Help taxi and rideshare drivers in Ireland maximize earnings, navigate transport hubs (airports, ferry ports, rail stations), understand demand probabilities (P_fare), weather, and transport policies.
2. Answer ALL questions—whether directly related to Turas AI, transport hubs, driving strategy, OR any general question/topic outside transport hubs (e.g. general knowledge, advice, math, science, coding, trivia, current events, directions, writing, etc.).
3. Always provide clear, accurate, concise, and helpful responses using your full AI knowledge base.

${context ? 'Current Live Dashboard Context:\n' + JSON.stringify(context, null, 2) : ''}`;

    // 1. Try Gemini API first if API key is present
    if (apiKey) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const contents = [];
        
        // Add system instruction as first user message
        contents.push({
          role: 'user',
          parts: [{ text: systemPrompt + '\n\nPlease acknowledge that you understand your role and are ready to help.' }]
        });
        contents.push({
          role: 'model',
          parts: [{ text: 'I understand. I am Turas AI, ready to assist drivers in Ireland with hub recommendations, weather, transport policies, and any other questions.' }]
        });

        // Add conversation history
        if (Array.isArray(history) && history.length > 0) {
          for (const h of history) {
            if (h.role && h.text) {
              contents.push({
                role: h.role === 'user' ? 'user' : 'model',
                parts: [{ text: h.text }]
              });
            }
          }
        }

        // Add the current user message
        contents.push({
          role: 'user',
          parts: [{ text: message }]
        });

        const resp = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024
            }
          })
        });

        if (resp.ok) {
          const data = await resp.json();
          const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (replyText) {
            return Response.json({ response: replyText, model: 'gemini-2.5-flash', source: 'gemini' }, { headers: corsHeaders });
          } else {
            console.error('[Turas AI Worker] Gemini API returned no text:', JSON.stringify(data));
          }
        } else {
          const errorData = await resp.text();
          console.error('[Turas AI Worker] Gemini API error:', resp.status, errorData);
        }
      } catch (geminiErr) {
        console.error('[Turas AI Worker] Gemini API call error:', geminiErr?.message || geminiErr);
      }
    } else {
      console.warn('[Turas AI Worker] No Gemini API key found in env.GEMINI_API_KEY or env.GEMINI_KEY');
    }

    // 2. Try Workers AI if binding is available
    if (env.AI && typeof env.AI.run === 'function') {
      try {
        const messages = [
          { role: 'system', content: systemPrompt }
        ];

        if (Array.isArray(history)) {
          for (const h of history) {
            if (h.role && h.text) {
              messages.push({
                role: h.role === 'user' ? 'user' : 'assistant',
                content: h.text
              });
            }
          }
        }

        messages.push({ role: 'user', content: message });

        const aiResult = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages,
          max_tokens: 500
        }).catch((e) => {
          console.warn('[Turas AI Worker] env.AI.run failed:', e?.message || e);
          return null;
        });

        if (aiResult) {
          const replyText = aiResult.response || aiResult.text;
          if (replyText) {
            return Response.json({ response: replyText, model: 'workers-ai-llama-3.1' }, { headers: corsHeaders });
          }
        }
      } catch (aiErr) {
        console.warn('[Turas AI Worker] Workers AI error:', aiErr);
      }
    }

    // 3. Fallback intelligent response generator for all messages
    const fallbackAnswer = generateIntelligentChatResponse(message, context);
    return Response.json({ response: fallbackAnswer, model: 'turas-assistant-intelligent' }, { headers: corsHeaders });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
  }
}

function generateIntelligentChatResponse(message, context) {
  const q = message.toLowerCase().trim();

  // Greetings
  if (q === 'hi' || q === 'hello' || q === 'hey' || q.startsWith('hi ') || q.startsWith('hello ') || q.startsWith('hey ')) {
    const topHubStr = context?.topHub ? ` Currently, **${context.topHub.name}** is your top recommended hub with a **${context.topHub.pFare}%** demand probability.` : '';
    return `Hello! I am Turas AI, your driver assistant powered by Google Gemini.${topHubStr}\n\nHow can I help you today? Ask me about hub scores, weather impacts, rank rules, or any general question!`;
  }

  // Identity / Status
  if (q.includes('who are you') || q.includes('what are you') || q.includes('how are you') || q.includes('what can you do')) {
    return `I am **Turas AI Assistant**, powered by Google Gemini. I help taxi and rideshare drivers in Ireland maximize shift yield by analyzing live transit arrivals, weather conditions, driver supply, and demand probabilities ($P_{fare}$). I can also answer general questions!`;
  }

  // Scores / P_fare
  if (q.includes('score') || q.includes('p_fare') || q.includes('probability') || q.includes('pfare')) {
    if (context?.topHub) {
      return `The current top recommendation is **${context.topHub.name}** with a $P_{fare}$ score of **${context.topHub.pFare}%** based on ${context.topHub.arrivalsCount || 0} live arrivals. Higher $P_{fare}$ scores (80%+) indicate short wait times and peak passenger demand.`;
    }
    return `The $P_{fare}$ probability index predicts passenger demand at a transit hub. Scores above 80% (Green) mean high demand and fast turnover. Amber (50-79%) is moderate, and Red (<50%) indicates low demand or high supply saturation.`;
  }

  // Weather
  if (q.includes('weather') || q.includes('rain') || q.includes('temp') || q.includes('snow') || q.includes('storm')) {
    if (context?.weather) {
      return `Current weather: **${context.weather.tempC}°C** with **${context.weather.precipMmHr}mm/hr** precipitation. ${context.weather.precipMmHr > 3 ? 'Heavy rainfall is boosting demand at exit gates.' : 'Mild conditions with baseline demand.'}`;
    }
    return `Precipitation significantly increases passenger demand at terminal exit gates and outdoor ranks. Heavy rain drives higher $P_{fare}$ scores across all nearby hubs.`;
  }

  // Ranks / Permits
  if (q.includes('rank') || q.includes('permit') || q.includes('uber') || q.includes('bolt') || q.includes('freenow')) {
    return `**Rank Access & Pickup Rules**:\n- Official airport and station ranks require licensed taxi rank permits (FreeNow, Independent).\n- Ride-hailing platforms (Uber, Bolt) must use designated app pickup zones.`;
  }

  // Earnings
  if (q.includes('earn') || q.includes('yield') || q.includes('money') || q.includes('profit') || q.includes('fare')) {
    return `To maximize earnings per shift, position at hubs with **$P_{fare} \\ge 80\\%$**. Shorter wait times mean more completed fares per hour.`;
  }

  // Locations
  if (q.includes('dublin') || q.includes('cork') || q.includes('shannon') || q.includes('galway') || q.includes('limerick')) {
    return `Hubs in ${context?.city?.toUpperCase() || 'Ireland'} are continuously monitored. Terminal arrivals, train schedules, and ferry dockings generate real-time demand surges. Check the hub list for live rankings.`;
  }

  // General questions fallback
  return `Regarding **"${message}"**:\n\nI am Turas AI Assistant. I analyze transit hub demand, weather, driver positioning, and answer driver questions. ${context?.topHub ? `Currently, **${context.topHub.name} (${context.topHub.pFare}%)** is your top recommended hub.` : 'Click **Begin Search** to evaluate live recommendations for your location.'}`;
}
