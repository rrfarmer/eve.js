# Citadel Systems Findings And Implementation Plan

## Summary

This plan covers all player-owned Upwell structures that use citadel-style fitting, services, fuel, and quantum-core mechanics. NPC stations remain on the existing station-service paths.

The implementation target has been rebaselined around the client inventory contract first. Structure service, fuel, and deed bays are structure-owner/corp-owned bays; the personal item hangar remains character-owned. Quantum cores are represented by a real inventory item in `flagStructureDeed=180`, with the structure state derived from that item.

The next target after the first manual test gate remains playable service parity: structure service slots, Standup service-module mapping, fuel bay burn, service-state reconciliation, and fitting/unfitting behavior. Rare sov, security, moon, and abandoned-state edge cases are deferred unless an existing subsystem already exposes them cleanly.

## Client Findings

The client defines structure service slots as inventory flags `164-171`, structure fuel as flag `172`, structure deed/core bay as flag `180`, and the Upwell Freighter Infrastructure Hold as flag `185`. Ship fitting flags remain a separate set: normal module slots, rigs, and subsystems.

The structure-control inventory tree also reuses some non-structure flag IDs in a structure context: `flagCargo=5` is the Structure Ammo Bay, `flagFighterBay=158` is the Structure Fighter Bay, and `flagMoonMaterialBay=186` is the Structure Moon Material Bay. These are structure-owner/corp-owned only when the inventory location is an Upwell structure; they must not become global structure flags because `5` is still normal ship cargo elsewhere.

The client `StructureBay` controllers accept rows whose `locationID` is the structure, whose `flagID` is the bay flag, and whose `ownerID` is the structure owner. This is the critical difference from the personal item hangar, which remains `ownerID=characterID`, `locationID=structureID`, and `flagID=4`.

Quantum cores use group `4086`. Required core type comes from dogma attribute `structureRequiresDeedType` / `attributeStructureRequiresDeedType=3101`.

The client maps Standup service module types to services in `structures/services.py`:

| Module Type | Services |
| --- | --- |
| `35892` Standup Market Hub I | Market |
| `35894` Standup Cloning Center I | Medical |
| `35899` Standup Reprocessing Facility I | Reprocessing |
| `35891` Standup Research Lab I | Copying, ME research, TE research |
| `35886` Standup Invention Lab I | Invention |
| `35878` Standup Manufacturing Plant I | Basic manufacturing |
| `35881` Standup Capital Shipyard I | Capital manufacturing |
| `35877` Standup Supercapital Shipyard I | Supercapital and capital manufacturing |
| `45550` Standup Hyasyoda Research Lab | Copying, ME research, TE research |
| `45538`, `45537`, `45539` reactors | Hybrid, composite, biochemical reactions |
| `45009` Standup Moon Drill I | Moon mining |
| `35913`, `35912`, `35914` FLEX modules | Jump bridge, cyno beacon, cyno jammer |
| `78330` LP Store | Loyalty store |
| `82941` Standup Metenox Moon Drill | Automatic moon mining |

Dogma attributes provide the mechanics needed by the server:

| Attribute | Use |
| --- | --- |
| `serviceSlots` | Number of service slots on a structure hull |
| `serviceModuleFuelConsumptionGroup` | Fuel group consumed by a service module |
| `serviceModuleFuelAmount` | Hourly fuel burn |
| `serviceModuleFuelOnlineAmount` | Fuel consumed when onlining |
| `structureRequiresDeedType` | Required quantum core type for the hull |

## Current Server Status

The server already has structure lifecycle, docking, directory/settings payloads, tethering, asset safety, GM `/upwell` commands, and several service consumers such as reprocessing, repair, and industry.

The main early gaps were that service slots were not treated as fitting flags, service states were not derived from fitted service modules, fuel bay consumption was not connected to services, and the client-called `structureControl.CheckCanDisableServiceModule` was missing.

The larger rebaseline gap found during live testing was that structure-owned bays were being listed and moved as character-owned structure inventory. That caused quantum cores moved to `flag=180` to disappear from the deed bay while remaining visible through personal assets. The server also had a `hasQuantumCore` boolean path that was not backed by the real inventory core item.

Ship rig behavior is already partially correct: rigs are skipped by strip fitting and destroyed through `DestroyFitting`. This behavior should stay separate from structure service module rules.

## Implementation Phases

1. Add shared constants/helpers for service slots `164-171`, fuel `172`, deed/core `180`, quantum core group `4086`, and structure-owned bay detection.
2. Fix Upwell structure inventory listing and moves so personal hangar `flag=4` remains character-owned while service/fuel/deed bays are structure-owner-owned.
3. Implement inventory-driven quantum core install from `flag=180`, including required-core validation, one-core capacity, state transition from core-wait anchoring to onlining, and repair of already-misowned deed rows.
4. Add real-core destruction handling so the installed core item is dropped instead of duplicating a synthetic boolean drop. Legacy boolean-only structures still drop the configured core type.
5. Audit controlled-structure dogma and station-control RPCs such as `EjectFromStructure`, `RenameStructure`, `Unanchor`, and `CancelUnanchor`.
6. Re-audit service module fitting, service reconciliation, and fuel consumption using structure-owned rows.
7. Audit remaining service consumers so player structures use reconciled service states while NPC station services remain unaffected.
8. Add strict parity rules later: security class restrictions, sov upgrade requirements, moon/flex edge rules, abandoned timing polish, and active job/order/clone disable vetoes.

