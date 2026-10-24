import sys, json, numpy as np, librosa
f, out = sys.argv[1], sys.argv[2]
CUT = 60.0
y, sr = librosa.load(f, sr=22050, mono=True)
dur = len(y)/sr
hop = 256
_, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop, units='time', tightness=400)
rms = librosa.feature.rms(y=y, hop_length=hop)[0]
t = librosa.times_like(rms, sr=sr, hop_length=hop)
best = None
for s in np.arange(20, dur-CUT-12, 1.0):
    m = (t>=s)&(t<s+CUT)
    e = rms[m].mean()
    if best is None or e > best[0]: best = (e, s)
start_guess = best[1]
# band onset envelopes
S_ = np.abs(librosa.stft(y, hop_length=hop, n_fft=2048))
freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
def band(lo, hi):
    m = (freqs>=lo)&(freqs<hi)
    return librosa.onset.onset_strength(S=librosa.amplitude_to_db(S_[m]), sr=sr, hop_length=hop)
bands = {'low': band(30,160), 'mid': band(160,2500), 'high': band(5000,11000)}
ot = librosa.times_like(bands['low'], sr=sr, hop_length=hop)
# downbeat: within beats in window, pick phase with max low-band onset
wb = beats[(beats>=start_guess-3)&(beats<start_guess+CUT+3)]
def at(env, tt):
    i = np.searchsorted(ot, tt); i = np.clip(i, 0, len(env)-1)
    return env[max(0,i-1):i+2].max()
ph = [sum(at(bands['low'], b) for b in wb[p::4]) for p in range(4)]
p = int(np.argmax(ph))
down = wb[p::4]
st = float(down[np.argmin(np.abs(down - start_guess))])
# beats inside cut (+ a bit beyond)
cb = beats[(beats>=st-1e-3)&(beats<=st+CUT+1)] - st
# regularise: fit line to beat index -> time, replace outliers
idx = np.arange(len(cb))
a, b = np.polyfit(idx, cb, 1)
resid = cb - (a*idx+b)
cb = a*idx + b
# refine phase: maximise onset strength on the 8th-note grid
envs = bands['low']/bands['low'].max() + bands['mid']/bands['mid'].max()
def score(d):
    g = st + d + np.arange(0, CUT, a/2)
    return sum(at(envs, x) for x in g)
ds = np.arange(-0.06, 0.0601, 0.004)
sc = [score(d) for d in ds]
shift = float(ds[int(np.argmax(sc))])
cb = cb + shift
print('  phase shift', round(shift*1000), 'ms')
nb = int(np.floor((CUT-0.5)/a))  # beats that fit
nb -= nb % 4
cb = cb[:nb+1]
if cb[0] < 0: st += cb[0]; cb = cb - cb[0]
end = st + float(cb[-1]) + a*2  # allow tail
# 16th-step strengths
steps = []
for i in range(len(cb)-1):
    for k in range(4):
        steps.append(st + cb[i] + (cb[i+1]-cb[i])*k/4)
steps = np.array(steps)
res = {}
for k, env in bands.items():
    v = np.array([at(env, s) for s in steps])
    v = v / (np.percentile(v, 98) + 1e-9)
    res[k] = [round(float(min(1, x)), 2) for x in v]
energy = []
for i in range(0, len(cb)-1, 4):
    m = (t>=st+cb[i])&(t<st+cb[min(i+4,len(cb)-1)])
    energy.append(float(rms[m].mean()))
energy = np.array(energy); energy = (energy-energy.min())/(np.ptp(energy)+1e-9)
data = {
  'bpm': round(60/a, 2), 'cutStart': round(st, 3), 'cutLength': round(end-st, 3),
  'beats': [round(float(x), 4) for x in cb],
  'bars': [round(float(x), 2) for x in energy],
  **res,
}
json.dump(data, open(out, 'w'))
print(f.split('/')[-1], 'bpm', data['bpm'], 'start', st, 'len', round(end-st,2), 'beats', len(cb), 'phase', p)
