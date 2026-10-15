# Outfitly mobile

Native iOS and Android app (Expo SDK 57, Expo Router) for the same Outfitly backend as the web app. It follows the Neckline O identity — Wardrobe Ink, Collar Coral, Linen, Inter and the logo — but uses mobile patterns rather than the web layout: a tab bar, modal sheets, the camera and photo library, long-press actions, pull to refresh and haptics.

| Tab | What it does |
|---|---|
| Studio | Pick a style, colour direction and optional starting piece; generate outfits and save them |
| Wardrobe | Your pieces by category. **+** adds a piece from the camera or library with auto-detected details; long-press removes one |
| Saved | Saved outfits; tap the bookmark to remove one |
| Account | Wardrobes, theme (follows the system), sign out |

Without an account, **Explore the sample wardrobe** shows the same sample pieces as the web demo, with outfits generated on the device.

## Run it in Expo Go

1. Install **Expo Go** on your phone (App Store / Play Store).
2. Point the app at your API:
   ```bash
   cp .env.example .env
   ```
   Set `EXPO_PUBLIC_API_URL` to your deployed API (the Render URL). A phone can't reach `localhost` on your computer; for a local backend, use your computer's LAN address and run the backend so it listens on `0.0.0.0`.
3. Start the dev server from this folder:
   ```bash
   npm install
   npx expo start
   ```
4. Scan the QR code: with the Camera app on iOS, or from inside Expo Go on Android. The phone and the computer must be on the same Wi-Fi network; if they can't see each other, run `npx expo start --tunnel`.

Photo uploads and outfit generation need the ML service (see `../ml-service`). Without it, sign-in, wardrobes and saved outfits work, and uploads show the backend's 503 message.

## Checks

```bash
npm run typecheck
npm run lint
npx expo-doctor
```

## Brand assets

- `src/brand.tsx` (logo, react-native-svg) is generated from `brand/logo/final/` by `frontend/scripts/generate_brand.py`; don't edit the paths by hand.
- `assets/icon.png` and `assets/adaptive-icon.png` are the full-bleed app icon from the brand kit; the splash screen shows it on Wardrobe Ink.
