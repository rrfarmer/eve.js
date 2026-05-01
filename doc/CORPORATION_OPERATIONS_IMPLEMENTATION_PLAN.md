# Corporation Operations Implementation Plan

Date: 2026-05-01

This plan defines the missing and incomplete corporation operation work for the
server. It is based on `doc/CLIENT_CODE_REFERENCE.md`, the decompiled client
source in `tools/ClientCodeGrabber/Latest/`, and the current server services
under `server/src/services/corporation`, `server/src/services/account`, and
`server/src/services/market`.

## Summary

The server is no longer missing the entire corporation surface by name. The
current codebase has a real corporation service tree, persistent corporation
runtime state, office rows, asset summaries, member rows, application rows,
wallet divisions, votes, recruitment ads, alliance and war helpers, LP wallet
helpers, and several tests.

The bigger gap is that many player-corporation operations are only partially
complete:

- Some client-called methods are still missing entirely.
- Some read paths work, but write paths are intentionally blocked or return
  empty lists.
- Many operations trust the caller session instead of enforcing EVE corporation
  roles on the server.
- Several gameplay side effects are not wired yet: corp tax collection, corp
  wallet transfers, corp market settlement, audit logs, impound movement, office
  rent bills, and sanctioned vote actions.
- Notifications and cache invalidations exist for several paths, but need to be
  made complete enough that the corporation window, wallet, assets, market, and
  station office UI stay in sync.

## Client Files Reviewed

Primary client-service wrappers:

- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/services/corporation/base_corporation.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/services/corporation/bco_corporations.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/services/corporation/bco_members.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/services/corporation/bco_applications.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/services/corporation/bco_titles.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/services/corporation/bco_shares.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/services/corporation/bco_recruitment.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/services/corporation/bco_alliance.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/services/corporation/officeManager.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/services/corporation/voting.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/services/corporation/itemLocking.py`

Corporation UI panels that reveal extra remote calls:

- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/neocom/corporation/corp_ui_accounts.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/neocom/corporation/corp_ui_applications.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/neocom/corporation/corp_ui_home.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/neocom/corporation/corp_ui_member_auditing.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/neocom/corporation/corp_ui_votes.py`

Wallet, market, and asset callers:

- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/neocom/wallet/transferMoneyWnd.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/neocom/wallet/walletSvc.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/neocom/wallet/walletUtil.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/neocom/wallet/panels/corp/`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/market/corpMarketOrders.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/market/buySellMultiBase.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/market/buyThisTypeWindow.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/market/sellMulti.py`
- `tools/ClientCodeGrabber/Latest/eve/client/script/ui/shared/mapView/filters/mapFilterCorpAssets.py`

Server files reviewed:

- `server/src/services/corporation/corpRegistryRuntime.js`
- `server/src/services/corporation/corpmgrService.js`
- `server/src/services/corporation/officeManagerService.js`
- `server/src/services/corporation/corpStationMgrService.js`
- `server/src/services/corporation/corpAssetState.js`
- `server/src/services/corporation/corpWalletState.js`
- `server/src/services/corporation/voteManagerService.js`
- `server/src/services/corporation/corpRecProxyService.js`
- `server/src/services/corporation/lpService.js`
- `server/src/services/account/accountService.js`
- `server/src/services/account/billMgrService.js`
- `server/src/services/market/marketProxyService.js`

## Current Surface Snapshot

Name-level client comparison found this:

| Service | Client-called method names | Implemented by name | Missing by name |
|---|---:|---:|---|
| `corpRegistry` | 74 | 74 | none found |
| `officeManager` | 11 | 10 | `isPrimed` is a client-side field, not a server method |
| `corpRecProxy` | 8 | 8 | none found |
| `corpmgr` | 7 | 6 | `AuditMember` |
| `billMgr` | 6 | 6 | none found |
| `lookupSvc` | 2 | 0 | `LookupEvePlayerCharacters`, `LookupNoneNPCAccountOwners` |
| `account` | 3 | 2 | `GiveCashFromCorpAccount` |
| `allianceRegistry` | 2 | 2 | none found in this pass |

