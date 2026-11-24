# ESCAPEMENT — Game Design & Architecture Document

## 1. Theme Pitch & Identity
**Title:** **ESCAPEMENT**
**Premise:** Inside the collapsing heart of the Great Astronomic Horologium, entropy has begun to seize the gears. You are the **Rogue Balance Wheel** — a sentient brass-and-blued-steel escapement core spinning against total mechanical freeze. Each wave is a **Chime** of the failing clock, unleashing swarms of corroded mechanisms — Rust Mites, Burr Sprockets, Magnetized Needles, Tarnish Globules, Pendulum Brutes, and Overwound Coils — sent to lock your axis. Shatter them to harvest glowing **Ruby Bearings** (XP) and **Gilt** (gold filings), bolt new **Complications** onto your frame mid-run, and fuse paired mechanisms into reality-breaking **Grand Complications** before the Grand Tourbillon and Mainspring Leviathan crush the dial.

## 2. Core Loop & Controls
- **Run Flow:** Title Screen (with Workshop & Codex) → 10-Wave **Cycle I** (each wave 22–34s, Boss at Wave 5 & Wave 10) → seamless transition into **Endless Mode (Cycle II+, Wave 11+)** → Defeat/Results Summary → spend Gilt on permanent Workshop upgrades → Next Run.
- **One-Thumb Portrait Controls (Primary):** Touch anywhere to spawn a **floating virtual joystick** with deadzone and visual anchor/thumb ring. Your Balance Wheel glides smoothly and auto-aims/auto-fires all equipped Complications.
- **Anchor Tempo (Tactile Risk-Reward):** Releasing your thumb (or stopping movement) engages **Anchor Tempo**, lighting a golden precision ring around the wheel that boosts fire rate by +30% (upgradeable up to +75% + brass shield ward). Players balance constant kiting against brief high-DPS bursts.
- **Desktop Fallback:** `WASD` or Arrow keys to move, `Esc` / `P` to pause, `1`/`2`/`3` to pick upgrades, mouse drag also works as virtual joystick.
- **Mobile UX & Battery:** Portrait locked layout with `env(safe-area-inset-*)`, `touch-action: none`, no zoom/scroll/selection, automatic pause and RAF stop on `visibilitychange` / `pagehide` / `blur`, and accessible Pause menu.

## 3. Upgrade System & Grand Complication Evolutions
Leveling up via Ruby Bearings (or opening an Elite/Boss **Relic Chest**) pauses the action with a dramatic slow-mo flash, knockback pulse, and harmonic chord, presenting **1 of 3 Complications** with rarity tiers (**Brass** 1×, **Blued** 1.25×, **Ruby** 1.5×, **Gilded** 2×, **Mythic Evolution**).

### Active Weapons (6 — up to 4 active slots per run, starter: Escapement Bolt)
1. **Escapement Bolt:** Rapid blued-steel pins fired at the nearest threat; scales count, pierce, and cadence.
2. **Ruby Prism:** Faceted crimson shards that ricochet sharply between enemies with luminous trails.
3. **Tourbillon Orbit:** Spinning brass gears orbiting your core, shredding and knocking back close swarmers.
4. **Chime Hammer:** Periodic massive acoustic gold shockwave ring damaging, slowing, and shattering armor.
5. **Hairspring Arc:** High-voltage blued-steel chain lightning arcing across enemy clusters.
6. **Pendulum Scythe:** Wide piercing clock-hand boomerangs sweeping out and returning through crowds.

### Passive Complications (12)
`Mainspring Tension` (Fire Rate), `Jewel Calibration` (Crit Chance/Dmg), `Split-Seconds` (+Projectiles), `Lubricated Pivots` (Move Speed), `Magnetic Coils` (Magnet Radius + XP), `Bimetallic Alloy` (Damage + Knockback), `Tempered Glass` (Max HP + Regen), `Overclock Capacitor` (Area/Size), `Ricochet Jewel` (+Bounce/Pierce), `Chrono Leech` (Kill-streak Chrono Slow + Heal), `Volatile Spring` (Death Shrapnel Explosions), `Anchor Tempo` (Stand-still Fire Rate + Ward).

### Grand Complication Evolutions (6 Synergies — Weapon Lv 3+ & Paired Passive Lv 1+)
1. **Perpetual Barrage** (*Escapement Bolt + Split-Seconds*): 5-stream gilded gatling fan with explosive tips.
2. **Prism Singularity** (*Ruby Prism + Ricochet Jewel*): Shards split into 2 mini-prisms on every ricochet.
3. **Celestial Orrery** (*Tourbillon Orbit + Overclock Capacitor*): Twin counter-rotating planetary brass saw rings that vaporize enemy darts and emit sparks.
4. **Cataclysm Carillon** (*Chime Hammer + Volatile Spring*): Triple cascading golden bell rings triggering chain explosions on kills.
5. **Tesla Chronometer** (*Hairspring Arc + Mainspring Tension*): Rapid 10-target guaranteed-crit lightning web with micro-stun.
6. **Eclipse Regulator** (*Pendulum Scythe + Jewel Calibration*): Full 360° obsidian-and-gold twin clock-hand eclipses leaving burning wakes.

