# TP7 · Satellite Tracker

App móvil en **React Native (Expo SDK 58, RN 0.88, TypeScript)**. Calcula en el dispositivo, con **SGP4/SDP4**, la posición en tiempo real de satélites LEO, MEO y GEO a partir de datos orbitales públicos. Los muestra en un mapa mundial con *ground track*, *footprint* y la constelación Starlink, y predice los pases visibles desde la ubicación del usuario. Incluye sky chart polar, modo brújula, notificaciones de pase y validación contra N2YO / Where the ISS at?.

> Programación Móviles 2026 · Licenciatura en Sistemas de Información · Trabajo Práctico Nº 7

## Entregables

| Entregable | Ubicación |
|---|---|
| Código fuente | este repositorio (`src/` app, `proxy/` backend) |
| Build de prueba | APK en *Releases* del repo · o `npx expo run:android` (Metro) |
| Documento técnico del modelo orbital | [`docs/modelo-orbital.md`](docs/modelo-orbital.md) |
| Informe de validación | [`docs/informe-validacion.md`](docs/informe-validacion.md) |
| Decisiones sobre fuentes de datos | [`docs/decisiones-fuentes-de-datos.md`](docs/decisiones-fuentes-de-datos.md) |
| Video demo | enlace en *Releases* · guion en [`docs/guion-video.md`](docs/guion-video.md) |

## Requisitos funcionales

| RF | Implementación |
|---|---|
| RF-01 Búsqueda por nombre / NORAD | `features/catalog/CatalogScreen.tsx` → `ProviderOrchestrator.search` |
| RF-02 Posición lat/lon/alt por SGP4 local | `core/orbital/satellite.ts` (`stateAt`) |
| RF-03 Azimut/elevación | `core/orbital/satellite.ts` (`lookAnglesAt`) |
| RF-04 Ventanas AOS / máx / LOS | `core/orbital/passFinder.ts` (grueso → bisección → sección áurea) |
| RF-05 Sky chart polar SVG | `features/passes/SkyChart.tsx` |
| RF-06 Notificación N min antes | `features/notifications/passReminders.ts` |
| RF-07 Modo brújula | `features/compass/CompassScreen.tsx` |
| RF-08 Filtro por constelación | chips de grupo en *Satellites* (Stations, Brightest, Starlink, GPS, Weather, GEO) |
| RF-09 Actualización automática por TTL | `useSatellite` (chequeo por minuto) + tarea en background |
| RF-10 Mapa en tiempo real (1 s) | `features/tracking/TrackingScreen.tsx` + MapLibre |
| RF-11 Ground track ±1 órbita con corte en antimeridiano | `core/orbital/groundTrack.ts`, `core/geo/antimeridian.ts` |
| RF-12 Footprint con elevación mínima configurable | `core/geo/footprint.ts` |
| RF-13 Capa de constelación | `features/tracking/hooks/useConstellation.ts` (1 fuente GeoJSON + `CircleLayer`) |
| RF-14 Proveedores + caché + fallback | `src/data/**`, `proxy/` |
| RF-15 Modo validación (error en km) | `features/validation/*`, `scripts/validate.ts` |
| RF-16 Antigüedad de los datos | `DataAgeBadge` (alerta > 72 h, indicador de caché offline) |

## Arquitectura

Arquitectura hexagonal con carpetas "que gritan" el dominio:

```
src/
  core/          Dominio puro (sin RN): SGP4, look angles, pases, ground track, footprint, geodesia
  data/          Puertos y adaptadores: DataProvider, proveedores, rate limiter, caché SQLite, orquestador
  features/      Casos de uso + UI por funcionalidad
    tracking/    Mapa en tiempo real, observador, constelación
    catalog/     Búsqueda y filtros
    passes/      Predicción, sky chart
    compass/     Orientación asistida
    notifications/  Recordatorios + tarea en background
    validation/  Comparación contra fuentes independientes
    settings/    Preferencias y salud de proveedores
  services/      Composition root (cadenas de fallback)
  shared/        UI, tema, store, formato
  app/           Rutas de Expo Router (solo enlazan pantallas)
proxy/           Backend Node (Fastify): credenciales, rate limit, caché persistida
docs/            Documentos entregables
scripts/         Generador del informe de validación
```

| Capa del enunciado | Dónde |
|---|---|
| Data Provider Layer | `src/data`, `proxy/` |
| Orbital Engine | `src/core/orbital` |
| Observer Layer | `features/tracking/hooks/useObserverLocation.ts`, `features/compass/useDeviceOrientation.ts` |
| Prediction Service | `core/orbital/passFinder.ts`, `features/passes/PassesContext.tsx` |
| Geo/Map Layer | `core/geo`, `features/tracking/components/SatelliteMap.tsx` |
| Validation Layer | `features/validation`, `scripts/validate.ts` |
| Presentation Layer | `features/*/…Screen.tsx`, `shared/ui.tsx` |
| Notification Layer | `features/notifications` |

**Stack.**

- `satellite.js` 6.0.2 (SGP4, OMM).
- `@maplibre/maplibre-react-native` 11 con tiles de OpenFreeMap (sin API key).
- `expo-location` y `expo-sensors`.
- `react-native-svg`.
- `expo-notifications` y `expo-background-task`.
- `expo-sqlite`.
- Expo Router.

Las decisiones de librería están justificadas en los documentos de `docs/`.

## Puesta en marcha

Requisitos:

- Node ≥ 23.6 (probado con 24). El proxy usa TypeScript nativo de Node.
- Android Studio con un emulador (API 35+) o un dispositivo.
- JDK de Android Studio.

### 1. Proxy (credenciales y caché)

```bash
cd proxy
npm install
cp .env.example .env    # completar N2YO_API_KEY y SPACETRACK_IDENTITY / SPACETRACK_PASSWORD
npm start               # http://localhost:8787  (GET /health)
```

Sin credenciales, el proxy funciona igual para CelesTrak y Where the ISS at?: Space-Track y N2YO responden `503 not configured` y la app hace fallback. También hay un `Dockerfile` opcional.

### 2. App

```bash
npm install
npx expo run:android      # development build + Metro
```

El emulador alcanza el proxy en `http://10.0.2.2:8787` (valor por defecto). En un dispositivo físico, configurá la IP de tu PC en *Settings → Data sources*.

Para simular la ubicación en el emulador:

```bash
adb emu geo fix -58.3816 -34.6037
```

### 3. Tests y calidad

```bash
npm test                 # 41 tests: motor orbital, geodesia, proveedores, orquestador, validación
npm run typecheck
cd proxy && npm test     # rate limiter, caché, rutas, manejo de credenciales
```

### 4. Informe de validación

Con el proxy corriendo y la key de N2YO cargada:

```bash
npm run validate -- --samples 5
```

Genera `docs/validation-results.md` y `docs/validation-results.json`.

### 5. APK

```bash
cd android
./gradlew assembleRelease   # android/app/build/outputs/apk/release/app-release.apk
```