Important correction: this only proves method-name coverage. It does not prove
the operation is game-complete, secure, or side-effect complete.

## Missing Or Incomplete Operations

### 1. Lookup and transfer unblockers

Missing:

- `lookupSvc.LookupEvePlayerCharacters(search, exact)`
- `lookupSvc.LookupNoneNPCAccountOwners(search, exact)`
- `account.GiveCashFromCorpAccount(toID, amount, fromAccountKey, toAccountKey=None, reason=None)`

Client impact:

- Corporation invitation search uses `LookupEvePlayerCharacters`.
- Wallet transfer dialogs use `LookupNoneNPCAccountOwners`.
- Corporation division give/take money uses `GiveCashFromCorpAccount`.

Server work:

- Add lookup rowsets backed by character, corporation, and alliance owner data.
- Exclude NPC-only account owners where the client asks for non-NPC owners.
- Debit the selected corporation wallet division, credit character or
  corporation destinations, write journal and transaction rows, and emit
  `OnAccountChange`.
- Enforce `corpAccountKey` access and division take roles.

### 2. Member auditing

Missing:

- `corpmgr.AuditMember(memberID, fromDate, toDate, rowsPerPage)`

Client impact:

- `corp_ui_member_auditing.py` expects two rowsets: item event logs and role
  history logs. It sorts by `eventDateTime` and `changeTime`.

Server work:

- Add persistent corporation audit tables or runtime sections:
  `memberRoleHistory`, `memberItemEvents`, and optionally `memberWalletEvents`.
- Log role, title, base, account key, division, and block-role changes from
  `UpdateMember`, `UpdateMembers`, and `ExecuteActions`.
- Log corp hangar item movement, impound release/trash, delivery, and office
  unrent effects.
- Implement `AuditMember` with the exact row headers the client reads.

### 3. Server-side corporation role enforcement

Incomplete:

- Many current write methods mutate state based on the session corporation but
  do not consistently enforce CEO, director, personnel manager, accountant,
  junior accountant, trader, station manager, communications officer, or
  divisional hangar roles.

Client-side checks exist, but the server must be authoritative.

Server work:

- Add a central `corporationAccess` helper with checks like:
  - `canManageCorporationSettings`
  - `canInviteOrAcceptApplications`
  - `canKickMember`
  - `canGrantRoles`
  - `canUseWalletDivision(accountKey, mode)`
  - `canQueryHangarDivision(flagID)`
  - `canTakeHangarDivision(flagID)`
  - `canRentOffice`
  - `canManageVotes`
- Apply it to all corporation writes before changing state.
- Return client-compatible user errors where known. Use the existing wrapped
  user-error helpers instead of silent nulls where the UI expects feedback.

### 4. Applications, invitations, and membership lifecycle

Partially implemented:

- Application insert, update, invitation insert, open invitation reads, and some
  notifications exist.

Still needed:

- Validate the full status graph from `evecorporation.recruitment` and
  `const.crpApplication*`.
- Make corporation acceptance, applicant acceptance, rejection, renegotiation,
  withdrawal, and invitation acceptance all archive correctly.
- Ensure only accepted final states move the character.
- Ensure all other active applications are archived when a character joins.
- Send welcome mail on successful join.
- Keep character session fields aligned: `corpid`, `corporationID`,
  `corprole`, `corpAccountKey`, `allianceid`, home station, and member
  start-date.
- Enforce role stasis and CEO restrictions for quit, kick, and self-kick.

### 5. Corporation tax collection

Partially implemented:

- `UpdateCorporation` stores `taxRate` and `loyaltyPointTaxRate`.
- LP wallet state exists.

Still needed:

- Apply corporation ISK tax to taxable PvE income paths such as bounties and
  mission rewards.
- Apply corporation LP tax to LP award paths if this client build expects LP
  taxation.
- Credit taxed ISK and LP to the corporation wallet or corporation LP wallet.
- Write personal and corporate journal entries so wallet panels explain the
  transfer.
- Exempt NPC corporations and non-taxable transfers.

### 6. Corporation wallet, bills, and journals

Partially implemented:

