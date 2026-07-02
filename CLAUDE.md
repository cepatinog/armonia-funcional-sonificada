# Armonía Funcional Sonificada

## Qué es este proyecto

Aplicación web educativa que sonifica los ejemplos del libro *Armonía Funcional
– del clásico al jazz* de Jaime Jaramillo Arias, capítulo por capítulo. Cada
ejemplo musical (acorde, escala, progresión, columna de armónicos) se muestra
como partitura, se visualiza en un teclado de piano, y se puede escuchar.

El usuario es trombonista profesional y músico-tecnólogo (Python intermedio,
Librosa/Essentia, formación en física). Las explicaciones técnicas pueden ser
profundas; el código debe ser legible y pedagógico, no críptico.

## Arquitectura (decisiones firmes, no cambiar sin discutirlo)

- **Sitio 100% estático**, desplegable en GitHub Pages. Sin servidores, sin
  build step, sin bundlers, sin frameworks (no React, no Vite, no npm).
  Vanilla HTML/CSS/JS con librerías por CDN.
- **Toda la lógica musical y de sonido vive en Python**, ejecutado en el
  navegador con **Pyodide**. JavaScript es solo el puente: UI, render y
  reproducción.
  - `py/teoria.py`: el "cerebro musical". Parseo de notas ("C4", "Bb3"),
    conversión a MIDI/Hz, construcción de acordes/escalas, y **transposición
    con deletreo enarmónico correcto** (ver sección Transposición).
  - `py/sintesis.py`: síntesis con NumPy. Aditiva (parciales con caída
    exponencial), envolvente ADSR, acordes en bloque, arpegios, progresiones.
    Devuelve arrays float32 a 44100 Hz.
- **Notación**: VexFlow (CDN) renderiza el pentagrama en SVG. VexFlow recibe
  los nombres de nota YA transpuestos y deletreados por `teoria.py` — nunca
  hace matemática musical por su cuenta.
- **Piano**: teclado SVG propio en JS, resalta las teclas del ejemplo activo.
- **Audio**: Web Audio API reproduce los buffers que genera Python
  (AudioBuffer desde el float32 array). No hay streaming en tiempo real.

## Transposición (requisito de primera clase)

Los ejemplos del libro están normalizados a Do. La app debe poder reproducir
y MOSTRAR cualquier ejemplo en las 12 tonalidades:

- Los JSON de datos siempre guardan los ejemplos en Do, tal como en el libro.
- La transposición ocurre en runtime, en `teoria.py`, y alimenta TANTO la
  síntesis como la partitura y el piano (única fuente de verdad).
- La transposición debe ser por intervalo (letra + alteración), NO por simple
  desplazamiento cromático de semitonos, para que el deletreo sea correcto:
  C–E–G transpuesto a Mi mayor es E–G#–B, nunca E–Ab–B.
- Deletreos convencionales de las 12 tonalidades mayores destino:
  C, Db, D, Eb, E, F, F#, G, Ab, A, Bb, B.
- La partitura debe mostrar la armadura de la tonalidad destino.

## Modelo de datos

`data/indice.json` es el **manifiesto del libro**: título, autor y la lista de
capítulos (`{numero, titulo, archivo, disponible}`). La portada (vista índice)
pinta una tarjeta por capítulo; solo los `disponible: true` son navegables.

Cada capítulo es un archivo `data/capitulo-XX.json` con una lista de ejemplos:

```json
{
  "capitulo": 1,
  "titulo": "La armonía tonal funcional",
  "concepto": "Idea general del capítulo (paráfrasis; se muestra sobre los ejemplos)",
  "ejemplos": [
    {
      "id": "cap01-ej01",
      "titulo": "Columna de armónicos desde C2",
      "descripcion": "Parafraseo breve del concepto (nunca texto literal del libro)",
      "tipo": "secuencia",
      "eventos": [
        { "notas": ["C2"], "dur": 0.6 },
        { "notas": ["C3"], "dur": 0.6 }
      ],
      "modos": ["secuencial", "acumulativo"]
    },
    {
      "id": "cap01-ej02",
      "titulo": "Triadas diatónicas de la escala mayor",
      "tipo": "progresion",
      "eventos": [
        { "cifrado": "C",  "notas": ["C3", "E4", "G4", "C5"], "dur": 1.5,
          "colores": ["", "verde", "", ""] },
        { "cifrado": "Dm", "notas": ["D3", "F4", "A4", "D5"], "dur": 1.5 }
      ],
      "modos": ["bloque", "arpegio"]
    }
  ]
}
```

Campos por evento: `notas` (siempre en Do; se transponen en runtime), `dur`
(segundos, **obligatorio**), `cifrado` (opcional) y `colores` (opcional, lista
**paralela** a `notas`). Cada capítulo puede traer `concepto` (idea general).

