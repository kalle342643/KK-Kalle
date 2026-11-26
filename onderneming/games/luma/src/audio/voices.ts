// Stemmenbeheer: elke klank is een stem met eigen knooppunten. Na afloop wordt alles losgekoppeld,
// en boven het maximum wordt de oudste stem zacht afgekapt.
import { hold } from "./util";

export interface Voice {
  /** Eindgain van de stem; begint op 0. */
  out: GainNode;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  /** Parameters die aan de gedeelde detune hangen. */
  detuned: AudioParam[];
  start: number;
  /** Nooit afkappen (pad, spanningstoon). */
  keep: boolean;
  ended: boolean;
  pending: number;
}

/** Een bestemming: een knooppunt of een parameter (voor modulatie). */
export type Dest = AudioNode | AudioParam;

function link(src: AudioNode, dest: Dest, input = 0): void {
  if (dest instanceof AudioNode) src.connect(dest, 0, input);
  else src.connect(dest);
}

export class VoicePool {
  private readonly active: Voice[] = [];

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly max: number,
    private readonly noiseBuf: AudioBuffer,
    private readonly detune: ConstantSourceNode | null,
  ) {}

  count(): number {
    return this.active.length;
  }

  voice(dest: AudioNode, t: number, keep = false): Voice {
    if (!keep && this.active.length >= this.max) this.steal();
    const out = this.ctx.createGain();
    out.gain.value = 0;
    out.connect(dest);
    const v: Voice = { out, srcs: [], nodes: [out], detuned: [], start: t, keep, ended: false, pending: 0 };
    this.active.push(v);
    return v;
  }

  osc(v: Voice, type: OscillatorType, freq: number, t: number, dest: Dest, cents = 0, input = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = cents;
    link(o, dest, input);
    if (this.detune) {
      this.detune.connect(o.detune);
      v.detuned.push(o.detune);
    }
    o.start(t);
    v.srcs.push(o);
    v.nodes.push(o);
    return o;
  }

  /** Lussende ruis vanaf een willekeurige plek in de gedeelde buffer. */
  noise(v: Voice, t: number, dest: AudioNode, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    // Oude Safari heeft geen detune op buffer-bronnen.
    if (this.detune && "detune" in s) {
      this.detune.connect(s.detune);
      v.detuned.push(s.detune);
    }
    s.start(t, Math.random() * (this.noiseBuf.duration - 0.05));
    v.srcs.push(s);
    v.nodes.push(s);
    return s;
  }

  gain(v: Voice, value: number, dest: Dest): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    link(g, dest);
    v.nodes.push(g);
    return g;
  }

  filter(v: Voice, type: BiquadFilterType, freq: number, q: number, dest: AudioNode): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    v.nodes.push(f);
    return f;
  }

  /** Stereo-plaats; zonder StereoPanner (heel oude browsers) gaat het signaal recht door. */
  pan(v: Voice, value: number, dest: AudioNode): AudioNode {
    if (value === 0 || typeof this.ctx.createStereoPanner !== "function") return dest;
    const p = this.ctx.createStereoPanner();
    p.pan.value = value;
    p.connect(dest);
    v.nodes.push(p);
    return p;
  }

  /** Twee mono-bronnen naar links en rechts. */
  merger(v: Voice, dest: AudioNode): ChannelMergerNode {
    const m = this.ctx.createChannelMerger(2);
    m.connect(dest);
    v.nodes.push(m);
    return m;
  }

  /** Stop alle bronnen op tijd `at`; daarna ruimt onended de stem op. */
  end(v: Voice, at: number): void {
    v.pending = v.srcs.length;
    if (v.pending === 0) {
      this.cleanup(v);
      return;
    }
    for (const s of v.srcs) {
      s.onended = () => {
        v.pending--;
        if (v.pending <= 0) this.cleanup(v);
      };
      try {
        s.stop(at);
      } catch {
        // al gestopt
      }
    }
  }

  /** Zacht uitfaden vanaf t en daarna stoppen. */
  release(v: Voice, t: number, tau: number): void {
    hold(v.out.gain, t);
    v.out.gain.setTargetAtTime(0, t, tau);
    this.end(v, t + tau * 7);
  }

  /** Alles meteen (maar zonder klik) stoppen. */
  stopAll(): void {
    const now = this.ctx.currentTime;
    for (const v of this.active.slice()) this.release(v, now, 0.02);
  }

  private steal(): void {
    let victim: Voice | undefined;
    for (const v of this.active) {
      if (!v.keep && !v.ended) {
        victim = v;
        break;
      }
    }
    if (!victim) return;
    // Uit de telling halen; de knooppunten ruimt onended later op.
    victim.ended = true;
    const i = this.active.indexOf(victim);
    if (i >= 0) this.active.splice(i, 1);
    const now = this.ctx.currentTime;
    hold(victim.out.gain, now);
    victim.out.gain.setTargetAtTime(0, now, 0.012);
    for (const s of victim.srcs) {
      try {
        s.stop(now + 0.08);
      } catch {
        // al gestopt
      }
    }
  }

  private cleanup(v: Voice): void {
    v.ended = true;
    const i = this.active.indexOf(v);
    if (i >= 0) this.active.splice(i, 1);
    if (this.detune) {
      for (const p of v.detuned) {
        try {
          this.detune.disconnect(p);
        } catch {
          // was al los
        }
      }
    }
    for (const n of v.nodes) n.disconnect();
    v.srcs.length = 0;
    v.nodes.length = 0;
    v.detuned.length = 0;
  }
}
