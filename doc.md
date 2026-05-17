# MeetPulse — Documento Funcional

## 1. Descripción General

MeetPulse es una aplicación de escritorio para Windows que permite grabar reuniones (audio del micrófono y del sistema), administrar las grabaciones localmente, y opcionalmente conectarlas a un servicio cloud para transcripción y análisis automatizado.

La aplicación opera en dos modos:

- **Modo local:** Todo funciona sin conexión a servicios externos. Las grabaciones se almacenan en el disco del usuario.
- **Modo cloud:** Al autenticarse con Google, la aplicación sincroniza clientes, proyectos y jobs con un backend externo, permitiendo solicitar transcripciones, análisis y gestionar todo desde la nube.

---

## 2. Autenticación

### 2.1 Pantalla de Login

Al abrir la aplicación, el usuario ve una pantalla que le solicita iniciar sesión con su cuenta de Google. Sin autenticación, no se puede acceder a las funcionalidades principales de la aplicación.

- **Botón "Iniciar sesión con Google":** Inicia el flujo OAuth2 a través del backend.
- Si la autenticación falla, se muestra un mensaje de error.
- La sesión persiste entre cierres de aplicación (el estado se mantiene en el backend nativo).

### 2.2 Cerrar Sesión

Desde el panel de Configuración, el usuario puede desconectar su cuenta de Google. Esto revoca la autenticación y devuelve al usuario a la pantalla de login.

---

## 3. Grabación de Audio

### 3.1 Widget Compacto (Flotante)

La aplicación ofrece una ventana compacta siempre visible (siempre encima) que funciona como control rápido de grabación. Se ubica en la esquina inferior derecha de la pantalla.

**Controles disponibles:**

- **Grabar / Pausar / Reanudar:** Un solo botón que alterna entre iniciar la grabación, pausarla y reanudarla según el estado actual.
- **Finalizar:** Detiene la grabación en curso y la guarda como una sesión completada.
- **Ocultar widget:** Cierra la ventana compacta (la aplicación sigue corriendo en segundo plano).
- **Fijar / Desfijar:** Alterna si la ventana permanece siempre encima de las demás.

**Indicadores visuales:**

- **Tiempo transcurrido:** Muestra la duración de la grabación en curso en formato `HH:MM:SS`.
- **Nivel de micrófono:** Barra de señal que indica la actividad del micrófono en tiempo real.
- **Nivel de audio del sistema:** Barra de señal que indica la actividad del audio del escritorio en tiempo real.
- **Estado de cada pista:** Iconos de micrófono y altavoz que se iluminan cuando hay señal activa.

### 3.2 Selección de Dispositivos de Audio

El usuario puede elegir qué dispositivos de audio utilizar:

- **Dispositivo de entrada (micrófono):** Lista desplegable con todos los micrófonos disponibles del sistema. El dispositivo predeterminado del sistema viene preseleccionado.
- **Dispositivo de salida (audio del sistema):** Lista desplegable con las fuentes de audio de escritorio disponibles (captura por loopback). El dispositivo predeterminado viene preseleccionado.

Los cambios de dispositivo se aplican inmediatamente y se persisten entre sesiones.

### 3.3 Estados de la Grabación

| Estado | Descripción |
|---|---|
| **Inactivo** | No hay ninguna grabación en curso. |
| **Iniciando** | La grabación se está preparando. |
| **Grabando** | Audio capturándose activamente. |
| **Pausado** | La grabación está detenida temporalmente; se puede reanudar. |
| **Deteniendo** | La grabación se está finalizando y procesando. |
| **Completado** | La grabación finalizó correctamente y está disponible en la biblioteca. |
| **Recuperando** | El sistema está recuperando una sesión interrumpida (crash recovery). |
| **Error** | Ocurrió un problema durante la grabación; se muestra el mensaje de error. |

### 3.4 Resiliencia

Si la aplicación se cierra inesperadamente durante una grabación, al reiniciar se detecta la sesión interrumpida y se ofrece recuperarla. Los segmentos de audio ya escritos se conservan.

---

## 4. Biblioteca de Audios

### 4.1 Vista Principal de Biblioteca

La biblioteca es el centro de administración de grabaciones. Se accede desde la barra lateral izquierda con el botón "Biblioteca".

