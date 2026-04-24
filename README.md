> [!NOTE]
> EVE.js Discord server: https://discord.gg/KMuJrMDEBa, Come and say hey!

> [!IMPORTANT]
> Thank you to John, as well as many other contributers who kept this project going, and helped development chug along! You will always be appreciated :)\
> EVE.js is still in its early stages, and not everything works. If you come across and issues, don't hesitate to create an Issue. If you would like to contribute to the project, please create a Pull Request!

**Notes:**
- Linux support is soon to come. Right now we mainly support Windows users. If you are on linux, you can still run the server, but you won't be able to properly use the `.bat` files used to quickly set up.
- Unless specifically said it is all there - there might be missing bits, some big, some tiny, this is NOT a fully complete eve server. The list below follows this too.
- We are aware of jolts that can occur, but due to a lack of time to re-fix them after pushing some updates that broke it. Soon-to-come updates should eliminate this :D

EVE.js is an easy-to-use server emulator for Eve Online. We are functional against the latest client patch as of **2nd April, 2026**.

## **Quick server startup:**
1. Install [Node.js LTS](https://nodejs.org/en/download)
2. Run `QuickstartServer.bat` inside the root project directory.
*Please keep in mind, that just quickly starts the server. To get the market to work, you will need to follow the direction below.*

## **Market setup**
1. Run `InstallRustForMarket.bat` inside `/tools`
2. Run `BuildMarketSeed.bat` inside `/tools/market-seed` (if you prefer to use the GUI version, run the script ending in `...Gui.bat`)
3. Run `StartMarketServer.bat` inside the root project directory.
*It's recommended to only seed Jita + New Caldari, because eeding the entire universe will take some time*

## **Other Guides**
- [Start here](doc/SETUP.md)
- [Launcher guide](doc/LAUNCHERS.md)
- [Optional market setup](doc/MARKET_SETUP.md)
- [Market seeder guide](doc/MARKET_SEEDER.md)
- [Troubleshooting](doc/TROUBLESHOOTING.md)
- [Tools and admin basics](doc/TOOLS.md)
- [Feature audit](doc/IMPLEMENTED_FEATURE_STATUS.txt)

## **Good To Know**
- Use a **copy** of your EVE client, not the one you normally play on.
- `doc/Olddocs` is legacy reference material. The current player-friendly guides live in `doc/`.
- Some folders under `tools/` are maintainer-only. If a guide does not mention them, you can ignore them.

## **Features:**
- [x] Character Creation
- [x] Paperdolls (character faces / images)
- [x] Movement and navigation
  - [x] Warping
  - [x] Stargates
  - [x] Jumping
  - [x] Session changes
  - [x] 1-1 undock positioning
  - [x] Aligning
- [x] Modules and ship
  - [x] Weapons  
    - [x] Missiles
      - *Missiles function, but may rarely bug out from time to time. Needs revisited, but not on high priority. Getting missiles to work was a pain, and took almost a week!*
    - [x] Lasers
      - *The lock animation on **only** Beam Lasers doesn't work, but for some reason it does sometimes..*
    - [x] Hybrids
    - [x] Projectiles
  - [x] Reloading
    - *Right click > Reload All works, but does it one at a time. This could possibly be improved.*
    - *When you automatically reload while firing missiles, they will continue to fire after being reloaded. (needs more testing)*
  - [x] Tooltips
    - *Buggy, range is not always accurate*
  - [ ] Passive Modules
    - *About half of the passive modules are in place, with some still needing implementation!*
  - [ ] Repairing
    - *Shield boost and armor has been testing only once, and should be testing again before being marked as complete.*
  - [x] Regeneration
    - [x] Passive shield recharge
    - [x] Capacitor recharge
- [x] Economy
  - [x] Market
  - [x] Hypernet
  - [x] New Eden Store
    - *Includes an editor, and fake checkout which auto succeeds!*
  - [x] EverMarks
- [x] Other
  - [x] Radials
    - *Radials are the white loop around the module when the module cycles.*
    - *Known issue, which happens randomly. Modules may not glow green. FIX: redock/jump/relog*
  - [x] Time Dialation (tidi)
    - *A lot has changed, so auto-scaling tidi is turned off by default until further tested. Though the slash command `/tidi <0.1-1.0>` is fully operational!*
  - [x] Fighters
    - *Some undocumented bugs may occur*
  - [x] Stargate Orientation
    - *Calculcated by the direction of the gate in the destination system, super super cool! They all face eachother! (Works the same way on TQ)*
  - [x] Speedy asset overview
    - *Asset overview and market-server load insanely fast, thanks to Rust!*

***The above list will be changes as development continues.***

