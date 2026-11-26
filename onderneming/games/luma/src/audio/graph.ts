// De vaste mengtafel: muziek- en sfx-bus, gedeelde galm en ping-pong-echo, lijm-compressor en begrenzer.
import { glide, hold } from "./util";

/**
 * Een bus heeft drie ingangen (droog, galm, echo). Elk pad krijgt dezelfde filter- en gain-trappen,
 * zodat dempen, filteren en de tape-stop ook de galm- en echostaart van die bus raken.
 */
export class Bus {
  readonly dry: GainNode;
  readonly verb: GainNode;
  readonly delay: GainNode;
  private readonly filters: BiquadFilterNode[] = [];
  private readonly ducks: GainNode[] = [];
  private readonly tapes: GainNode[] = [];
  private readonly levels: GainNode[] = [];

  constructor(ctx: BaseAudioContext, outs: readonly [AudioNode, AudioNode, AudioNode], filtered: boolean, level: number) {
    this.dry = ctx.createGain();
    this.verb = ctx.createGain();
    this.delay = ctx.createGain();
    const ins = [this.dry, this.verb, this.delay];
    for (let i = 0; i < 3; i++) {
      const input = ins[i];
      const out = outs[i];
      if (!input || !out) continue;
      let node: AudioNode = input;
      if (filtered) {
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 20000;
        f.Q.value = 0.3;
        node.connect(f);
        node = f;
        this.filters.push(f);
      }
      const duck = ctx.createGain();
      const tape = ctx.createGain();
      const lvl = ctx.createGain();
      lvl.gain.value = level;
      node.connect(duck).connect(tape).connect(lvl).connect(out);
      this.ducks.push(duck);
      this.tapes.push(tape);
      this.levels.push(lvl);
    }
  }

  /** Volume van de bus (instelling). */
  level(v: number, t: number, tau: number): void {
    for (const g of this.levels) glide(g.gain, v, t, tau);
  }

  /** Dempen voor pauze of game over. */
  duck(v: number, t: number, tau: number): void {
    for (const g of this.ducks) glide(g.gain, v, t, tau);
  }

  cutoff(hz: number, t: number, tau: number): void {
    for (const f of this.filters) glide(f.frequency, hz, t, tau);
  }

  /** Gains van de tape-stop-trap, voor eigen automatie. */
  tapeGains(): readonly GainNode[] {
    return this.tapes;
  }
}

/** Een vaste mengkanaal-ingang met eigen galm- en echo-send. Stemmen sluiten hierop aan. */
export function channel(g: Graph, bus: Bus, gain: number, verb: number, delay: number, pan = 0): GainNode {
  const ctx = g.ctx;
  const input = ctx.createGain();
  input.gain.value = gain;
  let out: AudioNode = input;
  if (pan !== 0 && g.hasPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    input.connect(p);
    out = p;
  }
  out.connect(bus.dry);
  if (verb > 0) {
    const s = ctx.createGain();
    s.gain.value = verb;
    out.connect(s).connect(bus.verb);
  }
  if (delay > 0) {
    const s = ctx.createGain();
    s.gain.value = delay;
    out.connect(s).connect(bus.delay);
  }
  return input;
}

export interface Graph {
  ctx: BaseAudioContext;
  /** Hoofdvolume na de begrenzer (dempen). */
  master: GainNode;
  music: Bus;
  sfx: Bus;
  /** Gedeelde toonhoogte-offset (cent) voor alle muziek: de tape-stop. */
  detune: ConstantSourceNode;
  /** Twee seconden witte ruis, gedeeld door alle ruisgeluiden. */
  noise: AudioBuffer;
  hasPanner: boolean;
  /** Echo-tijd in seconden (meestal een gepunteerde achtste). */
  setDelayTime(sec: number, t: number): void;
  dispose(): void;
}

export interface GraphLevels {
  music: number;
  sfx: number;
  master: number;
}