- Seven wallet divisions exist.
- `GetCashBalance`, `GetWalletDivisionsInfo`, `GetJournal`, `GetTransactions`,
  `GetCorporationBills`, `GetCorporationBillsReceivable`, and bill payment
  exist by name.

Still needed:

- `GiveCashFromCorpAccount` and division-to-division transfers.
- Access control per wallet division.
- Full journal entry types and owner fields for taxes, market escrow, market
  transactions, office rent, bills, dividends, donations, and admin grants.
- Automatic bill payment daemon or login-time processing.
- Office rent bill creation and overdue handling.
- Better receivable/payable bill coverage for war bills, office bills, alliance
  bills, surrender, and future corp mechanics.

### 7. Corporation assets, offices, hangars, and impound

Partially implemented:

- `corpmgr.GetAssetInventory`, `GetAssetInventoryForLocation`, and
  `SearchAssets` exist.
- `officeManager` can rent and unrent offices.
- Corp hangar inventory transfer has test coverage.

Still needed:

- Enforce query/take roles for each corp hangar division.
- Charge office rental cost from a corporation wallet.
- Create recurring office rental bills.
- On unrent, move office contents into impound instead of simply deleting the
  office row.
- On impound release, debit the release price and move items back into a new
  office or valid corp location.
- On trash impound, destroy or mark items according to client expectations.
- Improve nested container and asset search parity for corp assets.
- Cover `deliveries`, `capsuleerdeliveries`, `assetwraps`, `property`,
  `offices`, and `impounded` buckets with tests.
- Keep map filters and corporation accounts asset tabs cache-valid through
  object-cache invalidation.

### 8. Corporation market orders

Partially implemented:

- `GetCorporationOrders` exists.
- Market history can include corporation orders.

Blocked or incomplete:

- `marketProxyService` explicitly rejects `useCorp` in buy and sell paths with
  "Corporation market orders are not wired into corporation wallets and hangars
  yet."
- `CorpGetTransactions` currently returns an empty list.

Server work:

- Remove the personal-market-only guard for supported corporation paths.
- For corp buys, debit the chosen corp wallet division, create escrow, create
  corp-owned orders, and deliver purchased items to the correct corp delivery or
  office location.
- For corp sells, require query/take access to the selected corp hangar item,
  move items into market escrow, create corp-owned orders, and credit the corp
  wallet on fills.
- Populate corporation market transactions and wallet journals.
- Emit `OnOwnOrdersChanged(..., isCorp=1)` and account-change notifications.
- Update order-history and export row fields so issued-by and wallet-division
  columns work in `corpMarketOrders.py`.

### 9. Shares, votes, sanctioned actions, and item locking

Partially implemented:

- Share reads, share movement, dividends, vote cases, votes, sanctioned-action
  reads, and item-locking reads exist.

Still needed:

- Enforce shareholder and role rules for creating votes and moving shares.
- Validate vote duration, options, and vote type payloads.
- Apply sanctioned actions for:
  - create shares
  - lock blueprint or item
  - unlock item
  - kick member
  - CEO change
  - generic vote outcomes if the client expects them
- Connect item locking to inventory operations so locked corp items cannot be
  moved or used without an unlock vote.
- Emit `OnShareChange`, `OnSanctionedActionChanged`, and item-locking
  invalidations.

### 10. Recruitment ads

Partially implemented:

- `corpRecProxy` has create, update, delete, search, recruiter list, and
  per-corp reads.

Still needed:

- Enforce recruiter/personnel-manager/director permissions.
- Charge ad fees if this client build expects them.
- Expire ads after purchased days.
- Honor skill point, language, activity, time-zone, friendly-fire, tax, and
  member-count filters accurately enough for the recruitment search UI.
- Ensure recruiter character lists remain valid after members leave the corp.

### 11. Alliance and war operations that intersect corporations

Partially implemented:

- Alliance creation, applications, membership, relationships, bulletins,
  standings-like contacts, bills, capital system, prime hour, and war helpers
  exist.

Still needed for corporation parity:

- Enforce corporation CEO/director restrictions for alliance applications and
  alliance creation.
