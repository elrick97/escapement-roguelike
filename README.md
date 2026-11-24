# ESCAPEMENT

**An offline-playable horological one-thumb action roguelike PWA.**

Inside the collapsing heart of the Great Astronomic Horologium, you are the **Rogue Balance Wheel** spinning against total mechanical freeze. Shatter waves of corroded mechanisms to harvest **Ruby Bearings** and **Gilt**, bolt **Complications** onto your frame mid-run, fuse paired upgrades into broken **Grand Complications**, and survive past Cycle I into **Endless Overdrive**.

---

## Live Game URL (HTTPS)

**Play / Install:** **https://elrick97.github.io/escapement-roguelike/**

- Unique App Name: `Escapement`
- Unique Local Storage Key: `escapement_roguelike_v1_save`
- Versioned Offline Cache: `escapement-cache-v1` (100% of assets precached, zero runtime network calls)

---

## How to Install on My Phone Before the Flight (iPhone / iOS Safari)

> **Important:** On iOS, you **must** use **Safari** (not Chrome or an in-app browser) to install a PWA to your Home Screen.

1. Open **Safari** on your iPhone and go to **https://elrick97.github.io/escapement-roguelike/**.
2. Wait 2–3 seconds until the green **`● OFFLINE READY`** pill appears under the **ESCAPEMENT** title (this confirms the Service Worker has precached 100% of the game assets).
3. Tap the **Share** button (the square with an upward arrow at the bottom center of Safari).
4. Scroll down the share sheet and tap **Add to Home Screen**.
5. Confirm the name (**Escapement**) and tap **Add** in the top-right corner.

*(If using Android / Chrome instead: open the URL in Chrome, wait for `OFFLINE READY`, tap the `⋮` menu → **Add to Home screen** / **Install app**.)*

---

## How to Verify It Works in Airplane Mode Before Leaving Home

1. Launch **Escapement** once from your **Home Screen icon** while still on Wi-Fi so iOS Safari's standalone container completes its Service Worker registration and displays **`● OFFLINE READY`**.
2. Close the app completely (swipe up from the app switcher).
3. Turn on **Airplane Mode** (and make sure Wi-Fi is switched **off**).
4. Tap the **Escapement** icon on your Home Screen.
5. Verify the title screen loads immediately, tap **PLAY**, move with your thumb, and play for 10 seconds with sound on. If it launches and plays smoothly, you are 100% flight-ready!

---

## Controls

### Mobile (Portrait, One-Thumb)
- **Move:** Touch and drag anywhere on the screen to spawn the floating virtual joystick.
- **Auto-Fire:** All equipped Complications aim and fire automatically.
- **Anchor Tempo:** Lift your thumb to stand still and engage **Anchor Tempo** (+30% fire rate baseline, upgradeable up to +75% + brass shield ward).
- **Pause:** Tap the **`❚❚`** button in the top-right corner (also auto-pauses automatically if you lock your phone or switch apps).

### Desktop Fallback (Laptop Offline)
- **Move:** `WASD` or Arrow keys (or click-and-drag with mouse).
- **Pick Upgrade:** Click a card or press **`1`**, **`2`**, or **`3`**.
- **Pause / Resume:** `Esc` or `P`.
- **Deterministic Seed (Optional):** Append `?seed=12345` to the URL.

---

## Local Development & How to Redeploy

### Run Locally
```bash
npm install
npm run dev
```

### Build & Preview Production PWA Locally
```bash
npm run build
npm run preview
```

### Redeploy to GitHub Pages
Every push to `main` automatically rebuilds and deploys to GitHub Pages via `.github/workflows/deploy.yml`:
```bash
git add .
git commit -m "Update Escapement"
git push origin main
```
Or trigger a manual redeploy anytime with:
```bash
gh workflow run deploy.yml
```
