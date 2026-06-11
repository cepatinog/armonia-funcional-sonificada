/* app.js — orquestador de la Fase 1.
 *
 * Un solo ejemplo hardcodeado (el motor de capítulos desde JSON llega en la
 * Fase 2): el acorde de Do mayor. Flujo:
 *
 *   1. Pintar la tarjeta y el piano (no necesitan Python).
 *   2. Arrancar el Motor (Pyodide + NumPy + teoria/sintesis).
 *   3. Pedir a teoria.py el plan de render → partitura + teclas resaltadas.
 *   4. Habilitar "▶ Escuchar" → sintesis.py genera el audio y suena.
 */

"use strict";

const EJEMPLO = {
  titulo: "Acorde de Do mayor",
  descripcion:
    "La triada mayor sobre Do: fundamental (C4), tercera mayor (E4) y " +
    "quinta justa (G4). Sonido generado por síntesis aditiva en Python.",
  notas: ["C4", "E4", "G4"],
  dur: 2.0,
};

async function iniciarApp() {
  const titulo = document.getElementById("titulo-ejemplo");
  const descripcion = document.getElementById("descripcion-ejemplo");
  const estado = document.getElementById("estado-motor");
  const zonaPartitura = document.getElementById("partitura");
  const zonaPiano = document.getElementById("piano");
  const boton = document.getElementById("boton-escuchar");

  titulo.textContent = EJEMPLO.titulo;
  descripcion.textContent = EJEMPLO.descripcion;
  Piano.dibujar(zonaPiano);

  try {
    await Motor.iniciar((mensaje) => {
      estado.textContent = mensaje;
    });
  } catch (error) {
    estado.textContent =
      "No se pudo cargar el motor musical. Revisa tu conexión y que la app " +
      "se sirva por http (no file://). Detalle: " + error.message;
    estado.classList.add("error");
    console.error(error);
    return;
  }

  // Una sola llamada a Python alimenta partitura y piano.
  const plan = Motor.planDeRender(EJEMPLO.notas);
  Partitura.dibujarAcorde(zonaPartitura, plan, { armadura: "C" });
  Piano.resaltar(plan.midi);

  estado.classList.add("oculto");
  boton.disabled = false;

  boton.addEventListener("click", async () => {
    boton.disabled = true; // evitar acordes encimados
    try {
      await Motor.tocarAcorde(EJEMPLO.notas, EJEMPLO.dur);
    } finally {
      boton.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", iniciarApp);
