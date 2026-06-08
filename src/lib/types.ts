import type { ImageModel } from "@/lib/constants";

export interface GenerateResponse {
  taskId?: string;
  status?: string;
  error?: string;
}

export interface TaskResponse {
  taskId?: string;
  status?: string;
  images?: string[];
  error?: string;
}

export interface ReferenceImage {
  id: string;
  name: string;
  dataUrl: string;
}

export interface HistoryItem {
  id: string;
  prompt: string;
  model: ImageModel;
  size?: string;
  images: string[];
  createdAt: number;
}
