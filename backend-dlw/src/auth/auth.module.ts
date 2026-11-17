import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { AdminAuthGuard, OptionalSupabaseAuthGuard } from './auth.guards';

@Global()
@Module({
    providers: [SupabaseService, OptionalSupabaseAuthGuard, AdminAuthGuard],
    exports: [SupabaseService, OptionalSupabaseAuthGuard, AdminAuthGuard],
})
export class AuthModule {}
