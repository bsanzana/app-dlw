import { Test, TestingModule } from '@nestjs/testing';
import { DownloadsController } from './downloads.controller';
import { DownloadsService } from './downloads.service';
import { UsageService } from '../usage/usage.service';
import { HttpException, HttpStatus } from '@nestjs/common';

describe('DownloadsController', () => {
    let controller: DownloadsController;
    let service: DownloadsService;

    const mockDownloadsService = {
        getMetadata: jest.fn(),
        startDownload: jest.fn(),
        getJob: jest.fn(),
        cleanupFile: jest.fn(),
        extractClientIp: jest.fn().mockReturnValue('186.20.30.40'),
        checkAndIncrementIpQuota: jest.fn(),
        maxDownloadSizeMb: 500,
        getIpQuotaStatus: jest.fn().mockReturnValue({
            ip: '186.20.30.40',
            allowed: true,
            remaining: 2,
            maxPerDay: 2,
        }),
    };

    const mockUsageService = {
        getUserQuotaStatus: jest.fn(),
        checkUserBandwidthQuota: jest.fn(),
        recordRequest: jest.fn(),
        recordDownload: jest.fn(),
        recordBandwidth: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [DownloadsController],
            providers: [
                {
                    provide: DownloadsService,
                    useValue: mockDownloadsService,
                },
                {
                    provide: UsageService,
                    useValue: mockUsageService,
                },
            ],
        }).compile();

        controller = module.get<DownloadsController>(DownloadsController);
        service = module.get<DownloadsService>(DownloadsService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('getQuota', () => {
        it('should return quota status for the requesting IP when anonymous', async () => {
            const req: any = { headers: {} };
            const result = await controller.getQuota(req);
            expect(result).toBeDefined();
            expect(result.ip).toBe('186.20.30.40');
            expect(result.remaining).toBe(2);
            expect(mockDownloadsService.extractClientIp).toHaveBeenCalledWith(req);
            expect(mockDownloadsService.getIpQuotaStatus).toHaveBeenCalledWith('186.20.30.40');
        });

        it('should return user bandwidth quota when authenticated', async () => {
            mockUsageService.getUserQuotaStatus.mockResolvedValue({
                authenticated: true,
                email: 'user@dlw.cl',
                allowed: true,
                unlimitedRequests: true,
                bytesTransferred: 0,
                bandwidthLimitBytes: 10737418240,
            });

            const req: any = { headers: {}, user: { id: 'u1', email: 'user@dlw.cl' } };
            const result: any = await controller.getQuota(req);
            expect(result.authenticated).toBe(true);
            expect(result.maxDownloadSizeMb).toBe(500);
            expect(mockUsageService.getUserQuotaStatus).toHaveBeenCalledWith(req.user);
        });
    });

    describe('getInfo', () => {
        it('should throw 400 when url is empty or invalid', async () => {
            await expect(controller.getInfo('')).rejects.toThrow(HttpException);
            await expect(controller.getInfo('   ')).rejects.toThrow(HttpException);
        });

        it('should return metadata on success', async () => {
            const mockMeta = { id: 'abc', title: 'Video', formats: [] };
            mockDownloadsService.getMetadata.mockResolvedValue(mockMeta);

            const result = await controller.getInfo('https://youtube.com/watch?v=abc');
            expect(result).toEqual(mockMeta);
            expect(mockDownloadsService.getMetadata).toHaveBeenCalledWith('https://youtube.com/watch?v=abc');
        });
    });

    describe('startDownload', () => {
        it('should throw 400 when url or formatSelection is missing', async () => {
            await expect(controller.startDownload('', '18', 'video_audio', 'Test')).rejects.toThrow(HttpException);
            await expect(controller.startDownload('https://youtube.com', '', 'video_audio', 'Test')).rejects.toThrow(HttpException);
        });

        it('should validate quota, start download and pass clientIp and codecs', async () => {
            mockDownloadsService.startDownload.mockReturnValue({ jobId: 'job-123' });

            const req: any = { headers: { 'x-real-ip': '186.20.30.40' } };
            const result = await controller.startDownload(
                'https://youtube.com/watch?v=abc',
                '137+140',
                'video_audio',
                'Mi Video',
                req,
                'avc1.640028',
                'mp4a.40.2',
            );

            expect(result).toEqual({ jobId: 'job-123' });
            expect(mockDownloadsService.extractClientIp).toHaveBeenCalledWith(req);
            expect(mockDownloadsService.checkAndIncrementIpQuota).toHaveBeenCalledWith('186.20.30.40');
            expect(mockDownloadsService.startDownload).toHaveBeenCalledWith(
                'https://youtube.com/watch?v=abc',
                '137+140',
                'video_audio',
                'Mi Video',
                '186.20.30.40',
                'avc1.640028',
                'mp4a.40.2',
                undefined,
            );
        });

        it('should bypass IP quota and enforce bandwidth quota for authenticated users', async () => {
            mockDownloadsService.startDownload.mockReturnValue({ jobId: 'job-auth' });
            const req: any = {
                headers: {},
                user: { id: 'u-auth', email: 'auth@dlw.cl' },
            };

            const result = await controller.startDownload(
                'https://youtube.com/watch?v=abc',
                '137+140',
                'video_audio',
                'Mi Video',
                req,
                'avc1.640028',
                'mp4a.40.2',
            );

            expect(result).toEqual({ jobId: 'job-auth' });
            expect(mockDownloadsService.checkAndIncrementIpQuota).not.toHaveBeenCalled();
            expect(mockUsageService.checkUserBandwidthQuota).toHaveBeenCalledWith(req.user);
            expect(mockUsageService.recordDownload).toHaveBeenCalledWith(req.user);
            expect(mockDownloadsService.startDownload).toHaveBeenCalledWith(
                'https://youtube.com/watch?v=abc',
                '137+140',
                'video_audio',
                'Mi Video',
                '186.20.30.40',
                'avc1.640028',
                'mp4a.40.2',
                'u-auth',
            );
        });
    });

    describe('getJobStatus', () => {
        it('should throw 404 when job does not exist', () => {
            mockDownloadsService.getJob.mockReturnValue(undefined);
            expect(() => controller.getJobStatus('not-found')).toThrow(HttpException);
        });

        it('should return job status when job exists', () => {
            mockDownloadsService.getJob.mockReturnValue({
                id: 'job-123',
                status: 'downloading',
                title: 'Test',
                ext: 'mp4',
            });

            const result = controller.getJobStatus('job-123');
            expect(result).toEqual({
                id: 'job-123',
                status: 'downloading',
                progressPercent: 0,
                downloadSpeed: null,
                eta: null,
                totalBytes: null,
                error: undefined,
                title: 'Test',
                ext: 'mp4',
            });
        });

        it('should return processing status while post-processing on server', () => {
            mockDownloadsService.getJob.mockReturnValue({
                id: 'job-456',
                status: 'processing',
                progressPercent: 100,
                title: 'Test',
                ext: 'mp4',
            });

            const result = controller.getJobStatus('job-456');
            expect(result.status).toBe('processing');
            expect(result.progressPercent).toBe(100);
        });
    });

    describe('startDownload with extra engine options', () => {
        it('should forward engine, itemIndex, directUrl and ext when provided', async () => {
            mockDownloadsService.startDownload.mockReturnValue({ jobId: 'job-gdl-1' });
            const req: any = { headers: { 'x-real-ip': '186.20.30.40' } };

            const result = await controller.startDownload(
                'https://www.facebook.com/photo/?fbid=123',
                'gallery:all:zip',
                'image',
                'Album FB',
                req,
                undefined,
                undefined,
                'gallery_dl',
                1,
                'https://scontent.fbcdn.net/1.jpg',
                'zip',
            );

            expect(result).toEqual({ jobId: 'job-gdl-1' });
            expect(mockDownloadsService.startDownload).toHaveBeenCalledWith(
                'https://www.facebook.com/photo/?fbid=123',
                'gallery:all:zip',
                'image',
                'Album FB',
                '186.20.30.40',
                undefined,
                undefined,
                undefined,
                {
                    engine: 'gallery_dl',
                    itemIndex: 1,
                    directUrl: 'https://scontent.fbcdn.net/1.jpg',
                    ext: 'zip',
                },
            );
        });
    });
});
