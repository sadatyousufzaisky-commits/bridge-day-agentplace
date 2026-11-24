const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ZONE = 'America/Los_Angeles';
const LOCAL_DATE = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE });
const LOCAL_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hour: 'numeric',
  hourCycle: 'h23',
});
const DEFAULT_DEPARTURES = '09:00,11:00,13:00,15:00';
const FORECAST_MAX_AGE = 18 * HOUR;
const FORECAST_TIMEOUT_MS = 4_500;
const FORECAST_RETRY_DELAY_MS = 300;
const TRANSIENT_FORECAST_STATUS = new Set([502, 503, 504]);
const NWS_ROOT = 'https://api.weather.gov/gridpoints/MTR';
const SHOP_ROOT = 'https://www.blazingsaddles.com/san-francisco';
const LINKS = {
  route: `${SHOP_ROOT}/routes-and-tours/bike-the-bridge-self-guided`,
  rentals: `${SHOP_ROOT}/bikes-and-rates/all-bikes`,
  bridgeAccess: 'https://www.goldengate.org/bridge/visiting-the-bridge/bikes-pedestrians/',
  ferrySchedule: 'https://www.goldengate.org/ferry/route-schedule/sausalito-san-francisco/',
  ferryBikePolicy: 'https://www.goldengate.org/ferry/riding-the-ferry/bringing-your-bike/',
};

const CHECKPOINTS = [
  { name: 'Golden Gate Bridge south approach', minutes: 45, url: `${NWS_ROOT}/83,107/forecast/hourly` },
  { name: 'Sausalito waterfront', minutes: 135, url: `${NWS_ROOT}/83,109/forecast/hourly` },
];

const BIKES = {
  comfort: { label: 'Deluxe Comfort Bike', dailyUsd: 32, source: `${SHOP_ROOT}/bikes-and-rates/details-deluxe-comfort-bike` },
  electric: { label: 'Electric Bike', dailyUsd: 64, source: `${SHOP_ROOT}/bikes-and-rates/details-electric-bike` },
};

export function localDate(now = new Date()) {
  return LOCAL_DATE.format(now);
}

function parseRequest(params, now) {
  const date = params.get('date') ?? localDate(now);
  const dateUtc = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dateUtc) ||
      new Date(dateUtc).toISOString().slice(0, 10) !== date || date < localDate(now)) {
    return { error: 'Use today or a future date in San Francisco, in YYYY-MM-DD format.' };
  }

  const riders = params.get('riders') ?? '1';
  if (!/^(?:[1-9]|1\d|20)$/.test(riders)) return { error: 'Choose 1 to 20 riders.' };

  const bike = params.get('bike') ?? 'compare';
  if (!['comfort', 'electric', 'compare'].includes(bike)) {
    return { error: 'Choose comfort, electric, or compare.' };
  }

  const departures = [...new Set((params.get('departures') ?? DEFAULT_DEPARTURES).split(','))].sort();
  if (departures.length > 6 || departures.some(time => !/^(?:(?:0[89]|1[0-4]):(?:00|30)|15:00)$/.test(time))) {
    return { error: 'Use one to six comma-separated departure times in half-hour steps from 08:00 to 15:00 Pacific time.' };
  }

  // The Pacific DST transition occurs before every departure the planner supports.
  const offset = 18 - Number(LOCAL_HOUR.format(new Date(dateUtc + 18 * HOUR)));
  const times = departures.map(time => {
    const [hour, minute] = time.split(':').map(Number);
    return { time, instant: dateUtc + (hour + offset + minute / 60) * HOUR };
  });

  return { date, dateUtc, riders: Number(riders), bike, times };
}

async function requestForecast(checkpoint, fetcher) {
  const response = await fetcher(checkpoint.url, {
    headers: { Accept: 'application/geo+json', 'User-Agent': 'BridgeDay-Assessment/1.0' },
    redirect: 'error',
    signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS),
  });
  if (response.ok) return response.json();

  const error = new Error(`NWS returned ${response.status}`);
  error.retryable = TRANSIENT_FORECAST_STATUS.has(response.status) && !response.headers.has('Retry-After');
  throw error;
}

async function loadForecast(checkpoint, fetcher, now) {
  let forecast;
  try {
    forecast = await requestForecast(checkpoint, fetcher);
  } catch (error) {
    if (!error?.retryable && error?.name !== 'TimeoutError' && error?.name !== 'TypeError') throw error;
    await new Promise(resolve => setTimeout(resolve, FORECAST_RETRY_DELAY_MS));
    forecast = await requestForecast(checkpoint, fetcher);
  }

  const properties = forecast?.properties;
  const updatedAt = Date.parse(properties?.updateTime);
  if (!Number.isFinite(updatedAt) || updatedAt > now.getTime() + HOUR ||
      now.getTime() - updatedAt > FORECAST_MAX_AGE || !Array.isArray(properties.periods)) {
    throw new Error('NWS forecast is stale or unreadable');
  }

  return {
    updatedAt: new Date(updatedAt).toISOString(),
    periods: properties.periods.flatMap(period => {
      const start = Date.parse(period?.startTime);
      const end = Date.parse(period?.endTime);
      if (!(end > start)) return [];

      return [{
        start,
        end,
        summary: period.shortForecast,
        temperatureF: period.temperatureUnit === 'F' && Number.isFinite(period.temperature) ? period.temperature : null,
        windMph: parseWind(period.windSpeed),
        rainPct: validProbability(period.probabilityOfPrecipitation?.value),
      }];
    }),
  };
}

function parseWind(value) {
  const match = /^(\d+)(?:\s+to\s+(\d+))?\s+mph$/i.exec(value ?? '');
  return match ? Math.max(Number(match[1]), Number(match[2] ?? match[1])) : null;
}

