// Geluidseffecten uit de simulatie. Alles is gesynthetiseerd en staat in de toonladder van de zone.
import type { SimEvent } from "../sim/types";
import { channel, type Graph } from "./graph";
import type { Music } from "./music";
import { chordTones, degree, keyFor, type Key } from "./theory";
import { clamp, glide, mtof, panFor, rand } from "./util";
import { VoicePool, type Voice } from "./voices";

type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;

/** Boventonen van glas: verhouding, sterkte, duur. */
const GLASS: readonly (readonly [number, number, number])[] = [
  [2.76, 0.35, 0.25],
  [5.4, 0.15, 0.12],
];

/** Maximaal aantal gelijktijdige effectstemmen. */
const MAX_VOICES = 24;

interface Channels {
  dry: GainNode;
  bright: GainNode;
  wet: GainNode;
  low: GainNode;
}

export class Sfx {
  private readonly pool: VoicePool;
  private readonly ch: Channels;
  private tension: Voice | null = null;
  private tensionOsc: OscillatorNode | null = null;
  private tensionLfo: OscillatorNode | null = null;
  private tensionAt = 0;

  constructor(
    private readonly g: Graph,
    private readonly music: Music,
  ) {
    this.pool = new VoicePool(g.ctx, MAX_VOICES, g.noise, null);
    this.ch = {
      dry: channel(g, g.sfx, 1, 0.08, 0),
      bright: channel(g, g.sfx, 1, 0.3, 0.2),
      wet: channel(g, g.sfx, 1, 0.75, 0.32),
      low: channel(g, g.sfx, 1, 0.3, 0),
    };
  }

  voices(): number {
    return this.pool.count();
  }

  /** Vangst: een tokkel-bel die met elke ster de toonladder op klimt; combo klimt sneller. */
  capture(e: Ev<"capture">, now: number): void {
    const key = keyFor(e.zone);
    const fresh = e.gained > 0;
    const idx = Math.max(0, e.count - 1) + (e.perfect ? Math.min(e.combo, 6) : 0);
    const m = degree(key, ((idx % 10) + 10) % 10) + 12;
    const t = this.music.quantize(now);
    const pan = panFor(e.pos.x);
    const vel = fresh ? 1 : 0.45;
    this.bell(t, m, vel, e.perfect ? this.ch.wet : this.ch.bright, pan, 2, 1.6);
    if (e.kind === "giant") this.bell(t, m - 12, 0.5 * vel, this.ch.bright, pan, 1, 2);
    if (e.perfect && e.combo >= 2) this.bell(t + 0.03, m + 12, 0.32, this.ch.wet, -pan, 3.5, 1.2);
    if (e.perfect) this.shimmer(t + 0.02, key, m);
    if (fresh) this.music.remember(m);
  }

  /** Loslaten: zachte ruis-zwiep met een snelle val in toonhoogte. */
  release(e: Ev<"release">, now: number): void {
    this.whoosh(now, panFor(e.pos.x + e.dir.x * 4));
  }

  /** Scherf: hoog glazen getinkel uit de bovenste tonen van de ladder. */
  shard(_e: Ev<"shard">, now: number): void {
    const key = this.music.currentKey();
    const a = degree(key, 12 + Math.floor(Math.random() * 5));
    const b = degree(key, 12 + Math.floor(Math.random() * 5));
    this.glass(now, a, 0.22, rand(-0.3, 0.3));
    this.glass(now + 0.055, b === a ? a + 12 : b, 0.14, rand(-0.3, 0.3));
  }

