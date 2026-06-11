# Bitácora del proyecto

Registro de las sesiones de trabajo: qué se hizo, qué decisiones se tomaron
y por qué, qué problemas aparecieron y cómo se resolvieron. La entrada más
reciente va primero.

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
