import assert from 'node:assert/strict';
import test from 'node:test';
import { handleRequest, planRide } from '../src/ride-plan.mjs';

const now = new Date('2026-11-24T16:00:00Z');
const defaultFields = { date: '2026-11-24', departures: '09:00,11:00', riders: '2' };

function weatherFixture(url, { clock = now, incomplete = false, ageHours = 0 } = {}) {
  const start = Date.parse(clock.toISOString().slice(0, 10) + 'T16:00:00Z');
  const bridge = url.includes('83,107');
  const periods = Array.from({ length: 12 }, (_, index) => ({
    startTime: new Date(start + index * 3_600_000).toISOString(),
    endTime: new Date(start + (index + 1) * 3_600_000).toISOString(),
    windSpeed: bridge && index < 2 ? '15 to 20 mph' : '6 mph',
    temperature: 58,
    temperatureUnit: 'F',
    shortForecast: 'Partly Sunny',
    probabilityOfPrecipitation: { value: incomplete ? null : 10 },
  }));
  return Response.json({
    properties: { updateTime: new Date(clock.getTime() - ageHours * 3_600_000).toISOString(), periods },
  });
}

test('ranks two complete departures and returns sourced group rental estimates', async () => {
  const calls = [];
  const plan = await planRide(new URLSearchParams(defaultFields), {
    now,
    fetcher: async url => { calls.push(url); return weatherFixture(url); },
  });

  assert.equal(calls.length, 2);
  assert.equal(plan.forecast.status, 'ready');
  assert.equal(plan.recommendedDeparture, '11:00');
  assert.equal(plan.departures[0].checkpoints[0].sampleAt, '2026-11-24T17:45:00.000Z');
  assert.equal(plan.departures[0].checkpoints[0].forecastPeriodStart, '2026-11-24T17:00:00.000Z');
  assert.equal(plan.departures[0].checkpoints[0].forecastPeriodEnd, '2026-11-24T18:00:00.000Z');
  assert.equal(plan.departures[0].comparison.maxForecastWindMph, 20);
  assert.deepEqual(plan.itinerary.rentalEstimate.options.map(option => option.subtotalUsd), [63, 112]);
});

test('applies the winter offer only to ride dates within its published window', async () => {
  const cases = [
    ['2026-11-16', [108, 192], /standard online/],
    ['2026-11-17', [94.50, 168], /winter special/],
    ['2027-02-28', [94.50, 168], /winter special/],
    ['2027-03-01', [108, 192], /standard online/],
    ['2027-11-17', [108, 192], /standard online/],
  ];
  for (const [date, totals, rateBasis] of cases) {
    const plan = await planRide(new URLSearchParams({ ...defaultFields, date, riders: '3' }), {
      now: new Date('2026-10-01T16:00:00Z'),
      fetcher: async () => assert.fail('a ride beyond the forecast horizon should skip NWS'),
    });
    assert.equal(plan.forecast.status, 'outside_horizon');
    const estimate = plan.itinerary.rentalEstimate;
    assert.deepEqual(estimate.options.map(option => option.subtotalUsd), totals, date);
    assert.match(estimate.basis, rateBasis, date);
    assert.match(estimate.options[0].source, /details-regular-bike$/);
  }
});

