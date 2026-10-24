export const API_URL =
  (import.meta as any).env?.PUBLIC_API_URL !== undefined
    ? (import.meta as any).env.PUBLIC_API_URL
    : (import.meta as any).env?.DEV
    ? "http://localhost:3001/api"
    : "/api";

export type FormatType = "video_audio" | "video_only" | "audio_only";

export interface VideoFormatOption {
  id: string;
  type: FormatType;
  formatSelection: string;
  resolution: string;
  ext: string;
  note: string;
  hasAudio: boolean;
  hasVideo: boolean;
  filesize: number | null;
  height: number | null;
  fps: number | null;
  vcodec: string | null;
  acodec: string | null;
  abr?: number | null;
  tbr?: number | null;
}

export interface VideoMetadata {
  id: string;
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  formats: VideoFormatOption[];
}

export interface StartJobResponse {
  jobId: string;
}

export interface JobStatusResponse {
  id: string;
  status: "downloading" | "completed" | "failed";
  progressPercent?: number;
  downloadSpeed?: string | null;
  eta?: string | null;
  totalBytes?: string | null;
  error?: string;
  title?: string;
  ext?: string;
}

export interface QuotaStatusResponse {
  ip: string;
  allowed: boolean;
  used: number;
  remaining: number;
  maxPerDay: number;
  maxDownloadSizeMb: number;
  resetInSeconds: number;
  resetInHours: number;
}

export class DownloaderService {
  /**
   * Fetches metadata and format choices for a given URL
   */
  static async fetchMetadata(url: string): Promise<VideoMetadata> {
    const res = await fetch(`${API_URL}/downloads/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Error al obtener información del video");
    }

    return res.json();
  }

  /**
   * Starts background download
   */
  static async startDownload(
    url: string,
    formatSelection: string,
    type: FormatType,
    title: string
  ): Promise<StartJobResponse> {
    const res = await fetch(`${API_URL}/downloads/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, formatSelection, type, title }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Error al iniciar la descarga");
    }

    return res.json();
  }

  /**
   * Checks download job status
   */
  static async checkStatus(jobId: string): Promise<JobStatusResponse> {
    const res = await fetch(`${API_URL}/downloads/${jobId}/status`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || "Error al consultar estado");
    }
    return res.json();
  }

  /**
   * Generates direct download URL for finished file
   */
  static getDownloadUrl(jobId: string): string {
    return `${API_URL}/downloads/${jobId}/file`;
  }

  /**
   * Checks IP download quota and bandwidth limits
   */
  static async getQuota(): Promise<QuotaStatusResponse> {
    const res = await fetch(`${API_URL}/downloads/quota`);
    if (!res.ok) {
      throw new Error("Error al consultar cuota disponible");
    }
    return res.json();
  }
}
