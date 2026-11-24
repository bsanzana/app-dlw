import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
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

export interface GalleryDlParsedItem {
    index: number;
    url: string;
    ext: string;
    width: number | null;
    height: number | null;
    isVideo: boolean;
    filename: string;
}

export interface GalleryDlParsedResult {
    title: string;
    uploader: string;
    thumbnail: string;
    items: GalleryDlParsedItem[];
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v']);
const MEDIA_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', ...VIDEO_EXTENSIONS]);

@Injectable()
export class GalleryDlProvider {
    private readonly logger = new Logger(GalleryDlProvider.name);
    private readonly maxAlbumItems = 50;

    isEnabled(): boolean {
        return process.env.ENABLE_GALLERY_DL !== 'false';
    }

    /**
     * Detects URLs that primarily point to photos or image galleries where yt-dlp
     * usually fails or has no video stream (e.g. Facebook photos, Pinterest, Imgur).
     */
    isGalleryPreferredUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            const host = parsed.hostname.toLowerCase();
            const fullPath = `${parsed.pathname}${parsed.search}`.toLowerCase();

            if (host.includes('facebook.com') || host.includes('fb.com')) {
                if (
                    fullPath.includes('/photo') ||
                    fullPath.includes('/photos/') ||
                    fullPath.includes('fbid=') ||
                    fullPath.includes('set=a.') ||
                    fullPath.includes('set=pcb.')
                ) {
                    return true;
                }
            }

