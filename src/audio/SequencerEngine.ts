import { audioEngine } from './AudioEngine';
import { voiceManager } from './VoiceManager';
import { NoteEvent, SequencePattern } from '../state/types';
import { useStore } from '../state/useStore';

export interface PlayheadInfo {
  playing: boolean;
  recording: boolean;
  countingIn: boolean;
  countInBeat: number; // 1..4
  beat: number; // 0..totalBeats
  totalBeats: number;
  progress: number; // 0..1
  sequenceId: string;
}

class SequencerEngineImpl {
  private timerId: number | null = null;
  private isPlaying = false;
  private isRecording = false;
  private countingIn = false;
  private countInBeat = 0;

  // Timeline anchors in AudioContext time
  private nextTickTime = 0;
  private currentStepIndex = 0; // counts in 1/96th beat ticks? No: we track beat range directly!
  private lastScheduledBeat = 0;
  private loopStartAudioTime = 0;
  private activeSeqIndexInSong = 0;

  // Prevent double-triggering notes just recorded live in the same pass
  private recentlyRecordedIds = new Set<string>();

  // Standalone 4/4 metronome loop (runs when metronome is ON while sequencer is stopped)
  private standaloneTimerId: number | null = null;
  private standaloneNextBeatTime = 0;
  private standaloneBeatCount = 0;

  private readonly LOOKAHEAD_SEC = 0.08;
  private readonly INTERVAL_MS = 20;

  get playing(): boolean {
    return this.isPlaying;
  }

  get recording(): boolean {
    return this.isRecording;
  }

  private getActiveSequence(): SequencePattern | null {
    const state = useStore.getState();
    const seqs = state.project.sequences;
    if (seqs.length === 0) return null;

    if (state.songMode) {
      const nonEmpty = seqs.filter((s) => s.notes.length > 0);
      const list = nonEmpty.length > 0 ? nonEmpty : seqs;
      return list[this.activeSeqIndexInSong % list.length] ?? seqs[0];
    }

    return seqs.find((s) => s.id === state.activeSequenceId) ?? seqs[0];
  }

  private getSecondsPerBeat(): number {
    const bpm = useStore.getState().project.bpm || 92;
    return 60 / Math.max(40, Math.min(240, bpm));
  }

  /**
   * Computes MPC-style swing offset in beats for a given beat position.
   * Shifts odd 16th-note subdivisions forward proportionally to swing (0..0.65).
   */
  applySwingToBeat(beat: number, swing: number): number {
    if (swing <= 0.005) return beat;
    const sixteenthPos = beat * 4;
    const nearestSixteenth = Math.round(sixteenthPos);
    const dist = Math.abs(sixteenthPos - nearestSixteenth);
    if (dist < 0.2 && nearestSixteenth % 2 === 1) {
      // Shift odd 16th note forward by up to 1/3 of a 16th note
      return beat + swing * 0.125;
    }
    return beat;
  }

