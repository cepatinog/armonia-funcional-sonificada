# Armonía Funcional Sonificada

Aplicación web educativa que sonifica, capítulo por capítulo, los ejemplos
musicales del libro **Armonía Funcional – del clásico al jazz** de Jaime
Jaramillo Arias: cada acorde, escala o progresión se muestra como partitura,
se visualiza en un teclado de piano y se puede escuchar.

**Demo:** https://cepatinog.github.io/armonia-funcional-sonificada/

## Cómo funciona

- Sitio 100% estático, sin build step ni frameworks: HTML/CSS/JS vanilla con
  librerías por CDN.
- Toda la lógica musical y la síntesis de sonido viven en **Python**,
  ejecutado en el navegador con [Pyodide](https://pyodide.org):
  - [`py/teoria.py`](py/teoria.py) — parseo de notas, MIDI/Hz, deletreo
    enarmónico y (próximamente) transposición por intervalo.
  - [`py/sintesis.py`](py/sintesis.py) — síntesis aditiva con NumPy y
    envolvente ADSR, a 44100 Hz.
- JavaScript solo hace de puente: [VexFlow](https://www.vexflow.com/) dibuja
  la partitura, un teclado SVG propio resalta las notas y Web Audio reproduce
  los buffers que genera Python.

## Ejecutar localmente

```bash
python3 -m http.server 8000
# abrir http://localhost:8000
```

(Pyodide no funciona abriendo `index.html` directamente con `file://`;
necesita servirse por http.)

## Derechos de autor

El libro es obra de Jaime Jaramillo Arias y este repositorio **no** incluye
su contenido: las descripciones de los ejemplos son parafraseadas y los PDFs
de referencia están excluidos del control de versiones.
