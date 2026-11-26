// Kleine hulpjes voor de audio: toonhoogte, veilige automatie en het soort context.

/** MIDI-noot naar frequentie in Hz. */
export function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Bevries een parameter op zijn huidige waarde vanaf tijd t, zonder sprong. */
export function hold(p: AudioParam, t: number): void {
  if (typeof p.cancelAndHoldAtTime === "function") {
    p.cancelAndHoldAtTime(t);
  } else {
    // Firefox kent cancelAndHoldAtTime niet: zet de huidige waarde vast.
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

/** Glijd vloeiend naar een nieuwe waarde (tijdconstante tau in seconden). */
export function glide(p: AudioParam, value: number, t: number, tau: number): void {
  hold(p, t);
  p.setTargetAtTime(value, t, Math.max(0.001, tau));
}

/** Volume-curve voor schuifjes: zachter onderin, zoals het oor hoort. */
export function taper(v: number): number {
  const x = clamp(Number.isFinite(v) ? v : 0, 0, 1);
  return x * x;
}

export function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

/** De realtime context, of null bij een OfflineAudioContext. */
export function realtime(ctx: BaseAudioContext): AudioContext | null {
  return "startRendering" in ctx ? null : (ctx as AudioContext);
}

/** Wereldpositie naar stereo-plaats: mild, zodat het op een telefoon niet trekt. */
export function panFor(x: number): number {
  return clamp(x / 14, -0.45, 0.45);
}
