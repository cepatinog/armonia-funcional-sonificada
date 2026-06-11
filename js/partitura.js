/* partitura.js — wrapper de VexFlow.
 *
 * Recibe notas YA transpuestas y deletreadas por teoria.py (el "plan de
 * render") y las dibuja en un pentagrama SVG. Aquí no hay matemática
 * musical: VexFlow solo pinta lo que Python decidió.
 */

"use strict";

const Partitura = {
  /* Dibuja un acorde en redonda dentro de `contenedor`.
   *
   * plan: objeto de teoria.plan_de_render —
   *   { vexflow: ["c/4", "e/4", "g/4"], alteraciones: ["", "", ""], … }
   * opciones.armadura: tonalidad de la armadura ("C" en la Fase 1).
   */
  dibujarAcorde(contenedor, plan, opciones = {}) {
    const { armadura = "C", ancho = 320, alto = 160 } = opciones;
    const VF = Vex.Flow;

    contenedor.innerHTML = ""; // permitir redibujar sin acumular SVGs

    const renderer = new VF.Renderer(contenedor, VF.Renderer.Backends.SVG);
    renderer.resize(ancho, alto);
    const contexto = renderer.getContext();

    const pentagrama = new VF.Stave(10, 30, ancho - 20);
    pentagrama.addClef("treble").addKeySignature(armadura);
    pentagrama.setContext(contexto).draw();

    // Un solo StaveNote con varias claves = acorde en bloque.
    const acorde = new VF.StaveNote({ keys: plan.vexflow, duration: "w" });

    // VexFlow no deduce alteraciones del nombre: se añaden una a una,
    // tal como las entregó teoria.py.
    plan.alteraciones.forEach((alteracion, i) => {
      if (alteracion !== "") {
        acorde.addModifier(new VF.Accidental(alteracion), i);
      }
    });

    const voz = new VF.Voice({ num_beats: 4, beat_value: 4 });
    voz.addTickables([acorde]);
    new VF.Formatter().joinVoices([voz]).format([voz], ancho - 120);
    voz.draw(contexto, pentagrama);
  },
};
