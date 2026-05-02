# Planetary Interaction Implementation Plan

This plan tracks implementation of EVE Planetary Interaction, also known as PI. The immediate client crash is caused by `planetMgr` not handling moniker resolution, but the full feature spans planet view data, persistent colonies, resource simulation, production, inventory, customs offices, and notifications.

Alpha clone limits are not a gameplay goal for this server. Only implement those checks if the client explicitly requires a server response to keep the UI stable.

## Progress Snapshot

- Phase 0 complete: planet moniker binding, basic planet info, persistent resource qualities, safe empty read-only calls.
- Phase 1 static authority complete: `planetSchematics` table, PI structure/resource/commodity classification, key dogma attribute helpers, command-center upgrade constants, and hardcoded planet-type resource map.
- Phase 2 basic colony editing complete: `UserUpdateNetwork` accepts all client command stream IDs, remaps temporary pin/route IDs, persists colony pins/links/routes, returns client-shaped colony rows, supports `UserAbandonPlanet`, and consumes the placed command center item from ship inventory when present.
- Phase 3 server-native resource layers complete: each visited planet/resource gets persistent deterministic hotspots, ECU program estimates use the layer values and client-style head overlap, installed ECU programs write depletion events that affect later estimates, and `GetResourceData(info)` now returns experimental deterministic heatmap bytes.
- Still open from Phase 3: validate the experimental heatmap bytes against the V23 client. If the client rejects them or renders nonsense, we need the proprietary `PlanetResources.builder.CreateSHFromBuffer` buffer details or a live non-null payload capture.
- Still open from Phase 2: authoritative server-side validation, non-command-center placement costs, strict inventory ownership checks, CPU/power/link bandwidth enforcement, and real PI simulation remain later-phase work.

## Client Surface

The client enters PI through `eveMoniker.GetPlanet(planetID)`, which creates a `planetMgr` moniker. That means the server must support `MachoResolveObject` and `MachoBindObject` before normal planet calls are made.

The main bound `planetMgr` calls are:

- `GetPlanetInfo()`
- `GetPlanetResourceInfo()`
- `GetResourceData(info)`
- `GetFullNetworkForOwner(planetID, characterID)`
- `GetCommandPinsForPlanet(planetID)`
- `GetExtractorsForPlanet(planetID)`
- `UserUpdateNetwork(serializedChanges)`
- `UserAbandonPlanet()`
- `UserLaunchCommodities(commandPinID, commoditiesToLaunch)`
- `UserTransferCommodities(path, commodities)`
- `GetProgramResultInfo(pinID, typeID, heads, headRadius)`

Related services and calls:

- `planetMgr.GetPlanetsForChar()`
- `planetMgr.GetMyLaunchesDetails()`
- `planetMgr.DeleteLaunch(launchID)`
- `planetOrbitalRegistryBroker.GetTaxRate(customsOfficeID)`
- inventory bound object `ImportExportWithPlanet(spaceportPinID, importData, exportData, taxRate)`

## Persistent Data Model

Use a dedicated runtime table, initially `planetRuntimeState`, so PI state survives server restarts and can be iterated without modifying character records directly.

Initial shape:

```json
{
  "schemaVersion": 1,
  "resourcesByPlanetID": {},
  "coloniesByKey": {},
  "launchesByID": {},
  "nextIDs": {
    "pinID": 900000000000,
    "routeID": 1,
    "launchID": 910000000000
  }
}
```

Resource records should be keyed by planet ID and include:

- `planetID`
- `planetTypeID`
- `solarSystemID`
- persistent planet/resource seed values
- resource type IDs available on that planet
- display quality values returned by `GetPlanetResourceInfo`
- server-native resource layers by resource type:
  - background
  - hotspots
  - depletion events
- experimental generated coefficient bytes for non-null `GetResourceData`

Colony records should be keyed as `${planetID}:${ownerID}` and include:

- `planetID`
- `ownerID`
- `level`
- `currentSimTime`
- `pins`
- `links`
- `routes`
- per-colony next IDs if temporary client IDs need stable server remapping

Launch records should be keyed by launch ID and include:

- `launchID`
- `ownerID`
- `planetID`
- `solarSystemID`
- `launchTime`
- position
- contents
- expiry/deleted flags

## Phase 0: Open Planet View Safely

