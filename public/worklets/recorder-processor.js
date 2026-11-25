// Lossless PCM capture AudioWorklet for both microphone recording and internal resampling.
// Streams Float32 stereo/mono chunks directly to the main thread with zero codec delay.

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRecording = false;
    this.chunkSize = 2048;
    this.leftBuf = new Float32Array(this.chunkSize);
    this.rightBuf = new Float32Array(this.chunkSize);
    this.writeIndex = 0;
    this.meterCounter = 0;
    this.peak = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'start') {
        this.isRecording = true;
        this.writeIndex = 0;
        this.peak = 0;
      } else if (msg.type === 'stop') {
        if (this.isRecording && this.writeIndex > 0) {
          this.flush(this.writeIndex);
        }
        this.isRecording = false;
        this.writeIndex = 0;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  flush(length) {
    const left = this.leftBuf.slice(0, length);
    const right = this.rightBuf.slice(0, length);
    this.port.postMessage(
      { type: 'chunk', left, right, length },
      [left.buffer, right.buffer]
    );
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const ch0 = input[0];
    const ch1 = input.length > 1 ? input[1] : ch0;
    if (!ch0) return true;

    let localPeak = 0;
    for (let i = 0; i < ch0.length; i++) {
      const l = ch0[i];
      const r = ch1[i];
      const absL = l < 0 ? -l : l;
      const absR = r < 0 ? -r : r;
      if (absL > localPeak) localPeak = absL;
      if (absR > localPeak) localPeak = absR;

      if (this.isRecording) {
        this.leftBuf[this.writeIndex] = l;
        this.rightBuf[this.writeIndex] = r;
        this.writeIndex++;
        if (this.writeIndex >= this.chunkSize) {
          this.flush(this.chunkSize);
          this.writeIndex = 0;
        }
      }
    }

    if (localPeak > this.peak) this.peak = localPeak;
    this.meterCounter += ch0.length;
    if (this.meterCounter >= 1024) {
      this.port.postMessage({ type: 'meter', peak: this.peak });
      this.peak = 0;
      this.meterCounter = 0;
    }

    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