- Ensure executor support and member removal rules match client expectations.
- Connect war declaration bills to corp wallet payment and war activation.
- Keep alliance membership changes reflected in corporation and character
  sessions.

## Data Model Additions

Prefer extending `corporationRuntime` over inventing unrelated tables unless a
log grows large enough to justify its own file.

Recommended additions:

- `corporations[corpID].audit.memberRoleHistory[]`
- `corporations[corpID].audit.memberItemEvents[]`
- `corporations[corpID].audit.walletEvents[]`
- `corporations[corpID].marketTransactions[]`
- `corporations[corpID].officeRentals[]`
- `corporations[corpID].taxLedger[]`
- `corporations[corpID].applicationHistory[]` hardening, if the current shape
  is not enough for every status transition

Every write path should record:

- acting character ID
- acting corporation ID
- target character, owner, item, office, vote, or application ID
- old value and new value where the client audit UI can show it
- filetime timestamp
- wallet account key when money moved
- source and destination location/flag when items moved

## Notification And Cache Rules

Use the existing notification helpers where possible, then fill gaps:

- `OnCorporationChanged`
- `OnCorporationMemberChanged`
- `OnCorporationApplicationChanged`
- `OnCorporationWelcomeMailChanged`
- `OnOfficeRentalChange`
- `OnShareChange`
- `OnSanctionedActionChanged`
- `OnAccountChange`
- `OnOwnOrdersChanged`

Cache invalidation must cover:

- `corpmgr.GetAssetInventory`
- `corpmgr.GetAssetInventoryForLocation`
- `marketQuote.GetCorporationOrders`
- `account.GetJournal`
- `account.GetTransactions`
- `billMgr.GetCorporationBills`
- `billMgr.GetCorporationBillsReceivable`

## Implementation Phases

### Phase 0 - Trace and parity harness

Goal: make each corporation UI click produce a known server method and test.

Tasks:

- Add a lightweight corporation operation trace checklist from the client files.
- Add tests that verify each currently-known client method exists on the
  registered service.
- Add row-shape tests for `corpRegistry`, `corpmgr`, `officeManager`,
  `account`, `billMgr`, `voteManager`, and `corpRecProxy`.

Acceptance:

- A test fails if a client-called method is missing.
- Existing corporation tests still pass.

### Phase 1 - UI unblockers

Goal: remove the hard missing method calls.

Tasks:

- Implement `lookupSvc.LookupEvePlayerCharacters`.
- Implement `lookupSvc.LookupNoneNPCAccountOwners`.
- Implement `account.GiveCashFromCorpAccount`.
- Implement a first `corpmgr.AuditMember` that returns correct empty rowsets,
  then upgrade it as audit events are added.

Acceptance:

- Corp invitation search returns player characters.
- Wallet transfer destination search returns player characters and player
  corporations.
- Corp division-to-division and corp-to-character transfers work and journal.
- Member auditing window opens without RPC failure.

### Phase 2 - Access control spine

Goal: make corporation writes server-authoritative.

Tasks:

- Add central corporation access helpers.
- Guard settings, logo, tax, applications, invitations, roles, titles, shares,
  offices, wallet, contacts, bulletins, recruitment, votes, and corp hangar
  mutations.
- Add tests for denied writes by regular members.

Acceptance:

- A regular member cannot mutate corp settings or spend corp wallet divisions.
- CEO and director paths still work.
- Division-specific wallet and hangar roles are respected.

### Phase 3 - Membership lifecycle

Goal: make joining, leaving, inviting, accepting, kicking, and CEO succession
complete.

Tasks:

- Finish application status transitions.
- Wire welcome mail and application archiving.
- Enforce role stasis and CEO restrictions.
- Finish `ResignFromCEO` and corporation destruction or fallback behavior.
- Ensure session and character affiliation changes are synchronized.

Acceptance:

- Apply, accept, join, reject, invite, accept invitation, withdraw, kick, and
  quit flows all update corp membership and UI notifications.

### Phase 4 - Wallets, taxes, and bills

Goal: make corporation ISK and LP economics real.

Tasks:

