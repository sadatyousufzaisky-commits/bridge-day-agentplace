# Bridge Day · Technical note

Bridge Day helps visitors compare two departure times for Blazing Saddles’ self-guided ride from Fisherman’s Wharf to Sausalito. It also estimates adult bike rental costs for the group and provides official links for bridge access and the return ferry.

The public Agentplace demo opens without an account. **Compare ride times** runs a comparison using the visitor’s selected inputs. **Try a live example** starts a Luna conversation comparing 9 a.m. and 1 p.m. Pacific for two riders. [Open Bridge Day](https://bexcmykeu7dv.run.agentplace.io/)

GPT-6 Luna handles the sample conversation and follow-up requests. The custom form requests the forecasts directly. Both paths use deterministic comparison rules and fetch two U.S. National Weather Service forecast grids in parallel. The planner samples the bridge approach about 45 minutes after departure and Sausalito about 135 minutes after departure. It shows the weather values, forecast period, source, and update time for each checkpoint. The sampling times are itinerary assumptions.

The rental estimate uses published all-day rates and links to the business for the current price, equipment, and booking. The ferry operator confirms boarding rules and the bridge authority reports access changes. If either forecast is missing or stale, the planner keeps the route, rentals, and official links visible. It only recommends a departure when the inputs are complete and one option has the lowest score.

For production, I would replace the rental price snapshot with a shop-approved inventory and quote API and consume an authorized ferry disruption feed. I would cache NWS grids briefly within their freshness window, monitor timeouts and missing fields by grid, and automate visitor checks against each release.

## Verification

In separate signed-out sessions, the custom form compared 10 a.m. and 1 p.m. Pacific for three riders, returned readings for both checkpoints, and showed group estimates of $96 and $192. The Luna example compared 9 a.m. and 1 p.m. and recommended 1 p.m. A follow-up switched both riders to e-bikes, retained the date and departures, and showed $128. A chat revision immediately after a form-only comparison did not apply in one test. Changing bike type in the form retained the other inputs.

The standalone planner in this package passed 11 automated tests and a live NWS smoke test. It retries a transient network or gateway failure once, preserves valid readings when a forecast contains a malformed period, and leaves the departure recommendation open when the available evidence is incomplete.