test('keeps official links and refuses to rank when one upstream request fails', async () => {
  const plan = await planRide(new URLSearchParams(defaultFields), {
    now,
    fetcher: async url => url.includes('83,107') ? new Response(null, { status: 503 }) : weatherFixture(url),
  });

  assert.equal(plan.forecast.status, 'partial');
  assert.equal(plan.recommendedDeparture, null);
  assert.equal(plan.departures[0].checkpoints.length, 1);
  assert.equal(plan.departures[0].comparison, null);
  assert.match(plan.itinerary.links.ferrySchedule, /^https:\/\/www\.goldengate\.org\//);
});

test('retries a temporary upstream failure without re-requesting the successful grid', async () => {
  const calls = new Map();
  const plan = await planRide(new URLSearchParams(defaultFields), {
    now,
    fetcher: async url => {
      const count = (calls.get(url) ?? 0) + 1;
      calls.set(url, count);
      return url.includes('83,107') && count === 1 ? new Response(null, { status: 503 }) : weatherFixture(url);
    },
  });

  assert.deepEqual([...calls.values()], [2, 1]);
  assert.equal(plan.forecast.status, 'ready');
  assert.equal(plan.recommendedDeparture, '11:00');
});

test('does not immediately retry a rate-limited grid', async () => {
  let bridgeRequests = 0;
  const plan = await planRide(new URLSearchParams(defaultFields), {
    now,
    fetcher: async url => {
      if (!url.includes('83,107')) return weatherFixture(url);
      bridgeRequests += 1;
      return new Response(null, { status: 429, headers: { 'Retry-After': '5' } });
    },
  });

  assert.equal(bridgeRequests, 1);
  assert.equal(plan.forecast.status, 'partial');
  assert.equal(plan.recommendedDeparture, null);
});

test('does not invent a best departure when the forecast scores tie', async () => {
  const plan = await planRide(new URLSearchParams({ ...defaultFields, departures: '11:00,13:00' }), {
    now,
    fetcher: async url => weatherFixture(url),
  });
  assert.equal(plan.forecast.status, 'ready');
  assert.equal(plan.recommendedDeparture, null);
  assert.match(plan.forecast.message, /tied/);
});

test('does not treat missing precipitation data as zero', async () => {
  const plan = await planRide(new URLSearchParams(defaultFields), {
    now,
    fetcher: async url => weatherFixture(url, { incomplete: true }),
  });
  assert.equal(plan.forecast.status, 'partial');
  assert.equal(plan.recommendedDeparture, null);
  assert.equal(plan.departures[0].checkpoints[0].precipitationProbabilityPct, null);
});

test('preserves valid forecast periods when the upstream response contains a malformed row', async () => {
  const plan = await planRide(new URLSearchParams(defaultFields), {
    now,
    fetcher: async url => {
      const forecast = await weatherFixture(url).json();
      forecast.properties.periods.unshift(null, { startTime: 'invalid' });
      return Response.json(forecast);
    },
  });

  assert.equal(plan.forecast.status, 'ready');
  assert.equal(plan.recommendedDeparture, '11:00');
  assert.ok(plan.departures.every(departure => departure.checkpoints.length === 2));
});

test('returns an unranked itinerary when the upstream snapshot is stale', async () => {
  const plan = await planRide(new URLSearchParams(defaultFields), {
    now,
    fetcher: async url => weatherFixture(url, { ageHours: 24 }),
  });
  assert.equal(plan.forecast.status, 'unavailable');
  assert.equal(plan.forecast.retrievedAt, null);
  assert.equal(plan.recommendedDeparture, null);
  assert.equal(plan.itinerary.pickup, '2715 Hyde Street, San Francisco');
});

test('returns predictable input errors and skips unnecessary upstream traffic', async () => {
  let upstreamCalls = 0;
  const neverFetch = () => {
    upstreamCalls += 1;
    throw new Error('unexpected upstream call');
  };
  const options = { now, fetcher: neverFetch };
  const invalid = new Request('https://demo.example/v1/ride-plan?date=2026-11-31&riders=2');
  assert.equal((await handleRequest(invalid, options)).status, 400);
  const past = await planRide(new URLSearchParams({ ...defaultFields, departures: '08:00' }), {
    ...options,
    now: new Date('2026-11-24T16:01:00Z'),
  });
  assert.equal(past.forecast.status, 'no_future_departures');
  const far = await planRide(new URLSearchParams({ ...defaultFields, date: '2026-12-15' }), options);
  assert.equal(far.forecast.status, 'outside_horizon');
  assert.equal(past.forecast.retrievedAt, null);
  assert.equal(far.forecast.retrievedAt, null);
  assert.equal(upstreamCalls, 0);
});

test('uses the post-transition Pacific offset for a spring departure', async () => {
  const clock = new Date('2027-03-14T15:00:00Z');
  const plan = await planRide(new URLSearchParams({ date: '2027-03-14', departures: '10:30', bike: 'electric' }), {
    now: clock,
    fetcher: async url => weatherFixture(url, { clock }),
  });
  assert.equal(plan.forecast.status, 'ready');
  assert.equal(plan.departures[0].departureAt, '2027-03-14T17:30:00.000Z');
  assert.equal(plan.recommendedDeparture, null);
  assert.deepEqual(plan.itinerary.rentalEstimate.options.map(option => option.subtotalUsd), [64]);
});

test('defines a read-only HTTP contract with public browser access', async () => {
  const url = 'https://demo.example/v1/ride-plan';
  const response = await handleRequest(new Request(url, { method: 'OPTIONS' }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal((await handleRequest(new Request(url, { method: 'POST' }))).status, 405);
  assert.equal((await handleRequest(new Request('https://demo.example/missing'))).status, 404);
  assert.equal((await handleRequest(new Request('https://demo.example/health'))).status, 200);
});
