# Guion del video demo (≤ 3 min)

Grabación: `adb shell screenrecord --time-limit 180 /sdcard/demo.mp4` (lo lanza Claude) o la grabación integrada del emulador (*Extended controls → Record and playback*). El emulador debe estar con ubicación fija en Buenos Aires (`adb emu geo fix -58.3816 -34.6037`) y el proxy corriendo.

| Tiempo | Pantalla | Acción | Qué mostrar / decir (voz en off opcional) |
|---|---|---|---|
| 0:00–0:15 | Satellites | Grupo **Space stations** → tocar **ISS (ZARYA)** | Catálogo real de CelesTrak, fuente y antigüedad de la descarga. Búsqueda por nombre o NORAD (RF-01, RF-08) |
| 0:15–0:45 | Map | Esperar 5 s; tocar **Follow**; hacer zoom | Marcador animado refrescado cada 1 s con SGP4 local. Ground track pasado (gris) y futuro (amarillo) cortado en el antimeridiano. Footprint para 10° de elevación. Panel con lat/lon/alt, az/el, rango y antigüedad de los elementos (RF-02/03/10/11/12/16) |
| 0:45–1:05 | Map | Tocar **Starlink**; alejar el zoom | Capa de 300 Starlink del set SupGP en una sola capa GeoJSON; tiempo de cálculo por lote (RF-13) |
| 1:05–1:40 | Passes | Ver la lista; tocar un pase con buena elevación | Próximos pases AOS/TCA/LOS (búsqueda grueso → fino) y **sky chart** polar con AOS, LOS y máximo (RF-04/05) |
| 1:40–2:05 | Passes | Tocar **🔕 Remind me** en un pase; luego **Demo notification (10 s)** y volver al inicio del teléfono | Aparece la notificación del pase (RF-06). Mencionar que la tarea en background reprograma y refresca datos |
| 2:05–2:25 | Map → 🧭 Compass | Abrir la brújula; rotar el dispositivo virtual en *Extended controls → Virtual sensors* | Indicación "Turn right / tilt up" hasta **ON TARGET** (RF-07) |
| 2:25–2:50 | Validation | Tocar **Compare now** | Error vs N2YO y Where the ISS at? en km (RF-15). Mencionar el hallazgo del desfase de 1 s de N2YO (3–19 m de residual) |
| 2:50–3:00 | Settings | Mostrar salud de proveedores y elevación mínima | Fallback entre proveedores, caché con TTL de 12 h y proxy que guarda las credenciales (RF-09/14) |