  /** Rakelings langs een zwart gat: aanzwellende ruis en een doppler-zip van links naar rechts. */
  nearMiss(e: Ev<"nearMiss">, now: number): void {
    const t = now;
    const v = this.pool.voice(this.ch.bright, t);
    const side = e.pos.x >= 0 ? 1 : -1;
    let out: AudioNode = v.out;
    if (this.g.hasPanner) {
      const p = this.g.ctx.createStereoPanner();
      p.connect(v.out);
      v.nodes.push(p);
      p.pan.setValueAtTime(-0.6 * side, t);
      p.pan.linearRampToValueAtTime(0.6 * side, t + 0.45);
      out = p;
    }
    const bp = this.pool.filter(v, "bandpass", 400, 2, out);
    const ng = this.pool.gain(v, 0, bp);
    this.pool.noise(v, t, ng);
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(3800, t + 0.3);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.46);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.5, t + 0.3);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);

    const lp = this.pool.filter(v, "lowpass", 1800, 1, out);
    const zg = this.pool.gain(v, 0, lp);
    const o = this.pool.osc(v, "sawtooth", 220, t, zg);
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(1100, t + 0.28);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.5);
    zg.gain.setValueAtTime(0.0001, t);
    zg.gain.exponentialRampToValueAtTime(0.12, t + 0.28);
    zg.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);

    v.out.gain.setValueAtTime(0.5, t);
    this.pool.end(v, t + 0.55);
  }

  /** Hitte-drempel: tikjes, bij 0.85 hoger en sneller. */
  heat(e: Ev<"heat">, now: number): void {
    const key = this.music.currentKey();
    const urgent = e.heat >= 0.85;
    const m = degree(key, urgent ? 12 : 10) + 12;
    const n = urgent ? 3 : 2;
    const gap = urgent ? 0.085 : 0.14;
    const v = this.pool.voice(this.ch.dry, now);
    v.out.gain.setValueAtTime(urgent ? 0.2 : 0.14, now);
    for (let i = 0; i < n; i++) {
      const t = now + i * gap;
      const g = this.pool.gain(v, 0, v.out);
      this.pool.osc(v, "triangle", mtof(m), t, g);
      this.pool.osc(v, "sine", mtof(m + 12), t, this.pool.gain(v, 0.3, g));
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.06);
    }
    this.pool.end(v, now + (n - 1) * gap + 0.08);
  }

  /** Dood: lage dreun en een ruisuitbarsting die dichtgaat. De tape-stop doet de muziek zelf. */
  death(_e: Ev<"death">, now: number): void {
    const t = now;
    const v = this.pool.voice(this.ch.low, t);
    v.out.gain.setValueAtTime(1, t);
    const bg = this.pool.gain(v, 0, v.out);
    const o = this.pool.osc(v, "sine", 95, t, bg);
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    // Boventoon zodat de dreun ook op een telefoon hoorbaar is.
    const o2 = this.pool.osc(v, "triangle", 190, t, this.pool.gain(v, 0.3, bg));
    o2.frequency.setValueAtTime(190, t);
    o2.frequency.exponentialRampToValueAtTime(56, t + 1.2);
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.6, t + 0.01);
    bg.gain.exponentialRampToValueAtTime(0.0004, t + 1.6);

    const lp = this.pool.filter(v, "lowpass", 4000, 0.7, v.out);
    const ng = this.pool.gain(v, 0, lp);
    this.pool.noise(v, t, ng);
    lp.frequency.setValueAtTime(4000, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 0.9);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.32, t + 0.008);
    ng.gain.exponentialRampToValueAtTime(0.0003, t + 1.1);
    this.pool.end(v, t + 1.65);
  }

  /** Start van een run: zacht oplopend klokkenspel in het akkoord. */
  start(now: number): void {
    const key = this.music.currentKey();
    const steps = [5, 7, 9, 10];
    for (let i = 0; i < steps.length; i++) {
      const d = steps[i] ?? 5;
      this.bell(now + 0.02 + i * 0.075, degree(key, d), 0.38 - i * 0.04, this.ch.wet, (i - 1.5) * 0.15, 3.5, 1.8);
    }
  }

  /** Klein helder klikje voor knoppen. */
  click(now: number): void {
    const v = this.pool.voice(this.ch.dry, now);
    const f = rand(2050, 2250);
    const o = this.pool.osc(v, "sine", f, now, v.out);
    o.frequency.setValueAtTime(f, now);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, now + 0.025);
    v.out.gain.setValueAtTime(0, now);
    v.out.gain.linearRampToValueAtTime(0.14, now + 0.001);
    v.out.gain.exponentialRampToValueAtTime(0.0002, now + 0.045);
    this.pool.end(v, now + 0.05);
  }

  /**
   * Spanningstoon tijdens een hete baan: stijgt een kwint mee met de hitte en trilt steeds sneller.
   * Wordt elk frame aangeroepen; bouwt alleen knooppunten bij aan- of uitgaan.
   */
  updateTension(heat: number, key: Key, now: number): void {
    const on = heat > 0.6;
    if (!on) {
      if (this.tension) {
        this.pool.release(this.tension, now, 0.08);
        this.tension = null;
        this.tensionOsc = null;
        this.tensionLfo = null;
      }
      return;
    }
    const h = clamp((heat - 0.6) / 0.4, 0, 1);
    const hz = mtof(key.root + 12 + 7 * h);
    if (!this.tension) {
      const v = this.pool.voice(this.ch.low, now, true);
      const trem = this.pool.gain(v, 0.55, v.out);
      const osc = this.pool.osc(v, "triangle", hz, now, trem);
      this.pool.osc(v, "sine", hz * 1.5, now, this.pool.gain(v, 0.25, trem));
      const lfo = this.pool.osc(v, "sine", 3, now, this.pool.gain(v, 0.45, trem.gain));
      v.out.gain.setValueAtTime(0, now);
      this.tension = v;
      this.tensionOsc = osc;
      this.tensionLfo = lfo;
      this.tensionAt = 0;
    }
    // Niet elk frame nieuwe automatie: 20 keer per seconde is genoeg.
    if (now - this.tensionAt < 0.05) return;
    this.tensionAt = now;
    glide(this.tension.out.gain, 0.05 + 0.07 * h, now, 0.12);
    if (this.tensionOsc) glide(this.tensionOsc.frequency, hz, now, 0.1);
    if (this.tensionLfo) glide(this.tensionLfo.frequency, 3 + 9 * h, now, 0.1);
  }

  stopAll(): void {
    this.tension = null;
    this.tensionOsc = null;
    this.tensionLfo = null;
    this.pool.stopAll();
  }

  /** FM-tokkel: draaggolf met modulator (ratio), modulatie-index valt snel weg. */
  private bell(t: number, m: number, vel: number, dest: AudioNode, pan: number, ratio: number, dur: number): void {
    const hz = mtof(m);
    const v = this.pool.voice(dest, t);
    const out = this.pool.pan(v, pan, v.out);
    const car = this.pool.osc(v, "sine", hz, t, out);
    const mg = this.pool.gain(v, 0, car.frequency);
    this.pool.osc(v, "sine", hz * ratio, t, mg);
    mg.gain.setValueAtTime(hz * 2.4 * vel, t);
    mg.gain.exponentialRampToValueAtTime(hz * 0.08 + 1, t + 0.45);
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(0.3 * vel, t + 0.004);
    g.exponentialRampToValueAtTime(0.0003 * vel + 1e-5, t + dur);
    this.pool.end(v, t + dur + 0.02);
  }

  /** PERFECT: glinsterend akkoord hoog boven de noot, met veel galm. */
  private shimmer(t: number, key: Key, m: number): void {
    const v = this.pool.voice(this.ch.wet, t);
    const tones = chordTones(key, this.music.chordDegree());
    for (let i = 0; i < tones.length; i++) {
      const hz = mtof((tones[i] ?? m) + 24);
      const st = t + i * 0.025;
      this.pool.osc(v, "sine", hz, st, v.out, -7);
      this.pool.osc(v, "sine", hz, st, v.out, 7);
    }
    this.pool.osc(v, "triangle", mtof(m + 12), t, this.pool.gain(v, 0.5, v.out));
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(0.06, t + 0.03);
    g.exponentialRampToValueAtTime(0.00005, t + 2.6);
    this.pool.end(v, t + 2.65);
  }

  private glass(t: number, m: number, vel: number, pan: number): void {
    const hz = mtof(m);
    const v = this.pool.voice(this.ch.bright, t);
    const out = this.pool.pan(v, pan, v.out);
    this.pool.osc(v, "sine", hz, t, out);
    // Niet-harmonische boventonen: dat klinkt als glas. Alleen onder de Nyquist-grens (anders vouwt het terug).
    const limit = this.g.ctx.sampleRate * 0.42;
    for (const [ratio, level, len] of GLASS) {
      if (hz * ratio >= limit) continue;
      const pg = this.pool.gain(v, level, out);
      this.pool.osc(v, "sine", hz * ratio, t, pg);
      pg.gain.setValueAtTime(level, t);
      pg.gain.exponentialRampToValueAtTime(0.001, t + len);
    }
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(vel, t + 0.002);
    g.exponentialRampToValueAtTime(vel * 0.001 + 1e-5, t + 0.7);
    this.pool.end(v, t + 0.72);
  }

  private whoosh(t: number, pan: number): void {
    const v = this.pool.voice(this.ch.dry, t);
    const out = this.pool.pan(v, pan, v.out);
    const bp = this.pool.filter(v, "bandpass", 2800, 1.1, out);
    this.pool.noise(v, t, bp);
    bp.frequency.setValueAtTime(2800, t);
    bp.frequency.exponentialRampToValueAtTime(520, t + 0.3);
    const tg = this.pool.gain(v, 0, out);
    const o = this.pool.osc(v, "sine", 540, t, tg);
    o.frequency.setValueAtTime(540, t);
    o.frequency.exponentialRampToValueAtTime(170, t + 0.16);
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(0.18, t + 0.008);
    tg.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(0.32, t + 0.025);
    g.exponentialRampToValueAtTime(0.0003, t + 0.34);
    this.pool.end(v, t + 0.36);
  }
}
