export class PulseProcessor extends AudioWorkletProcessor {
    level;
    counter;
    lastPeak;
    oldValues;
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
                    this.oldValues = [0, 0];
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
            const [candidate, valueBefore] = this.oldValues;
            if ((this.level == 0 && candidate >= value && candidate >= valueBefore || this.level == 1 && candidate <= value && candidate <= valueBefore) && Math.abs(candidate - this.lastPeak) > 0.2) {
                this.level ^= 1;
                edges.push([this.counter, this.level]);
                this.counter = 0;
                this.lastPeak = candidate;
            }
            this.counter++;
            this.oldValues.unshift(value);
            this.oldValues.length = 2;
        });
        edges.length && this.port.postMessage(['edges', edges]);
        return true;
    }
}
registerProcessor('processor', PulseProcessor);