Goal: stop the current client crash and make the PI planet/resource view load with safe, persistent, deterministic data.

Server work:

- Add `planetMgr.Handle_MachoResolveObject`.
- Add `planetMgr.Handle_MachoBindObject`.
- Track bound-object ID to planet ID per session so later bound calls know which planet they represent.
- Implement `GetPlanetInfo()` with static planet metadata from `celestials`.
- Implement `GetPlanetResourceInfo()` with deterministic persistent P0 resource quality data.
- Implement `GetResourceData(info)` as a safe response. It may return `data: null` at first, allowing the client to keep its constant spherical harmonic instead of crashing.
- Return safe empty values for other read-only planet view calls:
  - `GetFullNetworkForOwner`
  - `GetCommandPinsForPlanet`
  - `GetExtractorsForPlanet`
  - `GetMyLaunchesDetails`
  - `DeleteLaunch`

Data to create:

- `planetRuntimeState` runtime table.
- Classic P0 resource type map per planet type for the planet/resource list.
- Persistent deterministic resource qualities for each visited planet.

Research/data still needed:

- Confirm the binary format expected by `PlanetResources.builder.CreateSHFromBuffer`.
- Determine whether a constant/null SH response is visually acceptable for Phase 0 or if the client requires a non-empty heat map for specific UI actions.
- Capture any next unhandled `planetMgr` calls after the planet view opens.

Tests:

- `MachoResolveObject` returns the local node.
- `MachoBindObject` returns a bound object and nested `GetPlanetInfo` works.
- Bound `GetPlanetInfo` resolves the correct planet.
- `GetPlanetResourceInfo` persists deterministic resource data.
- Empty foreign colony, extractor, command pin, and launch calls have stable shapes.

## Phase 1: Static PI Data Authority

Goal: expose all static PI data needed for validation, UI payloads, and simulation.

Server work:

- Add a PI static-data helper/module.
- Import or expose `planetSchematics.jsonl`.
- Build lookup helpers for:
  - P0 resources
  - P1/P2/P3/P4 commodities
  - command centers
  - ECUs
  - extractor heads
  - processors
  - storage facilities
  - launchpads
  - link CPU/power/bandwidth attributes
  - storage capacity attributes
  - import/export tax attributes
- Normalize type dogma access for CPU, power, capacity, cycle time, schematic inputs, and schematic outputs.

Data to create:

- `planetSchematics` static table from SDE JSONL.
- `planetIndustryTypes` or equivalent derived static table for groups/categories/attributes used by PI.
- Resource availability table if we decide not to keep the P0 map hardcoded.

Research/data still needed:

- Verify modern type/group IDs for all PI structures in this client build.
- Identify exact dogma attributes used by the client for PI fitting, storage, and tax calculations.
- Decide whether old extractor pin types need compatibility handling or can stay unsupported.

Tests:

- Static schematic lookup by schematic ID.
- Schematic lookup by output type ID.
- PI structure classification matches client `planetCommon.GetPinEntityType`.
- Dogma attribute helper returns expected CPU, power, storage, and tax fields.

## Phase 2: Colony Creation And Editing

Goal: let a character place, edit, submit, and reload a persistent colony.

Server work:

- Implemented `UserUpdateNetwork(serializedChanges)`.
- Implemented parsing for all command stream IDs:
  - create/remove pin
  - create/remove/upgrade link
  - create/remove route
  - set schematic
  - upgrade command center
  - add/remove/move extractor head
  - install program
- Implemented persistence in `planetRuntimeState.coloniesByKey`.
- Implemented serialized colony data matching client `ColonyData.RestorePinFromRow`, `RestoreLinkFromRow`, and `RestoreRouteFromRow`.
- Implemented `UserAbandonPlanet()`.
- `GetPlanetsForChar()` includes runtime colonies.
- Submit/abandon send basic planet notifications when the session supports them.
- Command-center deployment consumes the matching ship-inventory item after a successful submit and sends normal inventory item-change notifications.

Data to create:

- Implemented stable server pin ID allocator.
- Implemented stable route ID allocator.
- Optional command history/audit data for debugging serialized changes.

Research/data still needed:

