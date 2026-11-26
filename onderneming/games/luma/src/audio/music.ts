// Generatieve muziek in de toonsoort van de zone. Een vooruitkijkende planner zet noten op AudioContext-tijd;
// lagen komen erbij met de intensiteit: pad → subpuls → hihat → kick → arpeggio met gevangen noten.
import type { GamePhase } from "../contracts";
import { channel, type Graph } from "./graph";
import { bassNote, chordTones, droneNotes, fold, inScale, keyFor, PROGRESSION, type Key } from "./theory";
import { clamp, glide, hold, mtof, rand } from "./util";
import { VoicePool, type Voice } from "./voices";

/** Zestienden per akkoord (twee maten). */
const CHORD_STEPS = 32;
/** Zoveel gevangen noten onthoudt het arpeggio. */
const RECENT = 6;
/** Swing op de oneven zestienden, als deel van een zestiende. */
const SWING = 0.14;

interface PhaseMix {
  duck: number;
  cutoff: number;
  pad: number;
}

const PHASE_MIX: Record<GamePhase, PhaseMix> = {
  title: { duck: 0.9, cutoff: 9000, pad: 620 },
  playing: { duck: 1, cutoff: 20000, pad: 1050 },
  paused: { duck: 0.4, cutoff: 650, pad: 760 },
  over: { duck: 0.55, cutoff: 1500, pad: 760 },
};

interface Channels {
  sub: GainNode;
  kick: GainNode;
  hatL: GainNode;
  hatR: GainNode;
  arp: GainNode;
  swell: GainNode;
}

/** Laag-niveau 0..1 boven een drempel van de intensiteit. */
function layer(x: number, from: number): number {
  return clamp((x - from) / 0.18, 0, 1);
}

export class Music {
  /** 0..1, gezet door de engine. */
  intensity = 0;
  private key: Key;
  private bpm: number;
  private targetBpm: number;
  private step = 0;
  private next = 0;
  private running = false;
  private chordIdx = 0;
  private pad: Voice[] = [];
  private pendingZone: number | null = null;
  private readonly recent: number[] = [];
  private lastArp = -1;
  private padBase = PHASE_MIX.title.pad;
  /** Tot deze tijd loopt de tape-stop: geen nieuwe noten. */
  private tapeUntil = -1;
  private readonly pool: VoicePool;
  private readonly padIn: GainNode;
  private readonly padFilter: BiquadFilterNode;
  private readonly lfos: OscillatorNode[] = [];
  private readonly ch: Channels;

  constructor(
    private readonly g: Graph,
    zone: number,
  ) {
    const ctx = g.ctx;
    this.key = keyFor(zone);
    this.bpm = this.key.bpm;
    this.targetBpm = this.key.bpm;
    this.pool = new VoicePool(ctx, 72, g.noise, g.detune);

    // Pad: alle padstemmen door één langzaam bewegend laagdoorlaatfilter.
    this.padIn = ctx.createGain();
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = this.padBase;
    this.padFilter.Q.value = 2;
    this.padIn.connect(this.padFilter).connect(channel(g, g.music, 0.55, 0.6, 0.1));
    for (const [hz, depth] of [
      [0.043, 340],
      [0.017, 200],
    ] as const) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = hz;
      const d = ctx.createGain();
      d.gain.value = depth;
      lfo.connect(d).connect(this.padFilter.frequency);
      lfo.start();
      this.lfos.push(lfo);
    }