  private playMetronomeClick(when: number, accent: boolean): void {
    const ctx = audioEngine.context;
    const vol = useStore.getState().metronomeVolume;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(accent ? 1560 : 1040, when);
    osc.frequency.exponentialRampToValueAtTime(accent ? 920 : 640, when + 0.022);

    const peakGain = Math.max(0.0001, (accent ? 0.55 : 0.36) * vol);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peakGain, when + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.052);
  }

  private startStandaloneMetronome(): void {
    if (this.standaloneTimerId !== null || this.isPlaying) return;
    void audioEngine.unlock().then((ctx) => {
      if (this.isPlaying || !useStore.getState().metronomeOn) return;
      if (this.standaloneTimerId !== null) return;
      this.standaloneBeatCount = 0;
      this.standaloneNextBeatTime = ctx.currentTime + 0.02;
      this.standaloneMetronomeTick();
      this.standaloneTimerId = window.setInterval(
        () => this.standaloneMetronomeTick(),
        this.INTERVAL_MS
      );
    });
  }

  private stopStandaloneMetronome(): void {
    if (this.standaloneTimerId !== null) {
      window.clearInterval(this.standaloneTimerId);
      this.standaloneTimerId = null;
    }
  }

  private standaloneMetronomeTick(): void {
    if (this.isPlaying || !useStore.getState().metronomeOn) {
      this.stopStandaloneMetronome();
      return;
    }
    const ctx = audioEngine.context;
    const horizon = ctx.currentTime + this.LOOKAHEAD_SEC;
    const spb = this.getSecondsPerBeat();

    while (this.standaloneNextBeatTime < horizon) {
      const accent = this.standaloneBeatCount % 4 === 0; // Fixed 4/4 time signature
      this.playMetronomeClick(Math.max(ctx.currentTime, this.standaloneNextBeatTime), accent);
      this.standaloneBeatCount = (this.standaloneBeatCount + 1) % 4;
      this.standaloneNextBeatTime += spb;
    }
  }

  setMetronomeEnabled(on: boolean): void {
    useStore.getState().setMetronomeOn(on);
    if (on) {
      if (!this.isPlaying) {
        this.startStandaloneMetronome();
      }
    } else {
      this.stopStandaloneMetronome();
    }
  }

  toggleMetronome(): void {
    const next = !useStore.getState().metronomeOn;
    this.setMetronomeEnabled(next);
  }

  async start(withRecord = false): Promise<void> {
    this.stopStandaloneMetronome();
    const ctx = await audioEngine.unlock();
    const state = useStore.getState();

    if (this.isPlaying) {
      if (withRecord) {
        this.isRecording = !this.isRecording;
        state.setSeqTransport(true, this.isRecording, false, 0);
      }
      return;
    }

    this.activeSeqIndexInSong = 0;
    this.isPlaying = true;
    this.isRecording = withRecord;
    this.recentlyRecordedIds.clear();

    const spb = this.getSecondsPerBeat();
    const startAt = ctx.currentTime + 0.04;

    if (withRecord && state.countInOn) {
      // 4-beat friendly count-in before bar 1 begins (audible ONLY if metronome icon is ON!)
      this.countingIn = true;
      this.countInBeat = 1;
      if (state.metronomeOn) {
        for (let b = 0; b < 4; b++) {
          this.playMetronomeClick(startAt + b * spb, b === 0);
        }
      }
      this.loopStartAudioTime = startAt + 4 * spb;
      this.lastScheduledBeat = -0.0001;
      this.nextTickTime = this.loopStartAudioTime;
      state.setSeqTransport(true, true, true, 1);
    } else {
      this.countingIn = false;
      this.countInBeat = 0;
      this.loopStartAudioTime = startAt;
      this.lastScheduledBeat = -0.0001;
      this.nextTickTime = startAt;
      state.setSeqTransport(true, withRecord, false, 0);
    }

    this.currentStepIndex = 0;
    this.schedulerTick();
    this.timerId = window.setInterval(() => this.schedulerTick(), this.INTERVAL_MS);
  }

  stop(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    this.stopStandaloneMetronome();
    this.isPlaying = false;
    this.isRecording = false;
    this.countingIn = false;
    this.countInBeat = 0;
    this.recentlyRecordedIds.clear();
    voiceManager.stopAll();
    useStore.getState().setSeqTransport(false, false, false, 0);
  }

  togglePlay(): void {
    if (this.isPlaying) {
      this.stop();
    } else {
      void this.start(false);
    }
  }

  toggleRecord(): void {
    if (!this.isPlaying) {
      void this.start(true);
    } else {
      this.isRecording = !this.isRecording;
      useStore.getState().setSeqTransport(true, this.isRecording, this.countingIn, this.countInBeat);
    }
  }

  private schedulerTick(): void {
    if (!this.isPlaying) return;
    const ctx = audioEngine.context;
    const now = ctx.currentTime;
    const state = useStore.getState();
    const spb = this.getSecondsPerBeat();

    // Handle count-in countdown display
    if (this.countingIn) {
      const timeUntilStart = this.loopStartAudioTime - now;
      if (timeUntilStart > 0) {
        const beatNum = Math.min(4, Math.max(1, 5 - Math.ceil(timeUntilStart / spb)));
        if (beatNum !== this.countInBeat) {
          this.countInBeat = beatNum;
          state.setSeqTransport(true, this.isRecording, true, beatNum);
        }
        if (timeUntilStart > this.LOOKAHEAD_SEC) return;
      } else {
        this.countingIn = false;
        this.countInBeat = 0;
        state.setSeqTransport(true, this.isRecording, false, 0);
      }
    }

    const seq = this.getActiveSequence();
    if (!seq) return;

    const totalBeats = Math.max(4, seq.bars * 4);
    // Safe wrap if user switches live (e.g. in Perform) from a longer sequence to a shorter one
    if (this.lastScheduledBeat >= totalBeats) {
      this.lastScheduledBeat = this.lastScheduledBeat % totalBeats;
      this.loopStartAudioTime = now - Math.max(0, this.lastScheduledBeat) * spb;
      this.nextTickTime = now;
    }
    const horizonTime = now + this.LOOKAHEAD_SEC;

    // Schedule metronome clicks & notes up to horizonTime
    while (this.nextTickTime < horizonTime) {
      const windowStartBeat = this.lastScheduledBeat;
      const stepBeats = 0.0625; // 1/16th of a beat (= 1/64th note resolution)
      const windowEndBeat = Math.min(totalBeats, Math.max(0, windowStartBeat) + stepBeats);

      // Metronome strictly follows the TopBar metronome icon in both PLAY and REC modes (fixed 4/4)
      if (state.metronomeOn) {
        const firstBeat = Math.floor(windowStartBeat + 1e-7) + 1;
        for (let b = firstBeat; b <= windowEndBeat + 1e-7; b++) {
          if (b >= 0 && b < totalBeats) {
            const clickTime = this.loopStartAudioTime + b * spb;
            if (clickTime >= now - 0.025) {
              this.playMetronomeClick(Math.max(now, clickTime), b % 4 === 0);
            }
          }
        }
      }

      // Schedule all notes falling in (windowStartBeat, windowEndBeat]
      const mutedSet = new Set(state.mutedPads);
      const swing = state.project.swing;
      for (const note of seq.notes) {
        if (mutedSet.has(note.padId)) continue;
        if (note.startBeat > windowStartBeat && note.startBeat <= windowEndBeat) {
          if (this.recentlyRecordedIds.has(note.id)) {
            this.recentlyRecordedIds.delete(note.id);
            continue;
          }
          const swungBeat = this.applySwingToBeat(note.startBeat, swing);
          const triggerAt = this.loopStartAudioTime + swungBeat * spb;
          if (triggerAt >= now - 0.03) {
            const pad = state.project.pads[note.padId];
            if (pad?.hasSample) {
              voiceManager.triggerPad(pad, {
                velocity: note.velocity,
                pitchOffset: note.pitchOffset,
                when: Math.max(now, triggerAt),
              });
            }
          }
        }
      }

      this.lastScheduledBeat = windowEndBeat;
      this.currentStepIndex++;

      if (windowEndBeat >= totalBeats - 1e-6) {
        // Wrap to next loop (or next pattern in Song Mode)
        this.loopStartAudioTime += totalBeats * spb;
        this.lastScheduledBeat = -0.0001;
        this.recentlyRecordedIds.clear();

        if (state.songMode) {
          const nonEmpty = state.project.sequences.filter((s) => s.notes.length > 0);
          if (nonEmpty.length > 1) {
            this.activeSeqIndexInSong = (this.activeSeqIndexInSong + 1) % nonEmpty.length;
            const nextSeq = nonEmpty[this.activeSeqIndexInSong];
            if (nextSeq) {
              state.selectSequence(nextSeq.id);
            }
          }
        }
      }

      this.nextTickTime =
        this.loopStartAudioTime + Math.max(0, this.lastScheduledBeat) * spb;
    }
  }

  /**
   * Called by PadGrid or KeyboardOverlay whenever the user taps a pad/key.
   * If Sequencer is recording, records the hit with optional Quantize into the active pattern!
   */
  recordLiveHit(padId: number, velocity = 0.92, pitchOffset = 0): void {
    if (!this.isPlaying || !this.isRecording) return;
    const ctx = audioEngine.context;
    const now = ctx.currentTime;
    const state = useStore.getState();
    const seq = this.getActiveSequence();
    if (!seq) return;

    const spb = this.getSecondsPerBeat();
    const totalBeats = Math.max(4, seq.bars * 4);

    // Allow slightly early hits right at the end of count-in to snap to beat 0!
    let rawBeat = (now - this.loopStartAudioTime) / spb;
    if (this.countingIn) {
      if (rawBeat < -0.25) return; // Too early during count-in
      rawBeat = 0;
    }

    // Wrap cleanly into [0, totalBeats)
    rawBeat = ((rawBeat % totalBeats) + totalBeats) % totalBeats;

    let finalBeat = rawBeat;
    const q = state.project.quantize; // 0 = off, 8 = 1/8 (2 per beat), 16 = 1/16 (4 per beat), 12 = triplets (3 per beat)
    if (q > 0) {
      const stepsPerBeat = q === 12 ? 3 : q / 4;
      const snapped = Math.round(rawBeat * stepsPerBeat) / stepsPerBeat;
      finalBeat = snapped >= totalBeats - 0.001 ? 0 : snapped;
    }

    // Avoid duplicate hits on exact same pad & quantized slot
    const duplicate = seq.notes.some(
      (n) =>
        n.padId === padId &&
        n.pitchOffset === pitchOffset &&
        Math.abs(n.startBeat - finalBeat) < 0.06
    );
    if (duplicate) return;

    const note: NoteEvent = {
      id: `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      padId,
      startBeat: Math.round(finalBeat * 1000) / 1000,
      durationBeats: 0.25,
      velocity,
      pitchOffset,
    };

    // If quantized forward slightly ahead of now, mark it so scheduler doesn't double-trigger it this pass
    if (finalBeat >= rawBeat - 0.01 && finalBeat - rawBeat < 0.35) {
      this.recentlyRecordedIds.add(note.id);
    }

    state.addNoteToSequence(seq.id, note);
  }

  getPlayheadInfo(): PlayheadInfo {
    const seq = this.getActiveSequence();
    const totalBeats = seq ? Math.max(4, seq.bars * 4) : 8;
    const seqId = seq?.id ?? '';

    if (!this.isPlaying) {
      return {
        playing: false,
        recording: false,
        countingIn: false,
        countInBeat: 0,
        beat: 0,
        totalBeats,
        progress: 0,
        sequenceId: seqId,
      };
    }

    if (this.countingIn) {
      return {
        playing: true,
        recording: this.isRecording,
        countingIn: true,
        countInBeat: this.countInBeat,
        beat: 0,
        totalBeats,
        progress: 0,
        sequenceId: seqId,
      };
    }

    const ctx = audioEngine.context;
    const spb = this.getSecondsPerBeat();
    const elapsedBeats = Math.max(0, (ctx.currentTime - this.loopStartAudioTime) / spb);
    const beat = elapsedBeats % totalBeats;

    return {
      playing: true,
      recording: this.isRecording,
      countingIn: false,
      countInBeat: 0,
      beat,
      totalBeats,
      progress: beat / totalBeats,
      sequenceId: seqId,
    };
  }
}

export const sequencerEngine = new SequencerEngineImpl();
