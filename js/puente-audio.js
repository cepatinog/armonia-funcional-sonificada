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

  /* Plan para un ejemplo de varios eventos (secuencia o progresión), ya
   * transpuesto a `tonalidad` (los ejemplos se guardan en Do):
   * { pasos: [ {vexflow, alteraciones, midi, hz}, … ], midi_union: [..] }.
   * Los eventos viajan a Python como string JSON. */
  planDeEventos(eventos, tonalidad = "C") {
    const proxy = this.teoria.plan_de_eventos(JSON.stringify(eventos), tonalidad);
    const plan = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy();
    return plan;
  },

  /* Cronología de resaltado del piano para un ejemplo+modo (de sintesis.py),
   * transpuesta a `tonalidad`:
   * { segmentos: [ {t: seg, midis: [..]}, .. ], total: seg }. */
  lineaDeTiempo(eventos, modo, tonalidad = "C") {
    const proxy = this.sintesis.linea_de_tiempo(JSON.stringify(eventos), modo, tonalidad);
    const linea = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy();
    return linea;
  },

  /* Crea o reactiva el AudioContext. Solo puede hacerse tras un gesto del
   * usuario (política de autoplay), por eso no vive en iniciar(). */
  async _asegurarAudio() {
    if (this.audioCtx === null) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.FS,
      });
    }
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }
  },

  /* Copia las muestras float32 de un PyProxy (vista sobre la memoria WASM) al
   * heap de JS con slice() y libera la memoria del lado Python. */
  _extraerMuestras(proxy) {
    const vista = proxy.getBuffer("f32");
    const muestras = vista.data.slice();
    vista.release();
    proxy.destroy();
    return muestras;
  },

  /* Reproduce un array float32 y devuelve una promesa que se resuelve cuando el
   * sonido termina. Si se pasan `linea` (cronología de sintesis.py) y la función
   * `alResaltar(midis)`, enciende el teclado en sincronía con el audio y lo apaga
   * al terminar. */
  reproducir(muestras, linea = null, alResaltar = null) {
    const buffer = this.audioCtx.createBuffer(1, muestras.length, this.FS);
    buffer.copyToChannel(muestras, 0);

    const fuente = this.audioCtx.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(this.audioCtx.destination);

    return new Promise((resolver) => {
      const t0 = this.audioCtx.currentTime;
      fuente.onended = () => {
        if (alResaltar) alResaltar([]); // apagar el teclado al terminar
        resolver();
      };
      fuente.start();
      if (linea && alResaltar) this._sincronizarResaltado(linea, t0, alResaltar);
    });
  },

  /* Enciende el teclado siguiendo la cronología, guiándose por el reloj del
   * AudioContext (no por temporizadores, que se desajustan). */
  _sincronizarResaltado(linea, t0, alResaltar) {
    const segmentos = linea.segmentos || [];
    // El sonido se OYE un poco después de programarse; se descuenta esa latencia
    // para que la imagen coincida con lo que se escucha.
    const latencia = this.audioCtx.outputLatency || this.audioCtx.baseLatency || 0;
    let i = 0;
    const paso = () => {
      const transcurrido = this.audioCtx.currentTime - t0 - latencia;
      while (i < segmentos.length && transcurrido >= segmentos[i].t) {
        alResaltar(segmentos[i].midis);
        i++;
      }
      if (i < segmentos.length) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  },

  /* Sintetiza un acorde en bloque en Python (transpuesto a `tonalidad`) y lo
   * reproduce. */
  async tocarAcorde(notas, dur = 2.0, tonalidad = "C") {
    await this._asegurarAudio();
    return this.reproducir(this._extraerMuestras(this.sintesis.acorde_bloque(notas, dur, tonalidad)));
  },

  /* Reproduce una secuencia ("secuencial" o "acumulativo") en `tonalidad`. Si
   * se da `alResaltar`, sincroniza el teclado con el audio. */
  async tocarSecuencia(eventos, modo = "secuencial", alResaltar = null, tonalidad = "C") {
    await this._asegurarAudio();
    const muestras = this._extraerMuestras(this.sintesis.secuencia(JSON.stringify(eventos), modo, tonalidad));
    const linea = alResaltar ? this.lineaDeTiempo(eventos, modo, tonalidad) : null;
    return this.reproducir(muestras, linea, alResaltar);
  },

  /* Reproduce una progresión de acordes ("bloque" o "arpegio") en `tonalidad`.
   * Si se da `alResaltar`, sincroniza el teclado con el audio. */
  async tocarProgresion(eventos, modo = "bloque", alResaltar = null, tonalidad = "C") {
    await this._asegurarAudio();
    const muestras = this._extraerMuestras(this.sintesis.progresion(JSON.stringify(eventos), modo, tonalidad));
    const linea = alResaltar ? this.lineaDeTiempo(eventos, modo, tonalidad) : null;
    return this.reproducir(muestras, linea, alResaltar);
  },
};
