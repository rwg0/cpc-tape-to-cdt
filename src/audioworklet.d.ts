interface AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare var AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new(): AudioWorkletProcessor;
};

interface AudioWorkletProcessorImpl extends AudioWorkletProcessor {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

interface AudioWorkletProcessorConstructor {
  new (options: any): AudioWorkletProcessorImpl;
}

declare var sampleRate: number;
declare function registerProcessor(name: string, processorCtor: AudioWorkletProcessorConstructor): void;
