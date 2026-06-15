// Shared constants safe to import from both client and server code.

export const APIMART_PROVIDER = "apimart";
export const LOCAL_IMAGEGEN_PROVIDER = "local-imagegen";
export const IMAGE_PROVIDERS = [APIMART_PROVIDER, LOCAL_IMAGEGEN_PROVIDER] as const;

export const STANDARD_IMAGE_MODEL = "gpt-image-2";
export const OFFICIAL_IMAGE_MODEL = "gpt-image-2-official";
export const SUPPORTED_MODELS = [STANDARD_IMAGE_MODEL, OFFICIAL_IMAGE_MODEL] as const;

export const SUPPORTED_SIZES = [
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "5:4",
  "4:5",
  "2:1",
  "1:2",
  "21:9",
  "9:21",
] as const;

export const SUPPORTED_RESOLUTIONS = ["1k", "2k", "4k"] as const;
export const FOUR_K_SUPPORTED_SIZES = ["16:9", "9:16", "2:1", "1:2", "21:9", "9:21"];
export const MAX_REFERENCE_IMAGES = 16;
export const LOCAL_IMAGEGEN_QUALITIES = ["low", "medium", "high", "auto"] as const;
export const DEFAULT_LOCAL_IMAGEGEN_QUALITY = "medium";
export const LOCAL_IMAGEGEN_DISABLED_SIZES = ["21:9", "9:21"] as const;
export const LOCAL_IMAGEGEN_MODEL_LABEL = "GPT-Image-2";
export const LOCAL_IMAGEGEN_MODEL_HINT = "调用官方 imagegen 脚本";
export const LOCAL_IMAGEGEN_SIZE_MAP = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
  "4:3": "1360x1024",
  "3:4": "1024x1360",
  "16:9": "1536x864",
  "9:16": "864x1536",
  "5:4": "1280x1024",
  "4:5": "1024x1280",
  "2:1": "1440x720",
  "1:2": "720x1440",
} as const;

export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];
export type ImageModel = (typeof SUPPORTED_MODELS)[number];
export type ImageSize = (typeof SUPPORTED_SIZES)[number];
export type ImageResolution = (typeof SUPPORTED_RESOLUTIONS)[number];
export type LocalImageQuality = (typeof LOCAL_IMAGEGEN_QUALITIES)[number];
export type LocalImagegenSize = keyof typeof LOCAL_IMAGEGEN_SIZE_MAP;

export const MODEL_LABELS: Record<ImageModel, string> = {
  [STANDARD_IMAGE_MODEL]: "GPT-Image-2 (标准)",
  [OFFICIAL_IMAGE_MODEL]: "GPT-Image-2 (官方通道)",
};

export const PROVIDER_LABELS: Record<ImageProvider, string> = {
  [APIMART_PROVIDER]: "APIMart",
  [LOCAL_IMAGEGEN_PROVIDER]: "Local Imagen",
};
