import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    Optional,
    UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

export interface AuthenticatedRequest extends Request {
    user?: User;
}

export function extractBearerToken(req: Request): string | null {
    const authHeader = req.headers?.authorization;
    if (typeof authHeader !== 'string') return null;
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
}

/**
 * Permite peticiones anónimas, pero si incluyen un Bearer token válido adjunta req.user
 */
@Injectable()
export class OptionalSupabaseAuthGuard implements CanActivate {
    constructor(@Optional() private readonly supabaseService?: SupabaseService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (!this.supabaseService) return true;
        const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const token = extractBearerToken(req);

        if (token) {
            const user = await this.supabaseService.verifyToken(token);
            if (user) {
                req.user = user;
            }
        }

        return true;
    }
}

/**
 * Exige una sesión válida de Supabase y rol 'admin' en app_metadata
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
    constructor(private readonly supabaseService: SupabaseService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const token = extractBearerToken(req);

        if (!token) {
            throw new UnauthorizedException('Token de autenticación requerido');
        }

        const user = await this.supabaseService.verifyToken(token);
        if (!user) {
            throw new UnauthorizedException('Sesión inválida o expirada');
        }

        if (user.app_metadata?.role !== 'admin') {
            throw new ForbiddenException('Acceso restringido a administradores');
        }

        req.user = user;
        return true;
    }
}