    this.ch = {
      sub: channel(g, g.music, 0.4, 0, 0),
      kick: channel(g, g.music, 0.55, 0.06, 0),
      hatL: channel(g, g.music, 0.4, 0.25, 0.08, -0.35),
      hatR: channel(g, g.music, 0.4, 0.25, 0.08, 0.35),
      arp: channel(g, g.music, 0.4, 0.35, 0.42),
      swell: channel(g, g.music, 0.4, 0.85, 0.2),
    };
    g.setDelayTime(this.beat() * 0.75, ctx.currentTime);
  }

  currentKey(): Key {
    return this.key;
  }

  chordDegree(): number {
    return PROGRESSION[this.chordIdx % PROGRESSION.length] ?? 0;
  }

  /** Onthoud een gevangen noot: het arpeggio citeert die later. */
  remember(midi: number): void {
    this.recent.push(midi);
    if (this.recent.length > RECENT) this.recent.shift();
  }

  /**
   * Startijd voor een spelersnoot: de volgende zestiende als die binnen 40 ms valt, anders meteen.
   * Snel reageren gaat voor strak in de maat.
   */
  quantize(now: number): number {
    if (!this.running) return now;
    const sd = this.stepDur();
    let g = this.next;
    while (g - sd > now) g -= sd;
    return g > now && g - now <= 0.04 ? g : now;
  }

  setZone(zone: number): void {
    this.pendingZone = zone;
    const next = keyFor(zone);
    this.targetBpm = next.bpm;
    // Gevangen noten die niet in de nieuwe toonladder passen, vergeten.
    for (let i = this.recent.length - 1; i >= 0; i--) {
      const m = this.recent[i];
      if (m === undefined || !inScale(next, m)) this.recent.splice(i, 1);
    }
  }

  setPhase(phase: GamePhase, t: number): void {
    const mix = PHASE_MIX[phase];
    this.g.music.duck(mix.duck, t, 0.35);
    this.g.music.cutoff(mix.cutoff, t, 0.3);
    this.padBase = mix.pad;
    glide(this.padFilter.frequency, mix.pad, t, 1);
  }

  /** Dood: de band zakt weg als een stoppende bandrecorder en komt daarna rustig terug. */
  tapeStop(t: number): void {
    const d = this.g.detune.offset;
    hold(d, t);
    d.setTargetAtTime(-2400, t, 0.32);
    d.setValueAtTime(0, t + 1.8);
    for (const n of this.g.music.tapeGains()) {
      hold(n.gain, t);
      n.gain.setTargetAtTime(0, t + 0.15, 0.28);
      n.gain.setTargetAtTime(1, t + 1.9, 0.7);
    }
    this.tapeUntil = t + 1.9;
  }

  /** Nieuwe run tijdens of vlak na een tape-stop: kort dicht, toonhoogte terug, weer open. */
  restore(t: number): void {
    if (t >= this.tapeUntil) return;
    const d = this.g.detune.offset;
    for (const n of this.g.music.tapeGains()) {
      hold(n.gain, t);
      n.gain.setTargetAtTime(0, t, 0.012);
      n.gain.setTargetAtTime(1, t + 0.08, 0.15);
    }
    hold(d, t);
    d.setValueAtTime(0, t + 0.07);
    this.tapeUntil = -1;
  }

  /** Plan alle zestienden tot `horizon` (AudioContext-tijd). */
  tick(now: number, horizon: number): void {
    if (!this.running) {
      this.running = true;
      this.next = now + 0.05;
      this.step = 0;
      this.chordIdx = 0;
      this.startChord(this.next, 3.5, false);
    }
    if (this.next < now - 0.12) {
      // Hapering (trage frame, tabblad terug): niet inhalen, wel in de maat blijven.
      const sd = this.stepDur();
      const missed = Math.ceil((now - this.next) / sd);
      this.step += missed;
      this.next += missed * sd;
    }
    while (this.next < horizon) {
      this.playStep(this.next);
      this.bpm += (this.targetBpm - this.bpm) * 0.04;
      if (Math.abs(this.targetBpm - this.bpm) < 0.01) this.bpm = this.targetBpm;
      this.next += this.stepDur();
      this.step++;
    }
  }

  dispose(): void {
    for (const l of this.lfos) {
      try {
        l.stop();
      } catch {
        // al gestopt
      }
    }
    this.pool.stopAll();
  }

  private beat(): number {
    return 60 / this.bpm;
  }

  private stepDur(): number {
    return 60 / this.bpm / 4;
  }

  private playStep(t: number): void {
    if (this.pendingZone !== null && this.step % 4 === 0) {
      this.applyZone(this.pendingZone, t);
    } else if (this.step > 0 && this.step % CHORD_STEPS === 0) {
      this.chordIdx = (this.step / CHORD_STEPS) % PROGRESSION.length;
      this.startChord(t, 2.6, false);
    }
    const pos = this.step % 16;
    if (pos === 0) this.g.setDelayTime(this.beat() * 0.75, t);
    if (t < this.tapeUntil) return;

    const x = this.intensity;
    const sub = layer(x, 0.1);
    const hat = layer(x, 0.28);
    const kick = layer(x, 0.48);
    const arp = layer(x, 0.62);
    const swing = pos % 2 === 1 ? this.stepDur() * SWING : 0;

    if (sub > 0.02 && pos % 4 === 0) this.sub(t, sub * (pos === 0 ? 1 : 0.72));
    if (kick > 0.02 && (pos === 0 || pos === 8)) this.kick(t, kick);
    if (kick > 0.02 && x > 0.85 && pos === 11) this.kick(t + swing, kick * 0.4);
    if (hat > 0.02) {
      if (pos % 4 === 2) this.hat(t, hat * 0.9, pos === 14 ? 0.11 : 0.05, pos);
      else if (pos % 2 === 1 && x > 0.4 && Math.random() < 0.45 * hat) this.hat(t + swing, hat * rand(0.25, 0.4), 0.035, pos);
    }
    if (arp > 0.02 && pos % 2 === 0 && Math.random() < 0.16 + 0.3 * arp) this.arp(t, arp * rand(0.6, 1));
    else if (arp > 0.5 && pos % 4 === 3 && Math.random() < 0.12) this.arp(t + swing, arp * 0.45);
  }

  private applyZone(zone: number, t: number): void {
    this.pendingZone = null;
    this.key = keyFor(zone);
    // De wissel valt op de één van een nieuwe maat.
    this.step = 0;
    this.chordIdx = 0;
    this.startChord(t, 1.1, true);
  }

  private startChord(t: number, attack: number, swell: boolean): void {
    const rel = swell ? 0.45 : attack * 0.3;
    for (const v of this.pad) this.pool.release(v, t, rel);
    this.pad.length = 0;

    const d = this.chordDegree();
    const [r, f] = droneNotes(this.key, d);
    this.padNote(t, r, attack, 0.07, "triangle", 4);
    this.padNote(t, f, attack, 0.045, "triangle", 5);
    const tones = chordTones(this.key, d);
    // Akkoord als één blok in het middenregister leggen.
    const shift = fold(tones[0], this.key.root - 5, this.key.root + 7) - tones[0];
    for (const m of tones) this.padNote(t, m + shift, attack, swell ? 0.062 : 0.048, "sawtooth", 8);

    if (swell) {
      const fq = this.padFilter.frequency;
      hold(fq, t);
      fq.setTargetAtTime(2600, t, 0.5);
      fq.setTargetAtTime(this.padBase, t + 2.4, 1.4);
      this.swell(t, tones);
    }
  }

  /** Eén padtoon: twee iets ontstemde oscillatoren, links en rechts. */
  private padNote(t: number, m: number, attack: number, level: number, type: OscillatorType, cents: number): void {
    const v = this.pool.voice(this.padIn, t, true);
    const mg = this.pool.merger(v, v.out);
    const hz = mtof(m);
    this.pool.osc(v, type, hz, t, mg, -cents, 0);
    this.pool.osc(v, type, hz, t, mg, cents, 1);
    v.out.gain.setValueAtTime(0, t);
    v.out.gain.setTargetAtTime(level, t, attack / 3);
    this.pad.push(v);
  }

  /** Zone-wissel: hoge glinsterende akkoordtonen en een aanzwellende ruisgolf. */
  private swell(t: number, tones: readonly number[]): void {
    const v = this.pool.voice(this.ch.swell, t);
    for (const m of tones) {
      const hz = mtof(m + 24);
      this.pool.osc(v, "sine", hz, t, v.out, -6);
      this.pool.osc(v, "sine", hz, t, v.out, 6);
    }
    const bp = this.pool.filter(v, "bandpass", 500, 1.4, v.out);
    const ng = this.pool.gain(v, 0, bp);
    // De ruis zit in dezelfde stem, maar met een eigen omhullende.
    this.pool.noise(v, t, ng);
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(5200, t + 1.6);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.5, t + 1.5);
    ng.gain.linearRampToValueAtTime(0, t + 2.1);
    v.out.gain.setValueAtTime(0, t);
    v.out.gain.linearRampToValueAtTime(0.12, t + 1.2);
    v.out.gain.exponentialRampToValueAtTime(0.0002, t + 5.5);
    this.pool.end(v, t + 5.6);
  }

  private sub(t: number, vel: number): void {
    const hz = mtof(bassNote(this.key, this.chordDegree()));
    const v = this.pool.voice(this.ch.sub, t);
    this.pool.osc(v, "sine", hz, t, v.out);
    // Tweede harmonische: dan hoor je de puls ook op een telefoonspeaker.
    this.pool.osc(v, "sine", hz * 2, t, this.pool.gain(v, 0.28, v.out));
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(vel, t + 0.012);
    g.exponentialRampToValueAtTime(vel * 0.001 + 1e-5, t + 0.42);
    this.pool.end(v, t + 0.44);
  }

  private kick(t: number, vel: number): void {
    const v = this.pool.voice(this.ch.kick, t);
    const o = this.pool.osc(v, "sine", 140, t, v.out);
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.09);
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(vel, t + 0.003);
    g.exponentialRampToValueAtTime(vel * 0.001 + 1e-5, t + 0.32);
    // Zacht tikje voor de aanzet.
    const cg = this.pool.gain(v, 0, v.out);
    this.pool.noise(v, t, this.pool.filter(v, "bandpass", 2400, 1, cg));
    cg.gain.setValueAtTime(0, t);
    cg.gain.linearRampToValueAtTime(0.08, t + 0.001);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
    this.pool.end(v, t + 0.34);
  }

  private hat(t: number, vel: number, len: number, pos: number): void {
    const v = this.pool.voice(pos % 4 === 2 ? this.ch.hatR : this.ch.hatL, t);
    const hp = this.pool.filter(v, "highpass", 6800, 0.7, v.out);
    this.pool.noise(v, t, hp);
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(vel, t + 0.002);
    g.exponentialRampToValueAtTime(vel * 0.001 + 1e-5, t + len);
    this.pool.end(v, t + len + 0.01);
  }

  private arp(t: number, vel: number): void {
    const m = this.arpNote();
    const hz = mtof(m);
    const v = this.pool.voice(this.ch.arp, t);
    const lp = this.pool.filter(v, "lowpass", 2600, 0.5, v.out);
    this.pool.osc(v, "triangle", hz, t, lp);
    this.pool.osc(v, "sine", hz * 2, t, this.pool.gain(v, 0.18, v.out));
    const g = v.out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(vel, t + 0.006);
    g.exponentialRampToValueAtTime(vel * 0.001 + 1e-5, t + 0.5);
    this.pool.end(v, t + 0.52);
  }

  /** Meestal een recent gevangen noot, anders een akkoordtoon; nooit twee keer dezelfde achter elkaar. */
  private arpNote(): number {
    const lo = this.key.root + 12;
    const hi = this.key.root + 26;
    const n = this.recent.length;
    let m: number | undefined;
    if (n > 0 && Math.random() < 0.7) m = this.recent[n - 1 - Math.floor(Math.random() * Math.min(n, 4))];
    if (m === undefined || fold(m, lo, hi) === this.lastArp) {
      const tones = chordTones(this.key, this.chordDegree());
      m = tones[Math.floor(Math.random() * 3)] ?? this.key.root;
      if (fold(m, lo, hi) === this.lastArp) m = tones[0] + 12;
    }
    this.lastArp = fold(m, lo, hi);
    return this.lastArp;
  }
}
