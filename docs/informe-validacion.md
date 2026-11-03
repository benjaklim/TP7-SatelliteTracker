# Informe de validación de posiciones

TP Nº 7 · Satellite Tracker · Programación Móviles 2026

> Datos completos y muestras individuales: [`validation-results.md`](validation-results.md) y [`validation-results.json`](validation-results.json). Corrida del **2026-11-03 16:57 UTC**, 35 muestras.

## 1. Metodología

- **Posición propia:** SGP4 local (`src/core`, el mismo código que usa la app) con elementos OMM recién descargados de CelesTrak.
- **Referencias independientes:**
  - **N2YO**, endpoint `positions` a través del proxy, que guarda la API key;
  - **Where the ISS at?** (WTIA), endpoint `satellites/25544`.
- **Satélites:** cubren distintos regímenes orbitales.
  - ISS y Hubble: LEO baja, con arrastre alto.
  - NOAA 19 y NOAA 20: LEO heliosincrónica, ~830 km.
  - GPS BIIR-13: MEO, 20 200 km, rama SDP4 por resonancia de 12 h.
  - GOES 16: GEO, rama SDP4 por resonancia de 24 h.
- **Comparación sin sesgo de latencia:** se propaga **al timestamp que informa cada proveedor**, no a la hora local de recepción.
- **Métricas:**
  - error 3D: distancia ECEF entre ambas posiciones, incluye altitud;
  - error de suelo: distancia de los puntos subsatelitales sobre la superficie;
  - Δ altitud.
- **Muestreo:** 5 rondas separadas por 15 s, respetando los límites (WTIA 1 req/s; N2YO 35 de 1 000 transacciones/h).
- **Reproducible** con `npm run validate -- --samples 5`. En la app, la pestaña **Validation** (RF-15) hace la misma comparación en vivo.

## 2. Resultados crudos

| Satélite | Fuente | n | Error 3D medio (km) | σ (km) | Error suelo (km) | Antigüedad elementos (h) |
|---|---|---|---|---|---|---|
| ISS | N2YO | 5 | 7,65 | 0,00 | 7,14 | 22,8 |
| ISS | Where the ISS at? | 5 | **0,00** | 0,00 | 0,00 | 22,8 |
| Hubble | N2YO | 5 | 7,62 | 0,00 | 7,09 | 19,8 |
| NOAA 19 | N2YO | 5 | 7,43 | 0,00 | 6,57 | 20,2 |
| NOAA 20 | N2YO | 5 | 7,44 | 0,00 | 6,61 | 20,3 |
| GPS BIIR-13 | N2YO | 5 | 3,83 | 0,00 | 0,91 | 26,0 |
| GOES 16 | N2YO | 5 | 3,07 | 0,00 | 0,46 | 19,9 |

Hay dos observaciones que llaman la atención:

1. Contra **WTIA** el error es **0,00 km**: WTIA propaga con SGP4 el mismo set GP de CelesTrak. Esto valida que la implementación es **numéricamente equivalente** a otra implementación de referencia. No es una comparación independiente del modelo.
2. Contra **N2YO** el error es **constante** (σ = 0 en las 5 rondas) y su valor coincide con la **velocidad inercial de cada satélite multiplicada por 1 segundo**:

| Satélite | Velocidad inercial (km/s) | Error 3D (km) |
|---|---|---|
| ISS | 7,66 | 7,65 |
| GPS BIIR-13 | 3,87 | 3,83 |
| GOES 16 | 3,07 | 3,07 |

Un error del modelo crecería con el tiempo, variaría entre rondas y no seguiría la velocidad. Esto apunta a una diferencia de **tiempo**.

## 3. Análisis de desfase temporal

Para cada muestra se buscó el corrimiento Δt ∈ [−3 s, +3 s] (paso 0,05 s) que minimiza el error, con dos hipótesis:

- **(a)** Δt aplicado a todo: propagación SGP4 y rotación terrestre (GMST).
- **(b)** Δt aplicado solo a la propagación SGP4; la rotación terrestre se evalúa en el timestamp que informa N2YO.

| Satélite | Error crudo | (a) Δt | (a) residual | (b) Δt | (b) residual |
|---|---|---|---|---|---|
| ISS | 7,65 km | +1,05 s | 0,107 km | **+1,00 s** | **3 m** |
| Hubble | 7,62 km | +1,05 s | 0,144 km | **+1,00 s** | **8 m** |
| NOAA 19 | 7,43 km | +1,00 s | 0,458 km | **+1,00 s** | **6 m** |
| NOAA 20 | 7,44 km | +1,00 s | 0,518 km | **+1,00 s** | **3 m** |
| GPS BIIR-13 | 3,83 km | +1,05 s | 1,932 km | **+1,00 s** | **19 m** |
| GOES 16 | 3,07 km | (no converge) | 3,071 km | **+1,00 s** | **3 m** |