- Temporary client pin/route IDs are handled by returning a fully serialized colony with server IDs. No separate remap payload has been needed so far.
- ISK and inventory hooks for placing command centers and structures.
- Skill requirements that the client does not enforce locally.
- Exact notification payload parity for multiplayer/client cache refreshes.
- Stacked command-center deployment behavior needs live-client verification if players can deploy directly from stacks larger than one.

Tests:

- All command stream IDs parse correctly.
- New colony persists in runtime state and appears in `GetPlanetsForChar()`.
- Submitted colony round-trips through client-shaped serialized rows.
- `GetProgramResultInfo()` returns deterministic placeholder ECU program values.
- `UserAbandonPlanet()` removes the runtime colony.
- Command-center item consumption removes the deployed item from ship inventory.
- Still needed: invalid ownership, duplicate command center, impossible links, and resource-limit rejection coverage.

## Phase 3: Resource Layers And ECU Programs

Goal: make resource scanning and ECU extraction meaningful and persistent.

Server work:

- Store persistent server-native resource layer seeds and hotspot data per planet/resource.
- Implement experimental `GetResourceData(info)` heatmap payloads while the exact spherical-harmonic buffer semantics are unknown:
  - ensure the planet/resource layer exists
  - generate deterministic little-endian `float32` coefficient bytes from the resource layer seed/hotspots
  - return `newBand * newBand * 4` bytes, matching EvEmu's observed wire-size rule
  - return `numBands = newBand`
  - marshal `data` as raw Python-string bytes, not a text string or PyBuffer
  - fall back to `data: null` only when the planet/resource/band request cannot be resolved
- Implement `GetProgramResultInfo(pinID, typeID, heads, headRadius)` from resource layer values.
- Apply client-style own-head overlap using `ecuOverlapFactor`.
- Use ECU dogma values where available:
  - extraction quantity
  - overlap factor
  - depletion range
  - depletion rate
- Implemented ECU program install data:
  - resource type
  - head radius
  - head coordinates
  - cycle time
  - quantity per cycle
  - install time
  - expiry time
- Apply a deterministic depletion/regeneration approximation:
  - each installed ECU program adds a persisted depletion event to the resource layer
  - active depletion lowers future output near those heads
  - expired depletion recovers over time

Data to create:

- Implemented: `resourcesByPlanetID[*].layersByTypeID`.
- Implemented per layer:
  - version
  - seed
  - quality
  - background
  - hotspots
  - depletion events
- Still needed for higher confidence resource heat maps: prove the experimental byte format against the client or replace it with a closer `_eveplanetresources` coefficient encoder.
- Implemented experimental converter:
  - source: server-native layer seed, quality, hotspots, and depletion events
  - output: first `newBand^2` generated `float32` coefficients
  - goal: visible client heatmap, not live-server accuracy

Research/data still needed:

- Validate whether the V23 client accepts the experimental coefficient buffer.
- Exact spherical harmonic coefficient ordering/normalization for `CreateSHFromBuffer`.
- A live capture of a successful `GetResourceData(info)` response with non-null `data` would unblock the encoder if the experimental buffer fails.
- If we need live data, capture for one planet/resource at several `newBand` values, ideally `3`, `5`, `15`, and `30`; include `resourceTypeID`, `oldBand`, `newBand`, `proximity`, returned `numBands`, returned byte length, and returned data hex/base64.
- Client constants for resource proximity/bands versus skills are partially identified, but the decompiled `appConst.py` does not expose the proximity limit tuples cleanly.
- Server output math now follows the useful parts of client `baseColony.CreateProgram`: layer value sampling, ECU max volume, program length, cycle time, and own-head overlap. Remaining parity work is other-colony/other-ECU overlap and exact live depletion/noise curves.
- Decide whether to keep the deterministic depletion approximation or pursue closer Tranquility-style depletion behavior.

Tests:

- Implemented: resource layer records persist with stable hotspot data.
- Implemented: resource value sampling is deterministic and clamped to the client max value.
- Implemented: ECU output is deterministic for the same planet/resource/head positions.
- Implemented: installed programs persist and write depletion events.
- Implemented: depletion reduces later output around the same heads.
- Implemented: resource data response returns deterministic `newBand^2 * 4` byte payloads and larger-band payloads preserve smaller-band prefixes.
- Still needed: client-side validation of the experimental heatmap encoder.
- Expired programs stop producing.

