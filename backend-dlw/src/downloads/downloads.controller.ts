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
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import { DownloadsService } from './downloads.service';
import type { FormatType } from './downloads.service';

@Controller('downloads')
export class DownloadsController {
    private readonly logger = new Logger(DownloadsController.name);

    constructor(private readonly downloadsService: DownloadsService) { }

    /**
     * GET /downloads/quota
     * Returns remaining download quota and bandwidth limits for the caller's IP
     */
    @Get('quota')
    getQuota(@Req() req: Request) {
        const clientIp = this.downloadsService.extractClientIp(req);
        return this.downloadsService.getIpQuotaStatus(clientIp);
    }

    /**
     * POST /downloads/info
     * Fetches metadata and full list of available format combinations
     */
    @Post('info')
    async getInfo(@Body('url') url: string) {
        if (!url || typeof url !== 'string' || !url.trim()) {
            throw new HttpException('La URL es requerida', HttpStatus.BAD_REQUEST);
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
        @Req() req?: Request,
    ) {
        if (!url || !formatSelection) {
            throw new HttpException(
                'Se requieren url y formatSelection',
                HttpStatus.BAD_REQUEST,
            );
        }

        const clientIp = this.downloadsService.extractClientIp(req);

        // Validar y consumir cuota diaria por IP para proteger el ancho de banda
        this.downloadsService.checkAndIncrementIpQuota(clientIp);

        const validTypes: FormatType[] = ['video_audio', 'video_only', 'audio_only'];
        const resolvedType = validTypes.includes(type) ? type : 'video_audio';

        return this.downloadsService.startDownload(
            url.trim(),
            formatSelection,
            resolvedType,
            title || 'video',
            clientIp,
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
