/**
 * Amstrad CPC Tape to CDT Online Converter
 *
 * (c) 2024 Henri MEDOT
 *
 * This source code is licensed under the MIT License.
 * See the LICENSE file in the project root for more information.
 */

import { CDTWriter } from './cdtwriter.js';

const HEADER_MARKER = 0x2C;
const DATA_MARKER = 0x16;
const ZERO_BIT_LENGTH = 1167;
const BLOCK_GAP = 2000;

let capturing = false;
let audio: HTMLAudioElement;
let audioSource: MediaElementAudioSourceNode;
let fileInput: HTMLInputElement;
let browse: HTMLButtonElement;
let capture: HTMLButtonElement;
let context: AudioContext;
let stream: MediaStream;
let source: MediaElementAudioSourceNode | MediaStreamAudioSourceNode;
let worklet: AudioWorkletNode;
let output: HTMLPreElement;
let maxCount: number;
let resolver: Resolver;
let rejecter: Rejecter;
let threshold: number;
let filesPane: HTMLDivElement;
const buffer: PulseEdge[] = [];
const files: Record<string, Block[]> = {};

/**
 * Entry point.
 */
function main() {
  audio = document.getElementById('audio') as HTMLAudioElement;
  audio.onplay = () => audio.src && startCapturing('file');

  fileInput = document.getElementById('file-input') as HTMLInputElement;
  fileInput.onchange = e => {
    if (!capturing) {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      file && uploadFile(file);
    }
  };

  browse = document.getElementById('browse') as HTMLButtonElement;
  browse.onclick = () => fileInput.click();

  document.ondragover = e => e.preventDefault();
  document.ondrop = e => {
    e.preventDefault();
    if (!capturing) {
      const file = e.dataTransfer?.files[0];
      file && uploadFile(file);
    }
  }

  capture = document.getElementById('capture') as HTMLButtonElement;
  capture.onclick = () => toggleCapturing();

  output = document.getElementById('output') as HTMLPreElement;

  filesPane = document.getElementById('files') as HTMLDivElement;
}
window.main = main;

/**
 * Uploads a WAV file.
 */
function uploadFile(file: File): boolean {
  if (!file.type.includes('wav')) {
    alert('Please upload a valid WAV file.');
    return false;
  }

  audio.src = URL.createObjectURL(file);
  browse.nextSibling.textContent = file.name;
  return true;
}

/**
 * Outputs text to the user.
 */
function outputText(...text: string[]) {
  output.appendChild(document.createTextNode(text.join('\n').concat('\n')));
}

/**
 * Initializes audio resources.
 */
async function initAudio() {
  if (context) {
    return;
  }

  context = new AudioContext();
  maxCount = context.sampleRate * 0.005; // 5 ms
  const base = new URL('.', import.meta.url);
  const url = new URL('processor.js', base);
  await context.audioWorklet.addModule(url);
  worklet = new AudioWorkletNode(context, 'processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  worklet.port.onmessage = (event:MessageEvent<PulseProcessorMessage>) => processMessage(event.data);
  worklet.connect(context.destination);
  audioSource = context.createMediaElementSource(audio);
}

/**
 * Connects the source of the given type.
 */
async function connectSource(type: string) {
  if (source) {
    releaseSource();
  }

  switch (type) {
    case 'file':
      source = audioSource;
      audio.onpause = () => stopCapturing();
      audio.onended = () => stopCapturing();
      break;

    case 'line':
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: context.sampleRate,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });
      source = context.createMediaStreamSource(stream);
      break;
  }

  source.connect(worklet);
}

/**
 * Disconnects the active source and release associated resources.
 */
function releaseSource() {
  if (source) {
    source.disconnect(worklet);
    source = null;
  }

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  audio.onpause = null;
  audio.onended = null;
  audio.pause();
}

/**
 * Toggles capturing.
 */
async function toggleCapturing() {
  if (capturing) {
    stopCapturing();
    capture.textContent = 'Capture';
  }
  else {
    capture.textContent = 'Capturing...';
    capture.classList.add('capturing');
    startCapturing('line');
  }
}

/**
 * Starts capturing.
 */
async function startCapturing(sourceType: string) {
  if (capturing) {
    return;
  }

  await initAudio();
  await connectSource(sourceType);
  buffer.length = 0;
  capturing = true;
  fileInput.disabled = true;
  worklet.port.postMessage(['capture']);
  readBlocks();
}

