import { Module } from '@nestjs/common';
import { DownloadsController } from './downloads.controller';
import { DownloadsService } from './downloads.service';
import { CobaltProvider } from './providers/cobalt.provider';
import { GalleryDlProvider } from './providers/gallery-dl.provider';

@Module({
    controllers: [DownloadsController],
    providers: [DownloadsService, CobaltProvider, GalleryDlProvider],
    exports: [DownloadsService],
})
export class DownloadsModule { }
