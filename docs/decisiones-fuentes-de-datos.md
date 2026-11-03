# Decisiones sobre fuentes de datos

TP Nº 7 · Satellite Tracker · Programación Móviles 2026

## 1. Proveedores

| Proveedor | Rol | Formato | Acceso | Límite publicado | Límite configurado (cliente / proxy) |
|---|---|---|---|---|---|
| **CelesTrak** | Fuente principal: catálogo GP por grupo, búsqueda, **SupGP Starlink** | OMM JSON | Sin key | Revisa fuentes ~1 vez/día. **Bloquea con 403 la re-descarga del mismo archivo antes de 2 h** (verificado) | 20 req/min · caché proxy 2 h · caché app 12 h |
| **Space-Track.org** | Catálogo oficial, fallback | OMM JSON | Cuenta (cookie de sesión) | < 30 req/min y 300/h | 25/min y 280/h (margen) |
| **N2YO** | Validación cruzada de posición; TLE de respaldo | JSON / TLE | API key | 1 000 tx/h (posiciones, TLE); 100/h (pases) | 950/h |
| **Where the ISS at?** | Validación ISS y TLE de respaldo para la ISS | JSON / TLE | Sin key | ~1 req/s, solo NORAD 25544 | 1 req/s |

Los límites se aplican **dos veces**:

1. En la app, con `src/data/http/rateLimiter.ts` (ventanas deslizantes múltiples).
2. En el proxy, con `proxy/src/rateLimiter.ts`.

Cuando no hay cupo, la request falla rápido con 429 y el orquestador pasa al siguiente proveedor. Nunca se encola indefinidamente.

## 2. Starlink: por qué el set suplementario

SpaceX **no ofrece una API pública** de posiciones de la constelación:

- **Starlink Enterprise API** (cuentas, terminales, routers, telemetría): requiere cuenta business y no expone la constelación.
- **Space Traffic Coordination API**: restringida a operadores satelitales y autenticada con **certificado mTLS firmado por SpaceX**.

Por lo tanto se usa el **SupGP de CelesTrak** (`sup-gp.php?FILE=starlink`). Son elementos GP ajustados por CelesTrak a partir de las **efemérides que SpaceX publica** (las que comparte para coordinación de tráfico espacial). Ventajas frente al GP estándar:

- Incorpora **maniobras** recientes. Los Starlink maniobran con frecuencia y el GP del 18th SDS queda desactualizado entre actualizaciones.
- Mayor exactitud cerca de la época.
- Incluye objetos recién lanzados con números provisionales de **6 dígitos** (p. ej. `100001`). No tienen TLE, lo que obliga a usar **OMM/JSON**.

Si el SupGP no está disponible (403 por la regla de 2 h, o caída), `CelesTrakProvider` usa el grupo GP `starlink` y, si también falla, Space-Track (prefijo `STARLINK`).

## 3. Arquitectura de acceso a datos

```
 UI (features/*)
   │  useSatellite / useConstellation / CatalogScreen / ValidationScreen
   ▼
 ProviderOrchestrator  ── cache-first (TTL 12 h) ── SqliteCacheStore (expo-sqlite)
   │   fallback ordenado · salud por proveedor · stale-if-error
   ▼
 DataProvider (getCatalog · getOrbitalData · search · getValidationPosition)
   ├─ CelesTrakProvider (proxy)   ┐
   ├─ CelesTrakProvider (directo) │  httpJson: rate limiter + reintentos con
   ├─ SpaceTrackProvider (proxy)  │  backoff exponencial y jitter (429/5xx/red)
   ├─ N2yoProvider (proxy)        │
   └─ WhereTheIssProvider         ┘
            │
            ▼
 Proxy Node (Fastify) — credenciales · rate limit · caché TTL persistida en disco · stale-if-error
```

Cadenas de fallback (`src/services/container.ts`):

| Operación | Orden |
|---|---|
| Catálogo por grupo | CelesTrak (proxy) → CelesTrak (directo) → Space-Track (proxy) |
| Elementos de un satélite | CelesTrak (proxy) → CelesTrak (directo) → Space-Track → N2YO (TLE) → WTIA (TLE, solo ISS) |
| Búsqueda por nombre | CelesTrak (proxy) → CelesTrak (directo) → caché local (offline) |
| Búsqueda por NORAD | igual que "Elementos de un satélite" |
| Validación | N2YO (cualquier satélite) + Where the ISS at? (ISS), en paralelo |

## 4. Caché y TTL

- **Dispositivo:** SQLite con las tablas `orbital_records` (OMM por NORAD + `source` + `fetched_at`) y `catalog_groups`. **TTL 12 h**, coherente con la frecuencia de actualización de CelesTrak.
  - `useSatellite` re-evalúa el TTL cada minuto y refresca solo, sin superar los límites (RF-09).
  - La tarea en background hace lo mismo para los satélites con recordatorios.
- **Stale-if-error:** si todos los proveedores fallan, se sirve el dato vencido marcado `stale`. La UI muestra "offline cache" y la antigüedad de los elementos (RF-16). Esto permite **calcular un pase sin conectividad** en el momento del pase.
- **Proxy:** caché de respuestas de 2 h para datos orbitales, 5 s para N2YO y 1 s para WTIA, con deduplicación de requests concurrentes.
  - Se persiste en `proxy/.cache/responses.json`: reiniciar el proxy no vuelve a descargar archivos de CelesTrak y evita el 403.
  - Las respuestas se etiquetan con `x-cache: HIT|MISS|STALE` y `x-fetched-at`.
  - Durante el desarrollo, un reinicio del proxy sin caché en disco provocó el 403 de CelesTrak. De ahí la persistencia.

## 5. Credenciales

- Las credenciales de Space-Track (`SPACETRACK_IDENTITY`/`PASSWORD`) y la API key de N2YO (`N2YO_API_KEY`) viven **solo** en `proxy/.env`, que está ignorado por git. Hay un `proxy/.env.example` como plantilla.
- La app solo conoce la URL del proxy (configurable en *Settings*). No hay secretos en el bundle ni en el repositorio.
- El proxy no es un relay abierto:
  - grupos en lista blanca;
  - validación de NORAD y coordenadas;
  - rutas fijas por proveedor;
  - la key de N2YO nunca aparece en la respuesta (test incluido).
- Space-Track usa sesión por cookie: el proxy hace login una vez, reutiliza la cookie 90 min y nunca reenvía las credenciales a la app.
- Alternativa evaluada: Keychain/Keystore en el dispositivo. Se descartó porque obliga a que cada usuario tenga cuenta propia y multiplica las requests contra los límites por cuenta.

## 6. Manejo de errores

| Situación | Comportamiento |
|---|---|
| 5xx / red / 429 del upstream | Reintento con backoff exponencial (400 ms·2ⁿ, jitter 50–100 %), máx. 2–3 intentos |
| 4xx (excepto 429) | Sin reintento, se pasa al siguiente proveedor |
| Cupo local agotado | 429 inmediato con `retry-after` y fallback |
| Proveedor sin la operación (p. ej. WTIA para un satélite que no es la ISS) | `NotSupportedError`, se salta sin marcarlo como caído |
| Todo falla y hay caché vencida | Se sirve `stale` y la UI lo indica |
| Todo falla y no hay caché | `AllProvidersFailedError` con el detalle por proveedor (visible en *Settings → Data sources*) |
