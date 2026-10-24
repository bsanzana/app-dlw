import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

export type FormatType = 'video_audio' | 'video_only' | 'audio_only';

export interface VideoFormatOption {
    id: string; // unique key for selection
    type: FormatType;
    formatSelection: string; // string passed to yt-dlp -f
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

export interface DownloadJob {
    id: string;
    url: string;
    formatSelection: string;
    type: FormatType;
    title: string;
    ext: string;
    status: 'downloading' | 'completed' | 'failed';
    progressPercent?: number;
    downloadSpeed?: string;
    eta?: string;
    downloadedBytes?: string;
    totalBytes?: string;
    filePath?: string;
    error?: string;
    createdAt: number;
    clientIp?: string;
}

@Injectable()
export class DownloadsService {
    private readonly logger = new Logger(DownloadsService.name);
    private readonly jobs = new Map<string, DownloadJob>();
    private cleanupTimer?: NodeJS.Timeout;

    // Medidas de seguridad y protección contra ataques y sobrecarga
    readonly maxConcurrentDownloads = 3;
    readonly maxVideoDurationSeconds = 7200; // 2 horas máximo por video

    // Límites de ancho de banda por IP y tamaño máximo de archivo
    readonly maxDownloadsPerIpDay = process.env.MAX_DOWNLOADS_PER_IP_DAY
        ? parseInt(process.env.MAX_DOWNLOADS_PER_IP_DAY, 10)
        : 2; // Por defecto máximo 2 videos por IP cada 24 horas

    readonly maxDownloadSizeMb = process.env.MAX_DOWNLOAD_SIZE_MB
        ? parseInt(process.env.MAX_DOWNLOAD_SIZE_MB, 10)
        : 1024; // Por defecto 1024 MB (1 GB)

    readonly maxDownloadSizeBytes = this.maxDownloadSizeMb * 1024 * 1024;

    private readonly quotaFilePath = path.join(os.tmpdir(), 'dlw_ip_quotas.json');
    private readonly ipQuotas = new Map<string, number[]>(); // ip -> epoch timestamps

    constructor() {
        this.loadQuotasFromDisk();
        // Run cleanup of old jobs, temp files, and expired IP quotas every 10 minutes
        this.cleanupTimer = setInterval(() => this.cleanupOldJobs(), 10 * 60 * 1000);
        // Unref timer so it doesn't block Node process or Jest test teardown
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    onModuleDestroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
    }

    /**
     * Persists IP quota tracking to disk so that container restarts don't erase quotas
     */
    private loadQuotasFromDisk() {
        try {
            if (fs.existsSync(this.quotaFilePath)) {
                const data = fs.readFileSync(this.quotaFilePath, 'utf-8');
                const parsed = JSON.parse(data);
                const now = Date.now();
                const oneDay = 24 * 60 * 60 * 1000;
                for (const [ip, timestamps] of Object.entries(parsed)) {
                    if (Array.isArray(timestamps)) {
                        const valid = timestamps.filter((t: number) => typeof t === 'number' && now - t < oneDay);
                        if (valid.length > 0) {
                            this.ipQuotas.set(ip, valid);
                        }
                    }
                }
            }
        } catch (err) {
            this.logger.warn(`Could not load IP quotas from disk: ${err.message}`);
        }
    }

    private saveQuotasToDisk() {
        try {
            const obj: Record<string, number[]> = {};
            for (const [ip, timestamps] of this.ipQuotas.entries()) {
                if (timestamps.length > 0) {
                    obj[ip] = timestamps;
                }
            }
            fs.writeFileSync(this.quotaFilePath, JSON.stringify(obj));
        } catch (err) {
            this.logger.warn(`Could not persist IP quotas to disk: ${err.message}`);
        }
    }

    /**
     * Extracts reliable client IP from Express request, handling Cloudflare, Nginx proxy, and direct connections
     */
    extractClientIp(req: any): string {
        if (!req) return '127.0.0.1';
        const cfIp = req.headers?.['cf-connecting-ip'];
        if (typeof cfIp === 'string' && cfIp.trim()) {
            return cfIp.trim();
        }
        const xForwardedFor = req.headers?.['x-forwarded-for'];
        if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
            return xForwardedFor.split(',')[0].trim();
        }
        const xRealIp = req.headers?.['x-real-ip'];
        if (typeof xRealIp === 'string' && xRealIp.trim()) {
            return xRealIp.trim();
        }
        return req.ip || req.socket?.remoteAddress || '127.0.0.1';
    }

