# Train data source requirements

Safar Saathi doesn't depend on any particular vendor. All train data flows through the `TrainDataProvider` interface (`server/src/trains/types.ts`). Today the app runs on a built-in **simulator**. This document lists what a real source must supply before it can replace the simulator, and how to plug it in.

> There's no confirmed official public train-status API. Before launch, test 2-3 candidate providers against ~10 real trains on a live day (see the prompt pack), checking the accuracy and timeliness of each field below.

## What the app needs

### Live status, per train and start date (required)

The **start date** is the date the train leaves its origin (IST). A train that starts on the 9th and reaches Delhi on the 10th is still the "9th" run.

| Field                                                             | Required           | Notes                                                                                                           |
| ----------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Train number and name                                             | ✅                 | 5-digit number                                                                                                  |
| Overall state                                                     | ✅                 | not started / running / arrived / cancelled                                                                     |
| Current delay (minutes)                                           | ✅                 | 0 = on time                                                                                                     |
| Last station reached                                              | ✅                 | code and name                                                                                                   |
| Per station: scheduled arrival and departure                      | ✅                 | absolute times, so we can handle multi-day runs                                                                 |
| Per station: actual time if passed, otherwise the latest estimate | ✅                 | used for "expected at your station" and "leave now"                                                             |
| Per station: state                                                | ✅                 | upcoming / arrived / departed / skipped                                                                         |
| Cancelled flag                                                    | ✅                 | full and partial cancellations                                                                                  |
| Diverted flag and note                                            | ✅                 | which stations are skipped                                                                                      |
| **When the data was observed** (`fetchedAt`)                      | ✅                 | **Always shown to users as "as of …".** The source's own observation time, not our request time, if it has one. |
| Platform per station                                              | ⭐ strongly wanted | when it's announced, and every change. Platform-change alerts are a core differentiator.                        |
| Coach position                                                    | optional           | advertised via `capabilities().coachPosition`                                                                   |

### Schedule, per train (required)

Stops in order, with station code and name, arrival and departure as `HH:MM` IST, the day number (1 = start day), and distance in km.

### Search between stations (optional)

The assistant's `trains_between` tool appears only if the provider sets `capabilities().trainsBetween`.

### Operational requirements

- **Freshness:** live status updated at least every 2-5 minutes while a train is running. The app caches each train for `TRAIN_CACHE_TTL_SECONDS` (60 s by default), so one upstream call serves every user watching that train.
- **Latency:** p95 under 2 s. Calls time out after `TRAIN_TIMEOUT_MS` (4 s).
- **Errors:** use clear HTTP status codes. 404 means the train or date is unknown; 429 and 5xx mean temporary failure (we retry with backoff and open a circuit breaker after repeated failures).
- **Rate limits and pricing:** must fit the polling pattern (more often near departure and arrival) times the number of distinct trains being watched, not the number of users.
- **Terms:** we need written permission to show the data to end users and to send alerts based on it.

## Plugging in a real source

Set `TRAIN_PROVIDER=http`. The `HttpProvider` doesn't speak any vendor's format. It expects a small **adapter** (a few dozen lines, written once a vendor is chosen) that translates the vendor's API into our normalized JSON:

```
GET {TRAIN_API_BASE_URL}/trains/{trainNumber}/status?startDate=YYYY-MM-DD   -> TrainStatus, or 404
GET {TRAIN_API_BASE_URL}/trains/{trainNumber}/schedule                      -> TrainSchedule, or 404
```

The shapes are `TrainStatus` and `TrainSchedule` in `server/src/trains/types.ts`, and the exact validation is in `server/src/trains/http/HttpProvider.ts`. Responses that don't match are rejected as `BAD_RESPONSE` and never reach users.

| Env var                                                                                                                     | Meaning                                                        |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `TRAIN_PROVIDER`                                                                                                            | `mock` (default) or `http`                                     |
| `TRAIN_API_BASE_URL`                                                                                                        | the adapter's base URL (required for `http`)                   |
| `TRAIN_API_KEY`, `TRAIN_API_KEY_HEADER`                                                                                     | optional key, sent as that header (default `x-api-key`)        |
| `TRAIN_API_CAPABILITIES`                                                                                                    | what the source supplies, e.g. `liveStatus,schedule,platforms` |
| `TRAIN_CACHE_TTL_SECONDS`, `TRAIN_TIMEOUT_MS`, `TRAIN_RETRIES`, `TRAIN_BREAKER_THRESHOLD`, `TRAIN_BREAKER_COOLDOWN_SECONDS` | resilience tuning                                              |

Because every part of the app (dashboard, alert engine, assistant) reads through the same provider, switching the source changes all of them at once. The assistant only offers what `capabilities()` says the source can supply.

## Known limitation

Journeys store the date the passenger chose. For now the app treats that as the train's **start date**. For passengers boarding mid-route on a later day (e.g. day 2 of a 3-day run), the start date must be derived from the schedule. That's a follow-up for the alert engine (Phase 5).