export function buildGraph(ctx: BaseAudioContext, levels: GraphLevels): Graph {
  const t0 = ctx.currentTime;

  // Somknooppunt met kopruimte, daarna lijm, begrenzer, dempen en een laatste trim.
  const sum = ctx.createGain();
  sum.gain.value = 0.66;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -20;
  glue.knee.value = 14;
  glue.ratio.value = 2.2;
  glue.attack.value = 0.025;
  glue.release.value = 0.3;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  const master = ctx.createGain();
  master.gain.setValueAtTime(levels.master, t0);
  const trim = ctx.createGain();
  trim.gain.value = 0.95;
  sum.connect(glue).connect(limiter).connect(master).connect(trim).connect(ctx.destination);

  // Galm: procedurele stereo-impuls van ~3 s, laag weggefilterd tegen modder.
  const verbIn = ctx.createGain();
  const verbHp = ctx.createBiquadFilter();
  verbHp.type = "highpass";
  verbHp.frequency.value = 220;
  verbHp.Q.value = 0.5;
  const convolver = ctx.createConvolver();
  convolver.normalize = true;
  convolver.buffer = makeImpulse(ctx, 3.2);
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.9;
  verbIn.connect(verbHp).connect(convolver).connect(verbOut).connect(sum);

  // Ping-pong-echo: mono in, links → rechts → terug, met een donkerder wordende terugkoppeling.
  const delayIn = ctx.createGain();
  delayIn.channelCount = 1;
  delayIn.channelCountMode = "explicit";
  const delayHp = ctx.createBiquadFilter();
  delayHp.type = "highpass";
  delayHp.frequency.value = 320;
  const delayLp = ctx.createBiquadFilter();
  delayLp.type = "lowpass";
  delayLp.frequency.value = 4200;
  const delayL = ctx.createDelay(2);
  const delayR = ctx.createDelay(2);
  const fbLp = ctx.createBiquadFilter();
  fbLp.type = "lowpass";
  fbLp.frequency.value = 2600;
  const fb = ctx.createGain();
  fb.gain.value = 0.38;
  const merger = ctx.createChannelMerger(2);
  const delayOut = ctx.createGain();
  delayOut.gain.value = 0.75;
  const delayToVerb = ctx.createGain();
  delayToVerb.gain.value = 0.25;
  delayIn.connect(delayHp).connect(delayLp).connect(delayL);
  delayL.connect(merger, 0, 0);
  delayL.connect(delayR);
  delayR.connect(merger, 0, 1);
  delayR.connect(fbLp).connect(fb).connect(delayL);
  merger.connect(delayOut).connect(sum);
  delayOut.connect(delayToVerb).connect(verbIn);
  delayL.delayTime.value = 0.45;
  delayR.delayTime.value = 0.45;

  const outs = [sum, verbIn, delayIn] as const;
  const music = new Bus(ctx, outs, true, levels.music);
  const sfx = new Bus(ctx, outs, false, levels.sfx);

  const detune = ctx.createConstantSource();
  detune.offset.value = 0;
  detune.start(t0);

  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  return {
    ctx,
    master,
    music,
    sfx,
    detune,
    noise,
    hasPanner: typeof ctx.createStereoPanner === "function",
    setDelayTime(sec: number, t: number): void {
      for (const d of [delayL, delayR]) {
        hold(d.delayTime, t);
        d.delayTime.setTargetAtTime(Math.min(1.9, sec), t, 0.4);
      }
    },
    dispose(): void {
      try {
        detune.stop();
      } catch {
        // al gestopt
      }
      trim.disconnect();
    },
  };
}

/**
 * Stereo-impuls: ruis met exponentieel verval, zachte inzet en een staart die steeds donkerder wordt.
 * Links en rechts hebben eigen ruis: dat geeft breedte.
 */
function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(sr * 0.012);
  const fadeIn = sr * 0.03;
  const decay = 6.9 / seconds; // -60 dB aan het eind
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      if (i < pre) {
        d[i] = 0;
        continue;
      }
      const t = (i - pre) / sr;
      const env = Math.exp(-decay * t) * Math.min(1, (i - pre) / fadeIn);
      // Eén-pool laagdoorlaat die met de tijd sluit: hoog sterft sneller uit.
      const k = 0.55 - 0.4 * Math.min(1, t / seconds);
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * env;
    }
  }
  return buf;
}