/**
 * Stops capturing.
 */
function stopCapturing() {
  if (!capturing) {
    return;
  }

  capturing = false;
  worklet.port.postMessage(['stop']);
  releaseSource();
  fileInput.disabled = false;
  capture.classList.remove('capturing');
  clearLoadingStyles();
}

/**
 * Handles the messages sent by the pulse processor.
 */
function processMessage([type, ...data]: PulseProcessorMessage) {
  switch (type) {
    case 'edges':
      const [edges] = <[PulseEdge[]]> data;
      buffer.push(...edges);
      if (resolver) {
        resolveOrRejectEdge(resolver, rejecter);
        resolver = null;
        rejecter = null;
      }
      break;
  }
}

/**
 * Helper function that resolves or rejects based on the sample count of the
 * next edge in the buffer.
 */
function resolveOrRejectEdge(resolver: Resolver, rejecter: Rejecter) {
  if (!capturing) {
    rejecter();
    return;
  }

  const edge = buffer.shift();
  const [count] = edge;
  if (count > maxCount) {
    rejecter('a');
  }
  else {
    resolver(edge);
  }
}

/**
 * Gets a pulse edge from the processor.
 */
async function getPulseEdge(): Promise<PulseEdge> {
  return new Promise((resolve, reject) => {
    if (buffer.length > 0) {
      resolveOrRejectEdge(resolve, reject);
    }
    else {
      resolver = resolve;
      rejecter = reject;
    }
  });
}

/**
 * Reads blocks as long as capturing is on.
 */
async function readBlocks() {
  while (capturing) {
    try {
      await readBlock();
    }
    catch (e) {
      e && outputText(`Read error ${e}`);
    }
  }
}

/**
 * Reads a full block.
 */
async function readBlock() {
  const header = await readRecord(0x2C, 1);
  if (!header) {
    return;
  }

  const block: Block = {
    filename: String.fromCharCode(...header.slice(0, 16).filter(byte => byte != 0)).trim(),
    blockNumber: header[16],
    isLastBlock: !!header[17],
    fileType: header[18],
    dataLength: header[19] | (header[20] << 8),
    dataLocation: header[21] | (header[22] << 8),
    isFirstBlock: !!header[23],
    logicalLength: header[24] | (header[25] << 8),
    entryAddress: header[26] | (header[27] << 8),
    header,
  };

  outputText(`Loading ${block.filename} block ${block.blockNumber}`);
  const blockItem = saveBlock(block);

  const segmentCount = Math.ceil(block.dataLength / (256 + 2));
  try {
    const data = await readRecord(0x16, segmentCount, loading => blockItem.style.setProperty('--loading-percentage', `${loading * 100}%`));
    saveBlock(block, data);
  }
  catch (e) {
    saveBlock(block, false);
    throw e;
  }
}

/**
 * Reads a record (either header or data).
 */
async function readRecord(marker: number, segmentCount: number, progress?: (loading: number) => void): Promise<number[]> {
  // Read pilot and get the threshold value.
  threshold = await getThreshold();

  // Read marker.
  const byte = await getByte();
  if (byte !== marker) {
    return;
  }

  // Read segments.
  const data: number[] = [];
  for (let i = 0; i < segmentCount; i++) {
    progress && progress((i + 1) / segmentCount);
    data.push(...await getSegment());
  }

  return data;
}

/**
 * Reads the leader and determines the threshold.
 */
async function getThreshold(): Promise<number> {
  let count: number;
  let level: number;

  while (true) {
    try {
      // Wait for the start of the leader.
      do {
        [count, level] = await getPulseEdge();
      } while (level == 0);

      // Capture at least 256 leader pulses before encountering the sync bit to
      // establish a reliable threshold.
      let duration = 0;
      let pulseCount = 0;
      let lastCount: number;
      let average: number;
      count = Infinity;
      do {
        lastCount = count;
        [count, level] = await getPulseEdge();
        duration += count;
        pulseCount++;
        average = duration / pulseCount;
      } while (average * 5 / 4 < lastCount + count);
      if (pulseCount >= 256) {
        return average * 3 / 2;
      }
    }
    catch (e) {
      if (e !== 'a') {
        throw e;
      }
    }
  }
}

/**
 * Reads a single byte.
 */
