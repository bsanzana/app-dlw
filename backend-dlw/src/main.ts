import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Confiar en el proxy inverso (Nginx) para obtener la IP real del cliente vía X-Forwarded-For
  app.set('trust proxy', true);

  app.setGlobalPrefix('api');
  app.enableCors({ origin: '*' });
  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on http://0.0.0.0:${port}/api`);
}
bootstrap();
