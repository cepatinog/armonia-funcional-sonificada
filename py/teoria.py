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
# MIDI y de la transposición por intervalo: la letra y la alteración se
# guardan SEPARADAS justamente para poder transportar por grados de letra
# (C→E es siempre una tercera) y ajustar la alteración después, en vez de
# sumar semitonos a ciegas.
SEMITONOS_POR_LETRA = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

# Las siete letras en orden, para mover por grados de letra (índice diatónico).
LETRAS = "CDEFGAB"

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


def plan_de_render(nombres, tonalidad="C"):
    """Todo lo que la interfaz necesita para mostrar un grupo de notas.

    Es LA función que JavaScript consume: una sola llamada alimenta la
    partitura (vexflow + alteraciones), el piano (midi) y sirve de
    referencia para la síntesis (hz).

    VexFlow no dibuja alteraciones a partir del nombre de la nota; hay que
    añadirlas como modificadores explícitos. Por eso "alteraciones" viaja
    como lista paralela. La alteración a DIBUJAR depende de la armadura de
    `tonalidad` (notación de imprenta): "" si la armadura ya la provee,
    "n" (becuadro) si la armadura altera esa letra pero la nota es natural,
    y el símbolo de la alteración en cualquier otro caso. Los nombres ya
    llegan deletreados en la tonalidad destino (ver plan_de_eventos).
    """
    notas = [parsear_nota(n) for n in nombres]
    return {
        "vexflow": [nota_a_vexflow(n) for n in notas],
        "alteraciones": [alteracion_visible(n, tonalidad) for n in notas],
        "midi": [nota_a_midi(n) for n in notas],
        "hz": [round(midi_a_hz(nota_a_midi(n)), 2) for n in notas],
    }


def plan_de_eventos(eventos, tonalidad="C"):
    """Plan de render para un ejemplo con varios eventos (secuencia o progresión).

    Acepta una lista de {"notas": [...]} o el string JSON equivalente (tal como
    lo envía JavaScript). Los ejemplos se guardan en Do; `tonalidad` los transpone
    en runtime POR INTERVALO (notas y cifrado), única fuente de verdad de lo que
    se ve. Es lo que consume la interfaz para pintar partituras de más de un
    acorde. Devuelve:
      - "pasos": un plan_de_render por evento (más "cifrado", el texto del
        acorde a dibujar encima, vacío si el evento no lo trae), para la partitura.
      - "midi_union": todos los MIDI del ejemplo, en orden de aparición y sin
        repetir, para resaltar el piano y calcular su rango.
    """
    if isinstance(eventos, str):
        eventos = json.loads(eventos)
    pasos = []
    for ev in eventos:
        notas = transponer_nombres(ev["notas"], tonalidad)
        paso = plan_de_render(notas, tonalidad)
        # El cifrado también se transpone: la raíz cambia, la calidad se conserva.
        paso["cifrado"] = transponer_cifrado(ev.get("cifrado", ""), tonalidad)
        pasos.append(paso)
    union = []
    for paso in pasos:
        for midi in paso["midi"]:
            if midi not in union:
                union.append(midi)
    return {"pasos": pasos, "midi_union": union}


# ---------------------------------------------------------------------------
# Transposición por intervalo a las 12 tonalidades mayores
# ---------------------------------------------------------------------------
#
# Los ejemplos del libro están normalizados a Do. Para sonar y MOSTRARSE en
# cualquier tonalidad se transponen POR INTERVALO (letra + alteración), nunca
# por simple desplazamiento de semitonos: así el deletreo es correcto
# (C–E–G en Mi es E–G#–B, jamás E–Ab–B). El intervalo de Do a cada tónica
# destino se expresa como (pasos_de_letra, semitonos).
INTERVALOS_TONALIDAD = {
    "C":  (0, 0),  "Db": (1, 1),  "D":  (1, 2),  "Eb": (2, 3),
    "E":  (2, 4),  "F":  (3, 5),  "F#": (3, 6),  "G":  (4, 7),
    "Ab": (5, 8),  "A":  (5, 9),  "Bb": (6, 10), "B":  (6, 11),
}


def _intervalo_cercano(tonalidad):
    """Intervalo de Do a la tónica destino, eligiendo el registro más cercano.

    Si subir el intervalo pasa del tritono (más de 6 semitonos), se baja una
    octava (restando 7 pasos de letra y 12 semitonos): así Sol baja una 4ª en
    vez de subir una 5ª, Si baja un semitono, etc., y el ejemplo se mantiene
    en el mismo registro en las 12 tonalidades. El deletreo (letra+alteración)
    es idéntico en cualquier octava; esto solo afecta la altura.
    """
    if tonalidad not in INTERVALOS_TONALIDAD:
        raise ValueError(f"Tonalidad desconocida: {tonalidad!r}")
    pasos, semitonos = INTERVALOS_TONALIDAD[tonalidad]
    if semitonos > 6:
        pasos, semitonos = pasos - 7, semitonos - 12
    return pasos, semitonos


