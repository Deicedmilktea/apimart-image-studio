import type { ImageModel, ImageProvider, LocalImageQuality } from "@/lib/constants";

export interface GenerateRequest {
  provider?: ImageProvider;
  prompt: string;
  model?: string;
  size?: string;
  imageUrls?: string[];
  officialFallback?: boolean;
  resolution?: string;
  quality?: string;
}

// A generated image. `id` points at the bytes cached in IndexedDB; `url` is the
// original remote URL (APIMart links expire ~24h) kept as a fallback when the
// bytes could not be cached locally. At least one is always present.
export interface StoredImage {
  id?: string;
  url?: string;
}

export interface ReferenceImage {
  id: string;
  name: string;
  dataUrl: string;
}

export interface HistoryItem {
  id: string;
  prompt: string;
  provider: ImageProvider;
  model?: ImageModel;
  modelLabel?: string;
  quality?: LocalImageQuality;
  size?: string;
  images: StoredImage[];
  createdAt: number;
}
