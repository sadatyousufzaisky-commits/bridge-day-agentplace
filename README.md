# Bridge Day

Bridge Day helps visitors plan Blazing Saddles’ self-guided ride from Fisherman’s Wharf to Sausalito. It compares departure times using hourly National Weather Service forecasts, estimates all-day bike rentals for a group, and points riders to the official ferry schedule and bridge access information. This independent assessment demo uses public business information.

[Open the public Agentplace demo](https://bexcmykeu7dv.run.agentplace.io/). Visitor sign-in is disabled.

1. Set the ride date to tomorrow in Pacific time, enter 10 a.m. and 1 p.m., and set the group size to three adults.
2. Select **Compare ride times**. Each departure shows two forecast checkpoints, and the planner shows a group estimate for each bike type.
3. Select **Try a live example** to see the GPT-6 Luna conversation run its preset comparison.

The repository includes a runnable implementation of the forecast planner, its HTTP handler, and the tests. The [technical note](TECHNICAL-NOTE.md) explains how the published Agentplace project calls NWS, how to verify both paths, and what would change for production.

## Try the API

Use Node.js 22 or newer. No environment variables or API keys are required.

```sh
git clone https://github.com/sadatyousufzaisky-commits/bridge-day-agentplace.git
cd bridge-day-agentplace
npm test
npm run smoke
npm start
```

With the local service running, call `GET http://127.0.0.1:8787/v1/ride-plan?riders=2&bike=compare`. To verify a particular deployment, run `npm run smoke -- https://YOUR-API-ORIGIN`.

| Query parameter | Accepted values | Default |
| --- | --- | --- |
| `date` | Today or a future date in `YYYY-MM-DD` | Today in San Francisco |
| `departures` | One to six comma-separated half-hour times between `08:00` and `15:00` Pacific | `09:00,11:00,13:00,15:00` |
| `riders` | Integer from `1` through `20` | `1` |
| `bike` | `comfort`, `electric`, `compare` | `compare` |

`GET /v1/ride-plan` returns itinerary and estimate data with `forecast.status`, `departures`, and `recommendedDeparture`. Compare a checkpoint’s `sampleAt` to its `forecastPeriodStart` and `forecastPeriodEnd` to reproduce the comparison. Each reading includes its NWS endpoint and update time. Forecast statuses are `ready`, `partial`, `unavailable`, `outside_horizon`, and `no_future_departures`. The API returns HTTP 400 for invalid inputs. A request with an unavailable forecast can still return the sourced itinerary and rental estimate. `GET /health` checks HTTP availability.

Each weather request has a 4.5-second deadline. The service retries transient network and gateway failures once. It can return a partial result when only one grid remains available.

The rental estimate uses the ride date to select the documented winter offer or standard online rate. Check the details and applicable dates with the shop. [Regular bike](https://www.blazingsaddles.com/san-francisco/bikes-and-rates/details-regular-bike) · [Electric bike](https://www.blazingsaddles.com/san-francisco/bikes-and-rates/details-electric-bike)

## Project files

- [`src/ride-plan.mjs`](src/ride-plan.mjs) contains the planner and HTTP handler. Its default export is a Cloudflare Worker, and the same handler runs locally via [`src/local.mjs`](src/local.mjs).
- [`AGENTPLACE.md`](AGENTPLACE.md) contains the Builder brief, API setup, and published-agent verification steps.
- [`TECHNICAL-NOTE.md`](TECHNICAL-NOTE.md) explains the architecture, tradeoffs, and verification status.

## Public sources

- [Blazing Saddles’ self-guided route](https://www.blazingsaddles.com/san-francisco/routes-and-tours/bike-the-bridge-self-guided) and [San Francisco rental options](https://www.blazingsaddles.com/san-francisco/bikes-and-rates/all-bikes)
- [National Weather Service hourly forecast API](https://www.weather.gov/documentation/services-web-api)
- [Golden Gate Bridge bicycle access](https://www.goldengate.org/bridge/visiting-the-bridge/bikes-pedestrians/)
- [Golden Gate Ferry’s Sausalito schedule](https://www.goldengate.org/ferry/route-schedule/sausalito-san-francisco/) and [bike policy](https://www.goldengate.org/ferry/riding-the-ferry/bringing-your-bike/)