            return (
                host.includes('pinterest.') ||
                host === 'pin.it' ||
                host.includes('imgur.com') ||
                host.includes('deviantart.com') ||
                host.includes('pixiv.net') ||
                host.includes('flickr.com') ||
                host.includes('artstation.com')
            );
        } catch {
            return false;
        }
    }

    getCommonArgs(): string[] {
        const args = ['--ignore-config', '--no-mtime'];
        const cookiesPath = process.env.COOKIES_PATH || '/app/cookies/cookies.txt';
        const proxyUrl = process.env.PROXY_URL;

        if (fs.existsSync(cookiesPath)) {
            const writableCookiePath = path.join(os.tmpdir(), 'gallery-dl-cookies.txt');
            try {
                fs.copyFileSync(cookiesPath, writableCookiePath);
                args.push('--cookies', writableCookiePath);
            } catch {
                args.push('--cookies', cookiesPath);
            }
        }

        if (proxyUrl) {
            args.push('--proxy', proxyUrl);
        }

        return args;
    }

    /**
     * Parses `gallery-dl -j` JSON output (tuple array or JSON lines).
     * Entry type 2 contains post/directory metadata; type 3 contains [3, url, itemMetadata].
     */
    parseJsonOutput(stdout: string, sourceUrl: string): GalleryDlParsedResult {
        let entries: any[] = [];
        const trimmed = stdout.trim();
        if (!trimmed) {
            throw new Error('gallery-dl no devolvió metadatos.');
        }

        try {
            const parsed = JSON.parse(trimmed);
            entries = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
            // Fallback for JSON-lines output
            for (const line of trimmed.split(/\r?\n/)) {
                const l = line.trim();
                if (!l) continue;
                try {
                    entries.push(JSON.parse(l));
                } catch { }
            }
        }

        let postMeta: Record<string, any> = {};
        const items: GalleryDlParsedItem[] = [];
        const seenUrls = new Set<string>();

        for (const entry of entries) {
            if (!Array.isArray(entry) || entry.length < 2) continue;
            const tag = entry[0];

            if (tag === 2 && entry[1] && typeof entry[1] === 'object') {
                postMeta = { ...postMeta, ...entry[1] };
            } else if (tag === 3 && typeof entry[1] === 'string') {
                const mediaUrl = entry[1];
                const itemMeta = (entry[2] && typeof entry[2] === 'object') ? entry[2] : {};
                if (seenUrls.has(mediaUrl)) continue;
                seenUrls.add(mediaUrl);

                const rawExt = (
                    itemMeta.extension ||
                    path.extname(mediaUrl.split('?')[0]).replace('.', '') ||
                    'jpg'
                )
                    .toString()
                    .toLowerCase();

                if (!MEDIA_EXTENSIONS.has(rawExt)) continue;

                const isVideo = VIDEO_EXTENSIONS.has(rawExt);
                const width = typeof itemMeta.width === 'number' ? itemMeta.width : null;
                const height = typeof itemMeta.height === 'number' ? itemMeta.height : null;
                const filename = String(itemMeta.filename || `media_${items.length + 1}`);

                items.push({
                    index: items.length + 1,
                    url: mediaUrl,
                    ext: rawExt === 'jpeg' ? 'jpg' : rawExt,
                    width,
                    height,
                    isVideo,
                    filename,
                });

                postMeta = { ...itemMeta, ...postMeta };
                if (items.length >= this.maxAlbumItems) break;
            }
        }

        if (items.length === 0) {
            throw new Error('gallery-dl no encontró imágenes ni archivos descargables en el enlace.');
        }

        let fallbackHost = 'Red Social';
        try {
            fallbackHost = new URL(sourceUrl).hostname.replace(/^www\./, '');
        } catch { }

        const rawTitle =
            postMeta.title ||
            postMeta.description ||
            postMeta.content ||
            postMeta.caption ||
            items[0].filename ||
            `Publicación de ${fallbackHost}`;

        const title = String(rawTitle).replace(/\s+/g, ' ').trim().slice(0, 110);
        const uploader = String(
            postMeta.author?.name ||
            postMeta.author?.nick ||
            postMeta.username ||
            postMeta.uploader ||
            postMeta.user ||
            fallbackHost,
        ).trim();

        const firstImage = items.find((item) => !item.isVideo);

        return {
            title: title || `Publicación de ${fallbackHost}`,
            uploader: uploader || fallbackHost,
            thumbnail: firstImage?.url || items[0].url,
            items,
        };
    }

    async resolveInfo(url: string): Promise<VideoMetadata> {
        const stdout = await new Promise<string>((resolve, reject) => {
            const args = ['-j', '--range', `1-${this.maxAlbumItems}`, ...this.getCommonArgs(), url];
            const proc = spawn('gallery-dl', args);

            let out = '';
            let err = '';

            const timeout = setTimeout(() => {
                proc.kill('SIGTERM');
                reject(new Error('gallery-dl excedió el tiempo máximo de análisis.'));
            }, 25000);

            proc.stdout.on('data', (chunk) => (out += chunk.toString()));
            proc.stderr.on('data', (chunk) => (err += chunk.toString()));

            proc.on('close', (code) => {
                clearTimeout(timeout);
                if (code !== 0 && !out.trim()) {
                    reject(new Error(err.trim() || `gallery-dl finalizó con código ${code}`));
                    return;
                }
                resolve(out);
            });

            proc.on('error', (spawnErr) => {
                clearTimeout(timeout);
                reject(new Error(`No se pudo ejecutar gallery-dl: ${spawnErr.message}`));
            });
        });

        const parsed = this.parseJsonOutput(stdout, url);
        const formats: VideoFormatOption[] = [];

        if (parsed.items.length === 1) {
            const single = parsed.items[0];
            const dims = single.width && single.height ? `${single.width}x${single.height}` : null;
            formats.push({
                id: 'gdl_item_1',
                type: single.isVideo ? 'video_audio' : 'image',
                formatSelection: 'gallery:item:1',
                resolution: dims || (single.isVideo ? 'Video Original' : 'Imagen Original'),
                ext: single.ext,
                note: single.isVideo
                    ? 'Video extraído por gallery-dl'
                    : 'Imagen original sin compresión (gallery-dl)',
                hasAudio: single.isVideo,
                hasVideo: single.isVideo,
                filesize: null,
                height: single.height,
                fps: null,
                vcodec: null,
                acodec: null,
                engine: 'gallery_dl',
                itemIndex: 1,
                directUrl: single.url,
                previewUrl: single.isVideo ? null : single.url,
            });
        } else {
            const allImages = parsed.items.every((item) => !item.isVideo);
            // Primary option: download entire carousel/album as a .zip directly
            formats.push({
                id: 'gdl_album_zip',
                type: 'image',
                formatSelection: 'gallery:all:zip',
                resolution: `Álbum Completo (${parsed.items.length} archivos)`,
                ext: 'zip',
                note: 'Descarga directa de todo el carrusel en .zip (gallery-dl)',
                hasAudio: !allImages,
                hasVideo: !allImages,
                filesize: null,
                height: null,
                fps: null,
                vcodec: null,
                acodec: null,
                engine: 'gallery_dl',
                previewUrl: parsed.thumbnail,
            });

            // Individual items (capped at 20 cards to keep UI responsive)
            for (const item of parsed.items.slice(0, 20)) {
                const dims = item.width && item.height ? `${item.width}x${item.height}` : null;
                formats.push({
                    id: `gdl_item_${item.index}`,
                    type: item.isVideo ? 'video_audio' : 'image',
                    formatSelection: `gallery:item:${item.index}`,
                    resolution: item.isVideo
                        ? `Video #${item.index}${dims ? ` (${dims})` : ''}`
                        : `Imagen #${item.index}${dims ? ` (${dims})` : ''}`,
                    ext: item.ext,
                    note: `Archivo individual #${item.index} (gallery-dl)`,
                    hasAudio: item.isVideo,
                    hasVideo: item.isVideo,
                    filesize: null,
                    height: item.height,
                    fps: null,
                    vcodec: null,
                    acodec: null,
                    engine: 'gallery_dl',
                    itemIndex: item.index,
                    directUrl: item.url,
                    previewUrl: item.isVideo ? null : item.url,
                });
            }
        }

        const hasVideos = parsed.items.some((i) => i.isVideo);
        const hasImages = parsed.items.some((i) => !i.isVideo);

        return {
            id: `gdl_${Date.now()}`,
            title: parsed.title,
            thumbnail: parsed.thumbnail,
            duration: 0,
            uploader: parsed.uploader,
            formats,
            engine: 'gallery_dl',
            mediaType: hasVideos && hasImages ? 'mixed' : hasVideos ? 'video' : 'image',
        };
    }

    private collectFilesRecursively(dirPath: string): string[] {
        if (!fs.existsSync(dirPath)) return [];
        const results: string[] = [];
        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
            const full = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                results.push(...this.collectFilesRecursively(full));
            } else if (entry.isFile()) {
                results.push(full);
            }
        }
        return results.sort();
    }

    private getTotalDirectorySize(dirPath: string): number {
        return this.collectFilesRecursively(dirPath).reduce((acc, file) => {
            try {
                return acc + fs.statSync(file).size;
            } catch {
                return acc;
            }
        }, 0);
    }

    async downloadToFile(
        job: DownloadJob,
        options: ProviderDownloadOptions,
    ): Promise<void> {
        if (!job.filePath) {
            throw new Error('Ruta de archivo temporal no definida.');
        }

        const tempDir = path.join(os.tmpdir(), `dlw_gdl_${job.id}`);
        fs.mkdirSync(tempDir, { recursive: true });
        job.tempDir = tempDir;

        const isZip = options.formatSelection === 'gallery:all:zip';
        const itemIndex = options.itemIndex || 1;
        const rangeArg = isZip ? `1-${this.maxAlbumItems}` : `${itemIndex}`;

        try {
            await new Promise<void>((resolve, reject) => {
                const args = [
                    '-D', tempDir,
                    '--range', rangeArg,
                    '--filesize-max', `${options.maxDownloadSizeMb}M`,
                    ...this.getCommonArgs(),
                    job.url,
                ];

                this.logger.log(`[Job ${job.id}] Running gallery-dl with range=${rangeArg}`);
                const proc = spawn('gallery-dl', args);
                let stderr = '';

                const sizeCheckInterval = setInterval(() => {
                    const total = this.getTotalDirectorySize(tempDir);
                    if (total > options.maxDownloadSizeBytes) {
                        proc.kill('SIGTERM');
                        clearInterval(sizeCheckInterval);
                        reject(new Error(`La descarga excede el límite máximo de ${options.maxDownloadSizeMb} MB.`));
                    }
                }, 750);

                proc.stdout.on('data', () => {
                    job.status = 'downloading';
                    job.progressPercent = Math.min(80, (job.progressPercent || 15) + 10);
                });
                proc.stderr.on('data', (chunk) => (stderr += chunk.toString()));

                proc.on('close', (code) => {
                    clearInterval(sizeCheckInterval);
                    if (code !== 0) {
                        reject(new Error(stderr.trim() || `gallery-dl finalizó con código ${code}`));
                        return;
                    }
                    resolve();
                });

                proc.on('error', (err) => {
                    clearInterval(sizeCheckInterval);
                    reject(new Error(`Error ejecutando gallery-dl: ${err.message}`));
                });
            });

            const files = this.collectFilesRecursively(tempDir);
            if (files.length === 0) {
                throw new Error('gallery-dl no generó ningún archivo descargable.');
            }

            const totalBytes = this.getTotalDirectorySize(tempDir);
            if (totalBytes > options.maxDownloadSizeBytes) {
                throw new Error(`La descarga excede el límite máximo de ${options.maxDownloadSizeMb} MB.`);
            }

            if (isZip) {
                job.status = 'processing';
                job.progressPercent = 90;
                const zipInputs: ZipInputFile[] = files.map((filePath, idx) => {
                    const ext = path.extname(filePath) || '.jpg';
                    return {
                        name: `${String(idx + 1).padStart(2, '0')}${ext}`,
                        filePath,
                    };
                });
                await createZipFromFiles(zipInputs, job.filePath);
                job.ext = 'zip';
            } else {
                const downloadedFile = files[0];
                const realExt = path.extname(downloadedFile).replace('.', '').toLowerCase();
                if (realExt) {
                    job.ext = realExt === 'jpeg' ? 'jpg' : realExt;
                }
                fs.copyFileSync(downloadedFile, job.filePath);
            }

            job.progressPercent = 100;
            job.status = 'completed';
        } finally {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        }
    }
}
