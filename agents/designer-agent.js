// Turas AI — P_fare Designer Agent
// ES-module: exports TurasDesigner class
// Mission: ingest Live Telemetry Brief, execute P_fare equations per hub, rank & cluster

const CAPACITIES = { flight: 200, train: 200, ferry: 400 };
const LOAD_FACTORS = { flight: 0.82, train: 0.65, ferry: 0.50 };

const PLATFORM_ACCESS = {
  freenow: 1.0, independent: 1.0,
  uber: 1.25, bolt: 1.25
};

function hourlyDensity(hour) {
  const curve = [
    0.70, 0.70, 0.70, 0.70, 0.72, 0.80,
    0.95, 1.10, 1.20, 1.15, 1.05, 1.00,
    1.00, 1.05, 1.10, 1.15, 1.20, 1.30,
    1.25, 1.15, 1.05, 0.95, 0.85, 0.75
  ];
  return curve[hour] || 1.0;
}

function computeNPax(arrivals) {
  let total = 0;
  for (const a of arrivals) {
    const cap = CAPACITIES[a.mode] || 200;
    const load = LOAD_FACTORS[a.mode] || 0.70;
    total += cap * load;
  }
  return total;
}

function computeSBase(nPax, kHub) {
  return Math.min(100, (nPax / kHub) * 100);
}

function computeMWeather(precipMmHr, tempC) {
  const precipComponent = Math.min(precipMmHr, 10) * 0.035;
  let tempComponent = 0;
  if (tempC <= 3) tempComponent = 0.10;
  else if (tempC <= 8) tempComponent = 0.07;
  else if (tempC <= 12) tempComponent = 0.04;
  return 1.0 + precipComponent + tempComponent;
}

function computeMDisrupt(disruptions) {
  const dDisrupt = disruptions.length > 0 ? Math.min(1, disruptions.length * 0.5) : 0;
  return 1.0 + (dDisrupt * 0.25);
}

function computeBSupply(hour, platform) {
  const hDensity = hourlyDensity(hour);
  const aPlatform = PLATFORM_ACCESS[platform] || 1.0;
  return hDensity * aPlatform;
}

function computePFare(sBase, mWeather, mDisrupt, bSupply) {
  const iRaw = (sBase * mWeather * mDisrupt) / bSupply;
  return Math.min(99, Math.max(5, Math.round(iRaw)));
}

function pinColor(pFare) {
  if (pFare >= 80) return '#22c55e';
  if (pFare >= 50) return '#f59e0b';
  return '#ef4444';
}

function cluster(nPax, kHub) {
  if (nPax >= kHub) return 'high';
  if (nPax >= kHub * 0.5) return 'medium';
  return 'low';
}

function buildRationale(hubResult) {
  const parts = [];
  if (hubResult.mWeather > 1.05) parts.push(`weather surge +${(hubResult.mWeather - 1).toFixed(2)}`);
  if (hubResult.mDisrupt > 1.0) parts.push(`disruption +${(hubResult.mDisrupt - 1).toFixed(2)}`);
  if (hubResult.bSupply > 1.1) parts.push(`supply pressure ×${hubResult.bSupply.toFixed(2)}`);
  if (hubResult.nPax >= hubResult.kHub) parts.push('demand exceeds saturation');
  return parts.length > 0 ? parts.join(' · ') : 'baseline conditions';
}

export class TurasDesigner {
  constructor(brief) {
    this.brief = brief;
  }

  async evaluate() {
    const { hubs, city, platform, sessionId, generatedAt } = this.brief;
    const hour = new Date(generatedAt).getHours();
    const results = [];

    for (const hub of hubs) {
      const nPax = computeNPax(hub.arrivals);
      const sBase = computeSBase(nPax, hub.kHub);
      const mWeather = computeMWeather(hub.weather.precipMmHr, hub.weather.tempC);
      const mDisrupt = computeMDisrupt(hub.disruptions);
      const bSupply = computeBSupply(hour, platform);
      const pFare = computePFare(sBase, mWeather, mDisrupt, bSupply);
      const iRaw = (sBase * mWeather * mDisrupt) / bSupply;

      const result = {
        hubId: hub.hubId, name: hub.name, lat: hub.lat, lng: hub.lng, kHub: hub.kHub,
        nPax: Math.round(nPax), sBase: Math.round(sBase * 10) / 10,
        mWeather: Math.round(mWeather * 1000) / 1000,
        mDisrupt: Math.round(mDisrupt * 1000) / 1000,
        bSupply: Math.round(bSupply * 1000) / 1000,
        iRaw: Math.round(iRaw * 10) / 10,
        pFare, pinColor: pinColor(pFare),
        cluster: cluster(nPax, hub.kHub),
        arrivals: hub.arrivals,
        weather: hub.weather,
        disruptions: hub.disruptions
      };
      result.rationale = buildRationale(result);
      results.push(result);
    }

    results.sort((a, b) => b.pFare - a.pFare);
    results.forEach((r, i) => r.rank = i + 1);

    const avgPFare = Math.round(results.reduce((s, r) => s + r.pFare, 0) / (results.length || 1));
    const topHub = results[0];

    return {
      sessionId, city, platform, generatedAt,
      summary: {
        hubCount: results.length,
        avgPFare,
        topHubId: topHub?.hubId || null,
        topHubName: topHub?.name || null,
        topPFare: topHub?.pFare || 0
      },
      hubs: results
    };
  }
}
