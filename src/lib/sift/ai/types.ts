export type InferenceLocation = "on_device" | "external" | "unavailable";

export interface InferenceProvider {
  id: string;
  label: string;
  location: InferenceLocation;
  /** Human-readable status for Settings. */
  status(): Promise<string>;
  available(): Promise<boolean>;
}

export const PROMPT_VERSION_DEEP_ORGANIZE = "deep-organize-v1";
export const ANALYSIS_VERSION = "sift-analysis-v1";
