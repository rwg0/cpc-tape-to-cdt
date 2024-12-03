export class CDTWriter {
    bytes;
    constructor() {
        this.bytes = Array.from('ZXTape!', char => char.charCodeAt(0));
        this.pushByte(0x1A, 0x01, 0x00);
    }
    writeBLock11(data, zeroBitPulseLength, options = {}) {
        this.pushByte(0x11);
        const oneBitPulseLength = options.oneBitPulseLength ?? zeroBitPulseLength * 2;
        this.pushWord(options.pilotPulseLength ?? oneBitPulseLength, options.syncFirstPulseLength ?? zeroBitPulseLength, options.syncSecondPulseLength ?? zeroBitPulseLength, zeroBitPulseLength, oneBitPulseLength, options.pilotToneLength ?? 2048 * 2);
        this.pushByte(options.lastByteUsedBits ?? 8);
        this.pushWord(options.pauseAfter ?? 16);
        this.pushTribyte(data.length);
        this.pushByte(...data);
    }
    writeBlock20(pause) {
        this.pushByte(0x20);
        this.pushWord(pause);
    }
    pushByte(...bytes) {
        bytes.forEach(byte => this.bytes.push(byte & 0xFF));
    }
    pushWord(...words) {
        words.forEach(word => this.bytes.push(word & 0xFF, (word >> 8) & 0xFF));
    }
    pushTribyte(...tribytes) {
        tribytes.forEach(tribyte => this.bytes.push(tribyte & 0xFF, (tribyte >> 8) & 0xFF, (tribyte >> 16) & 0xFF));
    }
    getBlob() {
        return new Blob([new Uint8Array(this.bytes)], { type: 'application/octet-stream' });
    }
}
