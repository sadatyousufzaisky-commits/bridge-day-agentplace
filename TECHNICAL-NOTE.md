# Bridge Day · Technical note

Bridge Day helps visitors compare two departure times for Blazing Saddles’ self-guided ride from Fisherman’s Wharf to Sausalito. It also estimates adult bike rental costs for the group and provides official links for bridge access and the return ferry.

The public Agentplace demo opens without an account. **Compare ride times** runs a comparison using the visitor’s selected inputs. **Try a live example** starts a Luna conversation comparing 9 a.m. and 1 p.m. Pacific for two riders. [Open Bridge Day](https://bexcmykeu7dv.run.agentplace.io/)

Agentplace runs GPT-6 Luna for conversation and uses a typed action to compute the plan. The custom form starts the comparison directly. Both paths fetch two U.S. National Weather Service forecast grids in parallel and use deterministic comparison rules. The planner samples the bridge approach about 45 minutes after departure and Sausalito about 135 minutes after departure. Each reading shows its forecast period, source, and update time so riders can see the evidence behind the recommendation.

The rental estimate uses the ride date to select the published winter offer or standard online all-day rate. The shop confirms price and availability at booking. If either forecast is missing or stale, the planner keeps the route, rental estimates, and official operator links visible. It recommends a departure only when the inputs are complete and one option has the lowest score. [Regular bike rates](https://www.blazingsaddles.com/san-francisco/bikes-and-rates/details-regular-bike) · [Electric bike rates](https://www.blazingsaddles.com/san-francisco/bikes-and-rates/details-electric-bike)

For production, I would use a shop-approved inventory and quote API and an authorized ferry disruption feed. I would cache NWS grids within their freshness window, monitor missing fields and timeouts by grid, and automate signed-out release checks. I would also store the latest plan per session on the server and apply validated edits only to the fields the rider asks to change.

## Verification

In a signed-out session I compared 10 a.m. and 1 p.m. Pacific on November 25, 2026, for three adults. The planner showed timestamped readings for both checkpoints at each departure, recommended 1 p.m. for that forecast, and estimated $94.50 for regular bikes and $168 for e-bikes. I asked Luna to switch all three riders to e-bikes. The rendered plan kept the date, both times, and the rider count, and showed the $168 e-bike subtotal. An earlier test lost the form inputs during the chat handoff. The current release stages the submitted inputs for the next turn. The turn history can still show generic guidance while the planner presents the updated results.

The Luna example returned a fresh comparison for 9 a.m. and 1 p.m. for two riders. On a fresh session, the opening turn delayed the example until the agent was idle. On a date outside the available NWS horizon, the planner kept estimates and operator links visible and omitted the departure recommendation.

The standalone planner in this package passed 12 automated tests and a live NWS smoke test. The tests cover seasonal price boundaries, stale and malformed forecasts, partial upstream failure, retries, and Pacific daylight saving time.

## Platform limits

Agentplace's **Versions** panel lists snapshot download and GitHub code sync as Enterprise features. The repository supplies a standalone planner, its tests, and the [hosted implementation map](AGENTPLACE.md#hosted-implementation). For a production handoff, I would keep the planner and its contract in a business-owned repository and expose the versioned endpoint to Agentplace as a typed action.
