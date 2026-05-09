import { useEffect, useRef, useState } from "react";

type AudioMeters = {
  micBars: number[];
  micAvailable: boolean;
  micLevel: number;
};

const BAR_COUNT = 40;
const FLAT_BARS = Array.from({ length: BAR_COUNT }, () => 0.04);

export function useAudioMeters(active: boolean): AudioMeters {
  const [micBars, setMicBars] = useState(FLAT_BARS);
  const [micAvailable, setMicAvailable] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const micAnimationRef = useRef<number | null>(null);
  const barsRef = useRef<number[]>(FLAT_BARS);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!active) {
      stopStream(streamRef.current);
      streamRef.current = null;
      barsRef.current = FLAT_BARS;
      setMicBars(FLAT_BARS);
      setMicAvailable(false);
      setMicLevel(0);
      return;
    }

    let cancelled = false;
    let audioContext: AudioContext | null = null;

    async function startMicMeter() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false,
          },
          video: false,
        });

        if (cancelled) {
          stopStream(stream);
          return;
        }

        streamRef.current = stream;
        audioContext = new AudioContext();

        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();

        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.84;
        source.connect(analyser);
        const timeSamples = new Uint8Array(analyser.fftSize);
        const frequencySamples = new Uint8Array(analyser.frequencyBinCount);
        setMicAvailable(true);

        const tick = () => {
          analyser.getByteTimeDomainData(timeSamples);
          analyser.getByteFrequencyData(frequencySamples);

          let sum = 0;
          for (const sample of timeSamples) {
            const normalized = (sample - 128) / 128;
            sum += normalized * normalized;
          }

          const rms = Math.min(1, Math.sqrt(sum / timeSamples.length) * 4.5);
          const bars = createSmoothedBars(frequencySamples, barsRef.current, rms);
          barsRef.current = bars;
          setMicLevel(rms);
          setMicBars(bars);
          micAnimationRef.current = window.requestAnimationFrame(tick);
        };

        tick();
      } catch {
        setMicAvailable(false);
        setMicLevel(0);
      }
    }

    void startMicMeter();

    return () => {
      cancelled = true;
      if (micAnimationRef.current !== null) {
        window.cancelAnimationFrame(micAnimationRef.current);
        micAnimationRef.current = null;
      }
      void audioContext?.close();
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [active]);

  return { micAvailable, micBars, micLevel };
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function createSmoothedBars(frequencies: Uint8Array, previous: number[], rms: number): number[] {
  if (rms < 0.012) {
    return FLAT_BARS;
  }

  const next = Array.from({ length: BAR_COUNT }, (_, index) => {
    const start = Math.floor((index / BAR_COUNT) * frequencies.length * 0.72);
    const end = Math.max(start + 1, Math.floor(((index + 1) / BAR_COUNT) * frequencies.length * 0.72));
    let peak = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      peak = Math.max(peak, frequencies[sampleIndex] / 255);
    }

    const shaped = Math.pow(peak, 0.72) * Math.min(1, 0.55 + rms * 1.9);
    const prior = previous[index] ?? 0.04;
    return prior * 0.68 + shaped * 0.32;
  });

  return next;
}
