# Documento técnico — Modelo de propagación orbital

TP Nº 7 · Satellite Tracker · Programación Móviles 2026

## 1. Resumen

La app calcula **localmente** la posición de cada satélite con el modelo **SGP4/SDP4** a partir de elementos orbitales medios publicados en formato **OMM/JSON** (CelesTrak, Space-Track) o **TLE** (N2YO, Where the ISS at?, convertidos a OMM). Las APIs solo se consultan para descargar elementos (TTL 12 h) y para validación; nunca en cada frame.

Todo el cálculo vive en `src/core/` (dominio puro, sin dependencias de React Native) y está cubierto por tests unitarios (`npx jest src/core`).

| Etapa | Módulo | Salida |
|---|---|---|
| Elementos → `satrec` | `core/orbital/satellite.ts` (`json2satrec`) | Estado inicial SGP4 |
| Propagación | `propagateEci` (`satellite.js` 6.0.2) | Posición/velocidad TEME (km, km/s) |
| Punto subsatelital | `stateAt` (`eciToGeodetic` + GMST) | Lat/lon geodésica WGS-84, altitud |
| Az/El del observador | `lookAnglesAt` (`ecfToLookAngles`) | Azimut, elevación, rango |
| Ventanas de visibilidad | `core/orbital/passFinder.ts` | AOS, TCA, LOS, elevación máx. |
| Ground track | `core/orbital/groundTrack.ts` | Polilíneas cortadas en ±180° |
| Footprint | `core/geo/footprint.ts` | MultiPolygon de cobertura |
| Visibilidad óptica | `core/orbital/sun.ts` | Satélite iluminado + cielo oscuro |

## 2. SGP4/SDP4

SGP4 (*Simplified General Perturbations 4*, Hoots & Roehrich 1980; revisión de Vallado et al. 2006) es el modelo analítico con el que el 18th SDS genera los elementos GP. **Los elementos medios solo son consistentes con SGP4**: usarlos con un integrador kepleriano o numérico introduce errores mayores.

Perturbaciones modeladas:

- Achatamiento terrestre: armónicos zonales J2, J3, J4.
- Arrastre atmosférico mediante el término balístico **B\*** (modelo de densidad potencia-4).
- Para períodos ≥ 225 min se activa **SDP4** (rama *deep space*): perturbaciones lunisolares y resonancias de 12 h (GPS/Molniya) y 24 h (GEO). `satellite.js` elige la rama automáticamente.

Constantes: SGP4 usa **WGS-72** internamente (como exige la compatibilidad con los elementos); la conversión a coordenadas geodésicas usa el elipsoide **WGS-84**.

### Elección de la librería

- `satellite.js` **6.0.2**: JavaScript puro (CommonJS), soporta `json2satrec` para OMM.
- Se descartó la **v7**: es ESM-only y agrega un propagador WASM con `import()` dinámicos y *subpath imports* (`#wasm-*`) que Hermes/Metro no resuelven; Hermes además no expone `WebAssembly`.
- OMM es el formato principal porque los objetos con **NORAD de 6 dígitos** no tienen TLE. Esto ocurre en la práctica: el set SupGP de Starlink trae IDs como `100001`.
- `src/data/formats/tle.ts` convierte TLE → OMM para fuentes que solo exponen TLE. Un test verifica que ambas representaciones propagan a menos de 0,1 km entre sí.

## 3. Sistemas de referencia y conversiones

1. **TEME** (*True Equator Mean Equinox*): marco de salida de SGP4.
2. **TEME → ECEF**: rotación por el tiempo sidéreo medio de Greenwich (**GMST**, IAU-82) alrededor de Z.
3. **ECEF → geodésicas**: latitud geodésica iterativa sobre WGS-84; altitud sobre el elipsoide.
4. **ECEF → topocéntricas (SEZ)**: vector observador→satélite rotado al horizonte local del observador. Se obtiene azimut (desde el norte, sentido horario), elevación y rango.

## 4. Predicción de pases (AOS/TCA/LOS)

Una búsqueda ingenua (evaluar la elevación cada pocos segundos durante 72 h) cuesta ≈ 260 000 propagaciones. El algoritmo implementado es **grueso → fino**:

1. **Barrido grueso** cada 60 s: 4 320 evaluaciones en 72 h.
2. Al detectar un cruce del umbral de elevación mínima ε<sub>min</sub>, se refina por **bisección** hasta 1 s (≈ 6 iteraciones).
3. El **TCA** (máxima elevación) se refina con **búsqueda de la sección áurea** dentro de [AOS, LOS].
4. **Pases rasantes**: si una muestra es un máximo local por debajo del umbral (hasta 6°), también se refina. Así no se pierden pases más cortos que el paso grueso.
5. El generador `scanPasses` cede el control cada 400 muestras. `findPassesAsync` usa esos puntos para devolver el hilo JS a la UI, que no se congela mientras calcula.

**Exactitud.** El test `passFinder.test.ts` compara contra un barrido de fuerza bruta a 1 s durante 24 h. Coinciden la cantidad de pases, AOS y LOS (±2 s) y la elevación máxima (±0,05°).

**Costo medido** en Node 24 (V8 con JIT): 6,7 ms para 72 h de la ISS (13 pases). 300 propagaciones toman 1,5 ms. En el emulador Android (Hermes, sin JIT) la misma búsqueda tomó **482 ms**, unas 70 veces más; por eso el cálculo es cooperativo y la UI no se congela. El tiempo se muestra en la pestaña *Passes*.

