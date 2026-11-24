import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CobaltProvider } from './cobalt.provider';
import type { DownloadJob } from '../downloads.types';

describe('CobaltProvider', () => {
    let provider: CobaltProvider;
    const originalFetch = global.fetch;

    beforeEach(() => {
        provider = new CobaltProvider();
        process.env.COBALT_API_URL = 'http://cobalt:9000';
        process.env.ENABLE_COBALT = 'true';
    });

    afterEach(() => {
        global.fetch = originalFetch;
        delete process.env.COBALT_API_URL;
        delete process.env.ENABLE_COBALT;
        jest.restoreAllMocks();
    });

    it('should report enabled only when COBALT_API_URL is configured', () => {
        expect(provider.isEnabled()).toBe(true);
        delete process.env.COBALT_API_URL;
        expect(provider.isEnabled()).toBe(false);
    });

    it('should map a Cobalt video tunnel response into VideoMetadata with video/audio options', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                status: 'tunnel',
                url: 'http://cobalt:9000/tunnel?id=123',
                filename: 'tiktok_video_hd.mp4',
            }),
        } as any);

        const meta = await provider.resolveInfo('https://www.tiktok.com/@user/video/123');
        expect(meta.engine).toBe('cobalt');
        expect(meta.mediaType).toBe('video');
        expect(meta.title).toBe('tiktok video hd');
        expect(meta.formats.length).toBe(3);
        expect(meta.formats[0].formatSelection).toBe('cobalt:auto:1080');
        expect(meta.formats[0].engine).toBe('cobalt');
    });

    it('should map a single image redirect into a single image option', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                status: 'redirect',
                url: 'https://cdn.example.com/photo.jpg',
                filename: 'fb_photo.jpg',
            }),
        } as any);

        const meta = await provider.resolveInfo('https://www.facebook.com/photo?fbid=123');
        expect(meta.engine).toBe('cobalt');
        expect(meta.mediaType).toBe('image');
        expect(meta.formats).toHaveLength(1);
        expect(meta.formats[0].type).toBe('image');
        expect(meta.formats[0].ext).toBe('jpg');
    });

    it('should map a multi-item picker into a primary ZIP option plus individual items', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                status: 'picker',
                picker: [
                    { type: 'photo', url: 'https://cdn.example.com/1.jpg', thumb: 'https://cdn.example.com/t1.jpg' },
                    { type: 'photo', url: 'https://cdn.example.com/2.jpg', thumb: 'https://cdn.example.com/t2.jpg' },
                ],
            }),
        } as any);

        const meta = await provider.resolveInfo('https://www.instagram.com/p/abc/');
        expect(meta.engine).toBe('cobalt');
        expect(meta.formats[0].id).toBe('cobalt_picker_zip');
        expect(meta.formats[0].ext).toBe('zip');
        expect(meta.formats).toHaveLength(3); // 1 zip + 2 individual photos
    });

    it('should stream a file to disk and abort if Content-Length exceeds maxDownloadSizeBytes', async () => {
        const tmpFile = path.join(os.tmpdir(), `cobalt_test_${Date.now()}.mp4`);
        const job: DownloadJob = {
            id: 'job-cb-1',
            url: 'https://example.com/video',
            formatSelection: 'cobalt:auto:1080',
            type: 'video_audio',
            title: 'Test',
            ext: 'mp4',
            engine: 'cobalt',
            status: 'downloading',
            filePath: tmpFile,
            createdAt: Date.now(),
        };

        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-length': String(600 * 1024 * 1024) }),
            body: new ReadableStream(),
        } as any);

        await expect(
            provider.downloadToFile(job, {
                formatSelection: 'cobalt:auto:1080',
                type: 'video_audio',
                directUrl: 'http://cobalt:9000/tunnel?id=1',
                maxDownloadSizeBytes: 500 * 1024 * 1024,
                maxDownloadSizeMb: 500,
            }),
        ).rejects.toThrow(/MAX_FILESIZE_EXCEEDED/);

        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    });
});
