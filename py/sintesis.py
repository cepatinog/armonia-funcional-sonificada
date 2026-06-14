"""sintesis.py — generación de audio con NumPy.

Síntesis aditiva: cada nota es una suma de parciales armónicos (múltiplos
enteros de la fundamental) cuya amplitud cae exponencialmente con el número
de parcial. Una envolvente ADSR da forma al ataque y la extinción.

Todas las funciones devuelven arrays float32 a FS = 44100 Hz, listos para
copiarse a un AudioBuffer de Web Audio. Se puede probar con CPython local:

    python3 -c "import sintesis; s = sintesis.acorde_bloque(['C4','E4','G4'], 2.0); print(s.dtype, len(s), abs(s).max())"
"""

import json

import numpy as np

import teoria

# Frecuencia de muestreo, igual a la del AudioContext en el navegador.
FS = 44100

# Pico máximo de la señal normalizada: deja margen para evitar el recorte
# del conversor digital-analógico.
PICO_MAXIMO = 0.8

# Separación temporal entre notas de un arpegio. La usan TANTO la síntesis
# (_arpegio) como la línea de tiempo del resaltado, para que sonido e imagen
# coincidan exactamente.
RETARDO_ARPEGIO = 0.12


def tono(hz, dur, n_parciales=8, caida=0.55):
    """Una nota por síntesis aditiva, sin envolvente.

    Suma n_parciales senos en las frecuencias k·hz (k = 1, 2, 3…) con
    amplitud caida^(k-1): el fundamental pesa 1, el segundo parcial `caida`,
    el tercero `caida`², etc. Los parciales que superan Nyquist (FS/2) se
    descartan para no producir aliasing.
    """
    t = np.arange(int(round(FS * dur))) / FS
    onda = np.zeros_like(t)
    for k in range(1, n_parciales + 1):
        frecuencia_parcial = k * hz
        if frecuencia_parcial >= FS / 2:
            break
        onda += caida ** (k - 1) * np.sin(2 * np.pi * frecuencia_parcial * t)
    return onda


def adsr(n_muestras, ataque=0.02, decaimiento=0.15, sostenido=0.7, liberacion=0.4):
    """Envolvente ADSR de n_muestras valores entre 0 y 1.

    ataque, decaimiento y liberacion son duraciones en segundos; sostenido
    es el NIVEL (0–1) que se mantiene entre el decaimiento y la liberación.
    Si la nota es más corta que la suma de los tramos, estos se comprimen
    proporcionalmente para que la envolvente siempre quepa.
    """
    n_ataque = int(FS * ataque)
    n_decaimiento = int(FS * decaimiento)
    n_liberacion = int(FS * liberacion)

    n_tramos = n_ataque + n_decaimiento + n_liberacion
    if n_tramos > n_muestras:
        factor = n_muestras / n_tramos
        n_ataque = int(n_ataque * factor)
        n_decaimiento = int(n_decaimiento * factor)
        n_liberacion = int(n_liberacion * factor)

    n_sostenido = n_muestras - n_ataque - n_decaimiento - n_liberacion
    return np.concatenate([
        np.linspace(0.0, 1.0, n_ataque, endpoint=False),
        np.linspace(1.0, sostenido, n_decaimiento, endpoint=False),
        np.full(n_sostenido, sostenido),
        np.linspace(sostenido, 0.0, n_liberacion),
    ])


def normalizar(senal, pico=PICO_MAXIMO):
    """Escala la señal para que su pico absoluto sea `pico` (si no es silencio)."""
    maximo = np.abs(senal).max()
    if maximo > 0:
        senal = senal * (pico / maximo)
    return senal


def _voz(nombres, dur):
    """Suma de los tonos de varias notas con UNA envolvente ADSR compartida.

    Es el bloque de construcción de acordes, secuencias y progresiones: une
    `tono` y `adsr` pero NO normaliza, para poder concatenar varios tramos y
    normalizar la señal completa una sola vez al final. Devuelve float64.
    """
    nombres = list(nombres)
    mezcla = sum(tono(teoria.nombre_a_hz(n), dur) for n in nombres)
    return mezcla * adsr(len(mezcla))


def _arpegio(nombres, dur, retardo=RETARDO_ARPEGIO):
    """Un acorde "roto": las notas entran escalonadas y sostienen hasta el final.

    Cada nota arranca `retardo` segundos después de la anterior y dura hasta el
    fin del tramo, de modo que todas se apagan juntas (efecto de acorde rodado).
    Devuelve float64 de int(round(FS*dur)) muestras, SIN normalizar.
    """
    nombres = list(nombres)
    n_total = int(round(FS * dur))
    n_retardo = int(round(FS * retardo))
    segmento = np.zeros(n_total)
    for i, nombre in enumerate(nombres):
        inicio = min(i * n_retardo, n_total - 1)
        onda = tono(teoria.nombre_a_hz(nombre), (n_total - inicio) / FS)
        onda = onda * adsr(len(onda))
        m = min(len(onda), n_total - inicio)
        segmento[inicio:inicio + m] += onda[:m]
    return segmento


