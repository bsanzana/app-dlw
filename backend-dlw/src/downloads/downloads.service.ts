import { Injectable, Logger } from '@nestjs/common';
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
}

@Injectable()
export class DownloadsService {
    private readonly logger = new Logger(DownloadsService.name);
    private readonly jobs = new Map<string, DownloadJob>();
    private cleanupTimer?: NodeJS.Timeout;

    constructor() {
        // Run cleanup of old jobs and temp files every 10 minutes
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
     * Executes yt-dlp to extract raw video metadata and format choices
     */
    async getMetadata(url: string): Promise<VideoMetadata> {
        return new Promise((resolve, reject) => {
            const args = [
                '--dump-json',
                '--no-warnings',
                '--ignore-config',
                '--no-playlist',
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
                    const parsed = this.parseFormats(raw);
                    resolve(parsed);
                } catch (err) {
                    this.logger.error('Failed to parse yt-dlp metadata JSON', err);
                    reject(new Error('Failed to parse yt-dlp metadata JSON'));
                }
            });

            ytProcess.on('error', (err) => {
                reject(new Error(`Failed to execute yt-dlp: ${err.message}`));
            });
        });
    }

    /**
     * Parses raw yt-dlp output into complete format choices:
     * 1. video_audio (muxed or progressive)
     * 2. video_only (muted)
     * 3. audio_only (various qualities)
     */
    parseFormats(raw: any): VideoMetadata {
        const rawFormats: any[] = raw.formats || [];
        const validFormats = rawFormats.filter((f) => f && f.format_id && !f.format_id.startsWith('sb'));

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
                : (bestAudio ? `${f.format_id}+${bestAudio.format_id}` : `${f.format_id}+bestaudio[language=es]/bestaudio/best`);

            // Use estimated filesize or compute from bitrate if known
            let size = f.filesize || f.filesize_approx || null;
            if (!size && f.tbr && raw.duration) {
                size = Math.round((f.tbr * 1024 / 8) * raw.duration);
            }

            const audioLangTag = bestAudio?.format_note ? `[${bestAudio.format_note}]` : '';

            resultFormats.push({
                id: `va_${h}_${f.format_id}`,
                type: 'video_audio',
                formatSelection,
                resolution: `${h}p`,
                ext: 'mp4',
                note: f.format_note ? `${h}p ${audioLangTag}` : `${h}p`,
                hasAudio: true,
                hasVideo: true,
                filesize: size,
                height: h,
                fps: f.fps || null,
                vcodec: f.vcodec || null,
                acodec: f.acodec || (bestAudio ? bestAudio.acodec : 'aac'),
                tbr: f.tbr || null,
            });
        }

        // ── 2. Solo Video (Mudo / Sin audio) ───────────────────────────
        // Provide the distinct video streams without audio
        const seenVideoOnly = new Set<string>();
        for (const f of videoOnlyList) {
            const h = f.height || 0;
            const key = `${h}_${f.ext}`;
            if (!seenVideoOnly.has(key)) {
                seenVideoOnly.add(key);
                resultFormats.push({
                    id: `vo_${f.format_id}`,
                    type: 'video_only',
                    formatSelection: f.format_id,
                    resolution: h > 0 ? `${h}p (Mudo)` : `${f.resolution || 'Video'} (Mudo)`,
                    ext: f.ext || 'mp4',
                    note: `Solo video ${f.vcodec ? `(${f.vcodec})` : ''}`,
                    hasAudio: false,
                    hasVideo: true,
                    filesize: f.filesize || f.filesize_approx || null,
                    height: h || null,
                    fps: f.fps || null,
                    vcodec: f.vcodec || null,
                    acodec: null,
                    tbr: f.tbr || null,
                });
            }
        }

        // ── 3. Solo Audio (Distintas calidades / bitrates) ──────────────
        // Best MP3 extraction option (prefer original audio track)
        resultFormats.push({
            id: 'ao_mp3_best',
            type: 'audio_only',
            formatSelection: bestAudio ? bestAudio.format_id : 'bestaudio/best',
            resolution: 'MP3 (Audio Original)',
            ext: 'mp3',
            note: bestAudio?.format_note ? `Audio original (${bestAudio.format_note})` : 'Convertido automáticamente a MP3',
            hasAudio: true,
            hasVideo: false,
            filesize: bestAudio ? (bestAudio.filesize || bestAudio.filesize_approx || null) : null,
            height: null,
            fps: null,
            vcodec: null,
            acodec: 'mp3',
            abr: bestAudio ? (bestAudio.abr || bestAudio.tbr || null) : null,
        });

        // Individual native audio streams
        const seenAudio = new Set<string>();
        for (const f of sortedAudio) {
            const bitrate = Math.round(f.abr || f.tbr || 0);
            const key = `${bitrate}_${f.ext}`;
            if (!seenAudio.has(key)) {
                seenAudio.add(key);
                resultFormats.push({
                    id: `ao_${f.format_id}`,
                    type: 'audio_only',
                    formatSelection: f.format_id,
                    resolution: bitrate > 0 ? `${bitrate} kbps (${f.ext})` : `Audio (${f.ext})`,
                    ext: f.ext || 'm4a',
                    note: f.format_note || (f.acodec ? `Codec: ${f.acodec}` : 'Audio nativo'),
                    hasAudio: true,
                    hasVideo: false,
                    filesize: f.filesize || f.filesize_approx || null,
                    height: null,
                    fps: null,
                    vcodec: null,
                    acodec: f.acodec || null,
                    abr: bitrate || null,
                });
            }
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
     */
    buildYtDlpArgs(url: string, formatSelection: string, type: FormatType, outputPath: string): string[] {
        const baseArgs = [
            '--no-warnings',
            '--ignore-config',
            '--no-playlist',
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
     * Starts background download with yt-dlp
     */
    startDownload(url: string, formatSelection: string, type: FormatType, title: string): { jobId: string } {
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
        });

        ytProcess.stderr.on('data', (d) => (stderr += d.toString()));

        ytProcess.on('close', (code) => {
            if (code === 0 && fs.existsSync(tempPath)) {
                this.logger.log(`[Job ${jobId}] Download completed successfully.`);
                job.progressPercent = 100;
                job.status = 'completed';
            } else {
                this.logger.error(`[Job ${jobId}] Failed with exit code ${code}. Stderr: ${stderr}`);
                job.status = 'failed';
                job.error = stderr || `Proceso finalizado (código ${code})`;
                this.cleanupFile(tempPath);
            }
        });

        ytProcess.on('error', (err) => {
            this.logger.error(`[Job ${jobId}] Error spawning yt-dlp:`, err);
            job.status = 'failed';
            job.error = err.message;
            this.cleanupFile(tempPath);
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
     * Removes jobs older than 30 minutes
     */
    private cleanupOldJobs() {
        const threshold = Date.now() - 30 * 60 * 1000;
        for (const [id, job] of this.jobs.entries()) {
            if (job.createdAt < threshold) {
                this.cleanupFile(job.filePath);
                this.jobs.delete(id);
            }
        }
    }
}
