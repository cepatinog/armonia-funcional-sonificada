# Bitácora del proyecto

Registro de las sesiones de trabajo: qué se hizo, qué decisiones se tomaron
y por qué, qué problemas aparecieron y cómo se resolvieron. La entrada más
reciente va primero.

---

## Sesión 3 — 30 de junio de 2026

**Resultado:** transposición a las 12 tonalidades mayores con deletreo
enarmónico correcto y selector en la interfaz. Los ejemplos se siguen guardando
en Do (como en el libro) y se transponen en runtime; el cambio de tonalidad
re-renderiza partitura (con su armadura) y piano, y la reproducción suena en la
tonalidad elegida. Era el *requisito de primera clase* pendiente desde la Fase 1.

(Sesión retomada con Opus 4.8: primero se releyó `CLAUDE.md`, la bitácora y todo
el código para reconstruir el estado exacto antes de proponer el plan.)

### Paso 1 — Dos decisiones musicales antes de codificar

Se consultó al usuario (experto musical) sobre dos puntos donde había criterio:

- **Registro: cercano.** Transponer por el intervalo más próximo (máx. ±6
  semitonos): si subir pasa del tritono, se baja una octava. Así Sol baja una 4ª
  en vez de subir una 5ª, Si baja un semitono, etc., y el ejemplo se mantiene en
  el mismo registro en las 12 tonalidades (comparación visual/auditiva justa).
  El deletreo (letra+alteración) es idéntico en cualquier octava, así que esto
  solo afecta la altura.
- **Alteraciones: de imprenta.** Dibujar la alteración solo cuando difiere de lo
  que la armadura ya provee, con becuadro donde la armadura altera una letra pero
  la nota es natural. No es solo estética: hace emerger el deletreo correcto.

### Paso 2 — El motor de transposición en `teoria.py`

Respetando la decisión firme de modelar `Nota(letra, alteracion, octava)` con
los campos separados, la transposición es POR INTERVALO, nunca por semitonos a
ciegas:

- `INTERVALOS_TONALIDAD`: el intervalo de Do a cada tónica destino como
  `(pasos_de_letra, semitonos)`. `_intervalo_cercano` aplica la regla de registro.
- `transponer_nota`: mueve la letra por su índice diatónico (`octava*7 + índice`,
  `divmod` para la octava nueva), fija el MIDI objetivo y deriva la alteración
  como la diferencia con el MIDI natural de la letra nueva. Guarda defensiva si
  la alteración se sale de ±2 (futuros capítulos con notas extremas).
- `transponer_cifrado`: separa raíz (`[A-G]` + alteración) de la calidad (`m`,
  `7`, `dim`…) con un regex; solo la raíz se transpone. `Bdim`→`C#dim` en Re.
- `armadura_de` + `alteracion_visible`: a partir del orden de sostenidos/bemoles
  y el conteo por tonalidad, deciden qué dibujar (`""`, `"n"` o el símbolo).
- `plan_de_render`/`plan_de_eventos` reciben `tonalidad`; en Do el resultado es
  idéntico al anterior (compatibles hacia atrás, Fases 1 y 2 intactas).

`sintesis.py` (acorde/secuencia/progresión/línea de tiempo) recibe `tonalidad` y
transpone las notas con `teoria.transponer_eventos` ANTES de sintetizar, de modo
que audio, partitura y piano comparten altura y deletreo. Quedó sin uso el viejo
`_parsear_eventos` (el parseo de JSON ahora vive en teoría) y se retiró.

### Paso 3 — Puente y UI

- `puente-audio.js`: `tonalidad` como último parámetro (por defecto `"C"`) en
  `planDeEventos`, `lineaDeTiempo`, `tocarSecuencia`, `tocarProgresion`,
  `tocarAcorde`. Sin lógica musical nueva en JS.
- `app.js`: estado global `TONALIDAD`; el `<select>` repinta el ejemplo actual al
  cambiar y se deshabilita (junto con navegación y modos) mientras suena.
- `index.html`/`css`: selector de 12 tonalidades con `value` = nombre que entienden
  teoría y VexFlow (la armadura), etiqueta bilingüe (`Re♭ (Db)`).