function validProbability(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function getSample(checkpoint, forecast, instant) {
  const sampleAt = instant + checkpoint.minutes * 60_000;
  const period = forecast?.periods.find(value => value.start <= sampleAt && sampleAt < value.end);
  if (!period) return null;

  return {
    location: checkpoint.name,
    sampleAt: new Date(sampleAt).toISOString(),
    forecastPeriodStart: new Date(period.start).toISOString(),
    forecastPeriodEnd: new Date(period.end).toISOString(),
    forecastUpdatedAt: forecast.updatedAt,
    summary: typeof period.summary === 'string' ? period.summary.slice(0, 120) : null,
    temperatureF: period.temperatureF,
    windMph: period.windMph,
    precipitationProbabilityPct: period.rainPct,
    source: checkpoint.url,
  };
}

function makeOption(candidate, forecasts) {
  const samples = CHECKPOINTS.map((point, index) => getSample(point, forecasts[index], candidate.instant));
  const comparable = samples.every(sample => sample?.windMph != null && sample.precipitationProbabilityPct != null);
  const departure = {
    localTime: candidate.time,
    departureAt: new Date(candidate.instant).toISOString(),
    checkpoints: samples.filter(Boolean),
    comparison: null,
  };
  if (!comparable) return departure;

  const windMph = Math.max(...samples.map(sample => sample.windMph));
  const precipitationProbabilityPct = Math.max(...samples.map(sample => sample.precipitationProbabilityPct));
  departure.comparison = {
    maxForecastWindMph: windMph,
    maxPrecipitationProbabilityPct: precipitationProbabilityPct,
    score: windMph * 5 + precipitationProbabilityPct * 2,
  };
  return departure;
}

function itinerary(query) {
  const choices = query.bike === 'compare' ? Object.keys(BIKES) : [query.bike];
  return {
    name: 'Fisherman’s Wharf to Sausalito',
    pickup: '2715 Hyde Street, San Francisco',
    landmarks: ['Fisherman’s Wharf', 'Crissy Field', 'Golden Gate Bridge', 'Sausalito waterfront'],
    rentalEstimate: {
      riders: query.riders,
      currency: 'USD',
      basis: 'Published all-day online base rate per bike, checked 2026-11-24. Taxes, fees, ferry fare and equipment add-ons are separate. Verify current price and stock with the shop.',
      options: choices.map(key => ({ ...BIKES[key], bike: key, subtotalUsd: BIKES[key].dailyUsd * query.riders })),
    },
    ferry: 'Golden Gate Ferry boards bicycles first come, first served. Check the operator schedule and bike policy before leaving.',
    links: LINKS,
  };
}

export async function planRide(params, { now = new Date(), fetcher = fetch } = {}) {
  const query = parseRequest(params, now);
  if (query.error) return { status: 'invalid_input', message: query.error };

  const plan = {
    date: query.date,
    timeZone: ZONE,
    itinerary: itinerary(query),
    forecast: {
      provider: 'U.S. National Weather Service',
      retrievedAt: null,
      status: 'unavailable',
      message: 'The forecast could not be loaded. Check the official bridge access page before riding.',
    },
    departures: [],
    recommendedDeparture: null,
  };
  const upcoming = query.times.filter(candidate => candidate.instant >= now.getTime());
  if (upcoming.length === 0) {
    plan.forecast.status = 'no_future_departures';
    plan.forecast.message = 'Those departure times have passed in San Francisco. Try a later time or another date.';
    return plan;
  }

  if (query.dateUtc - Date.parse(`${localDate(now)}T00:00:00Z`) > 6 * DAY) {
    plan.forecast.status = 'outside_horizon';
    plan.forecast.message = 'Hourly comparisons are available through six days ahead. Check again closer to the ride.';
    return plan;
  }

  const results = await Promise.allSettled(CHECKPOINTS.map(point => loadForecast(point, fetcher, now)));
  const forecasts = results.map(result => result.status === 'fulfilled' ? result.value : null);
  plan.departures = upcoming.map(candidate => makeOption(candidate, forecasts));
  if (plan.departures.some(option => option.checkpoints.length > 0)) plan.forecast.retrievedAt = now.toISOString();

  if (plan.departures.every(option => option.comparison)) {
    plan.forecast.status = 'ready';
    plan.forecast.message = 'Two hourly checkpoints per departure. Forecast wind and precipitation describe planning conditions. Check official bridge access before riding.';
    if (plan.departures.length > 1) {
      const lowestScore = Math.min(...plan.departures.map(option => option.comparison.score));
      const best = plan.departures.filter(option => option.comparison.score === lowestScore);
      if (best.length === 1) plan.recommendedDeparture = best[0].localTime;
      else plan.forecast.message = 'The lowest weather scores are tied. Choose the time that fits your schedule and check official bridge access before riding.';
    }
  } else if (plan.forecast.retrievedAt) {
    plan.forecast.status = 'partial';
    plan.forecast.message = 'Some forecast inputs are missing. Available hourly readings are shown without a ranked departure.';
  }

  return plan;
}

export async function handleRequest(request, options) {
  const url = new URL(request.url);
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };

  if (url.pathname !== '/v1/ride-plan' && url.pathname !== '/health') {
    return Response.json({ status: 'not_found' }, { status: 404, headers });
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'GET') {
    return Response.json({ status: 'method_not_allowed' }, { status: 405, headers: { ...headers, Allow: 'GET, OPTIONS' } });
  }
  if (url.pathname === '/health') return Response.json({ status: 'ok', service: 'bridge-day' }, { headers });

  const plan = await planRide(url.searchParams, options);
  return Response.json(plan, { status: plan.status === 'invalid_input' ? 400 : 200, headers });
}

export default { fetch: request => handleRequest(request) };
