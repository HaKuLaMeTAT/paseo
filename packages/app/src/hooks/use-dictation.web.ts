import type { UseDictationOptions, UseDictationResult } from "./use-dictation.shared";

const noop = () => {};
const noopAsync = async () => {};
const disabled: UseDictationResult = {
  isRecording: false,
  isRecordingActive: () => false,
  isProcessing: false,
  partialTranscript: "",
  volume: 0,
  duration: 0,
  error: null,
  status: "idle",
  startDictation: noopAsync,
  cancelDictation: noopAsync,
  confirmDictation: noopAsync,
  retryFailedDictation: noopAsync,
  discardFailedDictation: noop,
  reset: noop,
};

// The Lite web/desktop build never subscribes to dictation or initializes audio.
export function useDictation(_options: UseDictationOptions): UseDictationResult {
  return disabled;
}