- Apply ISK and LP taxes to taxable rewards.
- Write personal and corp wallet journals for tax.
- Complete corp wallet division transfers.
- Add recurring office bills and auto-pay processing.
- Improve bill receivable/payable coverage.

Acceptance:

- Setting corp tax changes future taxable rewards.
- Wallet panels show balance, journal, and transaction evidence.
- Bills can be paid manually and automatically.

### Phase 5 - Offices and assets

Goal: make corp offices and corp assets behave like durable shared storage.

Tasks:

- Charge rent on office rental.
- Move contents to impound on unrent.
- Release or trash impounded items correctly.
- Enforce hangar division roles on inventory operations.
- Harden corp asset buckets, nested containers, deliveries, and asset-safety
  wraps.

Acceptance:

- Rent office, move item into corp hangar, see item in corp assets, unrent,
  see item impounded, release impound, and see item accessible again.

### Phase 6 - Corporation market orders

Goal: support the client "use corporation wallet" buy and sell flows.

Tasks:

- Replace `assertPersonalMarketOnly(useCorp)` with full corp settlement.
- Debit and credit corp wallet divisions.
- Move corp items into and out of market escrow.
- Populate `CorpGetTransactions`.
- Notify corp order and wallet changes.

Acceptance:

- Corp buy order spends corp wallet and appears in corp orders.
- Corp sell order consumes corp hangar stock and credits corp wallet on fill.
- Corp market transactions panel is non-empty after a corp market trade.

### Phase 7 - Shares, votes, sanctioned actions, and locking

Goal: make corporation governance affect the world.

Tasks:

- Enforce share and vote permissions.
- Apply sanctioned actions.
- Connect item locking to inventory movement and blueprint operations.
- Emit share, vote, and item-lock notifications.

Acceptance:

- A vote can create shares, lock an item, unlock an item, kick a member, or
  transfer CEO status, and the result is visible after activation.

### Phase 8 - Recruitment, alliance, and war polish

Goal: finish the surrounding corporation systems once the core corp is solid.

Tasks:

- Add recruitment ad expiry, costs, filters, and recruiter validation.
- Harden alliance application and executor rules.
- Wire war bills and corp wallet payment into war activation.
- Verify corp/alliance session changes and notifications.

Acceptance:

- Recruitment search filters match created ads.
- Alliance application accept/reject changes corp alliance membership.
- War declaration bill payment activates the expected war state.

## Testing Strategy

Use focused server tests first, then user-driven client testing for each phase.

Recommended test files:

- `server/tests/corporationLookupWalletParity.test.js`
- `server/tests/corporationAccessParity.test.js`
- `server/tests/corporationApplicationsParity.test.js`
- `server/tests/corporationTaxWalletParity.test.js`
- `server/tests/corporationOfficeAssetsParity.test.js`
- `server/tests/corporationMarketParity.test.js`
- `server/tests/corporationVotesSharesParity.test.js`
- `server/tests/corporationAuditParity.test.js`

For live client testing, use the actual corporation window tabs:

- Home and details
- Members
- Applications
- Recruitment
- Assets
- Wallet
- Offices while docked
- Politics and votes
- Market corporation orders

## Open Questions

- Should this server prefer strict EVE-like restrictions, or keep some
  dev-friendly shortcuts behind config flags?
- Should corporation market orders deliver to corp deliveries by default, or to
  a station office division when one exists?
- Should office rent be billed monthly with simulated filetime advancement, or
  should it stay manual/admin-triggered for now?
- Should NPC corporation tax and player corporation tax follow current live EVE
  behavior, or only what this V23.02 client exposes?
- For early phases, is an empty but correctly-shaped `AuditMember` acceptable,
  or should auditing be built before exposing the member-audit tab?

## Recommended First Slice

Start with Phase 1 and Phase 2 together:

1. `lookupSvc.LookupEvePlayerCharacters`
2. `lookupSvc.LookupNoneNPCAccountOwners`
3. `account.GiveCashFromCorpAccount`
4. Correct empty rowsets for `corpmgr.AuditMember`
5. A small `corporationAccess` helper used by the new wallet transfer path

This gives immediate visible wins in the client while creating the access-control
foundation needed by every later corporation operation.
