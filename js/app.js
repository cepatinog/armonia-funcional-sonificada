/* app.js — orquestador de la Fase 2.
 *
 * Motor dirigido por datos: carga data/capitulo-01.json, muestra los ejemplos
 * de uno en uno (con navegación) y, por cada ejemplo, ofrece un botón por modo
 * de reproducción. Flujo por ejemplo:
 *
 *   1. teoria.plan_de_eventos → partitura + teclas resaltadas (una sola llamada).
 *   2. Un botón por cada modo (secuencial, acumulativo, bloque, arpegio) que
 *      pide a sintesis.py el audio y lo reproduce.
 *
 * Toda la matemática musical y la síntesis viven en Python; aquí solo se arma
 * la interfaz y se conmuta entre ejemplos.
 */

"use strict";

let EJEMPLOS = [];
let indice = 0;
let TONALIDAD = "C"; // tonalidad activa; los ejemplos se guardan en Do y se transponen

// Qué función del Motor reproduce cada modo. Las secuencias y acumulaciones
// suenan en el tiempo (tocarSecuencia); bloques y arpegios son progresiones.
const TOCAR_POR_MODO = {
  secuencial: (eventos, modo, alResaltar, ton) => Motor.tocarSecuencia(eventos, modo, alResaltar, ton),
  acumulativo: (eventos, modo, alResaltar, ton) => Motor.tocarSecuencia(eventos, modo, alResaltar, ton),
  bloque: (eventos, modo, alResaltar, ton) => Motor.tocarProgresion(eventos, modo, alResaltar, ton),
  arpegio: (eventos, modo, alResaltar, ton) => Motor.tocarProgresion(eventos, modo, alResaltar, ton),
};

const ETIQUETA_MODO = {
  secuencial: "▶ Secuencial",
  acumulativo: "▶ Acumulativo",
  bloque: "▶ Bloque",
  arpegio: "▶ Arpegio",
};

async function iniciarApp() {
  const estado = document.getElementById("estado-motor");

  // 1. Cargar los datos del capítulo.
  let datos;
  try {
    const respuesta = await fetch("data/capitulo-01.json");
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    datos = await respuesta.json();
  } catch (error) {
    estado.textContent =
      "No se pudo cargar data/capitulo-01.json. Sirve la app por http " +
      "(python3 -m http.server). Detalle: " + error.message;
    estado.classList.add("error");
    console.error(error);
    return;
  }
  EJEMPLOS = datos.ejemplos;
  document.getElementById("titulo-capitulo").textContent =
    `Capítulo ${datos.capitulo} · ${datos.titulo}`;

  // 2. Arrancar el motor musical (Pyodide + NumPy + teoria/sintesis).
  try {
    await Motor.iniciar((mensaje) => {
      estado.textContent = mensaje;
    });
  } catch (error) {
    estado.textContent =
      "No se pudo cargar el motor musical. Revisa tu conexión y que la app se " +
      "sirva por http (no file://). Detalle: " + error.message;
    estado.classList.add("error");
    console.error(error);
    return;
  }
  estado.classList.add("oculto");

  // 3. Navegación entre ejemplos.
  document.getElementById("boton-anterior").addEventListener("click", () => {
    mostrarEjemplo(indice - 1);
  });
  document.getElementById("boton-siguiente").addEventListener("click", () => {
    mostrarEjemplo(indice + 1);
  });

  // 4. Selector de tonalidad: al cambiar, repinta el ejemplo actual (partitura
  //    con armadura nueva y piano re-rangeado); la reproducción usa TONALIDAD.
  document.getElementById("selector-tonalidad").addEventListener("change", (e) => {
    TONALIDAD = e.target.value;
    mostrarEjemplo(indice);
  });

  mostrarEjemplo(0);
}

/* Pinta el ejemplo en posición `i` (acotada al rango válido). */
function mostrarEjemplo(i) {
  indice = Math.max(0, Math.min(i, EJEMPLOS.length - 1));
  const ejemplo = EJEMPLOS[indice];

  document.getElementById("titulo-ejemplo").textContent = ejemplo.titulo;
  document.getElementById("descripcion-ejemplo").textContent = ejemplo.descripcion;
  document.getElementById("contador-ejemplo").textContent =
    `${indice + 1} / ${EJEMPLOS.length}`;

  // Una sola llamada a Python alimenta partitura y piano, ya en la tonalidad
  // activa (notas transpuestas + armadura destino).
  const plan = Motor.planDeEventos(ejemplo.eventos, TONALIDAD);
  Partitura.dibujar(document.getElementById("partitura"), plan.pasos, { armadura: TONALIDAD });
  dibujarPiano(plan.midi_union);

  construirBotonesModo(ejemplo);
  actualizarNav();
}

/* Dibuja el teclado con un rango que cubre las notas del ejemplo (con margen).
 * No resalta nada en reposo: las teclas se encienden al reproducir, en sincronía
 * con el audio. El rango es necesario porque el cap. 1 baja a Bb1/F1 y sube a F#6,
 * fuera del rango por defecto del piano. */
function dibujarPiano(midis) {
  let lo = Math.min(...midis) - 2;
  let hi = Math.max(...midis) + 2;
  while (lo % 12 !== 0) lo--; // empezar en un Do (tecla blanca)
  while (hi % 12 !== 0) hi++; // terminar en un Do
  Piano.dibujar(document.getElementById("piano"), lo, hi);
}

/* Crea un botón por cada modo del ejemplo y lo conecta a la síntesis. */
function construirBotonesModo(ejemplo) {
  const zona = document.getElementById("modos");
  zona.innerHTML = "";
  for (const modo of ejemplo.modos) {
    const boton = document.createElement("button");
    boton.className = "boton-modo";
    boton.textContent = ETIQUETA_MODO[modo] || "▶ " + modo;
    boton.addEventListener("click", async () => {
      bloquearControles(true); // evitar reproducciones encimadas y navegar a media reproducción
      try {
        await TOCAR_POR_MODO[modo](ejemplo.eventos, modo, (midis) => Piano.resaltar(midis), TONALIDAD);
      } finally {
        bloquearControles(false);
      }
    });
    zona.appendChild(boton);
  }
}

/* Bloquea botones de modo y navegación mientras suena un ejemplo; al desbloquear
 * restituye el estado correcto de la navegación según la posición actual. */
function bloquearControles(bloqueado) {
  for (const boton of document.querySelectorAll("#modos .boton-modo")) {
    boton.disabled = bloqueado;
  }
  document.getElementById("selector-tonalidad").disabled = bloqueado;
  if (bloqueado) {
    document.getElementById("boton-anterior").disabled = true;
    document.getElementById("boton-siguiente").disabled = true;
  } else {
    actualizarNav();
  }
}

function actualizarNav() {
  document.getElementById("boton-anterior").disabled = indice === 0;
  document.getElementById("boton-siguiente").disabled = indice === EJEMPLOS.length - 1;
}

document.addEventListener("DOMContentLoaded", iniciarApp);
