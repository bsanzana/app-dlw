import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createZipFromFiles, type ZipInputFile } from '../utils/zip.util';
import type {
    DownloadJob,
    ProviderDownloadOptions,
    VideoFormatOption,
    VideoMetadata,
} from '../downloads.types';

export interface CobaltPickerItem {
    type: 'photo' | 'video' | 'gif';
    url: string;
    thumb?: string;
}

export interface CobaltApiResponse {
    status: 'tunnel' | 'redirect' | 'picker' | 'error';
    url?: string;
    filename?: string;
    audio?: string;
    audioFilename?: string;
    picker?: CobaltPickerItem[];
    error?: {
        code?: string;
        context?: Record<string, unknown>;
    };
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'ogg', 'opus', 'wav', 'aac']);

@Injectable()
export class CobaltProvider {
    private readonly logger = new Logger(CobaltProvider.name);

    isEnabled(): boolean {
        return process.env.ENABLE_COBALT !== 'false' && Boolean(this.getApiUrl());
    }

    getApiUrl(): string {
        return (process.env.COBALT_API_URL || '').trim().replace(/\/+$/, '');
    }

    private inferExtFromFilenameOrUrl(filename?: string, url?: string, fallback = 'mp4'): string {
        const candidate = filename || url || '';
        const clean = candidate.split('?')[0].split('#')[0];
        const ext = path.extname(clean).replace('.', '').toLowerCase();
        if (ext && /^[a-z0-9]{2,5}$/.test(ext)) {
            return ext;
        }
        return fallback;
    }

    private inferExtFromContentType(contentType: string | null): string | null {
        if (!contentType) return null;
        const mime = contentType.split(';')[0].trim().toLowerCase();
        const map: Record<string, string> = {
            'video/mp4': 'mp4',
            'video/webm': 'webm',
            'audio/mpeg': 'mp3',
            'audio/mp4': 'm4a',
            'audio/ogg': 'ogg',
            'audio/opus': 'opus',
            'audio/wav': 'wav',
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
        };
        return map[mime] || null;
    }

    private buildReadableTitle(rawFilename: string | undefined, url: string): string {
        if (rawFilename) {
            const base = path.basename(rawFilename, path.extname(rawFilename))
                .replace(/[_-]+/g, ' ')
                .trim();
            if (base) return base.slice(0, 100);
        }
        try {
            const parsed = new URL(url);
            return `Media de ${parsed.hostname.replace(/^www\./, '')}`;
        } catch {
            return 'Media descargado';
        }
    }

    async requestCobalt(
        url: string,
        bodyOverrides: Record<string, unknown> = {},
        timeoutMs = 15000,
    ): Promise<CobaltApiResponse> {
        const apiUrl = this.getApiUrl();
        if (!apiUrl) {
            throw new Error('COBALT_API_URL no está configurado.');
        }

        const payload = {
            url,
            videoQuality: '1080',
            audioFormat: 'mp3',
            downloadMode: 'auto',
            filenameStyle: 'basic',
            ...bodyOverrides,
        };

        const response = await fetch(`${apiUrl}/`, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(timeoutMs),
        });

        let data: CobaltApiResponse;
        try {
            data = (await response.json()) as CobaltApiResponse;
        } catch {
            throw new Error(`Cobalt respondió con HTTP ${response.status} sin JSON válido.`);
        }

        if (!response.ok || data.status === 'error') {
            const code = data?.error?.code || `http.${response.status}`;
            throw new Error(`Cobalt no pudo procesar el enlace (${code}).`);
        }