**Estructura de la interfaz:**

- **Barra lateral izquierda:** Navegación por secciones, lista de clientes, y control de tema visual.
- **Panel central:** Tabla de audios con filtros por cliente y proyecto.
- **Panel derecho (Details Panel):** Formulario de edición del audio seleccionado.
- **Barra inferior (Player Bar):** Reproductor de audio.

### 4.2 Barra Lateral

**Marca y contador:** Logo de MeetPulse con la cantidad total de audios almacenados.

**Lanzador de grabación:** Botón "Iniciar grabación" que abre el widget compacto flotante.

**Navegación principal:**

- **Biblioteca:** Vista principal de audios activos.
- **Archivados:** Vista de audios y clientes archivados.
- **Configuración:** Panel de ajustes y sincronización cloud.

**Selector de tema:**

- **Claro:** Tema visual con fondo claro.
- **Oscuro:** Tema visual con fondo oscuro (predeterminado).

El tema se persiste en el navegador y se sincroniza entre ventanas.

**Lista de Clientes:**

Muestra todos los clientes detectados (tanto de grabaciones locales como del cloud) con su cantidad de audios asociados. El cliente "Sin clasificar" aparece siempre primero.

Cada cliente tiene acciones rápidas:
- **Archivar cliente:** Oculta el cliente y todos sus audios de la biblioteca principal. Los archivos no se eliminan.
- **Eliminar cliente:** Borra permanentemente el cliente, todos sus audios cloud vinculados y los registros locales asociados. No hay recuperación.

### 4.3 Tabla de Audios

Cada fila de la tabla representa una grabación y muestra:

- **Nombre del audio:** Nombre del archivo o nombre personalizado.
- **Fecha y hora:** Cuándo se inició la grabación.
- **Cliente:** A qué cliente pertenece.
- **Proyecto:** A qué proyecto pertenece.
- **Duración:** Duración total del audio.
- **Estado (badge):** Clasificado, borrador, archivado, etc.

**Selección:** Al hacer clic en una fila, el audio se selecciona y se carga en el panel de detalles y en el reproductor.

### 4.4 Filtros

**Filtro por cliente:** Seleccionar un cliente en la barra lateral filtra la tabla para mostrar solo sus audios.

**Filtro por proyecto:** Una barra de proyectos aparece sobre la tabla. Cada proyecto muestra su nombre, cantidad de audios, e iconos indicadores si hay transcripción o análisis disponible en la nube.

**Búsqueda por texto:** Un campo de búsqueda filtra por nombre del audio, nombre del cliente, nombre del proyecto o notas internas.

---

## 5. Gestión de Audios (Panel de Detalles)

Al seleccionar un audio, el panel derecho muestra su información y permite operarlo.

### 5.1 Información del Audio

- **Nombre del audio:** Se muestra en la cabecera del panel.
- **Badges cloud:** Si el audio tiene transcripción o análisis disponible en la nube, se muestran iconos indicadores.
- **Duración:** Tiempo total del audio.
- **Estado:** Estado actual de la grabación.

### 5.2 Campos Editables

Para audios locales, el usuario puede modificar:

- **Nombre del audio:** Renombrar el archivo.
- **Cliente:** Asignar o cambiar el cliente al que pertenece.
- **Proyecto:** Asignar o cambiar el proyecto.
- **Notas internas:** Campo de texto libre para anotaciones.

Los audios gestionados por el cloud no permiten editar estos campos desde la aplicación.

### 5.3 Acciones Disponibles

| Acción | Descripción |
|---|---|
| **Abrir archivo** | Abre la carpeta del sistema donde se almacena el audio grabado. |
| **Guardar** | Clasifica el audio con los datos ingresados (cliente, proyecto, nombre, notas) y lo mueve a la estructura de carpetas `Music/MeetPulse/{Cliente}/{Proyecto}/`. El audio queda como "clasificado". |
| **Drafts** | Guarda el audio como borrador en `Music/MeetPulse/drafts/`. No requiere cliente ni proyecto. |
| **Archivar** | Oculta el audio de la biblioteca principal. Los archivos no se eliminan. Se puede restaurar desde la vista de Archivados. |
| **Eliminar** | Borra permanentemente el audio y todos sus archivos asociados. No hay recuperación. |

