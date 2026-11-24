# Bridge Day · Technical note

Bridge Day helps visitors compare two departure times for Blazing Saddles’ self-guided ride from Fisherman’s Wharf to Sausalito. It also estimates adult bike rental costs for the group and provides official links for bridge access and the return ferry.

The public Agentplace demo opens without an account. **Compare ride times** runs a comparison using the visitor’s selected inputs. **Try a live example** starts a Luna conversation comparing 9 a.m. and 1 p.m. Pacific for two riders. [Open Bridge Day](https://bexcmykeu7dv.run.agentplace.io/)

Agentplace runs GPT-6 Luna for conversation and uses a typed action to compute the plan. The custom form starts the comparison directly. Both paths fetch two U.S. National Weather Service forecast grids in parallel and use deterministic comparison rules. The planner samples the bridge approach about 45 minutes after departure and Sausalito about 135 minutes after departure. Each reading shows its forecast period, source, and update time so riders can see the evidence behind the recommendation.

The rental estimate uses published all-day rates and links to the business for the current price, equipment, and booking. The ferry operator confirms boarding rules and the bridge authority reports access changes. If either forecast is missing or stale, the planner keeps the route, rentals, and official links visible. It only recommends a departure when the inputs are complete and one option has the lowest score.

For production, I would use a shop-approved inventory and quote API and an authorized ferry disruption feed. I would cache NWS grids within their freshness window, monitor missing fields and timeouts by grid, and automate signed-out release checks.

## Verification

In separate signed-out sessions, the custom form compared 10 a.m. and 1 p.m. Pacific for three riders and returned readings for both checkpoints. When a later ride date fell outside the available NWS forecast, the planner kept rental estimates and operator links visible and showed no recommended departure. The Luna example compared 9 a.m. and 1 p.m. A follow-up switched both riders to e-bikes and retained the date and departures. A chat revision immediately after a form-only comparison did not apply in one test. Changing bike type in the form retained the other inputs.

The standalone planner in this package passed 12 automated tests and a live NWS smoke test. The tests cover seasonal price boundaries, stale and malformed forecasts, partial upstream failure, retries, and Pacific daylight saving time.

## Platform limits

Agentplace's **Versions** panel lists snapshot download and GitHub code sync as Enterprise features. The repository supplies a standalone planner, its tests, and the [hosted implementation map](AGENTPLACE.md#hosted-implementation). For a production handoff, I would keep the planner and its contract in a business-owned repository and expose the versioned endpoint to Agentplace as a typed action.
