import { Test, TestingModule } from '@nestjs/testing';
import { DownloadsController } from './downloads.controller';
import { DownloadsService } from './downloads.service';
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
        getIpQuotaStatus: jest.fn().mockReturnValue({
            ip: '186.20.30.40',
            allowed: true,
            remaining: 2,
            maxPerDay: 2,
        }),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [DownloadsController],
            providers: [
                {
                    provide: DownloadsService,
                    useValue: mockDownloadsService,
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
        it('should return quota status for the requesting IP', () => {
            const req: any = { headers: {} };
            const result = controller.getQuota(req);
            expect(result).toBeDefined();
            expect(result.ip).toBe('186.20.30.40');
            expect(result.remaining).toBe(2);
            expect(mockDownloadsService.extractClientIp).toHaveBeenCalledWith(req);
            expect(mockDownloadsService.getIpQuotaStatus).toHaveBeenCalledWith('186.20.30.40');
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

        it('should validate quota, start download and pass clientIp', async () => {
            mockDownloadsService.startDownload.mockReturnValue({ jobId: 'job-123' });

            const req: any = { headers: { 'x-real-ip': '186.20.30.40' } };
            const result = await controller.startDownload(
                'https://youtube.com/watch?v=abc',
                '137+140',
                'video_audio',
                'Mi Video',
                req,
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
    });
});