## Implemented Baseline

The baseline implementation adds:

- Structure service slot flags `164-171` and structure fuel flag `172`.
- A server-side Standup service-module registry matching the client mapping.
- Structure service-slot fitting validation against slot capacity and allowed services.
- Structure fuel compatibility for fuel block group items.
- `structureControl.CheckCanDisableServiceModule`.
- Service-state reconciliation from online fitted service modules.
- Online fuel consumption, hourly fuel tick support, `fuelExpiresAt`, and Full Power/Low Power upkeep updates.

## Phase 5a Implemented

The first service-consumer pass adds:

- Structure-aware station service state rows for legacy station service consumers.
- Structure-aware station service masks that translate online structure services back to the legacy station service bit values the client expects.
- Structure-aware market topology so structure market orders resolve solar system, constellation, and region IDs.
- A shared structure service access helper for consumers that need to gate behavior on reconciled structure services while leaving NPC stations unchanged.
- Market action gating for player structures: station asks, buy-order placement, sell-order placement, and order modification now require an online Market service.

## Inventory/Core Rebaseline Implemented

The first rebaseline pass adds:

- Shared structure inventory constants for service slots `164-171`, fuel `172`, deed/core `180`, and quantum core group `4086`.
- Structure-owned bay listing for Upwell structures: service, fuel, and deed rows are returned with the structure owner corp, while personal hangar rows stay character-owned.
- Structure-control bay listing for Ammo `5`, Fighter `158`, Fuel `172`, Deed/Core `180`, and Moon Material `186`, with context-aware ownership so ambiguous ship flags keep working outside structures.
- Structure-owned bay move handling: dragging a core, service module, or fuel into a structural bay transfers ownership to the structure owner corp.
- Ammo and fighter bay move validation: ammo accepts charges, fighter bay accepts fighters, and both return structure-owner rows to the client.
- Deed bay validation for quantum cores: correct group, correct required hull core type, quantity one, and no second installed core.
- Inventory-driven core install: moving the required core to `flag=180` sets `hasQuantumCore`, stores `quantumCoreItemID/typeID`, and advances a core-waiting anchoring structure to onlining.
- Misowned deed bay repair: existing rows already stuck at `flag=180` with character ownership are adopted into the structure owner corp when the deed bay is listed.
- Real installed core destruction: destruction moves the actual installed core item into the wreck/drop location; legacy boolean-only structures still synthesize the configured core drop.
- Abandoned structure destruction now forces remaining contents to drop when asset safety is disabled, matching the existing abandoned-structure test expectation.

### Deployment Lifecycle Correction

The CCP deployment article confirms the core gate is after the 24-hour anchoring phase, not during it:

1. Launching the structure starts the initial 15-minute deployment vulnerability.
2. After that timer, the 24-hour anchoring timer starts.
3. When anchoring completes, the structure becomes dockable/openable and enters the core-needed onlining vulnerable stage.
4. If no quantum core is installed, it remains in onlining vulnerable with no repair timer; it should not stay in `ANCHORING`.
5. Installing the required quantum core starts the 15-minute repair/onlining timer.
6. When that timer completes, the structure transitions to the shield vulnerable/online baseline state.

The server now treats old or broken `ANCHORING` rows with no active timer and no core as `ONLINING_VULNERABLE` with `stateEndsAt=null`. This lets already-stuck structures load as dockable core-waiting structures. Expired anchoring timers also advance to the same state until a real core item is installed.

### Manual Test Gate 1

Stop here for client testing before continuing to station-control RPCs and broader service/fuel work:

1. Anchor an Astrahus from the Avalanche Infrastructure Hold.
2. Fast-forward the initial 15-minute deployment vulnerability and then the 24-hour anchoring timer.
3. Verify the structure now shows as dockable/openable and core-needed/onlining vulnerable, not `ANCHORING`.
4. Drag the required Astrahus Upwell Quantum Core into the Structure Deed Bay.
5. Verify the core stays visible in the deed bay, no longer appears as a personal asset in that structure, and `/upwell info` shows the 15-minute onlining repair timer.

## Test Scenarios

- A Standup Market Hub fits into an Astrahus service slot, stays offline after fitting, and does not make the market service available until onlined.
- Onlining a service module consumes online fuel from flag `172`, exposes the mapped service, and sets Full Power.
- Offlining or unfitting the service module removes the mapped service while basic services remain online.
- Structure service slots are rejected for ships.
- Non-fuel items are rejected from structure fuel.
- Elapsed fuel ticking consumes hourly fuel and offlines service modules when fuel is insufficient.
- Structure-backed station service rows and masks expose only online structure services.
- Structure market topology resolves player structures to their solar system, constellation, and region.
- Structure market calls stop before daemon access when the Market service is offline.
