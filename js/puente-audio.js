/* puente-audio.js — el puente entre Python (Pyodide) y el navegador.
 *
 * Responsabilidades:
 *   1. Arrancar Pyodide, cargar NumPy y los módulos py/teoria.py y py/sintesis.py.
 *   2. Exponer la teoría musical a la interfaz (Motor.planDeRender).
 *   3. Convertir los arrays float32 que genera Python en AudioBuffers
 *      y reproducirlos con Web Audio (Motor.tocarAcorde).
 *
 * JavaScript no calcula nada musical: solo transporta datos y reproduce.
 */

"use strict";

const Motor = {
  pyodide: null,
  teoria: null,    // módulo Python importado (PyProxy persistente)
  sintesis: null,  // ídem
  audioCtx: null,

  FS: 44100, // debe coincidir con sintesis.FS

  /* Arranca todo el motor. `alProgresar(mensaje)` informa a la UI del avance,
   * porque la descarga de Pyodide + NumPy tarda varios segundos. */
  async iniciar(alProgresar = () => {}) {
    alProgresar("Cargando Pyodide…");
    this.pyodide = await loadPyodide();

    alProgresar("Cargando NumPy…");
    await this.pyodide.loadPackage("numpy");
    // Ojo: loadPackage NO rechaza la promesa si la descarga falla (solo lo
    // reporta por consola). Un import real sí lanza error si numpy no está.
    this.pyodide.runPython("import numpy");

    alProgresar("Cargando teoria.py y sintesis.py…");
    // Los .py se sirven como archivos estáticos; se copian al sistema de
    // archivos virtual de Pyodide y se importan como módulos normales.
    for (const nombre of ["teoria", "sintesis"]) {
      const respuesta = await fetch(`py/${nombre}.py`);
      if (!respuesta.ok) {
        throw new Error(`No se pudo cargar py/${nombre}.py (${respuesta.status})`);
      }
      this.pyodide.FS.writeFile(`/home/pyodide/${nombre}.py`, await respuesta.text());
    }
    this.pyodide.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
    this.teoria = this.pyodide.pyimport("teoria");
    this.sintesis = this.pyodide.pyimport("sintesis");

    alProgresar("Motor musical listo.");
  },

  /* Pide a teoria.py todo lo necesario para pintar unas notas:
   * { vexflow: ["c/4", …], alteraciones: ["", …], midi: [60, …], hz: [261.63, …] } */
  planDeRender(notas) {
    const proxy = this.teoria.plan_de_render(notas);
    const plan = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy(); // liberar la memoria del lado Python
    return plan;
  },

  /* Sintetiza un acorde en Python y lo reproduce. Devuelve una promesa que
   * se resuelve cuando el sonido termina (útil para deshabilitar el botón). */
  async tocarAcorde(notas, dur = 2.0) {
    // El AudioContext solo puede crearse/activarse tras un gesto del usuario
    // (política de autoplay), por eso vive aquí y no en iniciar().
    if (this.audioCtx === null) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.FS,
      });
    }
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    // Python devuelve np.float32; getBuffer da una vista sobre la memoria
    // WASM, que copiamos con slice() antes de liberarla.
    const proxy = this.sintesis.acorde_bloque(notas, dur);
    const vista = proxy.getBuffer("f32");
    const muestras = vista.data.slice();
    vista.release();
    proxy.destroy();

    const buffer = this.audioCtx.createBuffer(1, muestras.length, this.FS);
    buffer.copyToChannel(muestras, 0);

    const fuente = this.audioCtx.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(this.audioCtx.destination);

    return new Promise((resolver) => {
      fuente.onended = resolver;
      fuente.start();
    });
  },
};
