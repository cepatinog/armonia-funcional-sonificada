/* partitura.js — wrapper de VexFlow.
 *
 * Dibuja los ejemplos en un GRAN PENTAGRAMA (clave de sol arriba, clave de fa
 * abajo, unidas por una llave), como en el libro y en la escritura de piano.
 * Cada nota va al pentagrama que le corresponde según su altura, de modo que se
 * evitan las líneas adicionales en los registros extremos (armónicos agudos,
 * subarmónicos graves). Las figuras son redondas y, si el evento trae cifrado,
 * se rotula encima del acorde.
 *
 * Recibe los "pasos" de teoria.plan_de_eventos; aquí no hay matemática musical:
 * VexFlow solo pinta lo que Python decidió.
 */

"use strict";

const Partitura = {
  ANCHO_NOTA: 70, // ancho aproximado reservado por redonda/acorde
  MARGEN_DERECHO: 60, // aire a la derecha del último acorde (su cifrado, p. ej. "E#dim",
                      // se extiende más allá de la cabeza; que no bese el borde)
  DIVISION_MIDI: 60, // Do central: notas >= 60 a la clave de sol, el resto a la de fa

  // Posición vertical de los dos pentagramas y alto total del lienzo. Generoso
  // para que quepan las líneas adicionales de los registros extremos.
  Y_SOL: 50,
  Y_FA: 140,
  ALTO: 280,

  /* Dibuja una secuencia de notas o acordes dentro de `contenedor`.
   *
   * pasos: lista de planes de teoria.plan_de_eventos —
   *   [{ vexflow: [...], alteraciones: [...], midi: [...], cifrado: "C" }, …]
   * opciones.armadura: tonalidad de la armadura ("C" en esta fase).
   */
  dibujar(contenedor, pasos, opciones = {}) {
    const { armadura = "C" } = opciones;
    const VF = Vex.Flow;

    contenedor.innerHTML = ""; // permitir redibujar sin acumular SVGs

    // Las notas empiezan después de la clave y la ARMADURA, cuyo ancho crece con
    // el número de alteraciones (Do ocupa ~42 px; Fa#, con 6 sostenidos, ~118).
    // Se mide ese inicio (getNoteStartX funciona antes de dibujar) para dimensionar
    // el lienzo y el ancho de formateo a partir de él, en vez de un margen fijo que
    // se quedaba corto en las tonalidades con armadura grande y desbordaba el último
    // acorde fuera del pentagrama.
    const inicioNotas = Math.max(
      new VF.Stave(10, 0, 1000).addClef("treble").addKeySignature(armadura).getNoteStartX(),
      new VF.Stave(10, 0, 1000).addClef("bass").addKeySignature(armadura).getNoteStartX()
    );
    const ancho = Math.max(360, inicioNotas + pasos.length * this.ANCHO_NOTA + this.MARGEN_DERECHO);
    // Ancho real disponible para las notas: del inicio medido hasta el aire derecho.
    // Cuando aplica el mínimo (ejemplos cortos), las notas se reparten para llenarlo.
    const anchoNotas = ancho - inicioNotas - this.MARGEN_DERECHO;

    const renderer = new VF.Renderer(contenedor, VF.Renderer.Backends.SVG);
    renderer.resize(ancho, this.ALTO);
    const ctx = renderer.getContext();

    // Los dos pentagramas, al mismo x.
    const sol = new VF.Stave(10, this.Y_SOL, ancho - 20).addClef("treble").addKeySignature(armadura);
    const fa = new VF.Stave(10, this.Y_FA, ancho - 20).addClef("bass").addKeySignature(armadura);
    sol.setContext(ctx).draw();
    fa.setContext(ctx).draw();

    // Llave a la izquierda y líneas que conectan ambos pentagramas (inicio y fin).
    new VF.StaveConnector(sol, fa).setType(VF.StaveConnector.type.BRACE).setContext(ctx).draw();
    new VF.StaveConnector(sol, fa).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
    new VF.StaveConnector(sol, fa).setType(VF.StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();

    // Repartir cada paso entre los dos pentagramas; donde un pentagrama no tiene
    // notas se coloca una nota fantasma (invisible) para mantener la alineación.
    const notasSol = [];
    const notasFa = [];
    pasos.forEach((paso) => {
      const idxSol = [];
      const idxFa = [];
      paso.midi.forEach((m, i) => (m >= this.DIVISION_MIDI ? idxSol : idxFa).push(i));

      const notaSol = this._figura(VF, paso, idxSol, "treble");
      const notaFa = this._figura(VF, paso, idxFa, "bass");
      notasSol.push(notaSol);
      notasFa.push(notaFa);

      // Cifrado encima del acorde, en el pentagrama que tenga la nota (preferimos
      // el de sol, que es donde suele quedar la voz superior del acorde).
      if (paso.cifrado) {
        const destino = idxSol.length ? notaSol : notaFa;
        destino.addModifier(new VF.ChordSymbol().addText(paso.cifrado), 0);
      }
    });

    const vozSol = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT);
    const vozFa = new VF.Voice({ num_beats: 4, beat_value: 4 }).setMode(VF.Voice.Mode.SOFT);
    vozSol.addTickables(notasSol);
    vozFa.addTickables(notasFa);

    // Formatear ambas voces juntas para que coincidan en el eje horizontal,
    // dentro del ancho real disponible para notas (sin invadir clave/armadura
    // a la izquierda ni el borde a la derecha).
    new VF.Formatter()
      .joinVoices([vozSol])
      .joinVoices([vozFa])
      .format([vozSol, vozFa], anchoNotas);
    vozSol.draw(ctx, sol);
    vozFa.draw(ctx, fa);
  },

  /* Una redonda con las notas de `indices`, o una nota fantasma (invisible) si
   * ese pentagrama no recibe ninguna nota en este paso. */
  _figura(VF, paso, indices, clave) {
    if (indices.length === 0) {
      return new VF.GhostNote({ duration: "w" });
    }
    const nota = new VF.StaveNote({
      clef: clave,
      keys: indices.map((i) => paso.vexflow[i]),
      duration: "w",
    });
    // VexFlow no deduce alteraciones del nombre: se añaden una a una, tal como
    // las entregó teoria.py (el índice es la posición dentro de ESTA figura).
    indices.forEach((i, pos) => {
      if (paso.alteraciones[i] !== "") {
        nota.addModifier(new VF.Accidental(paso.alteraciones[i]), pos);
      }
    });
    return nota;
  },
};
