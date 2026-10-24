import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DownloadsService } from './downloads.service';
import { HttpException, HttpStatus } from '@nestjs/common';

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
            { format_id: '18', ext: 'mp4', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', height: 360, fps: 30, tbr: 450, filesize: 25000000 },
            // DASH Video only streams
            { format_id: '136', ext: 'mp4', vcodec: 'avc1.4D401F', acodec: 'none', height: 720, fps: 30, tbr: 1200, filesize: 80000000 },
            { format_id: '137', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', height: 1080, fps: 30, tbr: 3000, filesize: 200000000 },
            { format_id: '248', ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 1080, fps: 30, tbr: 1500, filesize: 180000000 },
            // Format exceeding 500 MB (600,000,000 bytes) -> should be filtered out
            { format_id: '999', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', height: 2160, fps: 60, tbr: 25000, filesize: 600000000 },
        ],
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [DownloadsService],
        }).compile();

        service = module.get<DownloadsService>(DownloadsService);
        // Clean memory ipQuotas
        (service as any).ipQuotas.clear();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('parseFormats', () => {
        it('should correctly parse and classify formats and filter out formats exceeding 500 MB', () => {
            const parsed = service.parseFormats(mockRawYtDlp);

            expect(parsed.id).toBe('test_video_123');
            expect(parsed.title).toBe('Video de Prueba HD');
            expect(parsed.duration).toBe(215);

            // Group by type
            const videoAudio = parsed.formats.filter((f) => f.type === 'video_audio');
            const videoOnly = parsed.formats.filter((f) => f.type === 'video_only');
            const audioOnly = parsed.formats.filter((f) => f.type === 'audio_only');

            // Format 999 (> 500MB) must NOT exist in parsed formats
            const hugeFormat = parsed.formats.find((f) => f.formatSelection.includes('999'));
            expect(hugeFormat).toBeUndefined();

            // 1. Video + Audio combinations
            expect(videoAudio.length).toBeGreaterThan(0);
            const heights = videoAudio.map((f) => f.height);
            expect(heights).toContain(1080);
            expect(heights).toContain(720);
            expect(heights).toContain(360);

            // 2. Video Only (Mute / without audio)
            expect(videoOnly.length).toBeGreaterThan(0);
            const vo1080 = videoOnly.find((f) => f.height === 1080);
            expect(vo1080).toBeDefined();
            expect(vo1080?.hasAudio).toBe(false);

            // 3. Audio Only
            expect(audioOnly.length).toBeGreaterThan(0);
            const mp3Option = audioOnly.find((f) => f.id === 'ao_mp3_best');
            expect(mp3Option).toBeDefined();
            expect(mp3Option?.ext).toBe('mp3');
        });

        it('should filter out storyboard images (sb*)', () => {
            const parsed = service.parseFormats(mockRawYtDlp);
            const hasSb = parsed.formats.some((f) => f.formatSelection.startsWith('sb'));
            expect(hasSb).toBe(false);
        });

        it('should throw an error if all available formats exceed 500 MB', () => {
            const hugeVideo = {
                id: 'huge_123',
                title: 'Huge 8K Video',
                duration: 600,
                formats: [
                    { format_id: 'h1', ext: 'mp4', height: 4320, filesize: 600000000 },
                ],
            };

            expect(() => service.parseFormats(hugeVideo)).toThrow(
                /El video excede el límite máximo de descarga permitido/,
            );
        });
    });

    describe('buildYtDlpArgs', () => {
        it('should enforce --max-filesize 500M', () => {
            const args = service.buildYtDlpArgs('https://youtube.com/watch?v=123', '137+140', 'video_audio', '/tmp/test.mp4');
            expect(args).toContain('--max-filesize');
            expect(args).toContain('500M');
        });

        it('should build proper args for video + audio with mp4 merge', () => {
            const args = service.buildYtDlpArgs('https://youtube.com/watch?v=123', '137+140', 'video_audio', '/tmp/test.mp4');
            expect(args).toContain('-f');
            expect(args).toContain('137+140');
            expect(args).toContain('--merge-output-format');
            expect(args).toContain('mp4');
            expect(args).toContain('--postprocessor-args');
            expect(args).toContain('Merger:-c:v libx264 -c:a aac -movflags +faststart');
            expect(args).toContain('--no-playlist');
            expect(args).toContain('--remote-components');
            expect(args).toContain('ejs:github');
            expect(args).toContain('--extractor-args');
            expect(args).toContain('youtube:player-client=mweb,tv,web_safari');
        });

        it('should include pot provider url if POT_PROVIDER_URL env is set', () => {
            process.env.POT_PROVIDER_URL = 'http://dlw_pot_provider:4416';
            const args = service.buildYtDlpArgs('https://youtube.com/watch?v=123', '137+140', 'video_audio', '/tmp/test.mp4');
            expect(args).toContain('youtubepot-bgutilhttp:base_url=http://dlw_pot_provider:4416');
            delete process.env.POT_PROVIDER_URL;
        });

        it('should include proxy if PROXY_URL env is set', () => {
            process.env.PROXY_URL = 'http://proxy.test:8080';
            const args = service.buildYtDlpArgs('https://youtube.com/watch?v=123', '137+140', 'video_audio', '/tmp/test.mp4');
            expect(args).toContain('--proxy');
            expect(args).toContain('http://proxy.test:8080');
            delete process.env.PROXY_URL;
        });

        it('should include cookies only if cookies file exists', () => {
            const tmpCookiePath = path.join(os.tmpdir(), 'test_burner_cookies.txt');
            fs.writeFileSync(tmpCookiePath, '# Netscape HTTP Cookie File');
            process.env.COOKIES_PATH = tmpCookiePath;

            const args = service.buildYtDlpArgs('https://youtube.com/watch?v=123', '137+140', 'video_audio', '/tmp/test.mp4');
            expect(args).toContain('--cookies');
            expect(args).toContain(path.join(os.tmpdir(), 'yt-dlp-cookies.txt'));

            fs.unlinkSync(tmpCookiePath);
            delete process.env.COOKIES_PATH;
        });
    });

    describe('IP Daily Download Quota (Ancho de Banda)', () => {
        it('should allow 2 downloads per IP and block the 3rd with 429 Too Many Requests', () => {
            const ip = '190.160.10.25';

            // 1st download: allowed
            expect(() => service.checkAndIncrementIpQuota(ip)).not.toThrow();
            const status1 = service.getIpQuotaStatus(ip);
            expect(status1.remaining).toBe(1);
            expect(status1.allowed).toBe(true);

            // 2nd download: allowed
            expect(() => service.checkAndIncrementIpQuota(ip)).not.toThrow();
            const status2 = service.getIpQuotaStatus(ip);
            expect(status2.remaining).toBe(0);
            expect(status2.allowed).toBe(false);

            // 3rd download: rejected with 429
            expect(() => service.checkAndIncrementIpQuota(ip)).toThrow(HttpException);
            try {
                service.checkAndIncrementIpQuota(ip);
            } catch (err: any) {
                expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
                expect(err.message).toBe('Has alcanzado el límite de descargas diario.');
            }
        });

        it('should refund quota on job failure so allowance is not lost', () => {
            const ip = '200.50.10.15';

            service.checkAndIncrementIpQuota(ip);
            service.checkAndIncrementIpQuota(ip);
            expect(service.getIpQuotaStatus(ip).remaining).toBe(0);

            // Refund 1 download
            service.refundIpQuota(ip);
            expect(service.getIpQuotaStatus(ip).remaining).toBe(1);

            // User can download again
            expect(() => service.checkAndIncrementIpQuota(ip)).not.toThrow();
        });

        it('should accurately extract client IP handling Cloudflare and proxy headers', () => {
            // CF-Connecting-IP takes precedence
            const cfReq = { headers: { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' } };
            expect(service.extractClientIp(cfReq)).toBe('1.1.1.1');

            // X-Forwarded-For with multiple IPs takes first client IP
            const proxyReq = { headers: { 'x-forwarded-for': '181.42.10.5, 10.0.0.1' } };
            expect(service.extractClientIp(proxyReq)).toBe('181.42.10.5');

            // X-Real-IP fallback
            const realIpReq = { headers: { 'x-real-ip': '190.10.20.30' } };
            expect(service.extractClientIp(realIpReq)).toBe('190.10.20.30');

            // Direct socket fallback
            const directReq = { ip: '127.0.0.1' };
            expect(service.extractClientIp(directReq)).toBe('127.0.0.1');
        });
    });

    describe('Concurrency and Limits', () => {
        it('should reject starting download if max concurrent limit is reached', () => {
            for (let i = 0; i < 3; i++) {
                (service as any).jobs.set(`job-${i}`, {
                    id: `job-${i}`,
                    status: 'downloading',
                    createdAt: Date.now(),
                });
            }

            expect(() => {
                service.startDownload('https://youtube.com/watch?v=123', '18', 'video_audio', 'Test');
            }).toThrow(HttpException);
        });
    });
});