### 5.4 Solicitar Análisis

El usuario puede enviar un audio a procesamiento externo:

- **Solicitar análisis:** Envía el archivo de audio al backend externo para que genere una transcripción y un análisis. Requiere estar autenticado con Google.
- **Reanalizar:** Si el audio ya tiene una transcripción guardada en el cloud, se puede solicitar que se vuelva a generar el análisis desde esa transcripción sin reenviar el audio.

Durante el proceso se muestra el estado de la solicitud y mensajes de confirmación o error.

---

## 6. Reproductor de Audio

### 6.1 Controles

La barra inferior de la aplicación contiene un reproductor de audio que se activa al seleccionar una grabación.

- **Reproducir:** Inicia la reproducción del audio seleccionado.
- **Pausar:** Detiene temporalmente la reproducción.
- **Detener:** Detiene la reproducción y vuelve al inicio.
- **Barra de progreso:** Muestra el tiempo actual y la duración total. Permite adelantar o retroceder arrastrando el control.

### 6.2 Información Mostrada

- **Nombre del audio:** El audio actualmente seleccionado.
- **Cliente / Proyecto:** Clasificación del audio.
- **Tiempo actual / Duración total:** Formato `HH:MM:SS`.

### 6.3 Funcionamiento

- Para audios locales, el archivo se carga desde el sistema de archivos y se convierte en un blob reproducible.
- Para audios del cloud, se utiliza la URL de audio proporcionada por el backend.
- Si hay un error al cargar el audio, se muestra un mensaje descriptivo.

---

## 7. Vista de Contenido Cloud (Audio Focus View)

Al hacer clic en el botón de "Ver contenido cloud" (icono de ojo) en el panel de detalles, se abre una vista expandida que muestra los artefactos generados por el servicio cloud.

### 7.1 Pestañas

- **Transcripción:** Muestra la transcripción del audio en formato Markdown renderizado.
- **Análisis:** Muestra el análisis generado (resumen, puntos clave, acciones, etc.) en formato Markdown renderizado.

### 7.2 Copiar Contenido

- **Formato Texto:** Copia el contenido como texto plano (sin formato Markdown).
- **Formato Markdown:** Copia el contenido conservando el formato Markdown original.

Al copiar, se muestra una confirmación visual temporal.

### 7.3 Navegación

- **Volver a la lista:** Botón para regresar a la vista de la tabla de audios.
- **Identidad del audio:** Muestra cliente, proyecto, nombre, duración y fecha de la grabación.

---

## 8. Archivados

### 8.1 Vista de Archivados

Se accede desde la barra lateral con el botón "Archivados". Muestra todos los audios y clientes que han sido archivados.

**Audios archivados:**

- Grabaciones locales que el usuario archivó manualmente.
- Jobs del cloud que fueron archivados desde el servicio externo.

**Acciones:**

- **Restaurar:** Devuelve el audio archivado a la biblioteca principal. Si es un job del cloud, se restaura también en el servicio externo.

### 8.2 Clientes Archivados

Cuando se archiva un cliente, todos sus audios asociados se ocultan de la biblioteca principal y aparecen en esta vista.

---

## 9. Configuración

### 9.1 Sincronización Cloud

- **Botón "Sincronizar":** Fuerza una sincronización manual con el backend para obtener los últimos clientes, proyectos y jobs del cloud.
- **Última sincronización:** Muestra la fecha y hora de la última sincronización exitosa.
- **Contadores:** Muestra la cantidad de clientes, proyectos y jobs sincronizados desde el cloud.
- **Estado:** Mensajes de éxito o error de la sincronización.

### 9.2 Autenticación Google

- **Estado actual:** Muestra el email de la cuenta conectada o "No conectado".
- **Conectar / Desconectar:** Botones para iniciar o cerrar sesión con Google.

---

## 10. Integración con el Backend Externo

### 10.1 Configuración de Conexión

El usuario configura la conexión al backend desde el almacenamiento local (no hay interfaz directa para esto, se configura vía variables de entorno o localStorage):

- **URL del backend:** Dirección del servicio API (por defecto `http://localhost:8000`).
- **API Key:** Clave de autenticación para solicitar transcripciones desde el navegador (modo web mock).

### 10.2 Flujo de Autenticación OAuth2