- `partitura.js` y `piano.js` **no cambiaron**: VexFlow dibuja la alteración solo
  cuando teoría la incluye (incluido `"n"` → becuadro); el deletreo lo decide Python.

### Paso 4 — Verificación

- **Motor en CPython** (convención del repo): C–E–G → E–G#–B en Mi (nunca
  E–Ab–B); Cdim → F#dim como F#–A♮–C♮ en Fa#; Cm → Ab–Cb–Eb en La♭; G7 → C#7 con
  E# correcto. **Barrido completo** de los 8 ejemplos × 12 tonalidades sin
  excepción: alteraciones visibles dentro del vocabulario, MIDI transpuesto =
  original + intervalo cercano, señal `float32` con pico 0.8 y longitud invariante.
  El deletreo por intervalo produce dobles bemoles correctos donde toca (en Re♭ la
  columna de subarmónicos da A𝄫 y B𝄫): es lo correcto, no un error.
- **Render en navegador real** (Chrome headless + VexFlow + el `partitura.js`
  real, con planes reales generados por teoría): ej07 en Fa# rotula las 7 triadas
  `F#, G#m, A#m, B, C#, D#m, E#dim` (con E# bien deletreado), ej02 en Re♭ dibuja
  sin lanzar pese a los dobles bemoles, y los becuadros de imprenta aparecen.
  Truco de esta vez: para esquivar el timing del CDN en headless (que ya tumbó a
  NumPy en sesiones previas), se descargó VexFlow a un archivo local y se cargó por
  `file://` con `--dump-dom`; Chrome se mata por PID (no `pkill -f google-chrome`).
- **Cadena de audio completa**: la confirma el usuario en su navegador (NumPy no
  baja en el Chrome del sandbox; restricción de red del entorno, no del código).

### Paso 5 — Ajuste de layout: el ancho del pentagrama según la armadura

Probando en el navegador apareció un desborde: en tonalidades con armadura grande
(Fa#, 6 sostenidos) el último acorde se salía por la derecha del pentagrama. La
causa: `partitura.js` formateaba las notas en un ancho fijo (`ancho - MARGEN`, con
MARGEN=95 asumiendo un tamaño constante de clave + armadura), pero las notas
empiezan mucho más a la derecha cuanto más ancha es la armadura (~42 px en Do,
~118 px en Fa#), así que se justificaban en un ancho mayor al área real disponible.

Se midió el inicio real de las notas con `getNoteStartX()` (que ya devuelve el
valor correcto antes de dibujar) y se dimensionan el lienzo y el ancho de formateo
a partir de esa medida, no de un margen fijo. Así cada acorde recibe el mismo
espacio en las 12 tonalidades y el canvas solo crece para armaduras grandes.
Verificado con render headless (8 ejemplos × {Do, Fa#, Si, Re♭}: ninguno desborda
ni lanza) y con capturas de ej07 en Fa# y de la columna de 12 notas en Si.

### Estado al cierre

- [x] Transposición a las 12 tonalidades con deletreo enarmónico + selector.
- Pendiente: Fase 3 (refinamiento sonoro, tipo `voces` para cantar/escuchar voces
  por separado) y más capítulos.

---

## Sesión 2 — 13 de junio de 2026

**Resultado:** Fase 2 — capítulo 1 sonificado. La app pasó de un acorde
hardcodeado a un **motor dirigido por datos**: lee `data/capitulo-01.json`,
muestra los ejemplos de uno en uno con navegación, los dibuja en gran
pentagrama con cifrado, y reproduce cada modo (secuencial, acumulativo, bloque,
arpegio) **encendiendo el teclado en sincronía con el audio**.

(Sesión retomada con Opus 4.8: la Fase 1 la hizo el modelo Fable 5, así que se
partió de leer el código, la bitácora y `CLAUDE.md` para reconstruir el estado.)

### Paso 1 — Localizar el capítulo 1 en los PDFs

Los PDFs de `referencias/` están numerados `-3, -6 … -15`, sin un `-1` obvio.
Inspeccionándolos con `pdftotext` se descubrió que **cada PDF es una página del
libro**: el índice (pág. 7 del PDF) sitúa el capítulo 1 *"La armonía tonal
funcional"* en las páginas 7–9 (PDF-9, -10, -11); el capítulo 2 empieza en la
pág. 10. De ahí salió el material musical: columna de armónicos desde C2,
columna espejo de subarmónicos, las tres funciones por quintas, la triada mayor
en los armónicos, las triadas de las funciones tejiendo la escala, el dominante
con 7ª menor, las siete triadas diatónicas y las calidades de triada.

### Paso 2 — Decisiones de alcance

- **Transposición aplazada.** Esta iteración renderiza todo en Do (la forma
  normalizada del libro). El selector de las 12 tonalidades queda para después,
  para mantener commits pequeños y enfocados.
- **UI de un ejemplo a la vez + navegación** (anterior/siguiente + contador),
  no una lista apilada.
- El usuario (experto musical) revisa y ajusta el JSON propuesto.

### Paso 3 — `data/capitulo-01.json` y el motor de modos

- 8 ejemplos con el esquema de `CLAUDE.md` (`tipo`, `eventos`, `modos`),
  descripciones **parafraseadas** (derechos del libro).
- `py/sintesis.py` aprendió a tocar en el tiempo, no solo en bloque: helper
  `_voz` (suma de tonos + ADSR sin normalizar, para concatenar tramos), y
  `secuencia` (`secuencial`/`acumulativo`) y `progresion` (`bloque`/`arpegio`,
  con `_arpegio` que escalona las notas y las sostiene hasta el fin del acorde).
- `py/teoria.py` ganó `plan_de_eventos`: un `plan_de_render` por evento (más el
  `cifrado` passthrough) y `midi_union` para el piano. Sigue siendo la única
  fuente de verdad de lo que se ve.
- Los eventos viajan de JS a Python como **string JSON** (`JSON.stringify` ↔
  `json.loads`): así los módulos no se acoplan a Pyodide y se siguen probando
  con CPython.

### Paso 4 — Partitura como en el libro: gran pentagrama

A pedido del usuario, `partitura.js` se reescribió para dibujar un **gran
pentagrama** (clave de sol arriba, fa abajo, unidas por llave), repartiendo
cada nota a su clave según la altura (corte en Do central, MIDI 60). Donde un
pentagrama no recibe nota se coloca una **nota fantasma invisible** (`GhostNote`)
para mantener alineadas las dos voces sin mostrar silencios. Esto elimina las
líneas adicionales de los armónicos agudos y los subarmónicos graves. Las
figuras pasaron a **redondas** y se rotula el **cifrado** encima de los acordes
(`ChordSymbol`).

### Paso 5 — Sincronizar el teclado con el audio

El teclado mostraba todas las teclas del ejemplo encendidas desde el inicio. Se
cambió a: **en reposo el teclado está limpio**, y al reproducir se enciende **al
ritmo del sonido**, acorde por acorde (o nota por nota en arpegios), apagando lo
anterior, y se limpia al terminar.

Respetando la arquitectura, el *timing* lo decide Python: `sintesis.py` añadió
`linea_de_tiempo(eventos, modo)`, que devuelve los segmentos `{t, midis}` y
refleja exactamente el timing de la síntesis (comparten la constante
`RETARDO_ARPEGIO`). El puente reproduce esa cronología guiándose por el **reloj
del `AudioContext`** (con `requestAnimationFrame`, descontando la latencia de
salida), no por temporizadores, que se desajustan. También se bloquea la
navegación mientras suena, para no saltar de ejemplo a media reproducción.

### Paso 6 — Verificación (y peleas con el entorno)

- **Motor Python en CPython** (convención del repo): `plan_de_eventos`,
  `secuencia`/`progresion`/`acorde_bloque` (dtype `float32`, longitud = Σ
  duraciones × 44100, pico 0.8) y `linea_de_tiempo` en los cuatro modos.
- **Render en navegador real** (Chrome headless + VexFlow del CDN, con un plan
  sintético, sin Pyodide): el gran pentagrama dibuja dos claves, reparte las
  notas, rotula los cifrados y no lanza — verificando `GhostNote`,
  `StaveConnector` (llave), `ChordSymbol`, redondas y el formateo de dos voces.
- **Lecciones del sandbox** (para la próxima vez): `loadPackage("numpy")` de
  Pyodide vuelve a fallar dentro del Chrome del sandbox (el wheel responde 200
  por `curl`; es restricción de red del entorno, no del código), así que el
  camino de audio completo se prueba en el navegador del usuario. Además:
  Chrome headless se cae si se agota `/dev/shm` → usar `--disable-dev-shm-usage`;
  y un `pkill -f google-chrome` **mata el propio shell** porque su línea de
  comando contiene "google-chrome" (usar `pkill` por nombre de proceso, sin `-f`,
  o no mezclarlo con el comando que lanza Chrome).

### Estado al cierre

- [x] Fase 2 — motor de capítulos desde JSON: visor con navegación, gran
  pentagrama con cifrado y piano sincronizado con el audio. Capítulo 1
  sonificado en Do.
- Pendiente: transposición a las 12 tonalidades + selector (la estructura
  letra+alteración de `teoria.py` ya está lista), tipo `voces` y más capítulos.

---

## Sesión 1 — 11 de junio de 2026

**Resultado:** Fase 1 completa y desplegada. El prototipo del acorde de Do
mayor (partitura + piano + sonido) funciona en
https://cepatinog.github.io/armonia-funcional-sonificada/ y el código vive
en https://github.com/cepatinog/armonia-funcional-sonificada.

### Paso 1 — Definición del proyecto y plan

Se escribió `CLAUDE.md` con la arquitectura firme: sitio 100% estático,
toda la lógica musical en Python vía Pyodide, JavaScript solo como puente
(UI, render, reproducción), y la transposición por intervalo como requisito
de primera clase. Sobre esa base se acordó el plan de la Fase 1: demostrar
la cadena completa de punta a punta con un solo ejemplo hardcodeado antes
de construir el motor de capítulos.

Lo primero que se commiteó fue el `.gitignore`: los PDFs del libro estaban
sin proteger en `referencias/` y no pueden entrar nunca al historial de git.

### Paso 2 — Elección y pineo de versiones (CDN)

- **Pyodide 0.29.4**. Dato curioso del día: Pyodide acababa de cambiar su
  esquema de versiones (la siguiente a 0.29.4 es 314.0.0, siguiendo a
  Python 3.14). Se eligió la última versión del esquema maduro en vez de
  estrenar la recién publicada.
- **VexFlow 4.2.5** en build UMD (expone el global `Vex.Flow`). La v5 es
  ESM-first y complicaría el "sin build step".
- Ambas URLs se verificaron con `curl` antes de escribirlas en `index.html`.

### Paso 3 — El cerebro musical: `py/teoria.py`

Python puro, sin dependencias, probable con CPython local sin navegador.
Decisiones clave:

- La nota se modela como `Nota(letra, alteracion, octava)` con los tres
  campos **separados**. Esto no es capricho: la transposición correcta de la
  Fase 2 opera sobre grados de letra (C→E siempre es una tercera) y ajusta
  la alteración después. Sumar semitonos a ciegas produciría deletreos
  incorrectos (E–Ab–B en vez de E–G#–B).
- Conversiones: nombre → MIDI (`C4 = 60`) → Hz (temperamento igual,
  `A4 = 440`). Cada semitono multiplica la frecuencia por 2^(1/12).
- `plan_de_render(nombres)` es LA función que consume JavaScript: una sola
  llamada devuelve el formato VexFlow (`"c/4"`), las alteraciones, los
  números MIDI y los Hz. Así partitura, piano y síntesis comparten una
  única fuente de verdad.
- Detalle de VexFlow que condicionó el diseño: VexFlow **no** deduce las
  alteraciones del nombre de la nota; hay que añadirlas como modificadores
  explícitos. Por eso el plan incluye la lista paralela `alteraciones`.

### Paso 4 — La síntesis: `py/sintesis.py`

- **Aditiva**: cada nota es la suma de parciales armónicos k·f con amplitud
  `caida^(k-1)` (caída exponencial, `caida = 0.55`). Los parciales que
  superan Nyquist (FS/2) se descartan para evitar aliasing.
- **Envolvente ADSR** por tramos con `np.linspace`; si la nota es más corta
  que ataque+decaimiento+liberación, los tramos se comprimen
  proporcionalmente para que la envolvente siempre quepa.
- Normalización a pico 0.8 (margen anti-recorte) y salida `float32` a
  44100 Hz, exactamente lo que espera el `AudioBuffer` de Web Audio.

Ambos módulos se verificaron primero con CPython local (asserts de parseo,
enarmonías Cb4→59 y B#3→60, longitud y pico de la señal, ausencia de NaN)
antes de tocar el navegador. Ese orden ahorró depurar dos cosas a la vez.

### Paso 5 — El puente: `js/puente-audio.js`

La cadena Pyodide → síntesis → Web Audio quedó así:

1. `loadPyodide()` + `loadPackage("numpy")` (varios segundos; la UI muestra
   el avance con mensajes de estado).
2. Los `.py` se descargan con `fetch` y se escriben al sistema de archivos
   virtual de Pyodide; luego `pyimport("teoria")` y `pyimport("sintesis")`
   los importan como módulos normales.
3. Al pulsar "▶ Escuchar": Python genera el array float32, JS lo extrae con
   `getBuffer("f32")` (vista sobre la memoria WASM), lo copia con `slice()`
   y libera la vista y el proxy para no fugar memoria.
4. El array se copia a un `AudioBuffer` y suena por un
   `AudioBufferSourceNode`.
5. El `AudioContext` se crea **dentro del click**, nunca antes: la política
   de autoplay de los navegadores exige un gesto del usuario.

### Paso 6 — Partitura y piano: `js/partitura.js`, `js/piano.js`

- La partitura recibe el plan de render ya deletreado y solo pinta:
  pentagrama, clave de sol, armadura, un `StaveNote` con varias claves
  (= acorde en bloque) y las alteraciones como modificadores.
- El piano es un SVG generado a mano (rango C3–C6): blancas primero, negras
  encima, cada tecla con su `data-midi`. Los colores viven en el CSS;
  `resaltar(midis)` solo pone y quita la clase `activa`.

### Paso 7 — El problema del día: `loadPackage` que "no falla"

La primera prueba en navegador arrojó `No module named 'numpy'` a pesar del
`await pyodide.loadPackage("numpy")`. La causa es una trampa documentable de
Pyodide: **si la descarga del paquete falla, `loadPackage` no rechaza la
promesa** — reporta el error por consola y resuelve como si nada. La
solución fue ejecutar un `import numpy` real justo después de la carga: ese
sí lanza una excepción que el manejo de errores de la app muestra en la
tarjeta, en lugar de fallar en silencio más tarde.

### Paso 8 — Verificación end-to-end en Chrome headless

Probar una app que tarda segundos en arrancar Pyodide exigió ir más allá de
`--dump-dom`:

- `--virtual-time-budget` resultó contraproducente: acelera el tiempo
  virtual pero aborta descargas grandes (fue lo que tumbó a NumPy).
- La solución fue manejar Chrome por el **DevTools Protocol** (CDP) con un
  script de Node (el WebSocket nativo de Node 22, sin dependencias):
  esperar de verdad a que el motor cargue, leer el DOM, capturar la consola
  y ejecutar JS dentro de la página.
- Resultados: motor cargado, SVGs de partitura y piano presentes, teclas
  activas exactamente `[60, 64, 67]`, síntesis en el navegador con 88200
  muestras y pico 0.8, y tras un click real el `AudioContext` quedó en
  `running`. Una captura de pantalla confirmó el render visual.

(Los scripts CDP fueron temporales, en `/tmp`; si se vuelven rutina de cada
fase, vale la pena versionarlos en una carpeta de herramientas.)

### Paso 9 — Publicación

1. Rama renombrada de `master` a `main` y `README.md` de presentación.
2. Repo público creado a mano en github.com (sin `gh` CLI en la máquina;
   la autenticación SSH ya estaba configurada y el push funcionó directo).
3. GitHub Pages activado desde Settings → Pages, sirviendo `main` / raíz.
   Como la app es estática y todas las rutas son relativas, funcionó bajo
   el subpath `/armonia-funcional-sonificada/` sin tocar nada.

### Estado al cierre

- [x] Fase 1 — prototipo mínimo, desplegado y verificado.
- Próximo paso (Fase 2): `data/capitulo-01.json`, el motor de tarjetas que
  lee ejemplos desde JSON, y el selector de tonalidad con transposición por
  intervalo en `teoria.py` (la estructura letra+alteración ya quedó lista).
