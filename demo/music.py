"""Original background score for the Zhi demo: minimal dark electronic, 100 BPM, A minor.
Synthesized from scratch (no samples): detuned saw pad, sidechained sub, soft kick,
offbeat hats, pluck arpeggio, riser into the groove. Writes demo/out/music.wav (stereo, 48k).
"""
import numpy as np
import os, sys, wave

SR = 48000
BPM = 100
BEAT = 60 / BPM
DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 180.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)

def note(m):  # midi -> Hz
    return 440.0 * 2 ** ((m - 69) / 12)

def _fft_filter(x, gain):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * gain(f), n=len(x))

def lp(x, fc, order=2):
    # Butterworth-shaped magnitude response, zero phase
    return _fft_filter(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order)))

def hp(x, fc, order=2):
    return _fft_filter(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-6)) ** (2 * order)))

def env_ad(n, a, d):
    e = np.ones(n)
    na, nd = int(a * SR), int(d * SR)
    e[:na] = np.linspace(0, 1, na) if na else 1
    if nd:
        e[-nd:] *= np.linspace(1, 0, nd)
    return e

def saw(f, tt, phase=0.0):
    x = (f * tt + phase) % 1.0
    return 2 * x - 1

# progression (2 bars each): Am - F - C - G  (voicings, midi)
BAR = 4 * BEAT
CHORDS = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]]
ROOTS = [45, 41, 48, 43]

L = np.zeros(N)
R = np.zeros(N)

# ---------------------------------------------------------------- pad
seg = int(2 * BAR * SR)
for i, start in enumerate(range(0, N, seg)):
    ch = CHORDS[i % 4]
    n = min(seg, N - start)
    tt = np.arange(n) / SR
    padL = np.zeros(n)
    padR = np.zeros(n)
    for m in ch:
        f = note(m)
        for det, pan in ((-0.11, 0.8), (0.0, 0.5), (0.13, 0.2)):
            v = saw(f * 2 ** (det / 12), tt, rng.random())
            padL += v * pan
            padR += v * (1 - pan)
    e = env_ad(n, 1.2, 1.4)
    L[start:start + n] += padL * e * 0.022
    R[start:start + n] += padR * e * 0.022
# slow filter sweep for movement
sweep = 900 + 700 * (0.5 + 0.5 * np.sin(2 * np.pi * t / (8 * BAR)))
L = lp(L, 1400)
R = lp(R, 1400)
L *= 0.75 + 0.25 * np.sin(2 * np.pi * t / (4 * BAR))
R *= 0.75 + 0.25 * np.cos(2 * np.pi * t / (4 * BAR))

# ---------------------------------------------------------------- arrangement helpers
GROOVE = 4 * BAR  # groove starts after a 4-bar intro (~9.6s)
def active(x0, x1=None):
    m = (t >= x0) & (t < (x1 if x1 else DUR))
    return m.astype(float)

# ---------------------------------------------------------------- kick + sidechain
kick = np.zeros(N)
duck = np.ones(N)
klen = int(0.35 * SR)
kt = np.arange(klen) / SR
kshape = np.sin(2 * np.pi * (48 * kt + (120 - 48) * (1 - np.exp(-kt * 35)) / 35)) * np.exp(-kt * 9)
dlen = int(0.28 * SR)
dshape = 1 - 0.55 * np.exp(-np.arange(dlen) / SR * 12)
beat_i = 0
x = GROOVE
while x < DUR - 6:
    s = int(x * SR)
    n = min(klen, N - s)
    kick[s:s + n] += kshape[:n] * 0.42
    n2 = min(dlen, N - s)
    duck[s:s + n2] = np.minimum(duck[s:s + n2], dshape[:n2])
    x += BEAT
    beat_i += 1

# ---------------------------------------------------------------- sub bass (8ths, follows roots)
sub = np.zeros(N)
x = GROOVE
while x < DUR - 6:
    bar_idx = int(x / (2 * BAR)) % 4
    f = note(ROOTS[bar_idx] - 12)
    s = int(x * SR)
    n = int(BEAT / 2 * SR * 0.9)
    n = min(n, N - s)
    tt = np.arange(n) / SR
    sub[s:s + n] += np.sin(2 * np.pi * f * tt) * env_ad(n, 0.01, 0.08) * 0.22
    x += BEAT / 2
sub = lp(sub, 220)

# ---------------------------------------------------------------- hats (offbeat), enter after 8 bars
hats = np.zeros(N)
hlen = int(0.06 * SR)
noise = hp(rng.standard_normal(N), 7000)
x = GROOVE + 4 * BAR + BEAT / 2
while x < DUR - 6:
    s = int(x * SR)
    n = min(hlen, N - s)
    hats[s:s + n] += noise[s:s + n] * np.exp(-np.arange(n) / SR * 60) * 0.05
    x += BEAT

# ---------------------------------------------------------------- pluck arpeggio (16ths), middle section
arp = np.zeros(N)
x = GROOVE + 8 * BAR
step = 0
while x < DUR - 10:
    bar_idx = int(x / (2 * BAR)) % 4
    ch = CHORDS[bar_idx]
    m = ch[[0, 2, 1, 3, 2, 1, 3, 2][step % 8]] + 12
    s = int(x * SR)
    n = min(int(0.22 * SR), N - s)
    tt = np.arange(n) / SR
    tone = (np.sin(2 * np.pi * note(m) * tt) + 0.3 * np.sin(4 * np.pi * note(m) * tt)) * np.exp(-tt * 14)
    arp[s:s + n] += tone * 0.05
    x += BEAT / 4
    step += 1
arp = lp(arp, 3500)
# ping-pong delay
d = int(BEAT * 0.75 * SR)
arpL = arp.copy(); arpR = np.zeros(N)
arpR[d:] += arp[:-d] * 0.45
arpL[2 * d:] += arp[:-2 * d] * 0.25

# ---------------------------------------------------------------- riser into the groove
rlen = int(GROOVE * SR)
riser = hp(rng.standard_normal(rlen), 2000) * np.linspace(0, 1, rlen) ** 3 * 0.06
riser = lp(riser, 9000)

# ---------------------------------------------------------------- mix
L = L * duck + sub * duck + kick + hats + arpL
R = R * duck + sub * duck + kick + hats + arpR
L[:rlen] += riser
R[:rlen] += riser
fade = np.ones(N)
fo = int(6 * SR)
fade[-fo:] = np.linspace(1, 0, fo) ** 2
fade[: int(1.5 * SR)] = np.linspace(0, 1, int(1.5 * SR))
L *= fade
R *= fade
peak = max(np.abs(L).max(), np.abs(R).max())
L /= peak / 0.7
R /= peak / 0.7
os.makedirs(os.path.join(os.path.dirname(__file__), "out"), exist_ok=True)
out = os.path.join(os.path.dirname(__file__), "out", "music.wav")
pcm = (np.stack([L, R], 1) * 32767).astype("<i2")
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", out, f"{DUR:.1f}s")
