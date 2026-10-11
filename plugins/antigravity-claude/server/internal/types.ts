export interface ProviderLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ProviderStatus {
  available: boolean;
  diagnostic?: string;
}
