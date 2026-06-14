"""teoria.py — el cerebro musical de la aplicación.

Única fuente de verdad para todo cálculo musical: parseo de nombres de nota,
conversión a MIDI y Hz, y formato para VexFlow. JavaScript nunca hace
matemática musical; solo consume lo que este módulo le entrega.

El módulo es Python puro (sin dependencias), de modo que se puede probar
con CPython local sin abrir el navegador:

    python3 -c "import teoria; print(teoria.plan_de_render(['C4','E4','G4']))"

Convenciones:
- Notación científica de alturas: "C4" es el Do central (MIDI 60), "A4" = 440 Hz.
- Las alteraciones se escriben con sufijos: "F#3", "Bb2", "C##5", "Ebb4".
- La octava cambia de número en Do (B3 → C4).
"""

import json
import re
from dataclasses import dataclass

# Semitonos de cada letra medidos desde Do. Es la base de la conversión a
# MIDI y, en la Fase 2, de la transposición por intervalo: la letra y la
# alteración se guardan SEPARADAS justamente para poder transportar por
# grados de letra (C→E es siempre una tercera) y ajustar la alteración
# después, en vez de sumar semitonos a ciegas.
SEMITONOS_POR_LETRA = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

# Sufijo de alteración ↔ desplazamiento en semitonos.
ALTERACION_A_SEMITONOS = {"": 0, "#": 1, "##": 2, "b": -1, "bb": -2}
SEMITONOS_A_ALTERACION = {v: k for k, v in ALTERACION_A_SEMITONOS.items()}

# Frecuencia de referencia: La 4 = 440 Hz (MIDI 69).
MIDI_LA4 = 69
HZ_LA4 = 440.0

# Nombre como "Bb3": letra, alteración opcional, octava (admite negativas).
_PATRON_NOTA = re.compile(r"^([A-G])(##|#|bb|b)?(-?\d+)$")


@dataclass(frozen=True)
class Nota:
    """Una altura con su deletreo: letra, alteración y octava por separado.

    alteracion: -2 (doble bemol) … +2 (doble sostenido), 0 = natural.
    """

    letra: str
    alteracion: int
    octava: int

    def __str__(self):
        return f"{self.letra}{SEMITONOS_A_ALTERACION[self.alteracion]}{self.octava}"


def parsear_nota(nombre):
    """Convierte un nombre como "Bb3" en una Nota(letra='B', alteracion=-1, octava=3)."""
    coincidencia = _PATRON_NOTA.match(nombre.strip())
    if coincidencia is None:
        raise ValueError(f"Nombre de nota inválido: {nombre!r}")
    letra, alteracion, octava = coincidencia.groups()
    return Nota(letra, ALTERACION_A_SEMITONOS[alteracion or ""], int(octava))


def nota_a_midi(nota):
    """Número MIDI de una Nota. C4 = 60, A4 = 69.

    La octava MIDI -1 empieza en 0, por eso el (octava + 1).
    """
    return (nota.octava + 1) * 12 + SEMITONOS_POR_LETRA[nota.letra] + nota.alteracion


def midi_a_hz(midi):
    """Frecuencia en Hz de un número MIDI, en temperamento igual con La4 = 440 Hz.

    Cada semitono multiplica la frecuencia por 2^(1/12).
    """
    return HZ_LA4 * 2.0 ** ((midi - MIDI_LA4) / 12.0)


def nombre_a_hz(nombre):
    """Atajo: frecuencia en Hz directamente desde un nombre como "E4"."""
    return midi_a_hz(nota_a_midi(parsear_nota(nombre)))


def nota_a_vexflow(nota):
    """Clave de nota en el formato de VexFlow: "C4" → "c/4", "Bb3" → "bb/3"."""
    return f"{nota.letra.lower()}{SEMITONOS_A_ALTERACION[nota.alteracion]}/{nota.octava}"


def plan_de_render(nombres):
    """Todo lo que la interfaz necesita para mostrar un grupo de notas.

    Es LA función que JavaScript consume: una sola llamada alimenta la
    partitura (vexflow + alteraciones), el piano (midi) y sirve de
    referencia para la síntesis (hz).

    VexFlow no dibuja alteraciones a partir del nombre de la nota; hay que
    añadirlas como modificadores explícitos. Por eso "alteraciones" viaja
    como lista paralela ("" cuando la nota es natural).
    """
    notas = [parsear_nota(n) for n in nombres]
    return {
        "vexflow": [nota_a_vexflow(n) for n in notas],
        "alteraciones": [SEMITONOS_A_ALTERACION[n.alteracion] for n in notas],
        "midi": [nota_a_midi(n) for n in notas],
        "hz": [round(midi_a_hz(nota_a_midi(n)), 2) for n in notas],
    }


def plan_de_eventos(eventos):
    """Plan de render para un ejemplo con varios eventos (secuencia o progresión).

    Acepta una lista de {"notas": [...]} o el string JSON equivalente (tal como
    lo envía JavaScript). Es lo que consume la interfaz para pintar partituras de
    más de un acorde. Devuelve:
      - "pasos": un plan_de_render por evento (más "cifrado", el texto del
        acorde a dibujar encima, vacío si el evento no lo trae), para la partitura.
      - "midi_union": todos los MIDI del ejemplo, en orden de aparición y sin
        repetir, para resaltar el piano y calcular su rango.
    """
    if isinstance(eventos, str):
        eventos = json.loads(eventos)
    pasos = []
    for ev in eventos:
        paso = plan_de_render(ev["notas"])
        paso["cifrado"] = ev.get("cifrado", "")  # se dibuja encima del acorde
        pasos.append(paso)
    union = []
    for paso in pasos:
        for midi in paso["midi"]:
            if midi not in union:
                union.append(midi)
    return {"pasos": pasos, "midi_union": union}
