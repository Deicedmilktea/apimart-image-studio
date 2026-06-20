// Client-side configuration persisted in the browser. In the cloud build there
// is no server to hold API keys, so users bring their own keys/URLs and we keep
// them in localStorage. Nothing here ever leaves the user's browser except as a
// direct request to the provider they configured.

import { DEFAULT_APIMART_BASE_URL } from "@/lib/constants";

export const CONFIG_KEY = "apimart-image-studio:config";

export const DEFAULT_CUSTOM_MODEL = "gpt-image-1";

export interface AppConfig {
  apimartApiKey: string;
  apimartBaseUrl: string;
  customBaseUrl: string;
  customApiKey: string;
  customModel: string;
}

export function defaultConfig(): AppConfig {
  return {
    apimartApiKey: "",
    apimartBaseUrl: DEFAULT_APIMART_BASE_URL,
    customBaseUrl: "",
    customApiKey: "",
    customModel: DEFAULT_CUSTOM_MODEL,
  };
}

function normalize(raw: Partial<AppConfig> | null | undefined): AppConfig {
  const base = defaultConfig();
  if (!raw) return base;
  return {
    apimartApiKey: (raw.apimartApiKey ?? base.apimartApiKey).trim(),
    apimartBaseUrl: (raw.apimartBaseUrl?.trim() || base.apimartBaseUrl),
    customBaseUrl: (raw.customBaseUrl ?? base.customBaseUrl).trim(),
    customApiKey: (raw.customApiKey ?? base.customApiKey).trim(),
    customModel: (raw.customModel?.trim() || base.customModel),
  };
}

export function loadConfig(): AppConfig {
  if (typeof window === "undefined") return defaultConfig();
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaultConfig();
    return normalize(JSON.parse(raw) as Partial<AppConfig>);
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config: AppConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(normalize(config)));
  } catch {
    // Storage may be unavailable; non-fatal.
  }
}
