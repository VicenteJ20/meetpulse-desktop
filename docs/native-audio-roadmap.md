# Roadmap de audio nativo

## Fase 1: microfono con CPAL

- Enumerar dispositivos de entrada.
- Usar microfono default si no hay seleccion.
- Abrir stream input con config soportada.
- Convertir sample format a `f32`.
- Resamplear a 48 kHz si corresponde.
- Mezclar canales a mono.
- Enviar frames de 20 ms al encoder.
- Reportar RMS y clipping por ventana.

## Fase 2: system audio con WASAPI loopback

- Obtener render endpoint default.
- Inicializar `IAudioClient` en modo loopback.
- Capturar buffer por paquetes.
- Manejar silencio sin emitir errores.
- Mantener stereo en MVP.
- Reintentar si cambia el dispositivo default.

## Fase 3: encoder Ogg Opus

- Crear encoder por track.
- Usar 48 kHz.
- Mic mono a 48 kbps.
- System stereo a 64 kbps.
- Cerrar pagina Ogg al finalizar cada segmento.
- Escribir metadata minima para trazabilidad.

## Fase 4: mezcla final

- Decodificar `final/mic.opus` y `final/system.opus`.
- Alinear por timestamps de segmento.
- Aplicar headroom para evitar clipping.
- Codificar `final/mixed.opus`.

## Riesgos

- WASAPI loopback puede entregar formatos distintos por dispositivo.
- Suspender/reanudar Windows puede invalidar clientes de audio.
- Algunos dispositivos Bluetooth cambian sample rate dinamicamente.
- La mezcla final requiere sincronizacion temporal real, no solo concatenacion.
