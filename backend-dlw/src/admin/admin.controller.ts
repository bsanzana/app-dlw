import {
    Body,
    Controller,
    Get,
    HttpException,
    HttpStatus,
    Param,
    Patch,
    Req,
    UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard, type AuthenticatedRequest } from '../auth/auth.guards';
import { SupabaseService } from '../auth/supabase.service';
import { UsageService } from '../usage/usage.service';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
    constructor(
        private readonly usageService: UsageService,
        private readonly supabaseService: SupabaseService,
    ) {}

    /**
     * GET /api/admin/users
     * Lista usuarios registrados/loggeados con solicitudes, ancho de banda y límites
     */
    @Get('users')
    async getUsers() {
        return this.usageService.getAllUsersWithUsage();
    }

    /**
     * PATCH /api/admin/settings/bandwidth
     * Modifica el límite global de ancho de banda por defecto (en bytes)
     */
    @Patch('settings/bandwidth')
    async updateDefaultBandwidth(@Body('limitBytes') limitBytes: number) {
        const updated = await this.usageService.setDefaultBandwidthLimitBytes(Number(limitBytes));
        return { defaultBandwidthLimitBytes: updated };
    }

    /**
     * PATCH /api/admin/users/:userId/bandwidth
     * Modifica el límite de ancho de banda de un usuario específico (o null para usar el global)
     */
    @Patch('users/:userId/bandwidth')
    async updateUserBandwidth(
        @Param('userId') userId: string,
        @Body('limitBytes') limitBytes: number | null,
    ) {
        const parsed = limitBytes === null || limitBytes === undefined ? null : Number(limitBytes);
        await this.usageService.setUserBandwidthLimit(userId, parsed);
        return { userId, customBandwidthLimitBytes: parsed };
    }

    /**
     * PATCH /api/admin/users/:userId/role
     * Asigna o quita el rol de administrador a un usuario
     */
    @Patch('users/:userId/role')
    async updateUserRole(
        @Param('userId') userId: string,
        @Body('role') role: 'admin' | 'user',
        @Req() req: AuthenticatedRequest,
    ) {
        if (role !== 'admin' && role !== 'user') {
            throw new HttpException("Rol inválido. Debe ser 'admin' o 'user'", HttpStatus.BAD_REQUEST);
        }

        if (req.user?.id === userId && role !== 'admin') {
            throw new HttpException(
                'No puedes quitarte el rol de administrador a ti mismo',
                HttpStatus.BAD_REQUEST,
            );
        }

        const updated = await this.supabaseService.setUserRole(userId, role);
        return {
            id: updated.id,
            email: updated.email,
            role: updated.app_metadata?.role === 'admin' ? 'admin' : 'user',
        };
    }
}
