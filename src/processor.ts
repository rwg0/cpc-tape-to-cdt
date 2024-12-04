/**
 * Amstrad CPC Tape to CDT Online Converter
 *
 * (c) 2024 Henri MEDOT
 *
 * This source code is licensed under the MIT License.
 * See the LICENSE file in the project root for more information.
 */

export class PulseProcessor extends AudioWorkletProcessor {
  level: number;
  counter: number;
  lastPeak: number;
  candidateIndex = 4;
  precision = 10000;
  threshold = 2000;
  sliceLength: number;
  slice: number[];
  capturing = false;

  /**
   * Constructor.
   */
  constructor(options?: AudioWorkletNodeOptions) {
    super();

    this.port.onmessage = event => this.processMessage(event.data);
  }

  /**
   * Executes the commands sent by the main thread.
   */
  processMessage([type, ...data]: PulseProcessorCommand) {
    switch (type) {
      case 'capture':
        if (!this.capturing) {
          this.level = 0;
          this.counter = 0;
          this.lastPeak = 0;
          this.sliceLength = (this.candidateIndex * 2) + 1;
          this.slice = Array(this.sliceLength).fill(0);
          this.capturing = true;
        }
        break;

      case 'stop':
        if (this.capturing) {
          this.capturing = false;
          this.port.postMessage(['edges', []]);
        }
        break;
    }
  }

  /**
   * Implements the required process() method for an AudioWorkletProcessor.
   */
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>) {
    if (!this.capturing) {
      return true;
    }

    const input = inputs[0][0];
    if (!input) {
      return true;
    }

    const output = outputs[0][0];
    output && output.set(input);

    const edges: PulseEdge[] = [];

    input.forEach(value => {
      this.slice.unshift(Math.round(value * this.precision));
      this.slice.length = this.sliceLength;
      const candidate = this.slice[this.candidateIndex];
      if (this.level == 0 && candidate == Math.max(...this.slice) && candidate - this.lastPeak > this.threshold
       || this.level == 1 && candidate == Math.min(...this.slice) && this.lastPeak - candidate > this.threshold) {
        this.level ^= 1;
        edges.push([this.counter, this.level]);
        this.counter = 0;
        this.lastPeak = candidate;
      }
      this.counter++;
    });

    edges.length && this.port.postMessage(['edges', edges]);

    return true;
  }
}

registerProcessor('processor', PulseProcessor);