    /**
     * Checks if the IP has remaining downloads in the last 24-hour window and increments counter
     */
    checkAndIncrementIpQuota(clientIp: string) {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const history = (this.ipQuotas.get(clientIp) || []).filter((t) => now - t < oneDay);

        if (history.length >= this.maxDownloadsPerIpDay) {
            const oldest = Math.min(...history);
            const resetInMs = Math.max(0, oldest + oneDay - now);
            const hoursLeft = Math.ceil(resetInMs / (60 * 60 * 1000));
            throw new HttpException(
                `Has alcanzado el límite diario de descargas (máximo ${this.maxDownloadsPerIpDay} videos por día por IP para proteger el ancho de banda del servidor). Podrás descargar nuevamente en aproximadamente ${hoursLeft} hora(s).`,
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        history.push(now);
        this.ipQuotas.set(clientIp, history);
        this.saveQuotasToDisk();
    }

    /**
     * Refunds an IP's daily quota in case the download process fails
     */
    refundIpQuota(clientIp: string) {
        const history = this.ipQuotas.get(clientIp);
        if (history && history.length > 0) {
            history.pop();
            if (history.length === 0) {
                this.ipQuotas.delete(clientIp);
            } else {
                this.ipQuotas.set(clientIp, history);
            }
            this.saveQuotasToDisk();
        }
    }

    /**
     * Returns detailed IP quota status for frontend info or client queries
     */
    getIpQuotaStatus(clientIp: string) {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const history = (this.ipQuotas.get(clientIp) || []).filter((t) => now - t < oneDay);
        const count = history.length;
        const remaining = Math.max(0, this.maxDownloadsPerIpDay - count);
        const oldest = count > 0 ? Math.min(...history) : null;
        const resetInSeconds = oldest ? Math.max(0, Math.ceil((oldest + oneDay - now) / 1000)) : 0;

        return {
            ip: clientIp,
            allowed: count < this.maxDownloadsPerIpDay,
            used: count,
            remaining,
            maxPerDay: this.maxDownloadsPerIpDay,
            maxDownloadSizeMb: this.maxDownloadSizeMb,
            resetInSeconds,
            resetInHours: Math.ceil(resetInSeconds / 3600),
        };
    }

    /**
     * Resolves common yt-dlp arguments including PO token provider, optional burner cookies, and proxy
     */
    getCommonYtDlpArgs(): string[] {
        const potUrl = process.env.POT_PROVIDER_URL;
        const proxyUrl = process.env.PROXY_URL;
        const cookiesPath = process.env.COOKIES_PATH || '/app/cookies/cookies.txt';

        const args = [
            '--no-warnings',
            '--ignore-config',
            '--no-playlist',
            '--remote-components', 'ejs:github',
            '--extractor-args', 'youtube:player-client=mweb,tv,web_safari',
            ...(potUrl ? ['--extractor-args', `youtubepot-bgutilhttp:base_url=${potUrl}`] : []),
        ];

        if (fs.existsSync(cookiesPath)) {
            // yt-dlp tries to save updated session cookies upon exit.
            // If mounted read-only (:ro), yt-dlp crashes with Errno 30.
            // Copying to /tmp ensures yt-dlp has a writable cookie file.
            const writableCookiePath = path.join(os.tmpdir(), 'yt-dlp-cookies.txt');
            try {
                fs.copyFileSync(cookiesPath, writableCookiePath);
                args.push('--cookies', writableCookiePath);
            } catch (err) {
                this.logger.warn(`Failed to copy cookies to tmp: ${err.message}`);
                args.push('--cookies', cookiesPath);
            }
        }

        if (proxyUrl) {
            args.push('--proxy', proxyUrl);
        }

        return args;
    }

    /**
     * Executes yt-dlp to extract raw video metadata and format choices
     */
    async getMetadata(url: string): Promise<VideoMetadata> {
        return new Promise((resolve, reject) => {
            const args = [
                '--dump-json',
                ...this.getCommonYtDlpArgs(),
                url,
            ];

            const ytProcess = spawn('yt-dlp', args);

            let stdout = '';
            let stderr = '';

            ytProcess.stdout.on('data', (chunk) => (stdout += chunk.toString()));
            ytProcess.stderr.on('data', (chunk) => (stderr += chunk.toString()));

            ytProcess.on('close', (code) => {
                if (code !== 0) {
                    this.logger.error(`yt-dlp getMetadata error: ${stderr}`);
                    reject(new Error(stderr || `yt-dlp exited with code ${code}`));
                    return;
                }

                try {
                    const raw = JSON.parse(stdout);

                    if (raw.is_live) {
                        reject(new Error('No se permite la descarga de transmisiones en vivo (live streams).'));
                        return;
                    }

                    if (raw.duration && raw.duration > this.maxVideoDurationSeconds) {
                        reject(new Error('El video excede la duración máxima permitida (2 horas).'));
                        return;
                    }

                    const parsed = this.parseFormats(raw);
                    resolve(parsed);
                } catch (err) {
                    this.logger.error('Failed to parse yt-dlp metadata JSON', err);
                    reject(err instanceof Error ? err : new Error('Failed to parse yt-dlp metadata JSON'));
                }
            });

            ytProcess.on('error', (err) => {
                reject(new Error(`Failed to execute yt-dlp: ${err.message}`));
            });
        });
    }

    /**
     * Parses raw yt-dlp output into complete format choices:
     * 1. video_audio (guaranteed combined with audio)
     * 2. video_only (muted)
     * 3. audio_only (various qualities)
     * Automatically filters out formats exceeding maxDownloadSizeBytes (1 GB)
     */
    parseFormats(raw: any): VideoMetadata {
        const rawFormats: any[] = raw.formats || [];
        const validFormats = rawFormats.filter((f) => {
            if (!f || !f.format_id || f.format_id.startsWith('sb')) return false;
            // Descartar formatos que excedan el límite de tamaño permitido (1 GB)
            if (f.filesize && f.filesize > this.maxDownloadSizeBytes) return false;
            if (f.filesize_approx && f.filesize_approx > this.maxDownloadSizeBytes) return false;
            return true;
        });

        // Si se encontraron formatos pero todos fueron descartados por tamaño
        if (rawFormats.length > 0 && validFormats.length === 0) {
            throw new Error(`El video excede el límite máximo de descarga permitido de ${this.maxDownloadSizeMb} MB (1 GB).`);
        }

        const videoOnlyList = validFormats.filter(
            (f) => f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none'),
        );
        const audioOnlyList = validFormats.filter(
            (f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'),
        );
        const combinedList = validFormats.filter(
            (f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none',
        );

        // Sort audio by priority:
        // 1. Original audio track first (marked as "original" in format_note or language)
        // 2. Highest bitrate
        const sortedAudio = [...audioOnlyList].sort((a, b) => {
            const aNote = ((a.format_note || '') + ' ' + (a.language || '')).toLowerCase();
            const bNote = ((b.format_note || '') + ' ' + (b.language || '')).toLowerCase();
            const aIsOriginal = aNote.includes('original') || a.is_original;
            const bIsOriginal = bNote.includes('original') || b.is_original;

            if (aIsOriginal && !bIsOriginal) return -1;
            if (!aIsOriginal && bIsOriginal) return 1;

            return (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0);
        });
        const bestAudio = sortedAudio[0] ?? null;

        const resultFormats: VideoFormatOption[] = [];

        // ── 1. Video + Audio (Combinaciones completas garantizadas) ──────
        // Gather all video resolutions available (from videoOnly or combined)
        const heightsMap = new Map<number, any>();

        // Combined streams (progressive)
        for (const f of combinedList) {
            const h = f.height || 0;
            if (h > 0) {
                const current = heightsMap.get(h);
                if (!current || (f.tbr || 0) > (current.tbr || 0)) {
                    heightsMap.set(h, { ...f, isProgressive: true });
                }
            }
        }

        // Add or upgrade with separate video streams paired with best audio
        for (const f of videoOnlyList) {
            const h = f.height || 0;
            if (h > 0) {
                const current = heightsMap.get(h);
                if (!current || (!current.isProgressive && (f.tbr || 0) > (current.tbr || 0))) {
                    heightsMap.set(h, { ...f, isProgressive: false });
                }
            }
        }

        // Sort heights descending (e.g., 2160, 1440, 1080, 720, 480, 360, 240, 144)
        const sortedHeights = Array.from(heightsMap.keys()).sort((a, b) => b - a);

        for (const h of sortedHeights) {
            const f = heightsMap.get(h);
            const formatSelection = f.isProgressive
                ? f.format_id
                : (bestAudio ? `${f.format_id}+${bestAudio.format_id}` : f.format_id);

            // Calculate estimated combined filesize
            let combinedSize: number | null = f.filesize || f.filesize_approx || null;
            if (!f.isProgressive && bestAudio) {
                const audioSize = bestAudio.filesize || bestAudio.filesize_approx || null;
                if (combinedSize && audioSize) {
                    combinedSize += audioSize;
                }
            }

            // Excluir si la combinación excede el tamaño máximo permitido
            if (combinedSize && combinedSize > this.maxDownloadSizeBytes) {
                continue;
            }

            const label = `${h}p${f.fps && f.fps > 30 ? f.fps : ''}`;

            resultFormats.push({
                id: `va_${h}p_${f.format_id}`,
                type: 'video_audio',
                formatSelection,
                resolution: label,
                ext: 'mp4',
                note: f.isProgressive ? 'Video + Audio directo' : 'Video HD + Audio de alta calidad',
                hasAudio: true,
                hasVideo: true,
                filesize: combinedSize,
                height: h,
                fps: f.fps || null,
                vcodec: f.vcodec || null,
                acodec: f.isProgressive ? f.acodec : (bestAudio?.acodec || null),
                tbr: f.tbr || null,
            });
        }

        // ── 2. Solo Video (Mudo / Sin audio) ─────────────────────────────
        for (const f of videoOnlyList) {
            const h = f.height || 0;
            if (h > 0) {
                const label = `${h}p${f.fps && f.fps > 30 ? f.fps : ''} (Mudo)`;
                resultFormats.push({
                    id: `vo_${f.format_id}`,
                    type: 'video_only',
                    formatSelection: f.format_id,
                    resolution: label,
                    ext: f.ext || 'mp4',
                    note: 'Solo video sin pista de audio',
                    hasAudio: false,
                    hasVideo: true,
                    filesize: f.filesize || f.filesize_approx || null,
                    height: h,
                    fps: f.fps || null,
                    vcodec: f.vcodec || null,
                    acodec: null,
                    tbr: f.tbr || null,
                });
            }
        }

        // ── 3. Solo Audio ────────────────────────────────────────────────
        // Preset para MP3 Máxima Calidad (solo si existe audio disponible)
        if (bestAudio || combinedList.length > 0) {
            resultFormats.push({
                id: 'ao_mp3_best',
                type: 'audio_only',
                formatSelection: 'bestaudio/best',
                resolution: 'MP3 Audio (Alta Calidad)',
                ext: 'mp3',
                note: 'Convertido automáticamente a MP3 universal',
                hasAudio: true,
                hasVideo: false,
                filesize: bestAudio?.filesize || bestAudio?.filesize_approx || null,
                height: null,
                fps: null,
                vcodec: null,
                acodec: 'mp3',
                abr: bestAudio?.abr || 192,
            });
        }

        // Streams nativos de audio
        for (const f of audioOnlyList) {
            const kbps = Math.round(f.abr || f.tbr || 0);
            resultFormats.push({
                id: `ao_${f.format_id}`,
                type: 'audio_only',
                formatSelection: f.format_id,
                resolution: `${f.ext.toUpperCase()} ~${kbps ? kbps + 'kbps' : 'Audio'}`,
                ext: f.ext || 'm4a',
                note: f.format_note || 'Pista de audio nativa',
                hasAudio: true,
                hasVideo: false,
                filesize: f.filesize || f.filesize_approx || null,
                height: null,
                fps: null,
                vcodec: null,
                acodec: f.acodec || null,
                abr: f.abr || null,
            });
        }

        // Si se encontraron formatos originalmente pero todos fueron descartados por tamaño
        if (rawFormats.length > 0 && resultFormats.length === 0) {
            throw new Error(`El video excede el límite máximo de descarga permitido de ${this.maxDownloadSizeMb} MB (1 GB).`);
        }

        return {
            id: raw.id || '',
            title: raw.title || 'video',
            thumbnail: raw.thumbnail || '',
            duration: raw.duration || 0,
            uploader: raw.uploader || raw.channel || '',
            formats: resultFormats,
        };
    }

    /**
     * Builds the exact arguments for yt-dlp according to the requested format and type
     * Enforces --max-filesize to protect server bandwidth (max 1 GB)
     */
    buildYtDlpArgs(url: string, formatSelection: string, type: FormatType, outputPath: string): string[] {
        const baseArgs = [
            ...this.getCommonYtDlpArgs(),
            '--max-filesize', `${this.maxDownloadSizeMb}M`,
        ];

        if (type === 'audio_only' && (formatSelection === 'bestaudio/best' || !formatSelection.includes('+'))) {
            // Convert to MP3
            return [
                ...baseArgs,
                '-f', formatSelection,
                '-x',
                '--audio-format', 'mp3',
                '--audio-quality', '0',
                '-o', outputPath,
                url,
            ];
        }

        if (type === 'video_audio') {
            return [
                ...baseArgs,
                '-f', formatSelection,
                '--merge-output-format', 'mp4',
                // Compatibilidad universal (WhatsApp, iOS, Android, web): H.264 + AAC + faststart
                '--postprocessor-args', 'Merger:-c:v libx264 -c:a aac -movflags +faststart',
                '-o', outputPath,
                url,
            ];
        }

        // For video_only or specific audio format
        return [
            ...baseArgs,
            '-f', formatSelection,
            '-o', outputPath,
            url,
        ];
    }

    /**
     * Starts background download with yt-dlp and associates client IP for quota management
     */
    startDownload(
        url: string,
        formatSelection: string,
        type: FormatType,
        title: string,
        clientIp?: string,
    ): { jobId: string } {
        const activeDownloads = Array.from(this.jobs.values()).filter(
            (j) => j.status === 'downloading',
        ).length;

        if (activeDownloads >= this.maxConcurrentDownloads) {
            throw new HttpException(
                'El servidor está procesando el número máximo de descargas simultáneas permitidas. Por favor espera unos momentos e intenta de nuevo.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const jobId = randomUUID();
        const ext = (type === 'audio_only' && formatSelection === 'bestaudio/best') ? 'mp3' : 'mp4';
        const sanitizedTitle = (title || 'download').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
        const tempPath = path.join(os.tmpdir(), `dlw_${jobId}_${sanitizedTitle}.${ext}`);

        const job: DownloadJob = {
            id: jobId,
            url,
            formatSelection,
            type,
            title,
            ext,
            status: 'downloading',
            filePath: tempPath,
            createdAt: Date.now(),
            clientIp,
        };

        this.jobs.set(jobId, job);

        const args = [
            ...this.buildYtDlpArgs(url, formatSelection, type, tempPath),
            '--newline', // Output progress on new lines for easy parsing
        ];
        this.logger.log(`[Job ${jobId}] Starting yt-dlp with args: ${args.join(' ')}`);

        const ytProcess = spawn('yt-dlp', args);

        let stderr = '';

        // Parse stdout for real progress percentage and speed
        ytProcess.stdout.on('data', (d) => {
            const lines = d.toString().split('\n');
            for (const line of lines) {
                // Example yt-dlp line: [download]  45.2% of  120.50MiB at 12.30MiB/s ETA 00:05
                const match = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)/);
                if (match) {
                    const [, percent, total, speed, eta] = match;
                    job.progressPercent = parseFloat(percent);
                    job.totalBytes = total;
                    job.downloadSpeed = speed;
                    job.eta = eta;
                } else {
                    const simpleMatch = line.match(/\[download\]\s+([\d.]+)%/);
                    if (simpleMatch) {
                        job.progressPercent = parseFloat(simpleMatch[1]);
                    }
                }
            }

            // Real-time disk size check: abort if file exceeds maxDownloadSizeBytes
            if (fs.existsSync(tempPath)) {
                try {
                    const currentBytes = fs.statSync(tempPath).size;
                    if (currentBytes > this.maxDownloadSizeBytes) {
                        this.logger.warn(`[Job ${jobId}] Exceeded 1 GB size limit (${currentBytes} bytes). Aborting.`);
                        ytProcess.kill('SIGTERM');
                        job.status = 'failed';
                        job.error = `La descarga fue cancelada porque excede el límite máximo de ${this.maxDownloadSizeMb} MB (1 GB).`;
                        this.cleanupFile(tempPath);
                        if (job.clientIp) {
                            this.refundIpQuota(job.clientIp);
                        }
                    }
                } catch { }
            }
        });

        ytProcess.stderr.on('data', (d) => (stderr += d.toString()));

        ytProcess.on('close', (code) => {
            if (code === 0 && fs.existsSync(tempPath)) {
                // Final size check
                try {
                    const finalSize = fs.statSync(tempPath).size;
                    if (finalSize > this.maxDownloadSizeBytes) {
                        job.status = 'failed';
                        job.error = `El archivo generado excede el límite de ${this.maxDownloadSizeMb} MB (1 GB).`;
                        this.cleanupFile(tempPath);
                        if (job.clientIp) this.refundIpQuota(job.clientIp);
                        return;
                    }
                } catch { }

                this.logger.log(`[Job ${jobId}] Download completed successfully.`);
                job.progressPercent = 100;
                job.status = 'completed';
            } else {
                this.logger.error(`[Job ${jobId}] Failed with exit code ${code}. Stderr: ${stderr}`);
                job.status = 'failed';

                const lowerErr = stderr.toLowerCase();
                if (lowerErr.includes('max-filesize') || lowerErr.includes('larger than')) {
                    job.error = `El archivo excede el tamaño máximo permitido de ${this.maxDownloadSizeMb} MB (1 GB).`;
                } else {
                    job.error = stderr || `Proceso finalizado (código ${code})`;
                }

                this.cleanupFile(tempPath);
                // Refund quota if download failed so the user doesn't lose allowance
                if (job.clientIp) {
                    this.refundIpQuota(job.clientIp);
                }
            }
        });

        ytProcess.on('error', (err) => {
            this.logger.error(`[Job ${jobId}] Error spawning yt-dlp:`, err);
            job.status = 'failed';
            job.error = err.message;
            this.cleanupFile(tempPath);
            if (job.clientIp) {
                this.refundIpQuota(job.clientIp);
            }
        });

        return { jobId };
    }

    /**
     * Retrieves job status
     */
    getJob(jobId: string): DownloadJob | undefined {
        return this.jobs.get(jobId);
    }

    /**
     * Cleans up a temporary file safely
     */
    cleanupFile(filePath?: string) {
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (err) {
                this.logger.warn(`Could not remove temp file: ${filePath}`, err);
            }
        }
    }

    /**
     * Removes jobs older than 30 minutes and cleans expired IP quotas
     */
    private cleanupOldJobs() {
        const threshold = Date.now() - 30 * 60 * 1000;
        for (const [id, job] of this.jobs.entries()) {
            if (job.createdAt < threshold) {
                this.cleanupFile(job.filePath);
                this.jobs.delete(id);
            }
        }

        // Clean expired IP quotas older than 24h
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        let modified = false;
        for (const [ip, timestamps] of this.ipQuotas.entries()) {
            const valid = timestamps.filter((t) => now - t < oneDay);
            if (valid.length === 0) {
                this.ipQuotas.delete(ip);
                modified = true;
            } else if (valid.length !== timestamps.length) {
                this.ipQuotas.set(ip, valid);
                modified = true;
            }
        }
        if (modified) {
            this.saveQuotasToDisk();
        }
    }
}
