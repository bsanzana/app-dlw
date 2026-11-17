import {
    Controller,
    Post,
    Body,
    Get,
    Param,
    Res,
    Req,
    HttpException,
    HttpStatus,
    Logger,
    Optional,
    UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { DownloadsService } from './downloads.service';
import type { FormatType } from './downloads.service';
import { OptionalSupabaseAuthGuard, type AuthenticatedRequest } from '../auth/auth.guards';
import { UsageService } from '../usage/usage.service';

@Controller('downloads')
@UseGuards(OptionalSupabaseAuthGuard)
export class DownloadsController {
    private readonly logger = new Logger(DownloadsController.name);

    constructor(
        private readonly downloadsService: DownloadsService,
        @Optional() private readonly usageService?: UsageService,
    ) { }

    /**
     * GET /downloads/quota
     * Returns remaining download quota and bandwidth limits for the authenticated user or caller's IP
     */
    @Get('quota')
    async getQuota(@Req() req: AuthenticatedRequest) {
        if (req?.user && this.usageService) {
            const userQuota = await this.usageService.getUserQuotaStatus(req.user);
            return {
                ...userQuota,
                maxDownloadSizeMb: this.downloadsService.maxDownloadSizeMb,
            };
        }

        const clientIp = this.downloadsService.extractClientIp(req);
        return this.downloadsService.getIpQuotaStatus(clientIp);
    }

    /**
     * POST /downloads/info
     * Fetches metadata and full list of available format combinations
     */
    @Post('info')
    async getInfo(@Body('url') url: string, @Req() req?: AuthenticatedRequest) {
        if (!url || typeof url !== 'string' || !url.trim()) {
            throw new HttpException('La URL es requerida', HttpStatus.BAD_REQUEST);
        }

        if (req?.user && this.usageService) {
            await this.usageService.recordRequest(req.user);
        }

        try {
            return await this.downloadsService.getMetadata(url.trim());
        } catch (error) {
            this.logger.error(`Error al obtener información del video: ${error.message}`);
            throw new HttpException(
                error.message || 'Error al obtener información del video',
                HttpStatus.BAD_REQUEST,
            );
        }
    }

    /**
     * POST /downloads/start
     * Starts download in background and returns a jobId
     * Validates and increments daily download quota for the caller IP (max 2 per day)
     */
    @Post('start')
    async startDownload(
        @Body('url') url: string,
        @Body('formatSelection') formatSelection: string,
        @Body('type') type: FormatType,
        @Body('title') title: string,
        @Req() req?: AuthenticatedRequest,
        @Body('vcodec') vcodec?: string,
        @Body('acodec') acodec?: string,
    ) {
        if (!url || !formatSelection) {
            throw new HttpException(
                'Se requieren url y formatSelection',
                HttpStatus.BAD_REQUEST,
            );
        }

        const clientIp = this.downloadsService.extractClientIp(req);

        if (req?.user && this.usageService) {
            // Usuario autenticado: sin límite de descargas/día por IP, sujeto a cuota de ancho de banda (default 10 GB)
            await this.usageService.checkUserBandwidthQuota(req.user);
            await this.usageService.recordDownload(req.user);
        } else {
            // Usuario anónimo: validar y consumir cuota diaria por IP (2/día)
            this.downloadsService.checkAndIncrementIpQuota(clientIp);
        }

        const validTypes: FormatType[] = ['video_audio', 'video_only', 'audio_only'];
        const resolvedType = validTypes.includes(type) ? type : 'video_audio';

        return this.downloadsService.startDownload(
            url.trim(),
            formatSelection,
            resolvedType,
            title || 'video',
            clientIp,
            vcodec,
            acodec,
            req?.user?.id,
        );
    }

    /**
     * GET /downloads/:jobId/status
     * Returns job progress / completion / error state
     */
    @Get(':jobId/status')
    getJobStatus(@Param('jobId') jobId: string) {
        const job = this.downloadsService.getJob(jobId);
        if (!job) {
            throw new HttpException('Tarea no encontrada', HttpStatus.NOT_FOUND);
        }

        return {
            id: job.id,
            status: job.status,
            progressPercent: job.progressPercent || 0,
            downloadSpeed: job.downloadSpeed || null,
            eta: job.eta || null,
            totalBytes: job.totalBytes || null,
            error: job.error,
            title: job.title,
            ext: job.ext,
        };
    }

    /**
     * GET /downloads/:jobId/file
     * Serves the downloaded file and cleans up afterwards
     */
    @Get(':jobId/file')
    async downloadFile(
        @Param('jobId') jobId: string,
        @Res() res: Response,
    ) {
        const job = this.downloadsService.getJob(jobId);

        if (!job) {
            throw new HttpException('Tarea no encontrada', HttpStatus.NOT_FOUND);
        }

        if (job.status !== 'completed' || !job.filePath || !fs.existsSync(job.filePath)) {
            throw new HttpException(
                'El archivo aún no está listo o ha expirado',
                HttpStatus.BAD_REQUEST,
            );
        }

        const stat = fs.statSync(job.filePath);

        // Verificar que el archivo no supere el límite máximo de tamaño
        if (stat.size > this.downloadsService.maxDownloadSizeBytes) {
            this.downloadsService.cleanupFile(job.filePath);
            throw new HttpException(
                `El archivo excede el tamaño máximo permitido de ${this.downloadsService.maxDownloadSizeMb} MB`,
                HttpStatus.BAD_REQUEST,
            );
        }

        const sanitizedTitle = (job.title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `${sanitizedTitle}.${job.ext}`;

        const contentType = job.ext === 'mp3' ? 'audio/mpeg' : 'video/mp4';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', stat.size);

        const readStream = fs.createReadStream(job.filePath);
        readStream.pipe(res);

        res.on('finish', () => {
            this.logger.log(`Stream finalizado para tarea ${jobId}. Limpiando archivo.`);
            if (job.userId && this.usageService) {
                void this.usageService.recordBandwidth(job.userId, stat.size);
            }
            this.downloadsService.cleanupFile(job.filePath);
        });

        res.on('close', () => {
            // Si el cliente canceló la descarga antes de completarse
            if (!res.writableEnded) {
                this.logger.warn(`Conexión cerrada por el cliente para tarea ${jobId}. Limpiando archivo.`);
                this.downloadsService.cleanupFile(job.filePath);
            }
        });
    }
}
