import type { ReactNode } from "react";
import type * as NativeVoice from "./voice-context";

// Keep the mobile contract without importing the voice runtime into Lite web.
export function useVoiceOptional(): ReturnType<typeof NativeVoice.useVoiceOptional> {
  return null;
}
export function useVoiceTelemetryOptional(): ReturnType<
  typeof NativeVoice.useVoiceTelemetryOptional
> {
  return null;
}
export function useVoiceRuntimeOptional(): ReturnType<typeof NativeVoice.useVoiceRuntimeOptional> {
  return null;
}
export function useVoiceAudioEngineOptional(): ReturnType<
  typeof NativeVoice.useVoiceAudioEngineOptional
> {
  return null;
}
export function useVoice(): ReturnType<typeof NativeVoice.useVoice> {
  throw new Error("Voice is disabled in Paseo Lite");
}
export function useVoiceTelemetry(): ReturnType<typeof NativeVoice.useVoiceTelemetry> {
  throw new Error("Voice is disabled in Paseo Lite");
}
export function VoiceProvider({ children }: { children: ReactNode }) {
  return children;
}
