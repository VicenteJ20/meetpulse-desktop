# Test Plan Checklist

## Base app

- [ ] La ventana abre como widget flotante.
- [ ] Los botones cambian de estado correctamente.
- [ ] La app crea `AppData\\Local\\MeetingsAssistant`.
- [ ] SQLite se crea y migra sin errores.

## Segmentacion

- [ ] Cada segmento se escribe primero como `.tmp`.
- [ ] El segmento confirmado queda como `.opus` Ogg Opus.
- [ ] `manifest.json` se actualiza de forma atomica.
- [ ] SQLite registra segmentos confirmados.
- [ ] El uso de RAM permanece estable.

## Recovery

- [ ] Al iniciar, elimina `.tmp` antiguos.
- [ ] Al iniciar, remueve locks viejos.
- [ ] Una sesion `recording` queda como `interrupted_recovered`.
- [ ] Los segmentos confirmados se vuelven a registrar en SQLite.

## Stop seguro

- [ ] Detener cambia a `stopping`.
- [ ] El ultimo segmento se confirma.
- [ ] El manifest queda como `completed`.
- [ ] Se genera solo `final/mixed.opus`.
- [ ] La UI lista la grabacion.

## Audio nativo

- [ ] Grabacion de microfono por 5 minutos.
- [ ] Grabacion de audio del PC desde navegador.
- [ ] Grabacion dual-track simultanea.
- [ ] Pausa/reanudar sin perdida de control.
- [ ] Desconexion de microfono reporta error recuperable.