## Phase 4: Colony Simulation And Manufacturing

Goal: make colonies produce materials over time.

Current status:

- Implemented lazy authoritative simulation on colony reads (`GetPlanetInfo`, planet list/summary reads) and before `UserUpdateNetwork` applies new client edits.
- Implemented ECU cycle catch-up from persisted `lastRunTime`, `cycleTime`, `qtyPerCycle`, `programType`, and `expiryTime`.
- Implemented basic processor cycle catch-up from persisted schematics, including P0 input consumption and P1 output production.
- Implemented route movement from ECU output to processors/storage and from processor output to storage.
- Implemented storage capacity checks using type volume and pin capacity for command centers, storage facilities, and launchpads.
- Implemented idempotent simulation checkpoints through `currentSimTime`.
- Still needed: advanced multiplayer visibility if the client later needs more than safe summary shapes, and broader processor-chain coverage.

Server work:

- Implement authoritative lazy simulation on:
  - `GetPlanetInfo` - implemented
  - planet list/summary reads - implemented
  - `UserUpdateNetwork` - implemented before applying edits
  - `UserTransferCommodities` - implemented in Phase 8
  - `UserLaunchCommodities` - implemented in Phase 5
  - import/export - implemented in Phase 7
- Route ECU output into destination pins - implemented.
- Run processor cycles using schematics - implemented for persisted catch-up.
- Enforce storage capacity - implemented for commodity moves into storage-like pins.
- Enforce route path/link validity and bandwidth.
- Implement expedited transfers and cooldown/runtime updates - implemented in Phase 8.

Data to create:

- Simulation checkpoint fields on colony and pin records.
- Optional per-cycle debug trace guarded by config.

Research/data still needed:

- Confirm processor backlog/overflow behavior expected by the client.
- Confirm route max hop limits and link bandwidth formulas.
- Confirm command center and launchpad storage behavior.
- Capture or inspect client behavior for unrouted processor output and full processor input buffers.

Tests:

- P0 routes from ECU to storage/processor - covered by lazy simulation regression.
- Basic processor P0 to P1 cycle - covered by lazy simulation regression.
- Advanced/high-tech processor schematic cycles.
- Overflow cases do not duplicate materials.
- Simulation is idempotent when called repeatedly at the same timestamp - covered.

## Phase 5: Launches, Customs Offices, And Import/Export

Goal: complete material movement between planet surface, space, customs office, and inventory.

Current status:

- Implemented `UserLaunchCommodities(commandPinID, commoditiesToLaunch)` for command centers.
- Implemented launch cooldown validation, command-center commodity removal, `lastLaunchTime` updates, and persistent launch records.
- Implemented `GetMyLaunchesDetails()` rows for the launch journal.
- Implemented `DeleteLaunch(launchID)` soft deletion and launch-list filtering.
- Implemented launch pickup coordinates and `CmdWarpToStuff('launch', launchID)` fallback to those coordinates when no physical launch container entity exists.
- Implemented physical command-center launch containers as inventory-backed `Planetary Launch Container` space items containing launched commodities.
- Added `planetOrbitalRegistryBroker.GetTaxRate(customsOfficeID)` with a dev-default accessible tax rate.
- Still needed: real POCO/customs-office ownership polish and any deeper customs-office access rules beyond the current dev-default tax path.

Server work:

- Implement `UserLaunchCommodities` - implemented for command centers.
- Persist launch containers and expose them through `GetMyLaunchesDetails` - implemented as launch records with coordinates and contents.
- Implement launch deletion/expiry - deletion implemented; expiry display supported by launch time, cleanup pending.
- Spawn or expose launch pickup locations as needed by space/warp code - physical launch containers implemented with coordinate fallback.
- Add `planetOrbitalRegistryBroker` - implemented.
- Implement `GetTaxRate(customsOfficeID)` - implemented with a dev-default rate until POCO ownership/access is modeled.
- Ensure customs office slim items expose `planetID`.
- Extend inventory bound objects with `ImportExportWithPlanet` - implemented for bound customs inventories.
- Move commodities between customs-office inventory and launchpad pin contents - implemented for the dev-default customs path.
- Wallet debits and tax journaling are handled in Phase 7.

Data to create:

- Customs office/orbital registry state.
- Per-character customs office hangar contents if not already represented by inventory.
- Launch container inventory/state.