1. El usuario hace clic en "Iniciar sesión con Google".
2. La aplicación invoca al backend que inicia el flujo OAuth2 con Google.
3. El backend devuelve el estado de autenticación (email y token).
4. La aplicación guarda el estado y permite acceder a las funcionalidades cloud.

### 10.3 Sincronización del Dashboard Cloud

Al sincronizar, la aplicación consume tres endpoints del backend:

- **Clientes:** Obtiene la lista de clientes del cloud (slug, nombre, estado, proyectos, tags).
- **Proyectos:** Obtiene la lista de proyectos del cloud (slug, nombre, cliente asociado, estado).
- **Jobs:** Obtiene la lista de jobs de procesamiento (ID, nombre del archivo, duración, estado, URLs de audio, disponibilidad de transcripción y análisis).

### 10.4 Solicitud de Transcripción

Cuando el usuario solicita análisis para un audio local:

1. **Vía Tauri (app nativa):** La aplicación envía al backend el `recordingId`, `client`, `project`, `fileName` y `durationMs`. El backend localiza el archivo y lo procesa.
2. **Vía navegador (web mock):** La aplicación lee el archivo de audio local, lo convierte en un `FormData` con el archivo y metadatos (`relative_path`, `duration_ms`), y lo envía por POST al endpoint `/transcription/` con la API Key en el header `X-API-Key`.

El backend responde con un `job_id` que vincula la grabación local con el job del cloud.

### 10.5 Reintento de Análisis

Si un job ya tiene transcripción, se puede solicitar un reanálisis enviando el `job_id` al backend. El servicio regenera el análisis desde la transcripción existente sin necesidad de reenviar el audio.

### 10.6 Obtención de Artefactos

Para ver el contenido de un job, la aplicación solicita al backend los artefactos:

- **Transcripción:** Contenido Markdown de la transcripción.
- **Análisis:** Contenido Markdown del análisis generado.

La petición incluye el `job_id` y qué artefactos se desean obtener.

### 10.7 Gestión de Jobs del Cloud

| Acción | Descripción |
|---|---|
| **Archivar job** | Oculta un job del cloud de la vista principal. |
| **Restaurar job** | Devuelve un job archivado a la vista principal. |
| **Eliminar job** | Borra permanentemente un job del cloud y sus archivos asociados. |

### 10.8 Gestión de Clientes del Cloud

| Acción | Descripción |
|---|---|
| **Archivar cliente** | Oculta un cliente y todos sus jobs del cloud de la vista principal. |
| **Eliminar cliente** | Borra permanentemente un cliente del cloud, todos sus jobs y los registros locales vinculados. |

### 10.9 Listado de Jobs Archivados

La aplicación puede consultar al backend la lista de jobs que han sido archivados, para mostrarlos en la vista de Archivados.

---

## 11. Almacenamiento Local

### 11.1 Ubicación de Grabaciones

Las grabaciones se almacenan en:

```
C:\Users\<usuario>\AppData\Local\MeetingsAssistant\
```

### 11.2 Estructura de Cada Grabación

```
recordings/
  rec_yyyy-mm-dd_hh-mm-ss_xxxxxx/
    manifest.json       # Metadatos del segmento y estado
    lock                # Archivo de bloqueo (grabación activa)
    mic/                # Segmentos de audio del micrófono (Opus)
    system/             # Segmentos de audio del sistema (Opus)
    final/
      mixed.opus        # Audio final mezclado
```

### 11.3 Biblioteca Guardada

Cuando el usuario guarda una grabación en la biblioteca, el audio se copia a:

```
Musica/MeetPulse/{Cliente}/{Proyecto}/{nombre}.opus     # Clasificado
Musica/MeetPulse/drafts/{nombre}.opus                    # Borrador
```

### 11.4 Metadatos Persistentes

La aplicación almacena en `localStorage` del frontend:

- **Metadata de audios:** Cliente, proyecto, título, notas y estado de borrador por cada grabación.
- **Vínculos cloud:** Relación entre grabaciones locales y sus jobs del cloud.
- **URL del backend:** Dirección del servicio API.
- **API Key:** Clave para solicitudes de transcripción.
- **Tema visual:** Preferencia de tema claro u oscuro.

---

