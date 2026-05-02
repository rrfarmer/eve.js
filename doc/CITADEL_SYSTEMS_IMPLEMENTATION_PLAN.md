# Citadel Systems Findings And Implementation Plan

## Summary

This plan covers all player-owned Upwell structures that use citadel-style fitting, services, and fuel mechanics. NPC stations remain on the existing station-service paths.

The first implementation target is playable parity: structure service slots, Standup service-module mapping, fuel bay burn, service-state reconciliation, and fitting/unfitting behavior. Rare sov, security, moon, and abandoned-state edge cases are deferred unless an existing subsystem already exposes them cleanly.

## Client Findings

The client defines structure service slots as inventory flags `164-171` and structure fuel as flag `172`. Ship fitting flags remain a separate set: normal module slots, rigs, and subsystems.

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

## Current Server Status

The server already has structure lifecycle, docking, directory/settings payloads, tethering, asset safety, GM `/upwell` commands, and several service consumers such as reprocessing, repair, and industry.

The main gaps were that service slots were not treated as fitting flags, service states were not derived from fitted service modules, fuel bay consumption was not connected to services, and the client-called `structureControl.CheckCanDisableServiceModule` was missing.

Ship rig behavior is already partially correct: rigs are skipped by strip fitting and destroyed through `DestroyFitting`. This behavior should stay separate from structure service module rules.

## Implementation Phases

1. Add service-slot constants, structure fuel flag, and tests proving service slots do not become valid ship fitting slots.
2. Add a structure service-module runtime with client-derived module-to-service mapping, service-slot capacity checks, allowed-service checks, and SDE fuel attribute lookup.
3. Extend inventory moves so service modules fit only into structure service slots and structure fuel only accepts fuel block group items.
4. Extend dogma onlining/offlining so service modules consume online fuel, update module online state, reconcile structure services, and update `fuelExpiresAt`/upkeep.
5. Add elapsed fuel ticking that consumes hourly fuel, offlines unfueled services, and projects fuel expiry.
6. Audit remaining service consumers so player structures use reconciled service states while NPC station services remain unaffected.
7. Add strict parity rules later: security class restrictions, sov upgrade requirements, moon/flex edge rules, abandoned timing polish, and active job/order/clone disable vetoes.

## Implemented Baseline

The baseline implementation adds:

- Structure service slot flags `164-171` and structure fuel flag `172`.
- A server-side Standup service-module registry matching the client mapping.
- Structure service-slot fitting validation against slot capacity and allowed services.
- Structure fuel compatibility for fuel block group items.
- `structureControl.CheckCanDisableServiceModule`.
- Service-state reconciliation from online fitted service modules.
- Online fuel consumption, hourly fuel tick support, `fuelExpiresAt`, and Full Power/Low Power upkeep updates.

## Test Scenarios

- A Standup Market Hub fits into an Astrahus service slot, stays offline after fitting, and does not make the market service available until onlined.
- Onlining a service module consumes online fuel from flag `172`, exposes the mapped service, and sets Full Power.
- Offlining or unfitting the service module removes the mapped service while basic services remain online.
- Structure service slots are rejected for ships.
- Non-fuel items are rejected from structure fuel.
- Elapsed fuel ticking consumes hourly fuel and offlines service modules when fuel is insufficient.
