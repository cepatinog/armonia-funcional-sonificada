/* piano.js — teclado de piano en SVG propio.
 *
 * Dibuja un rango de teclas y resalta las notas del ejemplo activo por
 * número MIDI (que viene de teoria.py vía el plan de render). Los colores
 * los define css/estilos.css; aquí solo se ponen clases.
 */

"use strict";

const Piano = {
  // Geometría en unidades del viewBox del SVG.
  ANCHO_BLANCA: 26,
  ALTO_BLANCA: 110,
  ANCHO_NEGRA: 16,
  ALTO_NEGRA: 68,

  svg: null,

  /* ¿La clase de altura es tecla negra? (C#=1, D#=3, F#=6, G#=8, A#=10) */
  esNegra(midi) {
    return [1, 3, 6, 8, 10].includes(midi % 12);
  },

  /* Dibuja el teclado entre dos números MIDI (por defecto C3=48 … C6=84).
   * Las blancas se dibujan primero y las negras después, para que queden
   * encima. Cada tecla lleva su número MIDI en data-midi. */
  dibujar(contenedor, midiInicio = 48, midiFin = 84) {
    const NS = "http://www.w3.org/2000/svg";
    const blancas = [];
    const negras = [];

    let xBlanca = 0; // posición de la próxima tecla blanca
    for (let midi = midiInicio; midi <= midiFin; midi++) {
      if (this.esNegra(midi)) {
        // La negra se centra sobre la frontera entre la blanca anterior
        // y la siguiente (xBlanca ya apunta a esa frontera).
        negras.push({ midi, x: xBlanca - this.ANCHO_NEGRA / 2 });
      } else {
        blancas.push({ midi, x: xBlanca });
        xBlanca += this.ANCHO_BLANCA;
      }
    }

    const anchoTotal = xBlanca;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${anchoTotal} ${this.ALTO_BLANCA}`);
    svg.setAttribute("width", anchoTotal);
    svg.setAttribute("height", this.ALTO_BLANCA);

    const crearTecla = ({ midi, x }, esNegra) => {
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", x);
      rect.setAttribute("y", 0);
      rect.setAttribute("width", esNegra ? this.ANCHO_NEGRA : this.ANCHO_BLANCA);
      rect.setAttribute("height", esNegra ? this.ALTO_NEGRA : this.ALTO_BLANCA);
      rect.setAttribute("class", esNegra ? "tecla-negra" : "tecla-blanca");
      rect.dataset.midi = midi;
      svg.appendChild(rect);
    };

    blancas.forEach((tecla) => crearTecla(tecla, false));
    negras.forEach((tecla) => crearTecla(tecla, true));

    contenedor.innerHTML = "";
    contenedor.appendChild(svg);
    this.svg = svg;
  },

  /* Resalta las teclas de los números MIDI dados y apaga el resto. */
  resaltar(midis) {
    const activas = new Set(midis);
    for (const tecla of this.svg.querySelectorAll("rect")) {
      tecla.classList.toggle("activa", activas.has(Number(tecla.dataset.midi)));
    }
  },
};
