import type { InferenceProvider } from "./types";

const localStub: InferenceProvider = {
  id: "local-none",
  label: "Local model (Ollama / MLX)",
  location: "unavailable",
  async status() {
    return "Not connected yet. On your Mac this will be Ollama or MLX. Nothing is sent off the machine.";
  },
  async available() {
    return false;
  },
};

const externalXai: InferenceProvider = {
  id: "xai-external",
  label: "xAI (Grok) — off-device",
  location: "external",
  async status() {
    return "Optional. Sends compact excerpts to xAI. Requires an explicit click. Not part of the core archive.";
  },
  async available() {
    return true;
  },
};

export function listInferenceProviders(): InferenceProvider[] {
  return [localStub, externalXai];
}

export function getInferenceProvider(id: string): InferenceProvider | undefined {
  return listInferenceProviders().find((p) => p.id === id);
}
