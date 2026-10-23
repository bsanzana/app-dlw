import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DownloadsModule } from './downloads/downloads.module';

@Module({
  imports: [
    DownloadsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