        return data;
    }

    async resolveInfo(url: string): Promise<VideoMetadata> {
        const data = await this.requestCobalt(url);
        let hostname = 'Cobalt';
        try {
            hostname = new URL(url).hostname.replace(/^www\./, '');
        } catch { }

        if (data.status === 'picker' && Array.isArray(data.picker) && data.picker.length > 0) {
            const formats: VideoFormatOption[] = [];
            const items = data.picker;
            const firstPhoto = items.find((item) => item.type === 'photo' || item.thumb);
            const allPhotos = items.every((item) => item.type === 'photo' || item.type === 'gif');

            if (items.length > 1) {
                formats.push({
                    id: 'cobalt_picker_zip',
                    type: allPhotos ? 'image' : 'video_audio',
                    formatSelection: 'cobalt:picker:zip',
                    resolution: `Álbum Completo (${items.length} archivos)`,
                    ext: 'zip',
                    note: 'Empaquetado automático en .zip (Cobalt)',
                    hasAudio: !allPhotos,
                    hasVideo: !allPhotos,
                    filesize: null,
                    height: null,
                    fps: null,
                    vcodec: null,
                    acodec: null,
                    engine: 'cobalt',
                    previewUrl: firstPhoto?.thumb || firstPhoto?.url || null,
                });
            }

            items.forEach((item, idx) => {
                const defaultExt = item.type === 'video' ? 'mp4' : item.type === 'gif' ? 'gif' : 'jpg';
                const ext = this.inferExtFromFilenameOrUrl(undefined, item.url, defaultExt);
                const isVideo = item.type === 'video';
                formats.push({
                    id: `cobalt_picker_${idx + 1}`,
                    type: isVideo ? 'video_audio' : 'image',
                    formatSelection: `cobalt:picker:${idx + 1}`,
                    resolution: isVideo ? `Video #${idx + 1}` : `Imagen #${idx + 1}`,
                    ext,
                    note: `Elemento individual #${idx + 1} (Cobalt)`,
                    hasAudio: isVideo,
                    hasVideo: isVideo,
                    filesize: null,
                    height: null,
                    fps: null,
                    vcodec: null,
                    acodec: null,
                    engine: 'cobalt',
                    itemIndex: idx + 1,
                    directUrl: item.url,
                    previewUrl: item.thumb || (isVideo ? null : item.url),
                });
            });

            if (data.audio) {
                const audioExt = this.inferExtFromFilenameOrUrl(data.audioFilename, data.audio, 'mp3');
                formats.push({
                    id: 'cobalt_picker_audio',
                    type: 'audio_only',
                    formatSelection: 'cobalt:audio:mp3',
                    resolution: `Audio del post (${audioExt.toUpperCase()})`,
                    ext: audioExt,
                    note: 'Pista de audio extraída (Cobalt)',
                    hasAudio: true,
                    hasVideo: false,
                    filesize: null,
                    height: null,
                    fps: null,
                    vcodec: null,
                    acodec: audioExt,
                    engine: 'cobalt',
                    directUrl: data.audio,
                });
            }

            return {
                id: `cobalt_${Date.now()}`,
                title: this.buildReadableTitle(data.filename, url),
                thumbnail: firstPhoto?.thumb || firstPhoto?.url || '',
                duration: 0,
                uploader: hostname,
                formats,
                engine: 'cobalt',
                mediaType: allPhotos ? 'image' : 'mixed',
            };
        }

        if ((data.status === 'tunnel' || data.status === 'redirect') && data.url) {
            const ext = this.inferExtFromFilenameOrUrl(data.filename, data.url, 'mp4');
            const title = this.buildReadableTitle(data.filename, url);

            if (IMAGE_EXTENSIONS.has(ext)) {
                return {
                    id: `cobalt_${Date.now()}`,
                    title,
                    thumbnail: data.url,
                    duration: 0,
                    uploader: hostname,
                    engine: 'cobalt',
                    mediaType: 'image',
                    formats: [
                        {
                            id: 'cobalt_image_original',
                            type: 'image',
                            formatSelection: 'cobalt:auto',
                            resolution: 'Imagen Original',
                            ext,
                            note: 'Resuelto vía Cobalt (respaldo)',
                            hasAudio: false,
                            hasVideo: false,
                            filesize: null,
                            height: null,
                            fps: null,
                            vcodec: null,
                            acodec: null,
                            engine: 'cobalt',
                            directUrl: data.url,
                            previewUrl: data.url,
                        },
                    ],
                };
            }

            if (AUDIO_EXTENSIONS.has(ext)) {
                return {
                    id: `cobalt_${Date.now()}`,
                    title,
                    thumbnail: '',
                    duration: 0,
                    uploader: hostname,
                    engine: 'cobalt',
                    mediaType: 'audio',
                    formats: [
                        {
                            id: 'cobalt_audio_direct',
                            type: 'audio_only',
                            formatSelection: 'cobalt:audio:mp3',
                            resolution: `Audio (${ext.toUpperCase()})`,
                            ext,
                            note: 'Resuelto vía Cobalt (respaldo)',
                            hasAudio: true,
                            hasVideo: false,
                            filesize: null,
                            height: null,
                            fps: null,
                            vcodec: null,
                            acodec: ext,
                            engine: 'cobalt',
                            directUrl: data.url,
                        },
                    ],
                };
            }

            const formats: VideoFormatOption[] = [
                {
                    id: 'cobalt_va_best',
                    type: 'video_audio',
                    formatSelection: 'cobalt:auto:1080',
                    resolution: 'Video HD (Hasta 1080p)',
                    ext: ext || 'mp4',
                    note: 'Video + Audio vía Cobalt (respaldo)',
                    hasAudio: true,
                    hasVideo: true,
                    filesize: null,
                    height: 1080,
                    fps: null,
                    vcodec: 'h264',
                    acodec: 'aac',
                    engine: 'cobalt',
                    directUrl: data.url,
                },
                {
                    id: 'cobalt_ao_mp3',
                    type: 'audio_only',
                    formatSelection: 'cobalt:audio:mp3',
                    resolution: 'MP3 Audio (Alta Calidad)',
                    ext: 'mp3',
                    note: 'Solo Audio vía Cobalt (respaldo)',
                    hasAudio: true,
                    hasVideo: false,
                    filesize: null,
                    height: null,
                    fps: null,
                    vcodec: null,
                    acodec: 'mp3',
                    engine: 'cobalt',
                },
                {
                    id: 'cobalt_vo_mute',
                    type: 'video_only',
                    formatSelection: 'cobalt:mute:1080',
                    resolution: 'Video Mudo (Sin audio)',
                    ext: 'mp4',
                    note: 'Solo Video vía Cobalt (respaldo)',
                    hasAudio: false,
                    hasVideo: true,
                    filesize: null,
                    height: 1080,
                    fps: null,
                    vcodec: 'h264',
                    acodec: null,
                    engine: 'cobalt',
                },
            ];

            return {
                id: `cobalt_${Date.now()}`,
                title,
                thumbnail: '',
                duration: 0,
                uploader: hostname,
                formats,
                engine: 'cobalt',
                mediaType: 'video',
            };
        }

        throw new Error('Cobalt devolvió una respuesta vacía o no soportada.');
    }

    private async streamUrlToFile(
        targetUrl: string,
        outputPath: string,
        maxBytes: number,
        onProgress?: (downloadedBytes: number, totalBytes: number | null) => void,
    ): Promise<{ bytes: number; contentType: string | null }> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

        try {
            const response = await fetch(targetUrl, {
                signal: controller.signal,
            });

            if (!response.ok || !response.body) {
                throw new Error(`HTTP ${response.status} al descargar medio desde Cobalt`);
            }

            const contentLengthHeader = response.headers.get('content-length');
            const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;
            if (totalBytes && totalBytes > maxBytes) {
                controller.abort();
                throw new Error('MAX_FILESIZE_EXCEEDED');
            }

            const writer = fs.createWriteStream(outputPath);
            const reader = response.body.getReader();
            let downloaded = 0;

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (!value) continue;

                    downloaded += value.byteLength;
                    if (downloaded > maxBytes) {
                        controller.abort();
                        writer.destroy();
                        throw new Error('MAX_FILESIZE_EXCEEDED');
                    }

                    const chunkBuf = Buffer.from(value);
                    if (!writer.write(chunkBuf)) {
                        await new Promise<void>((resolve, reject) => {
                            writer.once('drain', resolve);
                            writer.once('error', reject);
                        });
                    }

                    onProgress?.(downloaded, totalBytes);
                }

                await new Promise<void>((resolve, reject) => {
                    writer.end(() => resolve());
                    writer.on('error', reject);
                });
            } catch (err) {
                writer.destroy();
                throw err;
            }

            return {
                bytes: downloaded,
                contentType: response.headers.get('content-type'),
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    async downloadToFile(
        job: DownloadJob,
        options: ProviderDownloadOptions,
    ): Promise<void> {
        if (!job.filePath) {
            throw new Error('Ruta de archivo temporal no definida.');
        }

        if (options.formatSelection === 'cobalt:picker:zip') {
            const fresh = await this.requestCobalt(job.url);
            if (fresh.status !== 'picker' || !Array.isArray(fresh.picker) || fresh.picker.length === 0) {
                throw new Error('Cobalt ya no devolvió elementos del carrusel para empaquetar.');
            }

            const tempDir = path.join(os.tmpdir(), `dlw_cb_${job.id}`);
            fs.mkdirSync(tempDir, { recursive: true });
            job.tempDir = tempDir;

            try {
                const zipInputs: ZipInputFile[] = [];
                let cumulativeBytes = 0;

                for (let i = 0; i < fresh.picker.length; i++) {
                    const item = fresh.picker[i];
                    const defaultExt = item.type === 'video' ? 'mp4' : item.type === 'gif' ? 'gif' : 'jpg';
                    let ext = this.inferExtFromFilenameOrUrl(undefined, item.url, defaultExt);
                    const itemPath = path.join(tempDir, `${String(i + 1).padStart(2, '0')}.${ext}`);

                    const remainingBudget = options.maxDownloadSizeBytes - cumulativeBytes;
                    if (remainingBudget <= 0) {
                        throw new Error('MAX_FILESIZE_EXCEEDED');
                    }

                    const result = await this.streamUrlToFile(item.url, itemPath, remainingBudget);
                    const detectedExt = this.inferExtFromContentType(result.contentType);
                    if (detectedExt) {
                        ext = detectedExt;
                    }

                    cumulativeBytes += result.bytes;
                    job.progressPercent = Math.round(((i + 1) / fresh.picker.length) * 85);
                    zipInputs.push({
                        name: `${String(i + 1).padStart(2, '0')}.${ext}`,
                        filePath: itemPath,
                    });
                }

                job.status = 'processing';
                job.progressPercent = 95;
                await createZipFromFiles(zipInputs, job.filePath);
                job.ext = 'zip';
                job.progressPercent = 100;
                job.status = 'completed';
                return;
            } finally {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            }
        }

        // Single file download
        let targetUrl = options.directUrl || '';
        const mode = options.formatSelection.startsWith('cobalt:audio')
            ? 'audio'
            : options.formatSelection.startsWith('cobalt:mute')
                ? 'mute'
                : 'auto';

        const resolveFreshUrl = async (): Promise<string> => {
            const res = await this.requestCobalt(job.url, { downloadMode: mode });
            if (res.status === 'picker' && options.itemIndex && res.picker?.[options.itemIndex - 1]) {
                return res.picker[options.itemIndex - 1].url;
            }
            if ((res.status === 'tunnel' || res.status === 'redirect') && res.url) {
                return res.url;
            }
            throw new Error('Cobalt no devolvió una URL descargable válida.');
        };

        if (!targetUrl || mode !== 'auto') {
            targetUrl = await resolveFreshUrl();
        }

        try {
            const result = await this.streamUrlToFile(
                targetUrl,
                job.filePath,
                options.maxDownloadSizeBytes,
                (downloaded, total) => {
                    job.status = 'downloading';
                    if (total && total > 0) {
                        job.progressPercent = Math.min(99, Math.round((downloaded / total) * 100));
                        job.totalBytes = `${(total / (1024 * 1024)).toFixed(1)}MiB`;
                    }
                },
            );
            const detectedExt = this.inferExtFromContentType(result.contentType);
            if (detectedExt && !job.ext) {
                job.ext = detectedExt;
            }
        } catch (err: any) {
            // Retry once with a fresh Cobalt URL if a cached directUrl expired
            if (options.directUrl && err?.message !== 'MAX_FILESIZE_EXCEEDED') {
                this.logger.warn(`[Job ${job.id}] Retrying Cobalt download with fresh URL: ${err.message}`);
                const freshUrl = await resolveFreshUrl();
                await this.streamUrlToFile(
                    freshUrl,
                    job.filePath,
                    options.maxDownloadSizeBytes,
                    (downloaded, total) => {
                        job.status = 'downloading';
                        if (total && total > 0) {
                            job.progressPercent = Math.min(99, Math.round((downloaded / total) * 100));
                            job.totalBytes = `${(total / (1024 * 1024)).toFixed(1)}MiB`;
                        }
                    },
                );
            } else {
                throw err;
            }
        }

        job.progressPercent = 100;
        job.status = 'completed';
    }
}
