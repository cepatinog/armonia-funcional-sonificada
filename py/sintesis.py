"""sintesis.py — generación de audio con NumPy.

Síntesis aditiva: cada nota es una suma de parciales armónicos (múltiplos
enteros de la fundamental) cuya amplitud cae exponencialmente con el número
de parcial. Una envolvente ADSR da forma al ataque y la extinción.

Todas las funciones devuelven arrays float32 a FS = 44100 Hz, listos para
copiarse a un AudioBuffer de Web Audio. Se puede probar con CPython local:

    python3 -c "import sintesis; s = sintesis.acorde_bloque(['C4','E4','G4'], 2.0); print(s.dtype, len(s), abs(s).max())"
"""

import numpy as np

import teoria

# Frecuencia de muestreo, igual a la del AudioContext en el navegador.
FS = 44100

# Pico máximo de la señal normalizada: deja margen para evitar el recorte
# del conversor digital-analógico.
PICO_MAXIMO = 0.8


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


def acorde_bloque(nombres, dur=2.0):
    """Un acorde en bloque: todas las notas suenan a la vez durante `dur` segundos.

    Recibe nombres de nota ("C4", "E4", "G4"), suma sus tonos, aplica la
    envolvente y normaliza. Devuelve float32 listo para Web Audio.
    """
    nombres = list(nombres)
    mezcla = sum(tono(teoria.nombre_a_hz(n), dur) for n in nombres)
    senal = normalizar(mezcla * adsr(len(mezcla)))
    return senal.astype(np.float32)
