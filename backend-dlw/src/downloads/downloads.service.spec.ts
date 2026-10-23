import { Test, TestingModule } from '@nestjs/testing';
import { DownloadsService, FormatType } from './downloads.service';

describe('DownloadsService', () => {
    let service: DownloadsService;

    // Fixture representing typical yt-dlp --dump-json output
    const mockRawYtDlp = {
        id: 'test_video_123',
        title: 'Video de Prueba HD',
        thumbnail: 'https://example.com/thumb.jpg',
        duration: 215,
        uploader: 'Canal de Prueba',
        formats: [
            // Storyboards (should be filtered out)
            { format_id: 'sb1', ext: 'mhtml', vcodec: 'none', acodec: 'none' },
            // Audio streams
            { format_id: '139', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.5', abr: 48, filesize: 1000000 },
            { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128, filesize: 3000000 },
            { format_id: '251', ext: 'webm', vcodec: 'none', acodec: 'opus', abr: 160, filesize: 3200000 },
            // Progressive stream (video + audio in one)
            { format_id: '18', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, fps: 30, tbr: 450 },
            // DASH Video only streams
            { format_id: '136', ext: 'mp4', vcodec: 'avc1.4D401F', acodec: 'none', height: 720, fps: 30, tbr: 1200 },
            { format_id: '137', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', height: 1080, fps: 30, tbr: 3000 },
            { format_id: '248', ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 1080, fps: 30, tbr: 1500 },
        ],
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [DownloadsService],
        }).compile();

        service = module.get<DownloadsService>(DownloadsService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('parseFormats', () => {
        it('should correctly parse and classify all formats into 3 categories', () => {
            const parsed = service.parseFormats(mockRawYtDlp);

            expect(parsed.id).toBe('test_video_123');
            expect(parsed.title).toBe('Video de Prueba HD');
            expect(parsed.duration).toBe(215);

            // Group by type
            const videoAudio = parsed.formats.filter((f) => f.type === 'video_audio');
            const videoOnly = parsed.formats.filter((f) => f.type === 'video_only');
            const audioOnly = parsed.formats.filter((f) => f.type === 'audio_only');

            // 1. Video + Audio combinations
            expect(videoAudio.length).toBeGreaterThan(0);
            // Should have 1080p, 720p, 360p
            const heights = videoAudio.map((f) => f.height);
            expect(heights).toContain(1080);
            expect(heights).toContain(720);
            expect(heights).toContain(360);

            // 1080p was video-only in raw, so it should be paired with best audio (format 251 or 140)
            const f1080 = videoAudio.find((f) => f.height === 1080);
            expect(f1080?.formatSelection).toContain('+');
            expect(f1080?.hasAudio).toBe(true);

            // 360p was progressive (format 18), so formatSelection can be direct '18'
            const f360 = videoAudio.find((f) => f.height === 360);
            expect(f360?.formatSelection).toBe('18');
            expect(f360?.hasAudio).toBe(true);

            // 2. Video Only (Mute / without audio)
            expect(videoOnly.length).toBeGreaterThan(0);
            const vo1080 = videoOnly.find((f) => f.height === 1080);
            expect(vo1080).toBeDefined();
            expect(vo1080?.hasAudio).toBe(false);
            expect(vo1080?.resolution).toContain('Mudo');

            // 3. Audio Only
            expect(audioOnly.length).toBeGreaterThan(0);
            // Should contain best MP3 preset
            const mp3Option = audioOnly.find((f) => f.id === 'ao_mp3_best');
            expect(mp3Option).toBeDefined();
            expect(mp3Option?.ext).toBe('mp3');
            expect(mp3Option?.hasVideo).toBe(false);

            // Should contain native audio streams
            const nativeAudio = audioOnly.filter((f) => f.id !== 'ao_mp3_best');
            expect(nativeAudio.length).toBeGreaterThan(0);
        });

        it('should filter out storyboard images (sb*)', () => {
            const parsed = service.parseFormats(mockRawYtDlp);
            const hasSb = parsed.formats.some((f) => f.formatSelection.startsWith('sb'));
            expect(hasSb).toBe(false);
        });
    });

    describe('buildYtDlpArgs', () => {
        it('should build proper args for video + audio with mp4 merge', () => {
            const args = service.buildYtDlpArgs('https://youtube.com/watch?v=123', '137+140', 'video_audio', '/tmp/test.mp4');
            expect(args).toContain('-f');
            expect(args).toContain('137+140');
            expect(args).toContain('--merge-output-format');
            expect(args).toContain('mp4');
            expect(args).toContain('--postprocessor-args');
            expect(args).toContain('Merger:-c:v libx264 -c:a aac -movflags +faststart');
            expect(args).toContain('--no-playlist');
        });

        it('should build proper args for MP3 extraction', () => {
            const args = service.buildYtDlpArgs('https://youtube.com/watch?v=123', 'bestaudio/best', 'audio_only', '/tmp/test.mp3');
            expect(args).toContain('-x');
            expect(args).toContain('--audio-format');
            expect(args).toContain('mp3');
        });

        it('should build proper args for video_only (muted)', () => {
            const args = service.buildYtDlpArgs('https://youtube.com/watch?v=123', '137', 'video_only', '/tmp/test.mp4');
            expect(args).toContain('-f');
            expect(args).toContain('137');
            expect(args).not.toContain('--merge-output-format');
        });
    });

    describe('job tracking in memory (KISS)', () => {
        it('should register a job and track its state', () => {
            // Mock spawn inside service or provide test job
            const job = {
                id: 'test-job-id',
                url: 'https://youtube.com/watch?v=123',
                formatSelection: '18',
                type: 'video_audio' as const,
                title: 'Test Video',
                ext: 'mp4',
                status: 'downloading' as const,
                createdAt: Date.now(),
            };
            (service as any).jobs.set(job.id, job);

            const fetchedJob = service.getJob('test-job-id');
            expect(fetchedJob).toBeDefined();
            expect(fetchedJob?.id).toBe('test-job-id');
            expect(fetchedJob?.status).toBe('downloading');
            expect(fetchedJob?.title).toBe('Test Video');
        });
    });
});