async function getByte(): Promise<number> {
  let byte = 0;
  for (let i = 0; i < 8; i++) {
    let [count1] = await getPulseEdge();
    let [count2] = await getPulseEdge();
    const bit = count1 + count2 > threshold ? 1 : 0;
    byte = (byte << 1) | bit;
  }
  return byte;
}

/**
 * Reads a data segment.
 */
async function getSegment(): Promise<number[]> {
  const data: number[] = [];
  for (let i = 0; i < 258; i++) {
    data.push(await getByte());
  }
  const crc = ~data.slice(0, 256).reduce((crc, byte) => {
    for (let a = byte << 8 | 1; a & 0xFF; a <<= 1) {
      crc = (a ^ crc) & 0x8000 ? ((crc ^ 0x0810) << 1) + 1 : crc << 1;
    }
    return crc;
  }, 0xFFFF) & 0xFFFF;
  const word = (data[256] << 8) | data[257];
  if (crc != word) {
    throw 'b';
  }
  return data;
}

/**
 * Saves a captured block.
 */
function saveBlock(block: Block, data?: number[] | false): HTMLLIElement {
  const id = `file-${block.filename}-${block.logicalLength.toString(16).padStart(4)}`.replace(/\W/g, '-').toLowerCase();
  if (!files[id]) {
    files[id] = [];
  }
  const blocks = files[id];

  const index = block.blockNumber - 1;
  if (!blocks[index]) {
    blocks[index] = block;
  }
  block = blocks[index];

  if (data) {
    block.data = data;
  }

  // Update UI.
  clearLoadingStyles();
  let fileItem = document.getElementById(id) as HTMLDivElement;
  if (!fileItem) {
    fileItem = document.createElement('div');
    fileItem.id = id;
    const title = document.createElement('h3');
    title.textContent = block.filename;
    fileItem.appendChild(title);
    const blockList = document.createElement('ul');
    fileItem.appendChild(blockList);
    filesPane.appendChild(fileItem);
  }

  const blockList = fileItem.getElementsByTagName('ul').item(0);
  const blockItems = blockList.children as HTMLCollectionOf<HTMLLIElement>;
  for (let i = blockItems.length; i <= index; i++) {
    const item = document.createElement('li');
    item.setAttribute('data-number', `${i + 1}`);
    blockList.appendChild(item);
  }
  const blockItem = blockItems.item(index);
  blockItem.classList.remove('error');
  blockItem.classList.add(data ? 'loaded' : (data !== false ? 'loading' : 'error'));
  block.isLastBlock && fileItem.classList.add('last-block-found');

  // Make a file downloadable once complete.
  if (!fileItem.classList.contains('complete')) {
    let lastBlockFound = false;
    const complete = blocks.reduce((carry, block) => {
      lastBlockFound = block.isLastBlock;
      return carry + +!!block.data;
    }, 0) == blocks.length && lastBlockFound;

    if (complete) {
      const button = document.createElement('button');
      button.textContent = 'Download CDT';
      button.onclick = () => downloadCDT(blocks, block.filename);
      fileItem.appendChild(button);
      fileItem.classList.add('complete');
    }
  }

  return blockItem;
}

/**
 * Clears the loading styles of the block elements.
 */
function clearLoadingStyles() {
  Array.from(filesPane.getElementsByClassName('loading') as HTMLCollectionOf<HTMLLIElement>).forEach(item => {
    item.classList.remove('loading');
    item.style.removeProperty('--loading-percentage');
  });
}

/**
 * Downloads captured blocks as a CDT file.
 */
function downloadCDT(blocks: Block[], filename: string) {
  const cdt = new CDTWriter();

  cdt.writeBlock20(BLOCK_GAP);

  const trailer = [0xFF, 0xFF, 0xFF, 0xFF];
  blocks.forEach(block => {
    cdt.writeBLock11([HEADER_MARKER].concat(block.header).concat(trailer), ZERO_BIT_LENGTH);
    cdt.writeBLock11([DATA_MARKER].concat(block.data).concat(trailer), ZERO_BIT_LENGTH, {pauseAfter: BLOCK_GAP});
  });

  const url = URL.createObjectURL(cdt.getBlob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename.replace(/\W/g, '-').toLowerCase()}.cdt`;
  link.click();
  URL.revokeObjectURL(url);
}