## 12. Gestión de Ventanas

### 12.1 Ventana Principal

- Tamaño: 1530 × 890 píxeles (redimensionable, mínimo 920 × 620).
- Barra de título personalizada con arrastre nativo de Windows.
- Botones de minimizar, maximizar y cerrar.

### 12.2 Ventana Widget (Compacta)

- Tamaño: 430 × 56 píxeles (no redimensionable).
- Se posiciona automáticamente en la esquina inferior derecha del monitor principal.
- Siempre visible por encima de otras ventanas (si está fijada).
- Se puede abrir desde la barra lateral de la biblioteca con "Iniciar grabación".

### 12.3 Cambio entre Modos

- Desde la ventana principal, se puede abrir el widget compacto.
- Al cerrar el widget, la ventana principal permanece abierta.
- Al cerrar la ventana principal, se oculta (no se cierra la aplicación).

---

## 13. Clasificación y Estados de Audio

### 13.1 Estados Locales

| Estado | Significado |
|---|---|
| **Sin clasificar** | El audio no tiene cliente asignado. Aparece bajo "Sin clasificar". |
| **Clasificado** | El audio tiene cliente y proyecto asignados. |
| **Borrador guardado** | El audio se guardó como borrador sin cliente ni proyecto. |
| **Archivado** | El audio fue archivado y no aparece en la biblioteca principal. |

### 13.2 Estados del Cloud

Los jobs del cloud tienen su propio estado (`processing`, `completed`, `archived`, etc.) que se refleja en la interfaz. Cuando un job tiene transcripción o análisis disponible, se muestra como "clasificado" en la biblioteca.

### 13.3 Vinculación Local-Cloud

Cuando un audio local se envía a transcripción, se crea un vínculo entre el `recording_id` local y el `job_id` del cloud. A partir de ese momento:

- El audio local puede desaparecer de la biblioteca (se limpia tras envío exitoso).
- El job del cloud aparece en la biblioteca como un audio con fuente "cloud".
- Los badges de transcripción y análisis se actualizan cuando el backend completa el procesamiento.

---

## 14. Resumen de Funcionalidades

| # | Funcionalidad | Local | Cloud |
|---|---|:---:|:---:|
| 1 | Grabar audio del micrófono | ✅ | — |
| 2 | Grabar audio del sistema (desktop) | ✅ | — |
| 3 | Pausar y reanudar grabación | ✅ | — |
| 4 | Finalizar grabación | ✅ | — |
| 5 | Selección de dispositivos de audio | ✅ | — |
| 6 | Widget compacto flotante | ✅ | — |
| 7 | Recuperación de sesiones interrumpidas | ✅ | — |
| 8 | Biblioteca de grabaciones | ✅ | ✅ |
| 9 | Reproducción de audio | ✅ | ✅ |
| 10 | Clasificar por cliente y proyecto | ✅ | ✅ |
| 11 | Guardar como borrador | ✅ | — |
| 12 | Renombrar grabaciones | ✅ | — |
| 13 | Agregar notas internas | ✅ | — |
| 14 | Archivar audios | ✅ | ✅ |
| 15 | Restaurar audios archivados | ✅ | ✅ |
| 16 | Eliminar audios permanentemente | ✅ | ✅ |
| 17 | Archivar clientes completos | ✅ | ✅ |
| 18 | Eliminar clientes completos | ✅ | ✅ |
| 19 | Filtrar por cliente | ✅ | ✅ |
| 20 | Filtrar por proyecto | ✅ | ✅ |
| 21 | Búsqueda por texto | ✅ | ✅ |
| 22 | Solicitar transcripción/análisis | ✅ (envía al backend) | ✅ |
| 23 | Reanalizar desde transcripción existente | — | ✅ |
| 24 | Ver transcripción (Markdown) | — | ✅ |
| 25 | Ver análisis (Markdown) | — | ✅ |
| 26 | Copiar contenido (texto o Markdown) | — | ✅ |
| 27 | Sincronización con backend | — | ✅ |
| 28 | Autenticación OAuth2 con Google | — | ✅ |
| 29 | Tema claro/oscuro | ✅ | ✅ |
| 30 | Abrir carpeta de grabación | ✅ | — |
| 31 | Gestión de múltiples ventanas | ✅ | — |
