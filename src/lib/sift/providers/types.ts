import type { ImportBundle, ProviderId } from "../types";

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  /** True if this blob looks like this provider's export. */
  detect(raw: string, filename?: string): boolean;
  parse(raw: string, filename?: string): ImportBundle;
}