**Conclusión del análisis.** La hipótesis (b) explica las 35 muestras de los 6 satélites, en LEO, MEO y GEO, con un residual de **3 a 19 metros**. N2YO informa un `timestamp` 1 s anterior al instante en que propagó el estado TEME, y lo convierte a coordenadas terrestres con la rotación del timestamp informado.

La hipótesis (a) no puede explicar GOES 16: un satélite geoestacionario casi no se mueve respecto de la Tierra, así que correr ambos relojes no cambia su posición. El error de 3,07 km aparece justamente porque la propagación inercial y la rotación terrestre quedan desfasadas.

Por lo tanto, **nuestro pipeline (SGP4 → TEME → ECEF → geodésicas WGS-84) coincide con N2YO al nivel de metros**, el orden del redondeo de sus coordenadas. Los ~7,5 km que se ven en LEO no son un error de nuestro cálculo. Equivalen a 1 s de movimiento, menos que el período de refresco del marcador en el mapa (1 s).

## 4. Crecimiento del error con la antigüedad de los elementos

La comparación entre implementaciones no mide la exactitud **física** de SGP4. Para eso se usó el historial de Space-Track (`gp_history`, 10 días). Cada set histórico se propagó hasta la época del set más reciente y se comparó contra este, que hace de "verdad" en su propia época.

| Antigüedad del set (días) | ISS: error 3D (km) | NOAA 19: error 3D (km) |
|---|---|---|
| ~0,3 | 0,20 | 0,01 |
| ~1,0 | 0,30 | 0,04 |
| ~1,5 | 3,39 | 0,06 |
| ~2,0 | 2,66 | 0,08 |
| ~2,5 | 2,79 | 0,14 |
| ~3,0 | 9,83 | 0,23 |
| ~4,6 | 4,02 | 0,25 |
| ~5,3 | 6,91 | 0,23 |
| ~7,5 | 5,15 | 0,30 |
| ~8,2 | **31,27** | 0,51 |

Interpretación:

- **ISS (~420 km):**
  - el arrastre atmosférico es fuerte y variable;
  - la estación hace **maniobras de reboost** que ningún set anterior puede anticipar.
  - Por eso el error no es monótono, con saltos de 2–10 km en pocos días y 31 km a los 8 días.
- **NOAA 19 (~870 km):** el arrastre es despreciable. El error crece suave y casi linealmente, de 10 m a ~0,5 km en 8 días.
- **Consecuencia de diseño:**
  - el TTL de **12 h** mantiene el error de la ISS por debajo de ~0,3 km;
  - la alerta de RF-16 a las **72 h** marca el punto donde el error en LEO baja puede superar los ~10 km, comparable al footprint de un haz o a la ventana de un pase de pocos segundos.

## 5. Conclusiones

1. La implementación de SGP4 y las conversiones de marco son correctas:
   - idénticas a WTIA (0 m, mismo modelo y mismos datos);
   - consistentes con N2YO a 3–19 m una vez identificado su desfase de reloj de 1 s.
2. El error que ve el usuario está dominado por la **antigüedad de los elementos orbitales**, no por el cálculo:
   - < 1 km el primer día;
   - unos km a los 2–3 días en LEO baja;
   - decenas de km a la semana o después de una maniobra.
3. El refresco automático por TTL (RF-09) y el indicador de antigüedad (RF-16) atacan precisamente esta fuente de error.
4. Para la constelación Starlink, que maniobra con frecuencia, se usa el set **SupGP** derivado de las efemérides del operador. Detalles en [`decisiones-fuentes-de-datos.md`](decisiones-fuentes-de-datos.md).

## 6. Limitaciones de la validación

- N2YO y WTIA usan SGP4, igual que nosotros. Validan la implementación, no el modelo físico. La validación del modelo se hizo con sets históricos (§4), que también son ajustes SGP4, no efemérides de precisión.
- El objeto Starlink del set SupGP no entró en esta corrida: CelesTrak rechaza (HTTP 403) una nueva descarga del mismo archivo antes de 2 h y el archivo ya se había descargado. El script lo incluye automáticamente cuando el proxy tiene el archivo en caché.
- Las muestras son de un único día. La variabilidad del arrastre depende de la actividad solar.
