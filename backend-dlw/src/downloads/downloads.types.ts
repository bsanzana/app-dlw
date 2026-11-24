export type DownloadEngine = 'ytdlp' | 'cobalt' | 'gallery_dl';

export type FormatType = 'video_audio' | 'video_only' | 'audio_only' | 'image';

export interface VideoFormatOption {
    id: string; // unique key for selection
    type: FormatType;
    formatSelection: string; // string passed to yt-dlp -f or provider selector
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
    engine?: DownloadEngine;
    previewUrl?: string | null;
    itemIndex?: number | null;
    directUrl?: string | null;
}

export interface VideoMetadata {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
    uploader: string;
    formats: VideoFormatOption[];
    engine?: DownloadEngine;
    mediaType?: 'video' | 'audio' | 'image' | 'mixed';
}

export interface BuildYtDlpOptions {
    vcodec?: string | null;
    acodec?: string | null;
}

export interface DownloadJob {
    id: string;
    url: string;
    formatSelection: string;
    type: FormatType;
    title: string;
    ext: string;
    engine: DownloadEngine;
    status: 'downloading' | 'processing' | 'completed' | 'failed';
    progressPercent?: number;
    downloadSpeed?: string;
    eta?: string;
    downloadedBytes?: string;
    totalBytes?: string;
    filePath?: string;
    tempDir?: string;
    error?: string;
    createdAt: number;
    clientIp?: string;
    userId?: string;
}

export interface ProviderDownloadOptions {
    formatSelection: string;
    type: FormatType;
    itemIndex?: number | null;
    directUrl?: string | null;
    maxDownloadSizeBytes: number;
    maxDownloadSizeMb: number;
}
