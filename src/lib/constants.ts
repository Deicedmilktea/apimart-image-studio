// Shared constants safe to import from both client and server code.

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

export type ImageModel = (typeof SUPPORTED_MODELS)[number];
export type ImageSize = (typeof SUPPORTED_SIZES)[number];
export type ImageResolution = (typeof SUPPORTED_RESOLUTIONS)[number];

export const MODEL_LABELS: Record<ImageModel, string> = {
  [STANDARD_IMAGE_MODEL]: "GPT-Image-2 (标准)",
  [OFFICIAL_IMAGE_MODEL]: "GPT-Image-2 (官方通道)",
};
