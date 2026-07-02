/* app.js — orquestador de la app.
 *
 * SPA estática de dos vistas, enrutada por el hash de la URL (sin build step,
 * compatible con el subpath de GitHub Pages):
 *
 *   ""/"#indice"  → ÍNDICE: portada con los capítulos del libro como tarjetas.
 *   "#cap-NN"     → VISOR: un capítulo, con sus ejemplos de uno en uno.
 *
 * El motor musical (Pyodide + NumPy + teoria/sintesis) se arranca UNA sola vez, de
 * fondo, mientras el usuario mira el índice; la vista de capítulo espera esa promesa
 * antes de renderizar, porque la partitura y el piano dependen de plan_de_eventos
 * (que corre en Python). Toda la matemática musical y la síntesis viven en Python;
 * aquí solo se arma la interfaz y se conmuta entre vistas.
 */

"use strict";

let MANIFIESTO = null;   // data/indice.json (título del libro + lista de capítulos)
let motorListo = null;   // promesa única del arranque del motor
let EJEMPLOS = [];        // ejemplos del capítulo activo
let indice = 0;           // índice del ejemplo mostrado
let TONALIDAD = "C";      // tonalidad activa; se conserva entre capítulos

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

  // 1. Cargar el manifiesto de capítulos.
  try {
    const respuesta = await fetch("data/indice.json");
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    MANIFIESTO = await respuesta.json();
  } catch (error) {
    estado.textContent =
      "No se pudo cargar data/indice.json. Sirve la app por http " +
      "(python3 -m http.server). Detalle: " + error.message;
    estado.classList.add("error");
    console.error(error);
    return;
  }

  // 2. Arrancar el motor de fondo (sin await): se carga mientras se ve el índice.
  motorListo = Motor.iniciar((mensaje) => { estado.textContent = mensaje; })
    .then(() => estado.classList.add("oculto"))
    .catch((error) => {
      estado.textContent =
        "No se pudo cargar el motor musical. Revisa tu conexión y que la app se " +
        "sirva por http (no file://). Detalle: " + error.message;
      estado.classList.remove("oculto");
      estado.classList.add("error");
      console.error(error);
      throw error;
    });

  // 3. Listeners globales.
  window.addEventListener("hashchange", enrutar);
  document.getElementById("boton-indice").addEventListener("click", () => {
    location.hash = ""; // volver al índice
  });
  document.getElementById("boton-anterior").addEventListener("click", () => {
    mostrarEjemplo(indice - 1);
  });
  document.getElementById("boton-siguiente").addEventListener("click", () => {
    mostrarEjemplo(indice + 1);
  });
  // Selector de tonalidad: al cambiar, repinta el ejemplo actual (partitura con
  // armadura nueva y piano re-rangeado); la reproducción usa TONALIDAD.
  document.getElementById("selector-tonalidad").addEventListener("change", (e) => {
    TONALIDAD = e.target.value;
    mostrarEjemplo(indice);
  });

  // 4. Resolver la ruta actual (permite entrar directo con #cap-NN).
  enrutar();
}

/* Muestra la vista que corresponde al hash de la URL. */
function enrutar() {
  const coincidencia = location.hash.match(/^#cap-(\d+)/);
  if (coincidencia) {
    vistaCapitulo(parseInt(coincidencia[1], 10));
  } else {
    vistaIndice();
  }
}

/* Alterna qué sección (índice / visor) está visible. */
function mostrarVista(cual) {
  document.getElementById("indice").classList.toggle("oculto", cual !== "indice");
  document.getElementById("visor").classList.toggle("oculto", cual !== "visor");
}

/* VISTA ÍNDICE: portada con los capítulos del libro como tarjetas. Las
 * disponibles enlazan a #cap-NN; el resto se muestra atenuado como hoja de ruta. */
function vistaIndice() {
  mostrarVista("indice");
  document.getElementById("indice-titulo").textContent =
    `${MANIFIESTO.titulo} · ${MANIFIESTO.autor}`;

  const lista = document.getElementById("lista-capitulos");
  lista.innerHTML = "";
  for (const cap of MANIFIESTO.capitulos) {
    const num = String(cap.numero).padStart(2, "0");
    let tarjeta;
    if (cap.disponible) {
      tarjeta = document.createElement("a");
      tarjeta.href = `#cap-${num}`;
      tarjeta.className = "tarjeta-capitulo";
    } else {
      tarjeta = document.createElement("div");
      tarjeta.className = "tarjeta-capitulo deshabilitada";
    }
    const etiqueta = cap.disponible ? "Escuchar →" : "Próximamente";
    tarjeta.innerHTML =
      `<span class="num-capitulo">Capítulo ${cap.numero}</span>` +
      `<span class="titulo-tarjeta">${cap.titulo}</span>` +
      `<span class="estado-tarjeta">${etiqueta}</span>`;
    lista.appendChild(tarjeta);
  }
}

/* VISTA CAPÍTULO: carga data/capitulo-NN.json y muestra sus ejemplos. */
async function vistaCapitulo(numero) {
  const cap = MANIFIESTO.capitulos.find((c) => c.numero === numero);
  if (!cap || !cap.disponible) {
    location.hash = ""; // capítulo inexistente o no disponible → índice
    return;
  }
  mostrarVista("visor");

  const estado = document.getElementById("estado-motor");
  try {
    await motorListo; // la partitura/piano necesitan Python; esperamos al motor
  } catch {
    return; // el error ya se mostró en el estado
  }

  let datos;
  try {
    const respuesta = await fetch(`data/${cap.archivo}`);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    datos = await respuesta.json();
  } catch (error) {
    estado.textContent =
      `No se pudo cargar data/${cap.archivo}. Detalle: ` + error.message;
    estado.classList.remove("oculto");
    estado.classList.add("error");
    console.error(error);
    return;
  }

  EJEMPLOS = datos.ejemplos;
  document.getElementById("titulo-capitulo").textContent =
    `Capítulo ${datos.capitulo} · ${datos.titulo}`;
  // Idea general del capítulo (paráfrasis; puede faltar en capítulos antiguos).
  document.getElementById("concepto-capitulo").textContent = datos.concepto || "";

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
  document.getElementById("boton-indice").disabled = bloqueado;
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
