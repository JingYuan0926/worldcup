# TxLINE wire-format notes

Ground-truth JSON shapes the settler and UI depend on, resolved empirically by the
**wire-format probe** (README spikes #7, #8). Until the probe runs against a live
token, every **Answer:** below is `TBD`.

> These notes exist because the docs leave the exact serialization ambiguous
> (string vs number vs object, base64 vs hex, integer scaling). Wrong guesses
> here silently break settlement, so we measure instead of assume.

## How to fill this in

The probe needs a saved TxLINE token (blocked today on the subscribe-tx funding).
Once authenticated:

```bash
npm run auth  -- --network devnet     # one-time: guest JWT → subscribe → activate
npm run probe -- --network devnet     # prints a SUMMARY block; paste answers below
```

The probe never crashes on a 4xx/5xx (logs WARN, continues) and ends with a
copy-pasteable **WIRE-FORMAT PROBE SUMMARY**. Replace each `TBD` with the matching
summary line, note the date + network, and delete the "How the probe checks it"
scaffolding once an answer is locked in.

Probe source: `services/ingest/src/cli/probe.ts`. Fixtures used:
`18209181` France–Morocco (QF, competitionId discovery) and the finished
`17588310` Tunisia–Japan (scores / proof / odds shapes).

---

## (a) World Cup competitionId — spike #7

Needed to filter `/api/fixtures/snapshot` down to World Cup fixtures. The WC
`competitionId` is **not documented** (README §7.7) — read it off a known fixture.

- **How the probe checks it:** `GET /api/fixtures/snapshot` (unfiltered) and
  `?startEpochDay=floor(now/86_400_000)`, locates fixture `18209181`, prints its
  `CompetitionId` + full record keys, and lists the distinct `CompetitionId → name`
  pairs in the snapshot (knockout ids appear only after the prior round, so if the
  QF fixture is absent, pick the World Cup entry from that list).

**Answer (live devnet, 2026-07-09):** `CompetitionId = 72` for fixture `18209181`.

Fixture record keys: `Ts`, `StartTime`, `Competition`, `CompetitionId`,
`FixtureGroupId`, `Participant1Id`, `Participant1`, `Participant2Id`,
`Participant2`, `FixtureId`, `Participant1IsHome`, `GameState`.

---

## (b) `statusSoccerId` shape — spike #8

Phase gate for settlement (HT=3, F=5, FET=10, FPE=13 — see phase table below).
Is it a bare number, a string, or a nested object?

- **How the probe checks it:** fetches a Scores record for finished fixture
  `17588310` (`/api/scores/snapshot/{id}?asOf=`, falling back to
  `/api/scores/updates/{id}`, then `/api/scores/historical/{id}`), reports
  `typeof statusSoccerId` (or its keys if an object), and dumps the record's
  top-level keys.

**Answer (live devnet SSE, 2026-07-09):** the live action record uses the numeric
field **`StatusId`** (`2` during H1), rather than `statusSoccerId`. Snapshot and
historical endpoints still need probing separately before the settlement phase
gate is frozen.

Live Scores SSE record keys: `FixtureId`, `GameState`, `StartTime`, `IsTeam`,
`FixtureGroupId`, `CompetitionId`, `CountryId`, `SportId`,
`Participant1IsHome`, `Participant2Id`, `Participant1Id`,
`CoverageSecondaryData`, `CoverageType`, `Action`, `Id`, `Ts`, `ConnectionId`,
`Seq`, `StatusId`, `Type`, `Clock`, `Stats`, `Participant`, `Possession`,
`PossessionType`. The live feed is a PascalCase action stream; every action also
carries the complete cumulative `Stats` map and `Clock: {Running, Seconds}`.

---

## (c) `stats` map key format — spike #8

The settlement stat keys (`7` + `8` corners, `1` + `2` goals, etc.) index into the
`stats` map. Are the keys numeric-strings (`"7"`) as a JSON object, or something
else (array, numbers)?

- **How the probe checks it:** reads `stats` off the same Scores record, reports
  the container type, whether every key matches `/^-?\d+$/`, the key count, and a
  handful of sample `key → value` entries.

**Answer (live devnet SSE, 2026-07-09):** `Stats` is a JSON object with
numeric-string keys. Base keys `"1"`…`"8"` and period keys such as `"1001"`…
are present on every observed action frame.

Sample at match clock 19:48: `"1":0`, `"2":0`, `"7":1`, `"8":0`,
`"1007":1`. A later corner confirmation incremented `"7"` to `2`.

---

## (d) proof hash encoding — spike #8

`validate_stat` expects every proof hash as exactly **32 bytes** (README §7.5, gotcha
#4). The API delivers them as base64 **or** `0x`-hex — the settler must detect and
decode correctly.

- **How the probe checks it:** discovers a late settlement `seq` from
  `/api/scores/historical/17588310`, calls
  `GET /api/scores/stat-validation?fixtureId=17588310&seq=<seq>&statKey=7&statKey2=8`,
  recursively finds every 32-byte-looking string in the response (field names are
  not assumed), and classifies each as `0x-hex` / `bare-hex` / `base64(url)` with its
  decoded byte length.

**Answer:** TBD (expect: 32 bytes; encoding TBD)

---

## (e) odds `Prices` vs `Pct` scaling — spike #8

Consensus odds (`StablePrice` feed) drive the Crowd Forecast panel (README §5.4 4b).
`Prices` integer scaling is undocumented — need the divisor to render decimal odds /
implied probability.

- **How the probe checks it:** `GET /api/odds/snapshot/17588310`, recursively collects
  numeric leaves whose key matches `/price/i` and `/pct|percent/i`, prints sample
  `path = value` pairs, and heuristically guesses the scale (×100 / ×1000 / ×1e6 /
  basis points) from the observed magnitudes. Confirm the exact divisor by hand
  against a known market before trusting it.

**Answer:** TBD

---

## Reference — stat keys, periods & phases (README §7.4)

Settlement vocabulary the probe/settler encode against. Stat key formula:

```
statKey = (period * 1000) + baseKey
```

### Base keys (per participant)

| Base key | Meaning (P1 / P2) |
|---|---|
| `1` / `2` | Goals — Participant 1 / Participant 2 |
| `3` / `4` | Yellow cards — P1 / P2 |
| `5` / `6` | Red cards — P1 / P2 |
| `7` / `8` | Corners — P1 / P2 |

### Period offsets

| Period | Offset | Example (P1 corners = base 7) |
|---|---|---|
| Full game | `+0` | `7` |
| First half (H1) | `+1000` | `1007` |
| Second half (H2) | `+2000` | `2007` |
| Extra time 1 (ET1) | `+3000` | `3007` |
| Extra time 2 (ET2) | `+4000` | `4007` |
| Penalty shootout (PE) | `+5000` | `5007` |

Worked examples: total match goals = `1` + `2`; total match corners = `7` + `8`;
first-half total goals = `1001` + `1002`.

### Game phases (`statusSoccerId` values)

Terminal/settle-relevant phases are **bold**.

| Phase | Id | | Phase | Id | | Phase | Id |
|---|---|---|---|---|---|---|---|
| NS | 1 | | H2 | 4 | | HTET | 8 | |
| H1 | 2 | | **F** | **5** | | ET2 | 9 |
| **HT** | **3** | | WET | 6 | | **FET** | **10** |
| | | | ET1 | 7 | | WPE | 11 |
| PE | 12 | | I | 14 | | C | 16 |
| **FPE** | **13** | | A | 15 | | TXCC | 17 |
| TXCS | 18 | | P | 19 | | | |

Settlement phase gates: COUNT full-time pools accept **F (5) / FET (10) / FPE (13)**
as terminal (a WC knockout can end 13); the first-half pool settles at **HT (3)**.
Phases A (15) / C (16) / P (19) route to refund (README §5.2).
