/**
 * Amstrad CPC Tape to CDT Online Converter
 *
 * (c) 2024 Henri MEDOT
 *
 * This source code is licensed under the MIT License.
 * See the LICENSE file in the project root for more information.
 */

type Block11Options = {
  pilotPulseLength?: number
  syncFirstPulseLength?: number
  syncSecondPulseLength?: number
  oneBitPulseLength?: number
  pilotToneLength?: number
  lastByteUsedBits?: number
  pauseAfter?: number
}

export class CDTWriter {
  private bytes: number[];

  /**
   * Constructor.
   */
  constructor() {
    this.bytes = Array.from('ZXTape!', char => char.charCodeAt(0));
    this.pushByte(0x1A, 0x01, 0x00);
  }

  /**
   * Writes a turbo speed data block (ID 11).
   */
  writeBLock11(data: number[], zeroBitPulseLength: number, options: Block11Options = {}) {
    this.pushByte(0x11);

    const oneBitPulseLength = options.oneBitPulseLength ?? zeroBitPulseLength * 2;
    this.pushWord(
      options.pilotPulseLength ?? oneBitPulseLength,
      options.syncFirstPulseLength ?? zeroBitPulseLength,
      options.syncSecondPulseLength ?? zeroBitPulseLength,
      zeroBitPulseLength,
      oneBitPulseLength,
      options.pilotToneLength ?? 2048 * 2,
    );
    this.pushByte(options.lastByteUsedBits ?? 8);
    this.pushWord(options.pauseAfter ?? 16);
    this.pushTribyte(data.length);
    this.pushByte(...data);
  }

  /**
   * Writes a pause block (ID 20).
   */
  writeBlock20(pause: number) {
    this.pushByte(0x20);
    this.pushWord(pause);
  }

  /**
   * Pushes one or more bytes onto the bytes array.
   */
  private pushByte(...bytes: number[]) {
    bytes.forEach(byte => this.bytes.push(byte & 0xFF));
  }

  /**
   * Pushes one or more words onto the bytes array.
   */
  private pushWord(...words: number[]) {
    words.forEach(word => this.bytes.push(word & 0xFF, (word >> 8) & 0xFF));
  }

  /**
   * Pushes one or more tribytes onto the bytes array.
   */
  private pushTribyte(...tribytes: number[]) {
    tribytes.forEach(tribyte => this.bytes.push(tribyte & 0xFF, (tribyte >> 8) & 0xFF, (tribyte >> 16) & 0xFF));
  }

  /**
   * Returns a blob of the CDT file.
   */
  getBlob(): Blob {
    return new Blob([new Uint8Array(this.bytes)], {type: 'application/octet-stream'});
  }
}