Research/data still needed:

- Current server representation of POCO/customs office items.
- Decide whether the dev server should auto-create virtual InterBus customs offices for empty systems or require anchored POCOs for testing.
- Whether nullsec skyhooks need to replace customs offices for this client/server world.
- Tax formula parity, owner/access rules, and tax recipients.

Tests:

- Command center launch removes pin contents and creates launch details - covered.
- Journal launch list renders active launch rows - covered.
- Launch deletion removes rows from `GetMyLaunchesDetails` - covered.
- Import/export transfers items correctly.
- Tax changes trigger `TaxChanged` behavior.
- No duplication across failed import/export attempts.

## Phase 6: Multiplayer Visibility And Polish

Goal: make PI visible, stable, and maintainable in normal play.

Current status:

- Implemented minimal safe foreign-colony/extractor summary shapes from existing colony records.
- Implemented GM/debug resource helpers used by the client:
  - `GMGetCompleteResource(resourceTypeID, layer)`
  - `GMGetLocalDistributionReport(planetID, surfacePoint)`
  - `GMGetSynchedServerState(charID)`
- Implemented server-operator diagnostics:
  - `GMGetPlanetDiagnostics(planetID, ownerID)`
  - `GMAddCommodity(pinID, typeID, quantity)`
  - `GMCleanupExpiredLaunches(maxAgeDays, ownerID)`
- Implemented stale launch cleanup that keeps normal expired journal entries around, but can retire very old launch records.
- Still needed: optional migration tooling and broader import/export notifications once POCO support exists.

Server work:

- Do not prioritize other-character command center visibility; this server does not need that parity unless the client requires a response shape.
- Keep extractor/foreign-colony visibility to minimal safe shapes only - implemented through summary calls.
- Add GM/debug calls only if useful for server operators - implemented.
- Add periodic cleanup for expired launches and abandoned state - stale launch cleanup implemented; abandoned colony cleanup pending only if needed.
- Add admin diagnostics for planet resources, colony state, and simulation deltas - implemented.

Data to create:

- Optional PI diagnostics snapshots.
- Optional migration tooling for `planetRuntimeState` schema changes.

Research/data still needed:

- Exact notification payloads for all client cache invalidation paths.
- Any client-side assumptions around corp/shared PI that we choose to support later.

Tests:

- Notifications refresh planet windows and colony list - covered for edit submission, launch creation, and launch cleanup.
- Runtime migration preserves existing colonies/resources.
- GM diagnostics and synced server-state calls stay marshal-safe - covered.

## Phase 7: PI Wallet Accounting And Economic Enforcement

Goal: make every PI ISK movement server-authoritative, journaled, idempotent, and safe from duplication.

Current status:

- Implemented initial server-side PI wallet accounting for colony construction edits and command-center launches.
- Added PI journal reference constants and account entry-type names:
  - `refPlanetaryImportTax = 96`
  - `refPlanetaryExportTax = 97`
  - `refPlanetaryConstruction = 98`
- Added a shared PI cost calculator for construction costs, command center upgrade costs, import tax, and export tax.
- `UserUpdateNetwork` now quotes construction cost before applying edits, debits the character wallet, journals construction charges, and stores accepted edit hashes to avoid double charging replayed submissions.
- Command center placement still consumes the inventory command center item but does not also charge the command center base price.
- Command center launches now preflight the launch, debit export tax, journal it, and leave commodities/launch state unchanged if the wallet cannot pay.
- `ImportExportWithPlanet` is implemented on bound customs-office inventories for launchpad import/export, including stale tax rejection, import/export tax journals, customs inventory movement, and launchpad content updates.
- Still needed: real POCO owner tax routing, customs-office access/standing rules, physical POCO inventory/capacity parity, and the wider server-authoritative CPU/power/link validation pass.
- The client already displays several PI costs locally:
  - colony construction cost from `cumulativePinCreationCost`
  - command center upgrade cost from `planetCommon.GetUpgradeCost(currentLevel, desiredLevel)`
  - command center launch export tax from `pin.GetExportTax(...)`
  - customs office import/export taxes from `ImportExportWithPlanet(spaceportPinID, importData, exportData, taxRate)`
