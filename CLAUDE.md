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

Cada capítulo es un archivo `data/capitulo-XX.json` con una lista de ejemplos:

```json
{
  "capitulo": 1,
  "titulo": "La armonía tonal funcional",
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
        { "cifrado": "C",  "notas": ["C3", "E4", "G4", "C5"], "dur": 1.5 },
        { "cifrado": "Dm", "notas": ["D3", "F4", "A4", "D5"], "dur": 1.5 }
      ],
      "modos": ["bloque", "arpegio"]
    }
  ]
}
```

Tipos previstos: "acorde", "progresion", "escala", "secuencia", "voces"
(para cantar/escuchar voces por separado: el libro insiste en ello).
El esquema puede crecer, pero todo cambio se documenta aquí.

## Estructura del repositorio

```
index.html          ← navegación por capítulos, contenedor de la app
css/estilos.css
js/app.js           ← carga JSON, construye tarjetas de ejemplos
js/partitura.js     ← wrapper de VexFlow
js/piano.js         ← teclado SVG
js/puente-audio.js  ← init de Pyodide + Web Audio
py/teoria.py
py/sintesis.py
data/capitulo-XX.json
referencias/        ← PDFs del libro (NO se publica: está en .gitignore)
```

## Flujo de trabajo por capítulo

1. El usuario indica qué PDF leer en `referencias/`.
2. Claude lee el capítulo y propone el `capitulo-XX.json` con todos los
   ejemplos musicales identificados, parafraseando las descripciones.
3. El usuario revisa/ajusta el JSON (él es el experto musical).
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
- [ ] Transposición a las 12 tonalidades con deletreo enarmónico + selector
  (la estructura letra+alteración de `teoria.py` ya está lista).
- [ ] Fase 3: refinamiento sonoro (timbres, voces separadas)
- [ ] Fase 4: navegación completa por capítulos + más capítulos
(Actualizar esta lista al completar cada fase.)