def _parsear_eventos(eventos):
    """Admite una lista de dicts o un string JSON (como lo manda JavaScript)."""
    if isinstance(eventos, str):
        eventos = json.loads(eventos)
    return eventos


def acorde_bloque(nombres, dur=2.0):
    """Un acorde en bloque: todas las notas suenan a la vez durante `dur` segundos.

    Recibe nombres de nota ("C4", "E4", "G4"), suma sus tonos, aplica la
    envolvente y normaliza. Devuelve float32 listo para Web Audio.
    """
    return normalizar(_voz(nombres, dur)).astype(np.float32)


def secuencia(eventos, modo="secuencial"):
    """Notas (o acordes) que se escuchan en el tiempo, no a la vez.

    `eventos` es una lista (o string JSON) de {"notas": [...], "dur": s}:
    - "secuencial": cada evento suena tras el anterior (p. ej. recorrer la
      columna de armónicos nota por nota).
    - "acumulativo": cada tramo suena con TODAS las notas introducidas hasta
      ese punto, de modo que la columna se va apilando.

    Devuelve float32 normalizado y listo para Web Audio.
    """
    eventos = _parsear_eventos(eventos)
    if modo == "acumulativo":
        tramos = []
        acumuladas = []
        for ev in eventos:
            acumuladas = acumuladas + list(ev["notas"])
            tramos.append(_voz(acumuladas, ev["dur"]))
    else:  # "secuencial"
        tramos = [_voz(ev["notas"], ev["dur"]) for ev in eventos]
    return normalizar(np.concatenate(tramos)).astype(np.float32)


def progresion(eventos, modo="bloque"):
    """Una sucesión de acordes, uno tras otro.

    `eventos` es una lista (o string JSON) de {"notas": [...], "dur": s}:
    - "bloque": cada acorde suena con todas sus notas juntas.
    - "arpegio": cada acorde se "rompe", sus notas entran escalonadas.

    Devuelve float32 normalizado y listo para Web Audio.
    """
    eventos = _parsear_eventos(eventos)
    if modo == "arpegio":
        tramos = [_arpegio(ev["notas"], ev["dur"]) for ev in eventos]
    else:  # "bloque"
        tramos = [_voz(ev["notas"], ev["dur"]) for ev in eventos]
    return normalizar(np.concatenate(tramos)).astype(np.float32)


def _midis(nombres):
    """Lista de números MIDI de unos nombres de nota (para resaltar el piano)."""
    return [teoria.nota_a_midi(teoria.parsear_nota(n)) for n in nombres]


def linea_de_tiempo(eventos, modo):
    """Cronología del resaltado del piano, sincronizada con el audio.

    Describe QUÉ teclas (MIDI) están encendidas y DESDE QUÉ instante, reflejando
    exactamente el timing de secuencia()/progresion()/_arpegio(). JavaScript la
    usa para encender el teclado al mismo tiempo que suena cada cosa. Devuelve:

        { "segmentos": [ {"t": inicio_en_seg, "midis": [..]}, .. ], "total": seg }

    Cada segmento sustituye al anterior (resaltar reemplaza), así que apagar las
    teclas previas es automático. Modos:
    - "secuencial"/"bloque": un segmento por evento, con las notas de ese evento.
    - "acumulativo": cada segmento incluye todas las notas introducidas hasta ahí.
    - "arpegio": dentro de cada acorde, un segmento por nota que se va sumando
      (las notas sostienen hasta el fin del acorde), separadas por RETARDO_ARPEGIO.
    """
    eventos = _parsear_eventos(eventos)
    segmentos = []
    t = 0.0
    for ev in eventos:
        notas = list(ev["notas"])
        if modo == "acumulativo":
            previas = segmentos[-1]["__nombres"] if segmentos else []
            nombres = previas + notas
            segmentos.append({"t": round(t, 4), "midis": _midis(nombres), "__nombres": nombres})
        elif modo == "arpegio":
            for j in range(len(notas)):
                inicio = t + min(j * RETARDO_ARPEGIO, ev["dur"])
                segmentos.append({"t": round(inicio, 4), "midis": _midis(notas[: j + 1])})
        else:  # "secuencial" / "bloque"
            segmentos.append({"t": round(t, 4), "midis": _midis(notas)})
        t += ev["dur"]

    for seg in segmentos:
        seg.pop("__nombres", None)  # campo auxiliar interno
    return {"segmentos": segmentos, "total": round(t, 4)}