## 4. Enemy & Boss Roster
- **Rust Mite:** Fast oxidized burr swarmers in packs.
- **Burr Sprocket:** Jagged gear that winds up (orange telegraph) and lunges in a straight line.
- **Magnet Needle:** Ranged blued-steel shard that telegraphs a glint and fires crimson magnetic darts.
- **Tarnish Globule:** Verdigris slime-gear that splits into 2 fast Mini-Globules upon destruction.
- **Pendulum Brute:** Heavy armored cast-iron weight that slams telegraphed shockwave rings.
- **Overwound Coil:** Volatile spiral spring that rushes close, ticks rapidly, and detonates in a ring (friendly-fires nearby enemies).
- **Elites (Wave 3+):** Scaled aura variants (*Gilded*, *Overwound*, *Volatile*) dropping Relic Chests.
- **Boss 1 — The Grand Tourbillon (Wave 5, 15, 25…):** Multi-cage spinning gyroscope firing rotating radial bolt curtains; Phase 2 (<50% HP) accelerates spiral volleys and telegraphed charge lanes.
- **Boss 2 — The Mainspring Leviathan (Wave 10, 20, 30…):** Armored dreadnought dial firing telegraphed rotating clock-hand sweep beams, expanding chime rings, and summoned Overwound Coils.

## 5. Endless Scaling Formula (Wave 11+)
Let $w$ be the wave index ($w \ge 1$) and $c = \lfloor (w - 1) / 10 \rfloor$ be the Cycle index (0 for Waves 1–10, 1+ for Endless):
- **Enemy HP Multiplier:** $M_{\text{HP}}(w) = (1 + 0.19(w - 1)) \cdot 1.18^{\max(0, w - 10)}$
- **Enemy Damage Multiplier:** $M_{\text{DMG}}(w) = (1 + 0.10(w - 1)) \cdot 1.07^{\max(0, w - 10)}$
- **Enemy Speed Multiplier:** $M_{\text{SPD}}(w) = \min(1.85,\; 1 + 0.025(w - 1))$
- **Spawn Rate Multiplier:** $M_{\text{SPAWN}}(w) = \min(2.8,\; 1 + 0.09(w - 1))$
- **Endless Wave Modifiers (Wave 11+):** Each wave rolls a named horological modifier (*Overclocked* +20% speed/XP, *Rust Storm* dense mites, *Magnetic Surge* extra needles, *Gilded Tide* 2× Gilt & Elites, *Twin Chime* rapid elites). Empowered Bosses recur every 5 waves.

## 6. Meta-Progression & Persistence
Saved locally under `escapement_roguelike_v1_save` (schema-versioned JSON with graceful fallback). Earned **Gilt** funds 6 permanent **Workshop** upgrades: *Hardened Mainspring* (Damage), *Tempered Case* (HP), *Jewel Bearings* (Speed/Magnet), *Precision Escapement* (Crit/ASPD), *Gilded Reserve* (Gilt/Rerolls), and *Calibrated Start* (Bonus Lv-1 Complication). Tracks Best Wave, Best Score, Total Kills, Runs Played, and Grand Complication Codex.

## 7. Art, Audio & Technical Stack
- **Visuals:** Midnight-enamel horological dial (`#0B1020`) with subtle rotating golden tick marks, brass (`#F5C542`), blued steel (`#4CC9F0`), ruby (`#FF2E63`), verdigris (`#2EC4B6`), and rust (`#E76F51`). High-contrast procedural Canvas 2D vector art with additive glow, hit-flash, squash-stretch, trauma screen shake, 25–45ms hit-stop, and pooled floating damage numbers.
- **Audio:** 100% procedural WebAudio synthesizer — crisp metallic ticks, ascending pentatonic Ruby pickup chimes, brass bell level-up chords, lightning crackles, crunch crits, and an adaptive clockwork arpeggio music loop. Unlocks on first gesture and suspends cleanly on backgrounding.
- **Stack & Offline Delivery:** **Vite + TypeScript + Canvas 2D** (zero runtime dependencies, <100 KB gzipped) deployed as an **installable PWA on GitHub Pages (HTTPS)**. A build-time Vite plugin injects every emitted asset and PNG icon (including `apple-touch-icon-180.png` for iOS Safari) into a versioned Service Worker (`escapement-cache-v1`) so 100% of assets are precached and playable in airplane mode.
- **Performance:** Fixed-capacity object pools (enemies, projectiles, particles, pickups, damage texts, shockwaves), reusable spatial hash grid (64px cells), `devicePixelRatio` capped at 2, zero per-frame allocations in hot loops, targeting 60 FPS with 250+ active entities on mid-range phones.