- The server wallet integration point is `server/src/services/account/walletState.js` through `adjustCharacterBalance(...)`, wallet journal storage, and `OnAccountChange` notifications.

Server work:

- Add PI journal constants to `JOURNAL_ENTRY_TYPE` and account-service formatting maps - implemented.
- Add a small PI cost calculator module, or equivalent helpers in `planetStaticData`/`planetRuntimeStore`, so all PI handlers use one source of truth - implemented.
- Recalculate `UserUpdateNetwork` edit costs on the server before applying colony edits:
  - charge type `basePrice` for newly-created non-command-center pins - implemented
  - do not charge command center base price when the command center item was already consumed from inventory - implemented
  - charge command center upgrade deltas using `getCommandCenterUpgradeCost(currentLevel, desiredLevel)` - implemented
  - do not issue removal refunds unless live/client behavior confirms submitted removals should refund ISK - implemented as no refund
  - confirm whether link construction/upgrades have ISK costs, or only CPU/power usage
- Debit the character wallet atomically with accepted colony updates:
  - validate colony changes first
  - verify sufficient ISK using existing wallet helpers - implemented
  - debit with `adjustCharacterBalance(characterID, -amount, { entryTypeID: refPlanetaryConstruction, ... })` - implemented
  - apply the colony edit only if the debit succeeds - implemented with compensating refund if the later apply fails
  - avoid double charges from packet retry/replay by storing an accepted edit hash, submission ID, or equivalent transaction marker - implemented with accepted edit hashes
- Charge command center launch taxes:
  - recalculate launch export tax server-side before removing commodities - implemented
  - use the command center or launch pin export-tax attributes and commodity tax multipliers - implemented with V23 client parity multiplier behavior
  - debit with `refPlanetaryExportTax = 97` - implemented
  - if the debit fails, leave pin contents and launch state unchanged - implemented
- Implement wallet accounting for `ImportExportWithPlanet`:
  - recalculate the current customs office tax rate with `planetOrbitalRegistryBroker.GetTaxRate(customsOfficeID)` - implemented with the current dev-default `0.05`
  - if the client-supplied `taxRate` is stale, return the client-compatible `TaxChanged` error - implemented
  - charge export tax for commodities leaving the planet - implemented
  - charge import tax for commodities entering the planet - implemented
  - move inventory only after successful debits - implemented for bound customs inventory and launchpad pin contents
  - keep import/export movement atomic so failed payments never duplicate or delete commodities - covered for stale-tax and insufficient-wallet preflight; broader rollback remains future hardening
- Decide tax recipient behavior:
  - for virtual/default InterBus customs offices, tax can be an ISK sink
  - for real POCOs, later route tax to the owner corporation wallet when corp-wallet plumbing is ready
- Add server-authoritative integrity checks that money enforcement makes more important:
  - CPU and power validation for pin, command-center upgrade, extractor-head, link, and route edits
  - link bandwidth and route waypoint limits
  - storage and customs office capacity checks
  - expedited transfer cooldown/runtime validation
- Add diagnostics:
  - quote current edit cost/tax cost in GM diagnostics
  - log wallet debits with planet ID, pin ID, reference ID, and reason

Data to create:

- PI wallet transaction constants and account-service reference-name mappings - implemented.
- Optional `planetRuntimeState` audit section for accepted PI edit hashes or transaction IDs - implemented for accepted edit hashes.
- Optional persisted customs office tax/owner config once real POCO ownership is modeled.
- Optional GM/admin diagnostics for pending construction costs and import/export tax quotes.

Research/data still needed:

- Confirm exact server-side error payload for insufficient ISK in all PI paths; edit submission, launches, and import/export currently use `NotEnoughMoney`.
- Confirm tax rounding behavior: floor, round, or fractional ISK truncation.
- Confirm whether export tax should use `attributeImportTaxMultiplier` like the decompiled V23 client `spaceportPin.py`, or `attributeExportTaxMultiplier` from dogma data.
- Confirm whether submitted pin removals refund construction cost, or whether the client subtraction only cancels local unsubmitted edit cost.
- Confirm whether link upgrades/builds have any ISK cost in this client version.
- Confirm command center launch tax recipient behavior when a POCO exists in orbit.

Tests:

- `UserUpdateNetwork` debits non-command-center pin base prices and command-center upgrade costs - covered.
- Command center placement consumes the inventory item but does not also charge its base price - covered.
- Insufficient ISK rejects the edit and leaves colony state unchanged - covered.
- Retried or replayed edit submissions do not double debit the wallet - covered.
- Command center launch debits export tax, removes commodities, and creates launch details - covered.
- Insufficient ISK on launch leaves commodities and launch state unchanged - covered.
- `ImportExportWithPlanet` debits import and export tax and moves items atomically - covered for the dev-default customs path.
- Stale customs office tax rate returns `TaxChanged` and moves nothing - covered.
- Wallet journal entries are created with reference IDs `96`, `97`, and `98` - covered.
- CPU, power, link bandwidth, route waypoint, capacity, and expedited transfer validations reject invalid edits before wallet debit.

## Phase 8: PI Authority And POCO Polish

Goal: make submitted PI network state trustworthy enough that the server, not the client, owns the colony rules.

Current status:

- Implemented a dry-run `UserUpdateNetwork` validation pass before wallet debit, so invalid edits do not charge ISK.
- Implemented command-center CPU and power validation when a colony has a command pin.
- Implemented ECU extractor-head CPU/power usage using dogma head attributes.
- Implemented link CPU/power usage using client-style distance, per-kilometer, level, and modifier math.
- Implemented route/link validation:
  - route path length and max `MAX_WAYPOINTS = 5`
  - linked pins must exist
  - route path segments must have links
  - link level must not exceed `LINK_MAX_UPGRADE = 10`
  - aggregate route bandwidth must fit link logistical capacity
- Implemented `UserTransferCommodities(path, commodities)` for expedited transfers.
- Implemented expedited transfer source cooldowns by persisting the source storage pin's next transfer time in `lastRunTime`.
- Implemented physical command-center launch containers as inventory-backed `Planetary Launch Container` space items containing the launched commodities.
- `CmdWarpToStuff('launch', launchID)` now prefers the physical launch container entity and falls back to launch coordinates if the container is not spawned.
- Implemented regression coverage that invalid CPU and invalid waypoint edits leave wallet and colony state unchanged.

Server work:

- Validate CPU/power for pin, command-center upgrade, extractor-head, and link edits - implemented.
- Validate route waypoint limits and link path existence - implemented.
- Validate link route bandwidth - implemented with route volume-per-hour approximation from client formulas.
- Keep validation before wallet debit - implemented through dry-run edit preview.
- Implement `UserTransferCommodities(path, commodities)` for expedited transfers - implemented.
- Add expedited transfer cooldown/runtime validation - implemented for source storage cooldown, commodity availability, destination acceptance, path ownership, and link existence/bandwidth.
- Add planet type restriction validation for pin placement if the client does not fully enforce it.
- Add exact route producer/consumer validation:
  - producer must produce routed commodity
  - consumer must accept routed commodity
  - storage-to-storage routing should be rejected
- Add POCO ownership/access polish:
  - route taxes to owner corporation wallet when real POCO ownership exists
  - enforce standing/access rules if desired
  - model physical POCO inventory/capacity instead of the current dev-default inventory path
- Add optional physical launch containers in space if coordinate-only launches are not enough for pickup gameplay - implemented for command-center launches.

Data to create:

- Optional POCO/orbital registry ownership and access config.
- Persisted expedited transfer cooldown fields on pins - implemented by reusing storage pin `lastRunTime`, matching the client model.
- Physical launch container inventory records linked to launch IDs - implemented through launch `itemID` / `physicalContainerID`.

Research/data still needed:

- Exact client labels for some validation errors if we want perfect parity.
- Exact producer/consumer route validation behavior for every processor/storage combination.
- Whether we want planet type restrictions to be hard server authority or relaxed dev-server behavior.
- How real POCO ownership should map to corporation wallets on this server.

Tests:

- CPU overuse rejects before wallet debit - covered.
- Route with too many waypoints rejects before wallet debit - covered.
- Link bandwidth overuse rejects before wallet debit.
- Route missing link rejects before wallet debit.
- Link upgrade over max level rejects before wallet debit.
- Expedited transfer moves commodities, sets cooldown, and rejects early reuse - covered.
- Command-center launch creates a physical launch container with launched commodities - covered.
- POCO owner tax routing credits the correct corporation wallet once ownership is modeled.
