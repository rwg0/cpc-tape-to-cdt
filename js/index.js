import { CDTWriter } from './cdtwriter.js';
const HEADER_MARKER = 0x2C;
const DATA_MARKER = 0x16;
const ZERO_BIT_LENGTH = 1167;
const BLOCK_GAP = 2000;
let capturing = false;
let audio;
let audioSource;
let fileInput;
let browse;
let capture;
let context;
let stream;
let source;
let worklet;
let output;
let maxCount;
let resolver;
let rejecter;
let threshold;
let filesPane;
const buffer = [];
const files = {};
function main() {
    audio = document.getElementById('audio');
    audio.onplay = () => audio.src && startCapturing('file');
    fileInput = document.getElementById('file-input');
    fileInput.onchange = e => {
        if (!capturing) {
            const input = e.target;
            const file = input.files?.[0];
            file && uploadFile(file);
        }
    };
    browse = document.getElementById('browse');
    browse.onclick = () => fileInput.click();
    document.ondragover = e => e.preventDefault();
    document.ondrop = e => {
        e.preventDefault();
        if (!capturing) {
            const file = e.dataTransfer?.files[0];
            file && uploadFile(file);
        }
    };
    capture = document.getElementById('capture');
    capture.onclick = () => toggleCapturing();
    output = document.getElementById('output');
    filesPane = document.getElementById('files');
    if (audio.src) {
        const filename = new URL(audio.src).pathname.split('/').pop();
        browse.nextSibling.textContent = filename;
    }
}
window.main = main;
function uploadFile(file) {
    if (!file.type.includes('wav')) {
        alert('Please upload a valid WAV file.');
        return;
    }
    audio.src = URL.createObjectURL(file);
    browse.nextSibling.textContent = file.name;
}
function outputText(...text) {
    output.appendChild(document.createTextNode(text.join('\n').concat('\n')));
}
async function initAudio() {
    if (context) {
        return;
    }
    context = new AudioContext();
    maxCount = context.sampleRate * 0.005;
    const base = new URL('.', import.meta.url);
    const url = new URL('processor.js', base);
    await context.audioWorklet.addModule(url);
    worklet = new AudioWorkletNode(context, 'processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
    });
    worklet.port.onmessage = (event) => processMessage(event.data);
    worklet.connect(context.destination);
    audioSource = context.createMediaElementSource(audio);
}
async function connectSource(type) {
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
async function startCapturing(sourceType) {
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
function processMessage([type, ...data]) {
    switch (type) {
        case 'edges':
            const [edges] = data;
            buffer.push(...edges);
            if (resolver) {
                resolveOrRejectEdge(resolver, rejecter);
                resolver = null;
                rejecter = null;
            }
            break;
    }
}
function resolveOrRejectEdge(resolver, rejecter) {
    if (!capturing) {
        rejecter();
        return;
    }
    const edge = buffer.shift();
    const [count] = edge;
    if (count > maxCount) {
        rejecter('a' + ' - count of ' + count + ' is larger than max ' + maxCount);
    }
    else {
        resolver(edge);
    }
}
async function getPulseEdge() {
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
async function readBlocks() {
    while (capturing) {
        try {
            await readBlock();
        }
        catch (e) {
            console.log(e + ' at ' + audio.currentTime);
            e && outputText(`Read error ${e} at ${audio.currentTime}`);
        }
    }
}
async function readBlock() {
    const header = await readRecord(0x2C, 1);
    if (!header) {
        return;
    }
    const block = {
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
    const segmentCount = Math.ceil(block.dataLength / 256);
    try {
        const data = await readRecord(0x16, segmentCount, loading => blockItem.style.setProperty('--loading-percentage', `${loading * 100}%`));
        saveBlock(block, data);
    }
    catch (e) {
        saveBlock(block, false);
        throw e;
    }
}
async function readRecord(marker, segmentCount, progress) {
    threshold = await getThreshold();
    console.log('Set threshold to ' + threshold);
    const byte = await getByte();
    if (byte !== marker) {
        return;
    }
    const data = [];
    for (let i = 0; i < segmentCount; i++) {
        progress && progress((i + 1) / segmentCount);
        data.push(...await getSegment());
    }
    return data;
}
async function getThreshold() {
    let count;
    let level;
    while (true) {
        try {
            do {
                [count, level] = await getPulseEdge();
            } while (level == 0);
            let duration = 0;
            let pulseCount = 0;
            let lastCount;
            let average;
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
            if (typeof e == "string" && e[0] == 'a') {
            }
            else {
                throw e;
            }
        }
    }
}
async function getByte() {
    let byte = 0;
    for (let i = 0; i < 8; i++) {
        let [count1] = await getPulseEdge();
        let [count2] = await getPulseEdge();
        let sum = count1 + count2;
        let diff = sum - threshold;
        if (diff < 0) {
            diff = -diff;
        }
        diff = diff * 2 / sum;
        if (diff < 0.2 || sum > threshold * 2) {
            console.log('at ' + audio.currentTime);
            console.log(count1 + count2, threshold);
        }
        const bit = count1 + count2 > threshold ? 1 : 0;
        byte = (byte << 1) | bit;
    }
    return byte;
}
async function getSegment() {
    const data = [];
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
        console.log('crc mismatch');
        throw 'b' + ' - expected crc 0x' + word.toString(16) + ' got 0x' + crc.toString(16);
    }
    return data;
}
function saveBlock(block, data) {
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
    clearLoadingStyles();
    let fileItem = document.getElementById(id);
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
    const blockItems = blockList.children;
    for (let i = blockItems.length; i <= index; i++) {
        const item = document.createElement('li');
        item.setAttribute('data-number', `${i + 1}`);
        blockList.appendChild(item);
    }
    const blockItem = blockItems.item(index);
    blockItem.classList.remove('error');
    blockItem.classList.add(data ? 'loaded' : (data !== false ? 'loading' : 'error'));
    block.isLastBlock && fileItem.classList.add('last-block-found');
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
function clearLoadingStyles() {
    Array.from(filesPane.getElementsByClassName('loading')).forEach(item => {
        item.classList.remove('loading');
        item.style.removeProperty('--loading-percentage');
    });
}
function downloadCDT(blocks, filename) {
    const cdt = new CDTWriter();
    cdt.writeBlock20(BLOCK_GAP);
    const trailer = [0xFF, 0xFF, 0xFF, 0xFF];
    blocks.forEach(block => {
        cdt.writeBLock11([HEADER_MARKER].concat(block.header).concat(trailer), ZERO_BIT_LENGTH);
        cdt.writeBLock11([DATA_MARKER].concat(block.data).concat(trailer), ZERO_BIT_LENGTH, { pauseAfter: BLOCK_GAP });
    });
    const url = URL.createObjectURL(cdt.getBlob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename.replace(/\W/g, '-').toLowerCase()}.cdt`;
    link.click();
    URL.revokeObjectURL(url);
}