Tipos previstos: "acorde", "progresion", "escala", "secuencia", "voces"
(para cantar/escuchar voces por separado: el libro insiste en ello).
El esquema puede crecer, pero todo cambio se documenta aquí.

### Notas coloreadas
El autor del libro resalta con color el grado que **define** cada función tonal.
Se reproduce ese coloreado: `colores` usa nombres semánticos (`""`, `"verde"`,
`"naranja"`, `"rojo"`) y `teoria.py` (`COLORES`) es la única fuente de verdad de
los tonos (hex medidos de las láminas): verde = 3ª (tónica), naranja = 4ª
(subdominante), rojo = 7ª (dominante). El color es **posicional** (va atado al
índice de la nota en el evento) y la transposición conserva el orden, así que
viaja a las 12 tonalidades sin lógica nueva (la nota verde sigue siendo la 3ª).
`partitura.js` solo pinta la cabeza (`setKeyStyle`); sin color → negro.

## Estructura del repositorio

```
index.html          ← dos vistas (índice + visor), contenedor de la app
css/estilos.css
js/app.js           ← enrutado por hash, vista índice y vista capítulo
js/partitura.js     ← wrapper de VexFlow (incluye color de cabezas)
js/piano.js         ← teclado SVG
js/puente-audio.js  ← init de Pyodide + Web Audio
py/teoria.py
py/sintesis.py
data/indice.json    ← manifiesto de capítulos (portada)
data/capitulo-XX.json
referencias/        ← PDFs e imágenes del libro (NO se publica: .gitignore)
```

La navegación es una SPA estática enrutada por el **hash** de la URL
(`""`/`#indice` → portada; `#cap-NN` → capítulo), sin build step y compatible
con el subpath de GitHub Pages. El motor (Pyodide+NumPy) arranca UNA vez de
fondo mientras se ve el índice; la vista de capítulo lo espera antes de
renderizar (partitura y piano dependen de Python).

## Flujo de trabajo por capítulo

1. El usuario sube las **imágenes literales** de los ejemplos del libro a
   `referencias/capN/` (fuente prioritaria a transcribir). El texto del capítulo
   puede leerse de los PDFs de `referencias/`.
2. Claude transcribe los ejemplos a `capitulo-XX.json` (notas, cifrado y
   `colores` tal como los colorea el autor), parafrasea el `concepto` del
   capítulo y las `descripcion` de cada ejemplo (nunca texto literal).
3. El usuario revisa/ajusta el JSON, sobre todo los voicings (él es el experto).
4. Si el capítulo introduce un tipo de ejemplo nuevo, se extiende el motor.

## Derechos de autor

El libro es material con derechos de Jaime Jaramillo Arias. Las descripciones
en los JSON se parafrasean siempre; nunca copiar párrafos literales. Los PDFs
en `referencias/` no se versionan ni se publican (.gitignore).

## Convenciones

- Código, comentarios, nombres de variables y commits en español.
- Probar siempre con `python3 -m http.server 8000` desde la raíz
  (Pyodide NO funciona abriendo index.html con file://).
- Commits pequeños y frecuentes; cada fase termina con la app funcionando.
- Sin dependencias nuevas sin discutirlo antes.

## Estado actual

- [x] Fase 1: prototipo mínimo (un acorde de Do mayor: partitura + piano + sonido)
- [x] Fase 2: motor de capítulos desde JSON — visor con navegación, gran
  pentagrama con cifrado y piano sincronizado con el audio (capítulo 1
  sonificado en Do; modos secuencial/acumulativo/bloque/arpegio).
- [x] Transposición a las 12 tonalidades con deletreo enarmónico + selector.
  `teoria.py` transpone POR INTERVALO (notas y cifrado); el motor recibe
  `tonalidad` (`plan_de_eventos`, `secuencia`, `progresion`, `acorde_bloque`,
  `linea_de_tiempo`). Decisiones: **registro cercano** (máx. ±6 semitonos, para
  mantener el ejemplo en la misma octava en las 12 tonalidades) y **alteraciones
  de imprenta** (`alteracion_visible` dibuja la alteración solo cuando difiere de
  la armadura, con becuadros donde haga falta). La partitura usa la armadura de
  la tonalidad destino.
- [x] Navegación por capítulos (Fase 4, base): SPA de dos vistas enrutada por
  hash, portada con tarjetas desde `data/indice.json`, motor de fondo. Texto de
  concepto por capítulo. **Notas coloreadas** como el autor (paleta en
  `teoria.py`, color por cabeza en `partitura.js`).
- [x] Capítulo 2 sonificado ("Funciones de la armonía tonal funcional"): las 7
  triadas por función con color (verde 3ª / naranja 4ª / rojo 7ª) + progresión y
  retrogresión. Transcrito de `referencias/cap2/`.
- [ ] Fase 3: refinamiento sonoro (timbres, voces separadas)
- [ ] Fase 4: más capítulos (3+)
(Actualizar esta lista al completar cada fase.)