def transponer_nota(nota, pasos_letra, semitonos):
    """Transpone una Nota por un intervalo (pasos de letra + semitonos).

    Mueve la letra por su índice diatónico (octava*7 + índice de letra) para
    obtener letra y octava nuevas, fija el MIDI objetivo sumando `semitonos`,
    y deriva la alteración como la diferencia con el MIDI natural de la letra
    nueva. Así C→E (2 pasos, 4 semitonos) da E natural, y Gb→A (2 pasos, 4
    semitonos) da A natural, cada uno con su deletreo correcto.
    """
    diatonico = nota.octava * 7 + LETRAS.index(nota.letra) + pasos_letra
    nueva_octava, indice = divmod(diatonico, 7)
    nueva_letra = LETRAS[indice]

    midi_objetivo = nota_a_midi(nota) + semitonos
    midi_natural = (nueva_octava + 1) * 12 + SEMITONOS_POR_LETRA[nueva_letra]
    alteracion = midi_objetivo - midi_natural
    if alteracion not in SEMITONOS_A_ALTERACION:
        raise ValueError(
            f"Transponer {nota} requiere una alteración fuera de rango "
            f"(±2): {alteracion:+d} sobre {nueva_letra}."
        )
    return Nota(nueva_letra, alteracion, nueva_octava)


def transponer_nombre(nombre, tonalidad):
    """Transpone un nombre de nota ("C4") a la tonalidad destino ("E4" en Mi)."""
    pasos, semitonos = _intervalo_cercano(tonalidad)
    return str(transponer_nota(parsear_nota(nombre), pasos, semitonos))


def transponer_nombres(nombres, tonalidad):
    """Transpone una lista de nombres de nota a la tonalidad destino."""
    return [transponer_nombre(n, tonalidad) for n in nombres]


def transponer_eventos(eventos, tonalidad):
    """Transpone las notas de cada evento a la tonalidad destino.

    Acepta una lista de dicts o un string JSON (como lo manda JavaScript) y
    devuelve los eventos con "notas" ya transpuestas, conservando "dur" y el
    resto de campos. Lo consume la síntesis para sonar en la tonalidad elegida.
    """
    if isinstance(eventos, str):
        eventos = json.loads(eventos)
    return [
        {**ev, "notas": transponer_nombres(ev["notas"], tonalidad)}
        for ev in eventos
    ]


# Cifrado: raíz (letra + alteración opcional) seguida de la calidad ("m", "7",
# "dim", "maj7"…). Solo la raíz se transpone; la calidad se conserva tal cual.
_PATRON_CIFRADO = re.compile(r"^([A-G])(##|#|bb|b)?(.*)$")


def transponer_cifrado(cifrado, tonalidad):
    """Transpone la raíz de un cifrado, conservando su calidad.

    "Bdim" a Re mayor → "C#dim"; "G7" a Mib mayor → "Bb7". Un cifrado vacío o
    sin raíz reconocible se devuelve sin tocar.
    """
    if not cifrado:
        return cifrado
    coincidencia = _PATRON_CIFRADO.match(cifrado)
    if coincidencia is None:
        return cifrado
    letra, alteracion, calidad = coincidencia.groups()
    raiz = Nota(letra, ALTERACION_A_SEMITONOS[alteracion or ""], 4)  # octava ficticia
    pasos, semitonos = _intervalo_cercano(tonalidad)
    nueva = transponer_nota(raiz, pasos, semitonos)
    return f"{nueva.letra}{SEMITONOS_A_ALTERACION[nueva.alteracion]}{calidad}"


# ---------------------------------------------------------------------------
# Armadura de la tonalidad (para dibujar solo las alteraciones necesarias)
# ---------------------------------------------------------------------------

# Orden en que aparecen los sostenidos y los bemoles en las armaduras, y cuántos
# tiene cada tonalidad mayor. De aquí se deduce qué letras altera la armadura.
ORDEN_SOSTENIDOS = "FCGDAEB"
ORDEN_BEMOLES = "BEADGCF"
SOSTENIDOS_POR_TONALIDAD = {"C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6}
BEMOLES_POR_TONALIDAD = {"F": 1, "Bb": 2, "Eb": 3, "Ab": 4, "Db": 5}


def armadura_de(tonalidad):
    """Letras que la armadura de `tonalidad` ya altera: {letra: ±1}.

    Re mayor → {"F": 1, "C": 1}; Mib mayor → {"B": -1, "E": -1, "A": -1}.
    Do mayor → {} (sin alteraciones).
    """
    if tonalidad in SOSTENIDOS_POR_TONALIDAD:
        n = SOSTENIDOS_POR_TONALIDAD[tonalidad]
        return {letra: 1 for letra in ORDEN_SOSTENIDOS[:n]}
    if tonalidad in BEMOLES_POR_TONALIDAD:
        n = BEMOLES_POR_TONALIDAD[tonalidad]
        return {letra: -1 for letra in ORDEN_BEMOLES[:n]}
    raise ValueError(f"Tonalidad desconocida: {tonalidad!r}")


def alteracion_visible(nota, tonalidad):
    """Alteración que VexFlow debe dibujar para `nota` bajo la armadura dada.

    Notación de imprenta: "" si la armadura ya provee esa alteración (no se
    repite), "n" (becuadro) si la armadura altera esa letra pero la nota es
    natural, y el símbolo de la alteración en cualquier otro caso. Así, en Fa#
    mayor (con A# y C# en la armadura), un La y un Do naturales llevan becuadro,
    pero un Fa# no lleva sostenido.
    """
    provista = armadura_de(tonalidad).get(nota.letra, 0)
    if nota.alteracion == provista:
        return ""
    if nota.alteracion == 0:
        return "n"
    return SEMITONOS_A_ALTERACION[nota.alteracion]
