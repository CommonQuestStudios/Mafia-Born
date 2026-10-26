# Changelog

All notable changes to From Dusk To Don (Mafia Born) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),

## [1.44.0] - 2026-10-26
### Added
- Guest play: start a game without an account; guest progress saves locally and carries over when creating an account
- Assigned "Guest #####" names for guests; custom names require a free account
- Paid name changes for account holders ($100,000, doubling each change, once every 7 days) from Settings and the Player Stats Identity card
- Server-side name checker with a unique index so no two accounts can share a character name; `/api/name-change` endpoints
- Renames update territories, crews, bounties, private chats and leaderboard entries in the online world
- New character portraits and item images
- GitHub Actions auto-deploy of the static site to cPanel via FTP

### Changed
- Account character names are now server-authoritative (cloud saves and multiplayer use the account's name)
- Help guide, tutorials and Settings text explain guest names, accounts and name changes

### Security
- `.htaccess` blocks public access to backend files, data files, docs and tooling folders on cPanel

## [1.43.5] - 2025-07-17
### Fixed
- Fixed corrupted Unicode character in territory display element (index.html)
- Added password hash format validation in verifyPassword() to prevent crashes on corrupted database entries (userDB.js)
- Wrapped authenticateUser() password verification in try/catch for graceful error handling (userDB.js)
- Fixed potential null dereference in session duplicate-check when orphaned player entries exist (server.js)
- Added null checks on all DOM element lookups in miniGames.js (tttStart, tttUpdateDisplay, tttReset, backToMiniGamesList)
- Removed unused variable vehicleDestroyed in job equipment durability logic (game.js)
- Removed unused heat variable in manageTurfDetails (game.js)
- Removed unused getNextTier import from player.js (game.js)
- Removed dead legacy function chargeBookieFeeHourly (game.js)
- Removed unused saveWorldState import from worldPersistence (server.js)
- Fixed string quote style inconsistency in inventory display (game.js)
- Prefixed unused catch parameter with underscore for lint compliance (game.js)

## [1.43.4] - 2025-07-17
### Added
- Font style customization in Settings with four options: Classic (Libre Baskerville), Typewriter (Special Elite), Elegant (Lora), and Clean (Inter)
- Font size selector in Settings with four options: Small, Medium, Large, and X-Large
- Font preferences persist via localStorage and apply instantly across the entire game

## [1.43.3] - 2025-07-17
### Fixed
- Base button border-radius updated from 2px to 6px for a more polished look across all screens
- Button double-border inset frame (::after) now inherits parent border-radius instead of hardcoded 1px
- Standardized inline button border-radius across game.js, casino.js, multiplayer.js, miniGames.js (small=4px, standard=6px, nav/primary=8px)
- Fixed non-theme red border colors (#ff0000, #ff4444, #ff2222, #ff6b6b) replaced with theme red (#8b3a3a) or theme gold (#c0a062) as appropriate
- Nav-back buttons updated from 2px to 6px border-radius
- Quick-btn sidebar border changed from grey (#444) to theme gold-dim for consistency
- Hospital cancel and bounty attempt button border-radius normalized to 6px
- Horse racing +/- bet buttons now use consistent gold borders instead of red/green
- Mobile menu Safehouse button and close button border colors fixed to theme red
- Fixed multiplayer heist Join/Create buttons using aggressive red borders instead of theme gold
- Auth delete account button border color fixed to theme red

## [1.42.3] - 2025-07-14
### Changed
- Vehicles now use a direct damage percentage (0-100%) instead of the durability/maxDurability system used by weapons and armor
- Each job adds 1-4% to a vehicle's damage counter; at 100% the vehicle is destroyed
- Vehicle condition now displayed as "Damage: X%" in inventory instead of durability points
- Inventory durability bar hidden for vehicles (they show the damage percentage info instead)
- Equip message for vehicles shows damage % and job success bonus
- Job success log uses new damage-based condition instead of old durability ratio
- Save migration converts existing vehicles from durability-based to vehicleDamage percentage

## [1.42.2] - 2025-07-14
### Changed
- Vehicle durability loss on jobs now deals 1-4% damage per use instead of a flat 1 durability point (scales with vehicle max durability)

## [1.42.1] - 2025-07-14
### Fixed
- Crash in faction passive functions (`getWeaponPriceMultiplier`, `getDrugIncomeMultiplier`, `getViolenceHeatMultiplier`) when `player.missions` is undefined -- `hasPassive()` now guards against null

## [1.42.0] - 2025-07-14
### Balance
- Legendary job cooldown increased from 20 minutes to 60 minutes (was too profitable per-second)
- Weapon power scaling improved: Sawed-Off Shotgun 90->120, Tommy Gun 100->160, Sniper Rifle 120->220 (better value at higher price tiers)
- Real estate ROI rebalanced: Luxury Penthouse income $4k->$7.5k/cycle, Private Island income $8k->$20k/cycle (higher-tier properties are now worthwhile investments)
- Turf fortification changed from flat +25 defense/level to percentage-based +5%/level of zone base defense (now scales properly across all zone difficulty tiers)

### Fixed
- Implemented `updateMissionAvailability()` which was an empty stub -- now unlocks turf missions based on player reputation thresholds

## [1.41.10] - 2025-07-14
### Fixed
- Gang member trait crash: added null-check on `member.traits` in `calculateMemberTaskScore()` preventing crash when traits array is undefined
- Mission stats corruption: `turfsControlled` stat now uses safe `(player.turf?.owned || []).length` instead of `player.territory` which could be undefined before first UI render
- Dead code cleanup: removed empty `forEach` loop body in `processTurfAttack()` failed-attack branch
- Server memory leak: cooldown maps (`pvpCooldowns`, `territoryWarCooldowns`, `assassinationCooldowns`, `disciplineCooldowns`) are now cleaned up on player disconnect
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.41.9] - 2026-03-17

### Fixed
- Territory persistence: conquered multiplayer territories no longer reset after logout or server restart
- Root cause: double-throttled saves (5s server + 5s persistence) meant data could be lost if server shut down within 10 seconds of a conquest
- Eliminated double-throttle by writing immediately after the server-level debounce
- Added `flushPendingWorldSave()` to graceful shutdown so pending territory changes are never lost
- Added 60-second periodic auto-save as a safety net for all world state

### Added
- Vehicle destruction events: when an equipped vehicle reaches 100% damage it is destroyed with dramatic flavor text (8 variations)
- Some destruction events deal health damage to the player (explosions, crashes, flips)
- Vehicle damage warnings at 50% and 75% damage thresholds
- Inventory now shows vehicle damage percentage alongside condition label

## [1.41.8] - 2026-03-17

### Fixed
- Multiplayer help screen: rewrote the Territories & Districts help topic to accurately describe MP territory wars (PvP conquest, gang casualties, arrest risk, 30-min cooldown, 10% resident tax, Top Don connection) instead of vague turf-like descriptions

## [1.41.7] - 2026-03-17

### Fixed
- Equipped weapons, armor, and vehicles no longer silently unequip after save/load
- Root cause: JSON serialization broke object reference identity; all "is equipped?" checks used === which failed after deserialization
- Equipment is now re-linked to inventory references on every load by matching name, type, and durability
- Added equippedWeapon, equippedArmor, equippedVehicle to initial player definition and new game reset

## [1.41.6] - 2026-03-17

### Added
- Crew job bonus: being in a crew boosts job earnings by +15% per crew member
- Crew job sharing: online crew members automatically receive 25% of your job earnings
- Crew bonus details shown in the "No Crew" modal prompt
- Crew size tracked on connection for immediate bonus availability

## [1.41.5] - 2026-03-17

### Fixed
- Fixed modal buttons having inconsistent styles -- secondary buttons (Go Solo, Stay Quiet, Cancel, Abort, etc.) now match the same gold/dark style as primary buttons instead of appearing dim and washed out

## [1.41.4] - 2026-03-16

### Added
- Superboss attack button now shows a 2-second cooldown bar so players can see when they can attack again

### Changed
- **Turf balance overhaul** -- Zone defenses increased ~2-2.5x across the board to prevent steamrolling early game
  - The Slums: 120 -> 200, Old Quarter: 140 -> 320, The Sprawl: 120 -> 300
  - Little Italy: 180 -> 450, Chinatown: 190 -> 475, Redlight: 200 -> 500
  - Harbor Row: 210 -> 550, Midtown Heights: 250 -> 400
- All rival family boss powers roughly doubled (Capos ~220-240, Underbosses ~380-440, Dons ~520-650)
- Independent boss Marcus Kane power: 160 -> 320
- Rival AI starting power and max power scale with updated boss values
- Existing saves automatically migrate to the new balance values on load

## [1.41.3] - 2026-03-16

### Fixed
- Fixed help text: skill tree node counts now correctly say "6-8 nodes" instead of "7 nodes"
- Fixed help text: added Mastermind max-rank exception note (caps at 5, not 10)
- Fixed ~15 outdated "injury" references left over from v1.41.0 injury removal -- updated to "damage taken" or "hurt chance" across help text, skill definitions, faction effects, code comments, and job approach modals
- Fixed faction effect descriptions: Police (replaced fake mechanical effects with honest flavor text), Civilians (now accurately describes protection racket bonuses), Underground (now accurately describes black market price discounts), Morales (injury -> hurt terminology)
- Fixed hospital tooltip: "Heal your injuries" -> "Restore your health"
- Inlined orphaned showSuperbossScreen() call in The Commission Activities tab

### Removed
- Removed 8 orphaned functions: expandTurf, gangWar, showFriendsScreen, showCrewScreen, showPlayerGambling, showSuperbossScreen, updateRightPanel, logOnlineWorldAction
- Removed 5 dead config flags from EXPANDED_SYSTEMS_CONFIG (turfWarsEnabled, interactiveEventsEnabled, rivalKingpinsEnabled, rivalGrowthInterval, turfAttackChance)
- Removed empty faction missions placeholder block
- Removed 14 client-side debug console.logs from game.js and multiplayer.js
- Removed 12+ legacy/orphaned window.* export aliases

## [1.41.2] - 2026-03-16

### Fixed
- Fixed ~192 buttons across the game that were missing the gold border (inline `border:none` overriding the standard button style). Affected screens: Operations (side ops, turf), Business Empire, Gang Management, Turf Control, Jail, Casino, Mini-Games, Black Market, Real Estate, Territory, Skill Tree, Player Stats, Intro, Help, Multiplayer Heists, and more.

## [1.41.1] - 2026-03-16

### Added
- Help screen now includes a **Territories & Districts** topic covering all 8 districts, relocation, ownership, and territory wars.
- Help screen now includes a **Top Don & City Policies** topic explaining how the Top Don is determined and what the five city-wide policies do.
- Multiplayer Overview help bullets now mention Territories and Top Don.

## [1.41.0] - 2026-03-16

### Removed
- **Gang Member Injury System** -- Removed the broken injury mechanic from turf fights. Members now either survive or die -- no more invisible "injured" status that was stuck permanently on page refresh
  - Removed `getGangHealTimeMs()` function and all injury `setTimeout` heal timers
  - Removed injury outcomes from `processTurfAttackCasualties()` and `processTurfAttack()` (turf defense)
  - Removed all "Injured" display lines from turf attack results, boss fight losses, and family elimination missions
  - Removed gang-member-heal references from Back-Alley Clinic help text (clinic still provides player passive HP regen)
  - Updated help text: member statuses are now "Active, Jailed, or Dead"

### Changed
- **Cautious Trait → Streetwise** -- Replaced the now-redundant "Cautious" trait with "Streetwise": -10% arrest chance, -30% death chance in turf fights, +10% stealth task effectiveness
- Updated family screen "Available" note to say "not in jail or dead" (removed "injured")
- Turf attack warning now says "may be killed" instead of "may be killed or injured"

### Fixed
- Save migration (v1.41.0): automatically converts any existing injured gang members to active and renames Cautious traits to Streetwise on load

## [1.40.1] - 2026-03-15

### Fixed
- **Turf Map Power Accuracy** -- Fixed two bugs causing inaccurate gang power display on the turf map
  - `recalculatePower()` no longer counts gang members toward `player.turf.power`; gang contribution is handled solely by `calculateTurfAttackPower()` to prevent double-counting
  - Active gang member filters now also exclude arrested members (`!m.arrested`) across turf attack power, active crew count, and casualty processing
  - Turf Power (overview) now reflects base infrastructure power; Attack Power (turf map) reflects full combat strength including active crew

### Added
- **Available Members on Family Screen** -- The roster tab now shows an "Available" count (X / total) alongside Members, Gang Power, and Active Ops, with a note explaining that available members are ready for action -- not in jail, injured, or dead

## [1.40.0] - 2026-03-15

### Changed
- **Turf vs Territory Naming Audit** -- Comprehensive pass across all files to enforce consistent naming: "Turf" for singleplayer (turf wars, turf zones, turf control) and "Territory" for multiplayer (districts, relocation, City Policies)
  - Renamed `showTerritoryControl()` to `showTurfControl()` with legacy alias
  - Renamed `processTerritoryOperations()` wrapper, `generateTerritoryEvent()` to `generateTurfEvent()`, `expandTerritory()` to `expandTurf()`
  - Renamed player properties: `territoryReputation` to `turfReputation`, `territoryPower` to `turfPower`, `territoryIncome` to `turfIncome`
  - Renamed Empire Rating property: `empireRating.territoryPower` to `empireRating.turfPower`
  - Updated all singleplayer DOM IDs: `territory-control-screen` to `turf-control-screen`, `territory-control-content` to `turf-control-content`, `territory-display` to `turf-display`
  - Fixed 50+ user-facing strings in notifications, help guide, tutorials, stats, and zone descriptions
  - Renamed config keys: `turfWarsEnabled`, `turfAttackChance`, `turfDefenseBonus`
  - Renamed data arrays and internal IDs: `turfEvents`, `turf_sellout`, `turf_violence`, etc.
  - Added save migration in `applySaveData()` to auto-convert old property names on load
  - Fixed server.js multiplayer event ID: `capture_turf` to `capture_territory`

## [1.38.0] - 2026-03-15

### Revamped
- **Help & Game Guide** -- Complete overhaul of the Help Index screen
  - Organised all topics into 8 clear categories: Basics, Earning Money & Jobs, Combat & Equipment, Skills & Training, Properties & Empire, Gangs/Factions/Story, Game Systems, Casino & Mini-Games, Multiplayer, and Achievements & More
  - Added 30+ detailed topics covering every game system (was 16 flat topics)
  - New topics: Character Creation, Car Theft, Bounty Board, Dirty Money & Laundering, Weapons, Armour, Vehicles, Supplies & Utilities, all 6 Skill Trees with per-node breakdowns, Business Fronts, Empire Rating, Crime Families, Corruption, Jail & Arrest, Hospital & Healing, Durability System, PvP, Player Market, Achievements, Daily Login, and more
  - Every topic now includes: what the system is, how it works mechanically, key numbers/costs, and which skills/perks/items affect it
  - Category-based navigation with gold section headers and grid layout
  - Training Gym costs documented (Tier 1-3 base + per-rank scaling)
  - All 42 skill nodes listed with exact per-rank effects and max ranks

## [1.37.0] - 2026-03-15

### New Skills
- **Preservation** (Endurance T2, requires Vitality 3): +2% chance per rank to prevent weapon/armor durability loss
- **Wheelman** (Stealth T2, requires Light Feet 3): -3% vehicle durability loss per rank
- **Interrogation** (Combat T2, requires Toughness 3): +5% bounty reward per rank
- **Connections** (Charisma T2, requires Street Cred 3): +2% fence sell price per rank
- **Silk Voice** (Charisma T2, requires Smooth Talker 3): +1% chance per rank to avoid jail entirely
- **Money Laundering** (Intelligence T2, requires Mastermind 3): +5% laundering capacity per rank

### Changes
- Save migration automatically backfills new skill tree nodes for existing players

## [1.36.1] - 2026-03-15

### Changes
- Training Gym costs significantly increased across all tiers
  - Tier 1: $200 base -> $1,500 base, $150/rank -> $1,000/rank, 45s -> 60s base time
  - Tier 2: $1,000 base -> $8,000 base, $500/rank -> $4,000/rank, 45s -> 90s base time
  - Tier 3: $3,000 base -> $25,000 base, $1,500/rank -> $12,000/rank, 90s -> 150s base time

## [1.36.0] - 2026-03-14

### Changes
- Damaged weapons and armor can no longer be sold, fenced, or listed on the Player Market
- Inventory sell button now shows "Damaged -- cannot sell" for worn gear
- Fence merchandise filter excludes damaged weapons/armor
- Confirmed broken items (0 durability) are already removed from inventory on break

## [1.35.9] - 2026-03-13

### Dead Code Sweep
- Removed stale TODO comment for future server-authoritative job system
- Removed legacy territory redirect stubs (`manageTerritoryDetails`, `fortifyTerritory`) and their window exports
- Removed `playNotificationSound` no-op stub and all 29 dead call sites across multiplayer.js
- Removed unused `getCurrentDateString` function (was triggering ESLint warning)
- Removed `flushDB` no-op and its export from userDB.js
- Cleaned up stale "Removed" comments in game.js and multiplayer.js

## [1.35.8] - 2026-03-13

### Changes
- Removed gang training system entirely -- recruit the members you want, fire the ones you don't
- Gang UI now has 3 tabs: The Family, Tasks, Recruitment
- Car Theft Ring gang operation now awards stolen vehicles (30% chance on success)
- Gang-stolen vehicles use weighted condition tiers -- crews are pros so better odds than solo theft
- Both player and gang car theft can now rarely land a perfect 0% damage vehicle

## [1.35.7] - 2026-03-12

### Changes
- Player is now locked on the Doctor screen during active treatment -- must wait or cancel to leave
- Each reputation rank now has unique story flavor text on rank-up overlay and ledger log
- Fixed newspaper links in world chat unclickable on mobile (text selection blocked taps)
- Fixed duplicate jail messages flooding the ledger
- Fixed arrest messages missing from world chat after jail-message cleanup

## [1.35.6] - 2026-03-12

### Changes
- Fixed newspaper links (jail/death/policy) not working on mobile ledger and world chat
- Newspaper overlays now reliably appear above all mobile UI elements
- Touch-friendly tap targets for newspaper close buttons and chat links on mobile
- World chat area caps at 50vh on small screens to prevent overflow
- Scrubbed personal file paths and stale ngrok URLs from documentation
- Updated all embracedcreation.com references to mafiaborn.com
- Removed export/import from Character Showcase
- Cleaned up README with Play Now badge, no version log or server setup

## [1.35.5] - 2026-03-12

### Changes
- Renamed gang "Operations" to "Tasks" in all UI to avoid confusion with story Operations
- Rescaled story chapter reputation requirements: Ch1 starts at 100, increases by 205 per chapter (up to 5,020 at Ch25)
- Added reputation requirement to Chapter 1 (previously had none)
- Removed duplicate reputation objectives from Chapters 16-18
- Removed turf tribute notification badge from Territories button (kept on Operations only)

## [1.35.4] - 2026-03-11

### Bug Fixes
- Fixed story chapter reputation requirements -- now properly ascend from 10 to 1050 across all 25 chapters (was incorrectly descending from 475 to 5)
- All 4 family storylines corrected: Torrino, Kozlov, Golden Dragon, Cartel del Sol
- Fixed gang member nickname quotes breaking operation/training select menus

## [1.35.3] - 2026-03-11

### UI & Gang Operations
- Gang operations now show progress bars with countdown timers and completion percentage
- Roster member cards display the active operation name instead of generic status
- Crew detail view shows operation name and progress bar for members on ops
- Moved Training Gym from Player Stats tabs to SafeHouse grid
- Removed City Policies button from the Turf screen

## [1.35.2] - 2026-03-11

### Code Quality
- Resolved all ESLint errors across the codebase (1123 -> 0)
- Fixed roleLabels/roleColors out-of-scope bug in heist result popup
- Removed duplicate job_result case in multiplayer message handler
- Updated ESLint config with proper multiplayer.js overrides and globals
- Auto-fixed quote style to single quotes across all JS files
- Fixed unused variable warnings in casino.js, miniGames.js, mobile-responsive.js, server.js

## [1.35.1] - 2025-07-11

### Gang Operations
- Expanded gang operations from 4 to 12 with strictly ascending reputation requirements (0-800)
- New operations: Street Shakedown, Getaway Job, Money Skim, Convoy Hijack, Sting Reversal, Assassination Contract, Bank Vault Job, Empire Takeover
- Operations now visually locked until player meets reputation threshold
- Added server-side reputation guard to prevent bypassing operation locks via console

## [1.35.0] - 2025-07-11

### Bug Fixes
- Fixed stash durability divide-by-zero crash
- Fixed bullet purchase refund crash (missing try-catch)
- Fixed fence heat NaN when heat is undefined
- Fixed gang power using 3 different formulas (unified to `recalculatePower`)
- Fixed enforcer/bruiser role check using wrong role names
- Fixed betrayal cooldown only checking 30 minutes instead of 10
- Fixed training config crashing on undefined tier
- Fixed UI event listener memory leak (added cleanup system)
- Fixed EventBus swallowing errors silently (now logs with console.error)
- Fixed forensics skill description being wrong

### Economy
- Money laundering capped at 85% conversion with heat-based jail risk
- Lowered tribute base (200 -> 150, 50/territory -> 35)
- Business cards now show hourly income rate and pending amount

### Jobs
- Car theft base find chance raised to 25%
- Extreme and Legendary jobs now offer Loud/Quiet approach choice
- Job failure now has consequences (heat, HP loss, cash loss)
- Money laundering now requires owning a business front
- Bank jobs yield 60/40 clean/dirty split; counterfeiting yields all dirty + intelligence bonuses

### Gang
- All role references migrated to expanded role names
- Added Back-Alley Clinic hospital property (reduces gang heal time, passive 1 HP/min per level)
- Gang operations now have difficulty tiers: Small Job, Standard, Big Score

### Territory
- Added income breakdown display (base, fortification, heat penalty, enforcers, milestones, reputation)

### Casino
- Added gambling luck percentage display next to wallet
- Rebalanced horse racing probability formula to better match displayed odds

### Mini-Games
- Removed daily play limits and cooldowns
- Added persistent win/loss/earnings stat tracking
- Removed Training Gym from main menu (still accessible via Player Stats)

### Multiplayer
- Added bounty expiration WebSocket notification with refund toast

### UI
- Modal accessibility: role=dialog, aria-modal, aria-labelledby, focus trapping, Escape to close
- Added aria-label to newspaper close buttons
- Added visible focus indicators on close buttons and modal buttons
- Added safe-area-inset-bottom padding for mobile quick actions bar
- Increased modal body max-height for better content visibility
- Stash tab now remembers last selected tab (Stash vs Motor Pool)

### Narration
- Added weather fallback guards in getActiveEffects() and buildEventsTabHTML()
- Server weather now validated against known weather types before applying
- World atmosphere notifications now display to player via toast (were previously invisible)
- Family atmosphere narrations now blend into world narration (40% chance)
- Added narrative flavor text to Empire Overview based on territory, gang size, and family

## [1.34.2] - 2026-03-11

### Fixed
- **Scroll reset bug** -- timer-driven refreshes (5s/30s) no longer reset scroll position on the Family, Black Market, or crew details screens
- **Operation start button** -- gang screen refresh no longer wipes dropdown selections while picking an operation or training target
- **Mobile select styling** -- select dropdowns now have 16px font (prevents iOS zoom), larger padding, and themed dark/gold styling

## [1.34.1] - 2026-03-10

### Added
- **Top Don policy budget system** -- 30-point budget with tradeoffs; favorable policies (lower taxes, crime bonuses) cost points, harsh policies (higher taxes, longer jail) earn points back
- **Submit Policy button** -- replaces individual per-policy Set buttons; all changes validated and applied at once with budget check
- **Policy newspaper** -- broadcast to all players when the Top Don submits new policies, with randomized headlines and reaction paragraphs
- **Collect Tribute button** -- added to Territory overview screen with ready/cooldown visual state
- **City Policies viewer** -- new button on Territory screen lets all players view active Top Don policies with favorable/harsh indicators

## [1.34.0] - 2026-03-10

### Added
- **Tribute ready notifications** -- gang tribute and turf tribute buttons now show a red dot when ready; SafeHouse menu badges light up for The Family and Territories
- **Tribute cooldown timers** -- tribute buttons grey out and display remaining time while on cooldown
- **Bookie turf tribute** -- bookie service now auto-collects turf tribute alongside businesses and gang tribute
- **Superboss cooldown timers** -- boss list displays power stats and per-boss 1-hour cooldowns
- **Superboss wipe mechanic** -- all participants downed by cumulative boss damage triggers a full wipe

### Changed
- **Superboss rebalance** -- massively increased HP (75K-500K) and power (12K-50K), reduced rewards ($500K-$5M), capped player attack power at 5,000 per hit, crit chance lowered to 10% with 1.5x multiplier
- **Boss counter-attacks** -- boss damage no longer divided by participant count; visible hit notifications shown to players; scaling down chance from 15% to 50% based on cumulative damage taken

### Fixed
- **Bookie notification types** -- bookie messages now use correct notification types instead of raw numbers
- **Turf heat display** -- removed "/100" from heat display, heat reduction is a flat $20,000 cost

## [1.33.9] - 2026-03-10

### Fixed
- **Side ops respect order** -- side operations now listed in correct ascending respect requirement order (The Code 10, Informant Network 25, Safe Houses 50, King of the Night 75, Ghost Money 100)

### Added
- **Death screen flavor text overhaul** -- expanded from 5 generic death messages to 35 variations across 6 categories (combat, job, hit, turf, executed, generic), auto-detected from cause of death
- **Death newspaper rewrite** -- headlines, subheads, openings, and body paragraphs are now context-aware with unique pools per death type (combat, job, hit, turf, laundering, car theft, executed, generic)
- **Jail newspaper expansion** -- doubled headlines per tone (10 funny, 8 serious, 7 breaking), added 8 subheads per tone, expanded detail/sentence paragraphs to 4-5 per tone with randomized selection, and added 7 randomized footer quotes

## [1.33.7] - 2026-03-10

### Added
- **Training prerequisite display** -- training programs now show stat requirements in the Training tab cards and the roster training prompt, with color-coded current/required values
- **Enroll prerequisite check** -- enrolling from the Training tab now validates prerequisites and shows exactly which stats are too low

### Fixed
- **Stolen painting FBI reward** -- side ops event payout lowered from $10M to $100K

## [1.33.6] - 2026-03-10

### Fixed
- **Title screen version overlap on mobile** -- version number and Privacy/Terms links are no longer absolute-positioned; they now flow naturally at the bottom of the intro content so they don't overlap other elements on small screens

## [1.33.5] - 2026-03-10

### Added
- **Turf defender assignment** -- manage screen now lets you assign/recall crew members to defend owned turf zones (+20 defense each), with a dropdown of available members and recall buttons for stationed defenders
- **Jailbreak screen crew section** -- the Underground Network breakout screen now shows your arrested crew members at the top with break-out buttons, cost, and success chance
- **Jail screen crew section** -- when locked up, you can see which of your crew are also behind bars (with time remaining)
- **`breakoutGangMember` screen awareness** -- breaking out crew now refreshes whichever screen is active (jailbreak, jail, or gang roster)

### Fixed
- **Mobile tab overflow on Family screen** -- Operations tab no longer collides with Training tab on small screens; added tighter font/padding at 480px breakpoint with overflow protection

## [1.33.4] - 2026-03-10

### Fixed
- **Jail breakout race condition** -- breaking out of jail (breakout, bribe, gang rescue) no longer gets overwritten by stale multiplayer sync; server now accepts client-synced jail releases, and a 10-second grace period prevents world_update from re-jailing freed players
- **Server jail release blocking** -- `handleJailStatusSync` on the server no longer blocks legitimate jail release syncs from breakout/bribe/rescue

### Added
- **Intro screen game pitch** -- new players now see a tagline and 4 feature highlights (Jobs & Heists, Build Your Empire, Live the Life, Multiplayer) before signing up, selling them on the game before account creation

## [1.30.0] - 2026-03-08

### Changed -- Server-Only Saves
- All game saves now stored on the server via MongoDB -- localStorage slots removed entirely
- Settings panel simplified to three buttons: **Save**, **Load**, **Burn Records**
- New **Burn Records** modal with two options: Reset Profile (wipe save, keep account) or Burn Everything (delete account and all data)
- Removed old slot-based save system (11 slots), export/import, and local-vs-cloud save comparisons
- `initAuth()` now loads directly from cloud without checking localStorage timestamps
- `autoCloudSave()` failure message updated (no more "saved locally only" reference)
- Cleaned up ~25 removed functions and their window globals from game.js

## [1.28.0] - 2025-06-06

### Changed — Heat Terminology Unification
- **All "Wanted Level" references renamed to "Heat"** across every file for consistent terminology
- Player property `wantedLevel` renamed to `heat` in player.js, game.js, multiplayer.js, server.js
- Job property `wantedLevelGain` renamed to `heatGain` in jobs.js and game.js
- EventBus event `wantedLevelChanged` renamed to `heatChanged`
- Functions `resetWantedLevelCourtHouse` and `adminClearWanted` renamed to `resetHeatCourtHouse` and `adminClearHeat`
- Stats property `highestWantedLevel` renamed to `highestHeat`
- **Save migration** automatically converts old `wantedLevel` saves to `heat` on load

## [1.27.1] - 2025-06-05

### Changed — World Chat Tabs & Admin Detection Fix
- **World Chat channel tabs** — Crew, Alliance, and Private channels are now accessible directly from the World Chat screen without visiting The Commission
- **Admin detection on session restore** — Admin status is now checked when a saved session is restored, not only on fresh login
- **Death newspaper fallback** — Clicking a death announcement in World Chat now falls back to the local obituary or shows a message if the data is unavailable

## [1.17.0] - 2026-03-06

### Added — Gang Member Operations
- Gang members now have a real XP/leveling system (levels 1-10 with XP bars on member cards)
- Assign gang members to manage businesses for 15-40% income boost based on member level
- Idle (unassigned) members earn passive dirty money from street hustles each cycle
- Members gain XP from operations, passive work, and level up with +1 to all stats and +2 power
- Small 2% arrest risk during idle hustling adds stakes to leaving members unassigned

### Added — Skill Tree Specialization
- 6 cross-tree synergy bonuses unlocked by investing 10+ points in two connected trees
- Synergies: Silent Killer, Iron Warrior, Ghost Protocol, Mastermind, Silver Tongue, Survivor
- Soft cap: skill ranks above 7 cost 2 skill points instead of 1 (diminishing returns)
- Synergy progress panel added to skill tree UI showing active/locked status

### Added — Side Operations Tab
- New "Side Ops" tab in the Operations screen between Story and Superboss
- Surfaces all side quests inline with active timers, available, locked, and completed sections
- Integrated with existing quest timer tick system for live countdowns

### Added — Jail System Revamp
- Escape odds displayed as visual bar with full breakdown (base + stealth + perks + synergies)
- Gang rescue operation: send your crew to break you out (20% base + 10% per available member)
- Failed rescue arrests 1-2 crew members and extends your sentence by 15 seconds
- Survivor synergy (Endurance + Luck) boosts breakout chance by up to 18%

### Fixed
- collectAllBusinessIncome now applies gang member manager bonus (was only applied to single collection)
- Old save files with fractional experienceLevel cleaned up on level-up
- Gang rescue arrest loop no longer picks the same member twice

## [1.16.1] - 2026-03-05

### Fixed — Encoding Bug Fixes
- Fixed 620 mojibake characters in missions.js story text across all 4 crime families (corrupted em dashes → proper `—`)
- Fixed 2 corrupted `omertà` spellings in missions.js
- Fixed 68 broken replacement characters in multiplayer.js — restored em dashes and diamond separators
- World Chat status bar now displays proper `◆` diamond instead of `?`

## [1.16.0] - 2026-03-05

### Changed — UI Consolidation & Cleanup
- **Back Room → Casino tab** — PvP gambling moved from standalone screen into the Casino as a third tab
- **Crew → Commission tab** — Crew screen consolidated into The Commission hub
- **Friends → Commission tab** — Friends & Social moved from standalone SafeHouse button into The Commission as a tab
- **Superboss → Operations tab** — Superboss fights moved into Operations screen as a secondary tab alongside Story
- **Dark Board removed** — entire Dark Board system removed; anonymous bounty option added to Bounty Board at 2x cost
- **Broken emoji fix** — replaced all 26 broken `??` placeholder emojis across multiplayer systems with correct Unicode characters
- **Friends SafeHouse button removed** — Friends now accessed exclusively via The Commission → Friends tab
- **Commission tab bar** — now has 9 tabs: Overview, PVP, Territories, Politics, Activities, Crew, Friends, Market, Chat
- **Tutorial tips updated** — contextual help entries reflect new tab locations for Friends, Crew, Casino, and Superboss

## [1.15.0] - 2026-03-04

### Added — Massive Story Expansion
- Each crime family now has **25 chapters** (up from 8) — 100 total story missions
- New 5-act structure per family: deeper narrative arcs with more boss fights, choices, and character development
- Torrino: "Blood & Honor" — 5 acts (The Streets, Made Man, The Inner Circle, Blood Ties, The Succession)
- Kozlov: "Iron & Ice" — 5 acts (The Proving Ground, Blood Brothers, Viktor's Shadow, The Fracture, The Coup)
- Chen: "Shadow & Silk" — 5 acts (The Test, The Dragon's Mark, The Inner Sanctum, The Long Game, Checkmate)
- Morales: "Fire & Blood" — 5 acts (La Prueba, Soldado, El Teniente, Sangre y Fuego, La Corona)
- Rank progression redistributed: Soldier@ch7, Capo@ch13, Underboss@ch19, Don@ch25
- 3-4 boss fights per family with unique dialogue (intro/victory/defeat)
- 13-15 meaningful player choices per storyline
- Smooth objective scaling from ch1 (5 jobs, $1K) through ch25 (90 jobs, $250K, L35, 15 gang, 5 properties, 80 rep)

## [1.14.2] - 2026-03-04

### Added — Vehicle Condition Job Bonus
- Equipped vehicle condition (durability %) now contributes to job success chance
- Formula: `power × 0.5 × (durability / maxDurability)` — damaged vehicles give less bonus
- Inventory vehicle cards now display Condition label (Excellent/Good/Worn/Critical) and Job Success bonus
- Equip log message shows the vehicle's current job success percentage

### Changed — Mini Game Balance
- Removed XP rewards from all 6 mini games: TikTakToe, Number Guessing, Rock Paper Scissors, Memory Match, Snake, Quick Draw
- Mini games now award cash, stamina, and combat reflex bonuses only
- Updated Memory Match reward text from "Stealth & Planning XP boost" to "Cash bonuses for speed & personal bests"
- Updated Snake reward text from "Stamina & Endurance boost" to "Cash & Stamina boost"

## [1.14.1] - 2026-03-04

### Fixed — Audit & Dead Code Cleanup
- Added `_safeUpdateUI` / `_safeLogAction` wrappers in multiplayer.js to guard against race conditions
- Replaced all bare `updateUI()` / `logAction()` calls with safe typeof-guarded wrappers
- Removed ~440 lines of dead server code: `handleTerritoryClaim`, `handleTerritoryClaimOwnership`, `handleWarBet`, `handleSiegeDeclare`, `notifySiegeDefender`, `handleSiegeFortify` + associated constants
- Removed 5 dead switch cases from server message routing
- Removed dead client handlers: `territory_claim_ownership_result`, `war_bet_result`
- Wired `job_result` client handler for future server-authoritative job processing
- Cleaned unused exports: `storyCampaigns`, `turfMissions`, `bossBattles` (missions.js)
- De-exported internal-only symbols: `NPC_TERRITORY_BOSSES`, `getLaunderingMultiplier`, `getDistrictIds`, `buildInitialTerritoryState` (territories.js)
- De-exported unused `resetCasinoWins` (casino.js)

### Changed — Content Updates
- Updated help guide & tutorials: Player Market descriptions now reflect all item types (vehicles, weapons, armor, ammo, gas, utility, trade goods)
- Fixed README: corrected district count from 12 to 8, updated rival system description, refreshed Recent Changes section
- README now mentions unified Player Market in Multiplayer features

## [1.14.0] - 2026-03-04

### Changed — Unified Player Market
- **Merged Vehicle Marketplace & Ammo Exchange** into a single **Player Market**
- Players can now list **vehicles, weapons, armor, ammo, gas, utility items, and trade goods** all in one place
- Unified server handlers: `market_list`, `market_buy`, `market_cancel`, `market_get_listings`
- Single `playerMarket` data store replaces separate `marketplace` and `ammoMarket` arrays
- Legacy `ammo_market_*` messages auto-forwarded to unified handler for backwards compatibility
- Old vehicle/ammo persistence migrated automatically on first load
- Black Market store tab tooltip and Player Market feature list updated for all item types
- Garage "Player Market" button preserved as convenience shortcut

## [1.13.0] - 2026-03-04

### Added — Mobile & QoL
- **Inline job requirements** — reputation, required items, jail chance, damage, and wanted gain now shown directly on job cards (no hover needed)
- **Requirement indicators** — green \u2713 for met, red \u2717 for unmet requirements
- **Gang operation countdowns** — live timer on operations panel and member status cards
- **Gang training countdowns** — live timer shown next to "In Training" status
- **Cooldown display** — operations show remaining cooldown time after completion
- **Gang screen auto-refresh** — timers update every 5 seconds while viewing gang screen

### Fixed — Gang Operations & Training
- **Operations/training survive reload** — pending timers resume on save-load with correct remaining time
- **Cooldown system** — rewritten to use persistent timestamps (was completely broken)
- **Arrest/betrayal cleanup** — active operation data properly removed on arrest or betrayal
- **Training role check** — `startTraining()` now recognises expanded roles (bruiser, fixer, etc.)
- **Offline completion** — operations and training that finish while offline are resolved on load

### Changed — Balance
- XP curve lowered ~40% for faster levelling
- Energy regen doubled (2/tick, 30s interval, min 15s)
- Energy now regenerates while in jail
- Offline catch-up for jail timer and energy regeneration

---

## [1.12.1] - 2026-03-03

### Fixed — Save/Load System (6 issues)
- **Permadeath cloud wipe** — cloud save now deleted on death via `DELETE /api/save`; prevents resurrection by refreshing
- **Auto-save re-enabled after restart** — `restartGame()` re-enables auto-save, resets to slot 1, and re-activates gameplay systems
- **Slot 0 falsy bug** — `currentSlot || 1` changed to `?? 1` in 3 places so slot 0 is no longer treated as "no slot"
- **Session persistence** — server sessions now stored in `users.json` and restored on startup; logins survive Render cold starts
- **Cloud auto-load safety** — `initAuth()` compares timestamps; skips cloud load when local save is newer
- **Cloud save failure notification** — user-visible "Cloud save failed" warning (throttled to once per 5 minutes)

### Changed — Tutorial & Help Text
- **Permadeath messaging** — all 5 "black out" references replaced with permanent death language
- **Crime families** — "Corleone, Moretti, etc." → "Torrino, Kozlov, Chen, or Morales" (2 instances)
- **Casino games** — removed Poker, added Dice and Horse Racing in tutorial and help
- **Mini games** — replaced "Lockpicking and Number Cracking" with TikTakToe, Number Guessing, Rock Paper Scissors, Snake
- **Auto-save help** — corrected "saves to Slot 0" to "saves to your current slot"
- **Server cloud-save default version** updated to 1.12.1

## [1.12.0] - 2026-03-03

### Fixed — Bug Audit Round 3 (11 issues)
- **Deep-copy save/load** — `JSON.parse(JSON.stringify())` prevents state bleed between save slots
- **buyItem underground rep** — reputation boost now fires correctly after all purchase type branches
- **selectPortrait parsing** — handles Stylized portrait paths and strips `profile_pics/` prefix
- **Quest timer leak** — `stopQuestTimerTick()` integrated into `clearAllGameplayIntervals()`
- **hideAllScreens rewrite** — data-driven array loop covering 28 screens with null guards
- **upgradeNode double-spend** — removed duplicate 100ms setTimeout race condition
- **Courthouse null guard** — `updateCourtHouseCost()` checks resetButton exists before updating
- **PvP countdown leak** — `clearInterval` called before each new `setInterval`
- **Fence pricing cache** — `getFenceMultiplier()` cached with 60-second TTL
- **Heist double-credit** — results now use server-sent `newMoney`/`newReputation` totals
- **Vehicle marketplace rollback** — stored rollback data restored on `marketplace_error`

### Changed — UI Cleanup
- **86 bracket abbreviation icons removed** — `[WPN]`, `[ARM]`, `[VEH]`, etc. stripped from all items and factions
- **Server cloud-save default version** updated from 1.7.2 to 1.12.0

### Fixed — Mobile Responsiveness (13 issues)
- **Safehouse scroll** — removed restrictive `max-height` from `.menu-grid`; added `#safehouse` to mobile padding override
- **Store buy buttons** — flex-wrap and full-width buttons on mobile; grid collapses to single column; category tabs scroll horizontally
- **Save slot grids** — collapse to single column on mobile via `.save-slot-grid` class
- **Save management row** — full-width buttons on mobile via `.save-manage-row` class
- **Gang top grid** — collapses to single column on mobile via `.gang-top-grid` class
- **Recruitment level guide** — `repeat(auto-fit, minmax(200px, 1fr))` for small screens
- **Business/laundry/garage grids** — min-width reduced from 320-350px to 260px
- **Character showcase, gang members, training, rival kingpins** — min-width reduced from 300px to 240px
- **Level-up overlay text** — responsive `clamp()` sizing instead of fixed `6em`/`3em`
- **Blackjack cards** — `clamp(50px,15vw,70px)` width for viewport scaling
- **320px breakpoint** — padding now accounts for stats bar height with `calc()`
- **Tablet padding** — simplified to single `.game-screen` catch-all rule
- **Obituary stats** — grid collapses to 1fr at 480px breakpoint
- **Vehicle images** — responsive width with `aspect-ratio: 220/165`

## [1.11.8] - 2026-03-02

### Fixed — Skills & Buffs Audit: 6 Dead Systems Wired
- **Removed orphaned `getReputationPriceModifier()`** — never called anywhere, redundant with `getStreetRepBonus`
- **Chen `smugglingMultiplier` wired** — laundering conversion rate bonus (+4.5%) and collection payout bonus (+15%)
- **Morales `energyRegenBonus` wired dynamically** — `player.js` now reads from `getChosenFamilyBuff()` instead of hardcoded family check
- **Skill Tree Upgrades displayed** — `playstyleStats.skillTreeUpgrades` now shown in Playstyle Stats profile section
- **8 family streetRep gameplay hooks** (2 per family):
  - Torrino: sell price bonus at shops/fence + territory defense bonus
  - Kozlov: gang war power bonus + weapon price discount
  - Chen: drug/smuggling income bonus + faction mission success bonus
  - Morales: heat reduction from activities + injury chance reduction
- **Faction effects display text updated** — all 4 family faction positive/negative effect descriptions now match real implemented mechanics

## [1.11.7] - 2026-03-02

### Added — Turf System Overhaul: Milestones, Escalation & Dominance
- **Turf Milestones** — 4 progression tiers unlock at 2/4/6/8 zones with permanent perks:
  - Street Presence (2 zones): +10% XP from all sources
  - Neighbourhood Boss (4 zones): turf heat decays twice as fast
  - District Kingpin (6 zones): +15% turf income
  - City Overlord (8 zones): +25% turf income + exclusive Overlord's Scepter weapon (60 power)
- **Rival Escalation** — rival attack frequency and power now scale with zones owned (7.5% chance / 55 power at 1 zone → 25% / 160+ at 8 zones)
- **Power-Scaled Defense** — fortifications now give 25 defense per level (up from 10) and 10% of total turf power is added as passive defense to every zone
- **Family Dominance** — seize all zones of a rival family to earn a one-time bonus: $100,000 + 50 reputation + 50 power + 30 turf rep
- **Defense Breakdown panel** on the Manage screen — shows fortification contribution, defender count, power bonus, total defense, and vulnerability status
- **Rival Threat Level panel** — displays current attack chance %, attack power range, and zone vulnerability (Well Defended / At Risk / Vulnerable)
- **Turf Milestones panel** on the Territory Control screen — tracks progress toward all 4 milestones with locked/unlocked indicators
- **Family Dominance panel** with progress bars — visual tracker for eliminating each rival family's territory
- **Milestone perks wired into gameplay** — XP boost, heat decay, and income bonuses applied through centralized `gainExperience()` and income calculation
- Key XP grants (chapters, operations, jailbreaks) now route through `gainExperience()` for consistent perk application
- Updated Territory Control help topic with full documentation of all new turf systems

## [1.11.6] - 2026-03-02

### Fixed — Admin Kill & Death Newspaper
- **Admin kill triggers permadeath** — target player now sees the full death screen and newspaper when killed by an admin
- **Death newspaper broadcast** — server builds newspaper data and broadcasts it to all online players on admin kill
- **World chat announcement** — admin kills are announced in world chat as "The Daily Racketeer" with a clickable newspaper card
- **Newspaper text readability** — all newspaper body text, stats, dateline, and footer forced to pure black (#000000) with bold weight, text-shadow, and text-stroke
- **1920s visual overhaul** — Art Deco styling, warm sepia/gold color palette, Playfair Display and Special Elite fonts throughout
- **Blue color elimination** — replaced all blue/cool-toned inline backgrounds with warm period-appropriate colors

## [1.11.5] - 2026-03-01

### Changed — Safehouse UX & Ledger Filters
- **Safehouse buttons reorganized** — Operations first, then Jobs, Black Market, Stash, Doctor, Gambling, with progression unlocks after and Settings last
- **New safehouse tip** — one-time dismissible popup guides new players to start with Jobs and Operations
- **Ledger filter buttons** — All, Environment, and World Chat filters let players control what appears in the ledger
- **World Chat in ledger** — multiplayer chat messages and player connection/disconnect notices now appear in the ledger under the World Chat filter
- **Color-coded ledger entries** — gold border (environment), blue (chat), purple (online status)
- **Faction names replace abbreviations** — ITA/RUS/CHN/MEX replaced with full names: Torrino Family, Kozlov Bratva, Chen Triad, Morales Cartel across all files
- **Ethnicity added to faction data** — family choice screen now correctly shows "Italian/Russian/Chinese/South American crime family"
- **Passive log messages fixed** — removed broken flag emojis from Chen and Morales passive log entries

## [1.11.4] - 2026-03-01

### Changed — Tutorial & Help Overhaul
- **Tutorial starts after changelog** — the safehouse tutorial now automatically appears after the "What's New" changelog is dismissed on first play
- **Safehouse tutorial expanded** — 6 detailed sections covering Status Bar stats, The Ledger, Quick Actions Bar, Navigation Buttons, and Getting Started tips
- **All 13 screen tutorials rewritten** — more detail, tips, and full explanations for every screen (Jobs, Store, Missions, Gang, Properties, Casino, Stash, Hospital, Skills, Stats, Territory, Settings)
- **Help guide expanded from 17 to 21 topics** — new topics: UI Guide (HUD), Combat & Equipment, Dirty Money & Laundering, Seasons & Weather
- **Every help topic rewritten** — added sub-headings, detailed explanations, strategy tips, and complete mechanic breakdowns
- **Heat system guide** — now explains 5 granular tiers (Cool/Warm/Hot/Scorching/Inferno) with causes and reduction methods
- **Energy guide** — covers all 3 consumable types with grinding strategy tips
- **Skills guide** — explains what each of the 6 talent trees is best suited for

## [1.11.3] - 2026-03-01

### Changed — Emoji Cleanup & Faction Flag Fix
- **Removed ~65 decorative emojis** — tabs, buttons, headers, notifications, and log messages cleaned up across game.js and index.html
- **Faction flags fixed for PC** — replaced flag emojis (invisible on Windows desktop) with text abbreviations: ITA, RUS, CHN, MEX
- **Help guide icons cleared** — removed emoji icons from 15+ help topics
- **Functional emojis kept** — lock indicators, toggle checkmarks, map legend, store categories, achievements, weather, districts, leaderboards, weekly challenges

## [1.11.2] - 2026-03-01

### Added — Change Portrait from Settings
- **Change Portrait button** in Settings > Personalization section
- Portrait picker reuses gender-organized Male/Female sections from character creation
- Changing portrait also updates ethnicity and gender fields and auto-saves

## [1.11.1] - 2026-03-01

### Changed — Profile Picture Organization
- **Portrait grid organized by gender** — Male and Female sections with clear headers
- Both portrait selection screens (new game + settings) use gender-sorted layout
- Portrait grid CSS updated for responsive columns (6-col desktop, 3-col tablet, 2-col phone)

## [1.11.0] - 2026-03-XX

### Changed — Omerta-Style Economy Rebalance
- **Energy regen slowed** — 45s base interval (was 20s), min 25s (was 10s). Full refill ~75 min.
- **Job energy costs increased** — Street Soldier 3 (was 1), Boost a Ride 8 (was 5), Store Heist 14 (was 10), all others +20-30%
- **Early job payouts reduced** — Street Soldier $40-180 (was $60-300), Store Heist $800-2,200 (was $1,200-3,000), Protection $500-1,400 (was $600-1,600)
- **XP curve steepened ~50%** — formula now `level*600 + level²*120 + level³*8` (Level 1: 728 XP, Level 10: 20,000 XP)
- **XP rewards reduced** — low: 2, medium: 4 (was 6), high: 10 (was 14), very high: 16 (was 22), extreme: 25 (was 35), legendary: 40 (was 50)
- **Reputation gains slowed ~40%** — low: 0.2 (was 0.3), medium: 0.3 (was 0.5), high: 0.6 (was 1.0), etc.
- **Hospital costs increased** — full heal $25/HP (was $10), patch $20/HP (was $8), rest 25 energy for 12 HP (was 20 energy for 15 HP)
- **Store prices increased ~30%** — Brass Knuckles $10K (was $7.5K), Pistol $40K (was $30K), Tommy Gun $200K (was $150K), all armor/vehicles up
- **Energy items 2.5x more expensive** — Coffee $2,500 (was $1K), Energy Drink $6K (was $2.5K), Steroids $10K (was $4K)
- **Utility items increased** — Lockpick $15K (was $10K), Police Scanner $50K (was $35K), Fake ID $35K (was $25K)
- **Trade goods increased** — Moonshine $75K (was $60K), Mary Jane $150K (was $120K), Cocaine $250K (was $200K)
- **Property income halved** — Basement Hideout $250/cycle (was $500), Private Island $8K (was $15K)
- **Business income halved** — all 9 business types base income reduced 50%
- **Passive income reduced** — gang members $25/cycle (was $50), territory $100 (was $200)
- **Casino min bet $100** — all games now enforce $100 minimum (was $1)
- **Failure XP reduced** — 1 XP on job failure (was 2)

## [1.8.4] - 2026-03-01

### Changed
- **Black Market restructured** — now has 3 top-level tabs: Buy, The Fence, and Player Market
- **Fence merged into Black Market** — no more separate Fence screen; fence functionality lives under the Fence tab
- **Player Market tab added** — trade vehicles with other players directly from Black Market
- Fence sell functions now use Heat (Wanted Level) instead of the removed Suspicion system
- `getFenceMultiplier()` heat penalty now based on `wantedLevel`

### Removed
- Fence nav sidebar button — one fewer menu button
- ~400 lines of commented-out dead code (old suspicion / FBI investigation block)
- `suspicionTimer` / `fbiTimer` references in event timer system
- `fence-screen` div from HTML

## [1.8.3] - 2026-03-01

### Changed
- **Suspicion system removed** — all suspicion gains now route through the existing Heat (Wanted Level) system
- **Motor Pool merged into Stash** — new Stash & Motor Pool screen with tabs
- **Skills/Expertise merged into Stats** — Stats screen now has 6 tabs

### Removed
- FBI Investigation popups, suspicion timers, and suspicion-based consequences
- Expertise and Motor Pool nav buttons — fewer buttons, less clutter
- 'c' and 'k' keyboard shortcuts (now accessed through Stash and Stats tabs)

## [1.8.2] - 2026-03-01

### Changed
- **Stats screen consolidation** — Empire Rating & Empire Overview merged into Player Stats as tabs (5 tabs: Player Stats, Career Statistics, Character Showcase, Empire Rating, Empire Overview)
- **Properties screen consolidation** — Business Fronts merged into Properties as a Fronts tab (2 tabs: Properties, Fronts)
- **Gambling screen consolidation** — Mini Games (Pastimes) merged into Gambling as a Mini Games tab (2 tabs: Gambling, Mini Games)
- Reduced nav menu clutter — 3 fewer sidebar buttons (Empire Rating, Fronts/Businesses, Pastimes removed)
- Mobile nav casino label renamed from "Casino" to "Games"

### Removed
- **Popup random events** — interactive event modals (STREET_STORIES + INTERACTIVE_EVENTS) no longer fire on timer
- **FBI investigation popup chain** — suspicion timer and FBI escalation timer disabled
- Old `mini-games-screen` HTML (content moved into `casino-screen`)

## [1.8.1] - 2026-03-01

### Added
- **Political System** — Top Don (player/alliance with most territories) can set 5 server-wide policies: worldTaxRate, marketFee, crimeBonus, jailTimeMod, heistBonus
- **Alliance Discipline** — leaders can warn, fine, demote, or kick members with full audit logging
- **Energy items in mobile navbar** — quick access to energy consumables from bottom nav

### Fixed
- Gang member dismissal now calls `recalculatePower()` — previously referenced non-existent `recalculateGangPower()`
- Political worldTaxRate above 10% now works — server computes business tax authoritatively from grossIncome instead of trusting client-sent taxAmount
- Client business tax display uses server-synced political tax rate instead of hardcoded `BUSINESS_TAX_RATE`

### Removed
- Dead `const TAX_RATE = 0.10` from server.js (replaced by dynamic political rate)
- Dead `export const TAX_RATE` from territories.js (never imported)
- Stale TODO comments about updating TAX_RATE dynamically

## [1.8.0] - 2026-03-01

### Added
- **Unified RPG Talent Tree** — replaced basic skills and old skill trees with a single talent tree system across 6 branches (Muscle, Stealth, Business, Street Smarts, Leadership, Racketeer)
- **16 Street Story encounters** — rich random events with dialogue, scene-setting, and branching choices (old debts, journalist, FBI approach, funeral, wedding, hospital visit, dock strike, etc.)
- **5 Multi-Step Side Quest chains** — Informant Network, Safe Houses, Ghost Money, Code of Honor, Nightlife Empire — each with 3 progressive steps and escalating rewards
- **4 Post-Don Endgame Story Arcs** — The Successor, The Commission, The Reckoning (RICO), Legacy — unlocked by reputation thresholds
- **Level milestone narrations** at levels 5, 10, 15, 20, 25, 30 with immersive story overlays
- **Atmospheric world narrations** — 16 dynamic street atmosphere texts displayed on a rolling timer
- **Family-specific narrations** — Torrino, Kozlov, Chen, and Morales families now have unique job success/failure/atmosphere flavour text
- **storyExpansion.js** — new central content module for all story expansion content
- **Side quest UI system** — full screen with active/available/locked/completed quest views and progress bars

### Changed
- Re-enabled interactive events system with expanded event pool (original 5 + 16 street stories) and deduplication
- Job success/failure narrations now use family-aware text when player has chosen a family
- Post-Don epilogue screen expanded with endgame arc cards and side operations access
- Interactive event descriptions now render as multi-paragraph formatted text
- Story chapter view now includes Side Operations button

## [1.7.6] - 2026-03-01

### Changed
- **README.md** fully updated to v1.7.6 — removed mentions of loans, mentors, loyalty, perks; added current features (laundering, horse racing, vehicle system, weather)
- Cleaned stale onboarding/tutorial references from mobile nav customizer
- Updated Recent Changes section to reflect phases 25-31

## [1.7.5] - 2026-03-01

### Removed
- **Mentorship Program** — potentialMentors data, startMentoring(), checkMentorDiscovery(), mentor capture in gang wars, Mentors expertise tab
- **Expertise Perks System** — availablePerks data (11 perks), all perk effect checks (mastermind, fearMonger, shadowWalker, ghostProtocol, warMachine, streetSmart, fortuneSon, masterTeacher), Perks expertise tab, checkForNewPerks(), unlockPerk(), applyPerkEffects()
- **Gang Loyalty System** — loyalty stats from all 7 specialist roles, loyalty bars/buttons in crew UI, loyalty calculations in gang power/operations/betrayal/tribute, boostMemberLoyalty(), getAverageLoyalty(), updateMemberLoyalty(), dealWithDisloyalty(), loyalty_building training program, 35+ change areas cleaned
- **Loan Shark System** — showLoanShark(), takeLoan(), repayLoan(), checkLoanEligibility(), loanOptions data (4 loan types), Shylock SafeHouse menu entry, loan-shark-screen HTML

### Changed
- **Gang Member Death Rates Increased** — Turf defense death chance 10%→25%, turf expansion losses 1-3→2-5 members, gang war defeat losses 30%→45% of gang
- Gang operations now have 8% chance of member death (previously only arrest/betrayal)
- Turf defense victories now 25% chance of injury/death with 30% death sub-chance (was 15% injury only)
- Expertise screen now has 3 tabs: Basic Skills, Skill Trees, Reputation
- Faction selection text updated ("unique perks" → "unique advantages")
- Jailbreak description updated ("builds loyalty" → "earns respect")

## [1.7.4] - 2026-03-01

### Fixed
- **PowerShell Corruption Repair** — fixed 6 corrupted emoji expressions in multiplayer.js PvP result popup
- **dismissMember() Ghost Bug** — members now properly removed from array instead of just flagged, counter synced
- **137 bare alert() converted** to themed `showBriefNotification()` toasts with danger/success/warning classification
- **3 bare confirm() converted** to themed `ui.confirm()` modal dialogs (territory functions made async)
- **3 fragile gangSize calculations** fixed to use `gangMembers.length` directly
- **Dead legacy alert override function** removed (superseded by showBriefNotification)

## [1.7.3] - 2025-06-14

### Added
- **Territories SafeHouse Button** — new "Territories" button in the SafeHouse (unlocks at Level 5) to manage all owned territories from one screen
- **Territory Management Screen** — shows all owned SP Turf Zones (from Turf Wars) and MP Online Districts with stats: income, fortification, defense rating, tax revenue, residents list
- **Territory Summary Dashboard** — at-a-glance stats showing total territories, turf zones, online districts, total residents, and tax revenue
- **Alliance Territories Tab** — new "Alliance Territories" tab in the Alliance panel showing all districts owned by alliance members collectively
- **Alliance Territory Stats** — summary bar in alliance territories tab showing districts held, total residents, total tax revenue, and number of territory holders
- Server now includes alliance territory data in `alliance_info_result` response for faster initial load
- Territory info auto-refreshes when server sends updated territory data

## [1.6.9] - 2026-02-28

### Added
- NPC rival bosses control all 8 territories by default — players must fight to take over
- 8 themed NPC boss names (Vinnie 'The Rat' Morello, Don Castellano, Nikolai 'The Bear' Volkov, etc.)
- RIVAL BOSS badge on NPC-owned territories with distinct brown styling
- Scaled NPC defense per district difficulty (80–200 base defense rating)
- Persistence migration — existing unclaimed territories automatically get NPC bosses on server start

### Fixed
- Challenge button now sends correct `territory_war` message (was sending old `territory_claim` to wrong handler)
- Client-side gang member & energy pre-validation before sending war challenge

### Changed
- Territories help text updated to reflect NPC-first design
- No territories start unclaimed — Claim button never appears, only Challenge

## [1.6.8] - 2026-02-28

### Added
- Horse Racing casino game — 6 horses with different odds (2x–12x), animated racetrack, adjustable bets ($10–$50k)

### Changed
- Leaderboard tab label from "Turf" to "Territories"
- District explorer button from "Claim Turf" to "Claim Territory"
- Chat tab placeholder from "Loading street news..." to "Loading activity..."

### Removed
- Turf Wars (dead feature — gang wars array was always empty, never triggered)
- Street News / City Events system from Activities tab
- Objective tracker sidebar ("Current Objective" section in bottom-right)
- Onboarding tutorial system disabled (initOnboarding / updateTracker calls removed from game.js)
- spectateWar() animated battle/betting modal (~230 lines)
- showGangWars() and showCityEvents() functions from multiplayer.js

## [1.6.7] - 2026-02-28

### Added
- Black Market now has 8 category tabs (All, Consumables, Weapons, Armor, Tools, Vehicles, Luxury, Special) for easier browsing

### Fixed
- Black Market no longer resets scroll position after purchasing an item
- Jail timer now syncs from server authority, preventing early releases in multiplayer
- Rebalanced energy items: Coffee $1,000/15E, Energy Drink $2,500/30E, Steroids $4,000/60E

### Removed
- Removed redundant walkthrough tutorial system from game.js (onboarding.js preserved)
- Removed ~200 lines of dead respect/relationships UI code (showRelationshipsScreen, renderRelationship, formatTargetName)
- Removed stale respect system config flags (respectSystemEnabled, respectDecayRate)
- Removed clearTutorialHighlights() and dead tutorial-prompt-screen cleanup code
- Updated "tutorial" references to "onboarding" in mobile nav customizer

## [1.6.5] - 2026-02-27

### Fixed
- Delete save from Settings now correctly returns to the title screen
- `returnToIntroScreen()` rewritten to use `hideAllScreens()` for comprehensive cleanup
- `confirmDeleteSave()` wrapped in try-catch so errors can't silently prevent redirect

### Added
- Server health ping during loading — game stays on loading screen while Render server wakes from sleep
- "Waking up the server..." status message shown during cold start, with 30-second timeout fallback

### Changed
- Operations unlocked from level 0 (was level 3)
- Updated tutorial "Progressive Unlocks" step to match actual unlock levels
- Updated README version and recent changes section

## [1.6.4] - 2026-02-27

### Fixed
- Fixed PVP and Online World screens breaking after visiting World Chat
- World Chat was replacing the entire multiplayer-screen innerHTML, destroying the multiplayer-content div
- World Chat now correctly renders inside multiplayer-content and restores it if missing

## [1.6.3] - 2026-02-27

### Removed
- Removed unused respect-based relationship system (initializeRespectSystem, modifyRespect, calculateRespectEffects, processRespectDecay)
- Removed legacy redirect stubs (generateCampaignHTML, generateFactionMissionsHTML, generateBossBattlesHTML, territory redirect functions)
- Removed corresponding window.* assignments for deleted functions

### Changed
- Consolidated duplicate Character Showcase — showCharacterShowcase() now reuses buildCharacterShowcaseHTML()
- Consolidated duplicate Save/Load slot card templates into shared renderLoadSlotCards() helper
- showRecruitment() now uses hideAllScreens() instead of 9 manual getElementById calls

## [1.6.2] - 2026-02-27

### Fixed
- Fixed SafeHouse header clipping when stats bar wraps to multiple rows
- All screen headers, sidebars, and content padding now adapt to actual stats bar height

### Changed
- Replaced 31 hardcoded `44px` references with dynamic `--stats-bar-h` CSS variable
- Added `ResizeObserver` on stats bar to keep layout in sync

## [1.6.1] - 2026-02-27

### Fixed
- Removed duplicate "Back to SafeHouse" button from Stash screen
- Fixed Fence screen header clipping — added section header and page-nav
- Added null safety to all multiplayer DOM lookups (prevents console errors when elements missing)

### Changed
- Unified all Pastimes play buttons to consistent gold style matching Number Hunter
- Merged Crew Details into Family screen via "Manage Crew" button (removed redundant SafeHouse entry)
- Standardized 25+ inline back buttons across all screens to unified `nav-btn-back` class

## [1.6.0] - 2026-02-27

### Added
- **Turf System Overhaul** — complete replacement of SP territory system with 8 unique zones: Little Italy, Redlight District, Chinatown, Harbor Row, The Slums, Midtown Heights, Old Quarter, The Sprawl
- **Rival Families** — 4 crime families (Torrino, Kozlov, Chen, Morales) each with unique gameplay buffs
- **Family Allegiance** — choose which family to side with and rise through ranks from Associate to Don
- **Turf Missions & Boss Fights** — new mission chains tied to each zone, with boss encounters for turf control
- **Family Rank Progression** — earn promotions through reputation, missions completed, and zones controlled

### Fixed
- Critical missing comma in player.js that caused SyntaxError on game load
- 13 broken `addLog()` calls replaced with correct `logAction()` function
- Removed ~218 lines of duplicate function definitions (manageTurfDetails, fortifyTurf, etc.)
- `getRiskColor` now handles 'extreme' and 'very high' risk levels correctly
- Territory rewards properly route through turf system instead of being silently overwritten by updateUI()
- `startTurfMission` now correctly adds conquered zones to player.turf.owned
- Territory dispute event uses turf system checks instead of legacy counter

### Changed
- All SP "Territory" labels renamed to "Turf" across UI, missions, narration, and empire overview
- Mission IDs updated to match new TURF_ZONES (harbor_row_expansion, midtown_expansion, etc.)
- Cross-file references updated in missions.js, narration.js, empireOverview.js, index.html

## [1.5.9] - 2026-02-26

### Added
- **Status Bar customisation** — new section in Settings lets players toggle visibility of every HUD stat (Cash, Health, Energy, Heat, Rank, Dirty Money, Suspicion, Influence, Turf, District, XP, Skill Points, Season, Weather)
- Preferences stored in localStorage and applied on every UI update and game load

### Removed
- **Interactive random encounters** — disabled the popup events system (police raid choice, rival scandal / blackmail, arms deal, betrayal rumor, witness problem) that interrupted gameplay

## [1.5.8] - 2026-02-26

### Added
- **Durability system** — weapons, armor, and vehicles now have durability that degrades with each job, mission, or battle; items break when durability reaches 0
- **One-of-each limit** — players can only own one of each specific weapon, armor, or vehicle at a time
- **Vehicle equipping** — vehicles can now be equipped/unequipped from inventory, contributing power when equipped
- **Durability bars** — inventory screen shows visual durability indicators with color-coded health (green/yellow/red)
- **Equipment info in stats** — stats display now shows equipped item durability alongside power
- **Store "Already Owned"** — purchase buttons disabled for equippable items already in inventory

### Changed
- **Power system overhaul** — power is now calculated from equipped items + real estate + gang members only; unequipped inventory items no longer contribute power
- **Item type unification** — all guns now use type "weapon" (was "gun"), all cars now use type "vehicle" (was "car")
- **Equipment stores objects** — equipped weapon/armor/vehicle now store the full item object instead of just the name string
- **All `player.power` manipulations** replaced with centralized `recalculatePower()` function

### Fixed
- **Stats display** — equipment section now correctly reads item objects instead of treating strings as objects
- **Achievement check** — removed obsolete `type === 'gun'` check (now just "weapon")
- **Save migration** — old saves automatically get durability values, fixed types, and migrated equipped items from strings to objects

## [1.5.7] - 2026-02-26

### Added
- **Admin Panel** — server-verified admin controls in Settings with quick grants, stat editing, jail controls, and skill management (replaces old cheat system)
- **UI Toggles** — checkboxes in Settings to show/hide Quick Actions Panel and Mobile Nav Bar; preferences saved in localStorage

### Changed
- **Mission economy rebalance** — all mission rewards reduced ~90% for a slower grind (story campaigns, faction ops, territory conquests, boss battles, and objective targets)
- **Version sync** — gameVersion in cloud saves now uses the `CURRENT_VERSION` constant instead of hardcoded strings; updated package.json, server default, README, and CHANGELOG

### Fixed
- **Mobile nav on PC** — nav bar no longer appears on desktop after skipping tutorial (added mobile/tablet guard)
- **Admin panel visibility** — admin flag now set immediately on login/register via client-side fallback; showOptions refreshes admin status asynchronously

## [1.5.5] - 2026-02-26

### Fixed
- **Emoji encoding** — fixed ~920 lines of corrupted emoji characters (double-encoded UTF-8 mojibake) displaying as garbled symbols
- **Check for Updates** — now uses `fetch(asset, { cache: 'reload' })` on all 25+ game files to properly bust the browser HTTP cache before reloading, so updates actually take effect
- Cleaned up stale `?_cb=` URL params left by previous force-refresh logic

### Changed
- **Assassination odds lowered** — base chance 8%→5%, max cap 20%→15%, all bonuses reduced, target defense increased

## [1.5.4] - 2026-02-26

### Changed
- **Operations UI redesign** — replaced single-page wall of content with tabbed navigation (Story, Family Ops, Territory, Bosses)
- Mission cards now use proper CSS classes with color-coded borders, status badges, and inline requirement tags
- Crime families in Family Ops tab are collapsible accordion groups
- Locked missions hidden behind a toggle to reduce visual clutter
- Story campaign panel now shows a chapter progress bar with completion percentage
- Compact faction intel strip at top shows all family reputations at a glance

### Removed
- Random encounters system removed from generators.js and game.js

### Fixed
- Bot jailbreak button now shows visible alert feedback on success/failure
- Online players in jail now sync to server so other players can see them in jail lists
- Added `syncJailStatus()` client function and `handleJailStatusSync()` server handler

## [1.5.3] - 2026-02-25

### Fixed
- **Ghost UI** — fixed `.page-header` breadcrumbs remaining visible on screen after navigating away on mobile (position: fixed elements escaping hidden parent)
- **Check for Updates** — replaced deprecated `window.location.reload(true)` with `forceHardReload()` that clears service workers, Cache Storage API, then redirects with a `?_cb=` cache-buster to bypass GitHub Pages CDN
- **Mobile page-header** — added `.mobile-device .page-header` CSS rule so header spans full width instead of using desktop sidebar offsets

### Added
- `forceHardReload()` utility function for reliable cache-busting across all modern browsers
- `.screen-active` class system with MutationObserver to auto-hide fixed-position elements inside inactive screens
- Force Refresh button shown after version check reports you're up to date

## [1.5.2] - 2026-02-25

### Fixed
- **Version sync** — PC and mobile now display the same version number (1.5.2)
- **Duplicate code block** in game.js (`resetQuickActionPrefs` body appeared twice) — orphaned statements ran at module scope on load, potentially crashing initialization and breaking all Settings buttons on mobile
- **Mobile nav bar customizer** and **quick action customizer** buttons in Settings now work reliably
- **Save system** gameVersion now uses the `CURRENT_VERSION` constant instead of a hardcoded string
- **Server cloud save** default version updated from 1.3.8 to current release

## [1.4.3] - 2026-02-24

### Fixed
- **Comprehensive layout overhaul** — raised base `.game-screen` padding so all 31 screens clear the page-header at every breakpoint
- **Responsive media queries** — corrected sidebar top offsets (44px), page-header left/right values, and stats bar flex layout across 768px and 480px breakpoints
- **clearTutorialHighlights()** — now clears inline styles instead of setting incorrect z-index and border values
- **Tutorial skip button** persisting after skipping or completing the tutorial
- **5 runtime error hotfixes** — resolved crashes in gang, territory, faction, and UI systems
- **Stolen-cars screen** double-indent from conflicting margin and padding rules
- **Corrupted CSS block** with literal `\n` characters replaced with actual newlines

### Changed
- **Economy rebalance** — tuned job payouts, energy costs, and XP progression curves for better flow
- **Ledger polish** — sticky heading with gradient background, tighter log entry spacing
- **Merged expanded-styles.css** into styles.css — single stylesheet for all game CSS
- Removed `<link>` to expanded-styles.css from index.html
- Version bumped to 1.4.3

## [0.2.0] - 2025-11-21

### Added
- **Configuration System**
  - `config/meta.js` - Centralized game name, version, and metadata
  - `config/balance.js` - All balancing values (jobs, missions, XP, energy) in one place with detailed comments
  - Easy tuning of payouts, jail chances, energy costs, and progression curves

- **Event System**
  - `eventBus.js` - Decoupled event system for UI updates
  - `ui-events.js` - UI listeners subscribe to game state changes
  - Events: `moneyChanged`, `xpChanged`, `jailStatusChanged`, `wantedLevelChanged`, `reputationChanged`, `territoryChanged`

- **Logging & Debugging**
  - `logging.js` - Structured client-side logging system
  - Toggle via `GameLogging.setEnabled(true)` or `window.DEBUG_MODE`
  - Log key events: job completion, jail, territory capture, multiplayer errors
  - Debug panel accessible via `GameLogging.showDebugPanel()`

- **Server Improvements**
  - `worldPersistence.js` - JSON-based world state persistence
  - Automatic save/load for territories, city events, and leaderboards
  - Saves to `world-state.json` with error handling and throttling
  - Enhanced security with rate limiting and input validation
  - Profanity filter for player names and chat

- **Development Tools**
  - ESLint configuration for code quality
  - npm scripts: `npm run lint`, `npm run check`, `npm run dev`
  - Better error handling and logging throughout

### Changed
- Refactored configuration for easier balancing
- Improved code organization and documentation
- Enhanced server stability and security
- Updated package.json with correct version and metadata

### Technical
- All balance values centralized in `config/balance.js`
- Event-driven UI updates reduce coupling
- Server-side world state persistence
- Foundation for server-authoritative multiplayer

## [0.1.0] - Initial Release

### Added
- Core criminal empire gameplay
- Single player progression system
- Local multiplayer support
- Job system with risk/reward mechanics
- Territory control
- Gang management
- Faction missions
- Character customization
- Save/load functionality
