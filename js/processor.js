export class PulseProcessor extends AudioWorkletProcessor {
    level;
    counter;
    lastPeak;
    candidateIndex = 4;
    precision = 10000;
    threshold = 2000;
    sliceLength;
    slice;
    capturing = false;
    constructor(options) {
        super();
        this.port.onmessage = event => this.processMessage(event.data);
    }
    processMessage([type, ...data]) {
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
    process(inputs, outputs, parameters) {
        if (!this.capturing) {
            return true;
        }
        const input = inputs[0][0];
        if (!input) {
            return true;
        }
        const output = outputs[0][0];
        output && output.set(input);
        const edges = [];
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
