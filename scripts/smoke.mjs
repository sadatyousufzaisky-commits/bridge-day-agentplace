import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startLocalServer } from '../src/local.mjs';
import { localDate } from '../src/ride-plan.mjs';

const remoteOrigin = process.argv[2];
const server = remoteOrigin ? null : startLocalServer(0);

try {
  if (server) await once(server, 'listening');
  const origin = remoteOrigin ?? `http://127.0.0.1:${server.address().port}`;
  const today = localDate();
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const url = new URL('/v1/ride-plan', origin);
  url.search = new URLSearchParams({ date: tomorrow, riders: '3', departures: '10:00,13:00', bike: 'compare' });

  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.equal(plan.date, tomorrow);
  assert.equal(plan.forecast.status, 'ready', plan.forecast.message);
  assert.deepEqual(plan.departures.map(option => option.localTime), ['10:00', '13:00']);
  assert.ok(plan.departures.every(option => option.checkpoints.length === 2));
  const estimate = plan.itinerary.rentalEstimate;
  assert.equal(estimate.riders, 3);
  assert.deepEqual(estimate.options.map(option => option.bike), ['comfort', 'electric']);
  for (const option of estimate.options) {
    assert.equal(option.subtotalUsd, option.dailyUsd * estimate.riders);
  }
  const [morning, afternoon] = plan.departures;
  const delta = morning.comparison.score - afternoon.comparison.score;
  let best = null;
  if (delta < 0) best = morning.localTime;
  if (delta > 0) best = afternoon.localTime;
  assert.equal(plan.recommendedDeparture, best);
  console.log(JSON.stringify({
    date: plan.date,
    timeZone: plan.timeZone,
    provider: plan.forecast.provider,
    retrievedAt: plan.forecast.retrievedAt,
    recommendedDeparture: plan.recommendedDeparture,
    rentalEstimate: estimate,
    options: plan.departures.map(({ localTime, comparison, checkpoints }) => ({
      localTime, comparison, sources: checkpoints.map(({ source, forecastUpdatedAt }) => ({ source, forecastUpdatedAt })),
    })),
  }, null, 2));
} finally {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
}
