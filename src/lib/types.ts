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

export interface GenerateResponse {
  taskId?: string;
  status?: string;
  error?: string;
  images?: string[];
  saved?: SavedImageInfo[];
  savedDir?: string;
  provider?: ImageProvider;
}

export interface SavedImageInfo {
  filename: string;
  path: string;
  url: string;
}

export interface TaskResponse {
  taskId?: string;
  status?: string;
  images?: string[];
  error?: string;
  saved?: SavedImageInfo[];
  savedDir?: string;
  provider?: ImageProvider;
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
  images: string[];
  createdAt: number;
  savedDir?: string;
  saved?: SavedImageInfo[];
}
