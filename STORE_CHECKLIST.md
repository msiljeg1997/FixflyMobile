# Store priprema — što je gotovo i što trebaš ti

Stanje na 2026-07-27. App je funkcionalno spreman za prvi native build;
sve ispod što je označeno 🔴 traži tvoju akciju (račun, logo, tekst) i
ne mogu to napraviti umjesto tebe.

---

## ✅ Gotovo u kodu

- `eas.json` — build profili (`development` / `preview` / `production`),
  API URL zapečen po okruženju
- `app.json` — bundle ID `io.fixfly.pro` (iOS + Android), tamna tema,
  splash, permission opisi (kamera / galerija / Face ID), Android
  permissions
- Ikone generirane iz pravog Fixfly logotipa: app icon (1024×1024, bez
  alfa kanala — Apple to odbija), splash, Android adaptive + monochrome,
  favicon
- Firebase config fajlovi već su na mjestu (`google-services.json`,
  `GoogleService-Info.plist`)

---

## 🔴 Što trebaš ti, prije prvog builda

### 1. Pristup računima
- **Apple Developer** (ideš preko prijateljevog računa): treba mi
  **Team ID**, i da je bundle `io.fixfly.pro` registriran na tom teamu.
  Idealno dodaj mene/sebe kao člana u App Store Connect.
- **Google Play Console**: pozivnica kao user, i kreiran app zapis s
  paketom `io.fixfly.pro`.
- **Expo račun** (besplatan) za EAS build — `npx eas login`.

### 2. Push notifikacije (bez ovoga push ne radi na iOS-u)
- **APNs Auth Key** (`.p8`) generiran na Apple teamu + **Key ID** +
  **Team ID**, uploadan u Firebase → Project Settings → Cloud Messaging.
- ⚠️ `.p8` se može skinuti **samo jednom** — spremi ga odmah.

### 3. Tekstovi i materijali za listing
- Naziv appa, kratki opis (do 80 znakova), puni opis
- **Privacy policy URL** — obavezno na oba storea. App skuplja: email,
  ime, telefon, fotografije, lokacijski kod. Bez toga nema objave.
- Screenshotovi: iPhone 6.7" i 6.5" (App Store), telefon + 7"/10" tablet
  (Play). Mogu ih generirati iz appa kad kažeš.
- Kategorija (predlažem: Business / Productivity), dobna oznaka

---

## Redoslijed kad dobiješ pristupe

```bash
cd src/mobile/app
npx eas login
npx eas build:configure

# Prvi test build (interni, ne ide u store):
npx eas build --profile preview --platform android   # APK, može se instalirati direktno
npx eas build --profile preview --platform ios       # treba Apple team

# Produkcijski build + slanje:
npx eas build --profile production --platform all
npx eas submit --profile production --platform all
```

**Bitno:** tek native build (`development`/`preview` profil) omogućuje
**prave push notifikacije** — Expo Go ih ne podržava. Registracija push
tokena u appu (`POST /api/agent/device-token`) namjerno još nije
ožičena; ima smisla je dodati tek uz prvi native build, kad se može
stvarno testirati.

---

## Poznata preostala stavka

**Registracija FCM tokena + deep-link s notifikacije** — backend je
gotov i šalje ispravno, app još ne registrira token. To je zadnji korak
i radi se zajedno s prvim native buildom (paket `expo-notifications`,
zatraži dopuštenje, pošalji token, handler za tap na notifikaciju).