Casos borde:

- Si el satélite ya está sobre el umbral al inicio de la ventana, el pase se marca `inProgress`.
- Si no termina dentro de la ventana, se marca `truncated`. Así se representa un GEO siempre visible.

### Visibilidad óptica

Un pase se marca *visible* si, en alguna de 5 muestras del pase, se cumplen las dos condiciones:

- el satélite está iluminado, según un modelo de **sombra cilíndrica** de la Tierra;
- el Sol está por debajo de **−6°** (crepúsculo civil) para el observador.

La posición del Sol sale de `sunPos` (algoritmo de baja precisión del Astronomical Almanac).

## 5. Ground track y antimeridiano

- Muestreo adaptativo: `paso = clamp(T·60/150, 30 s, 600 s)`, ≈ 150 muestras por órbita. Para la ISS (T ≈ 93 min) da 37 s; para GEO, 574 s.
- Se dibuja **una órbita pasada** (gris, punteada) y **una futura** (amarilla). Se recalcula una vez por minuto, no por frame.
- **Corte en el antimeridiano:** si dos muestras consecutivas saltan más de 180° en longitud, la polilínea se divide. La latitud del cruce se **interpola linealmente** para que ambos tramos terminen exactamente en ±180°, sin huecos (`splitLineAtAntimeridian`).

## 6. Footprint (área de cobertura)

Ángulo central terrestre del círculo de cobertura para altitud *h* y elevación mínima ε:

```
λ = arccos( R / (R + h) · cos ε ) − ε          radio en superficie = R · λ
```

Ejemplos:

- ISS a 420 km con ε = 0°: ≈ 2 250 km.
- ISS con ε = 10°: ≈ 1 400 km.
- GEO con ε = 0°: λ ≈ 81,3°.

El círculo se genera con la fórmula de **punto destino esférico** (96 vértices). Las longitudes se desenrollan para que sean continuas. Luego el anillo se recorta con **Sutherland–Hodgman** contra franjas de 360° y se obtiene un `MultiPolygon` que no cruza el mapa. Si el círculo **contiene un polo**, el anillo se cierra por la latitud ±90° (test incluido).

La elevación mínima es configurable (por defecto 10°, en línea con la práctica ITU-R de 5–10° para enlaces) y se usa tanto para AOS/LOS como para el footprint.

## 7. Supuestos y limitaciones

| Limitación | Impacto | Mitigación |
|---|---|---|
| Precisión intrínseca de elementos GP + SGP4 | ~1 km en la época; crece 1–3 km/día en LEO baja, más con actividad solar alta | TTL 12 h, badge de antigüedad (RF-16) y alerta > 72 h |
| Maniobras no publicadas (Starlink maniobra con frecuencia) | Error de decenas de km hasta el próximo set | Uso del set **SupGP** derivado de efemérides del operador |
| Sin refracción atmosférica | Elevación observada ~0,5° mayor cerca del horizonte; AOS real unos segundos antes | Umbral mínimo de 10° por defecto |
| TEME→ECEF solo con GMST (sin movimiento polar ni UT1−UTC) | < 30 m | Despreciable frente al error de los elementos |
| Footprint sobre Tierra esférica (R medio) | < 0,5 % del radio | — |
| Sombra cilíndrica (sin penumbra) | Error de segundos en entrada/salida de eclipse | Solo afecta la etiqueta "visible" |
| Densidad atmosférica fija en B\* (sin clima espacial) | Domina el error a varios días | Refresco automático por TTL |
| Brújula: magnetómetro sin calibrar e interferencias | Error de varios grados | Tolerancia ±5°, aviso de calibración en figura de 8, uso de `trueHeading` (declinación corregida) |
| Background en Android (WorkManager) | El SO decide el momento real (mín. 15 min) | Las notificaciones se programan **localmente** con anticipación: no dependen de que la tarea corra a tiempo |

## 8. Rendimiento

- **Capa de constelación:** se usa **una sola fuente GeoJSON + `CircleLayer`** (render nativo en GPU), no un `Marker` por satélite. Las posiciones se propagan en lotes de 100 que ceden el hilo, con un lote completo cada 2 s. El tiempo por lote se muestra en el mapa: **52 ms para 300 Starlink** en el emulador (Hermes), dentro de un ciclo de 2 s.
- **Marcador del satélite:** se recalcula cada 1 s. La animación de pulso corre con `useNativeDriver`.
- **Pases:** cálculo cooperativo (ver §4), recalculado cada 10 min o al cambiar satélite/observador/umbral.

Si se necesitara más, el siguiente paso sería un *worklet* en un runtime secundario (react-native-worklets) o un TurboModule nativo con SGP4 en C++. Con las optimizaciones actuales no fue necesario.

## 9. Referencias

- Vallado, D., Crawford, P., Hujsak, R., Kelso, T.S. (2006). *Revisiting Spacetrack Report #3*. AIAA 2006-6753.
- Vallado, D. *Fundamentals of Astrodynamics and Applications*.
- CelesTrak — *NORAD Two-Line Element Set Format* y documentación de GP/SupGP.
- satellite.js — https://github.com/shashwatak/satellite-js
- ITU-R S.1257 / prácticas de elevación mínima para enlaces satelitales.
