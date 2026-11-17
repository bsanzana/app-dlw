import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { SupabaseService } from '../auth/supabase.service';

export const DEFAULT_BANDWIDTH_LIMIT_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

export interface UserUsageRow {
    user_id: string;
    email: string;
    provider: string;
    requests_count: number;
    downloads_count: number;
    bytes_transferred: number;
    bandwidth_limit_bytes: number | null;
    last_active_at: string;
    created_at: string;
}

@Injectable()
export class UsageService {
    private readonly logger = new Logger(UsageService.name);

    constructor(private readonly supabaseService: SupabaseService) {}

    private resolveProvider(user: User): string {
        return (user.app_metadata?.provider as string) || 'email';
    }

    /**
     * Obtiene el límite global de ancho de banda por defecto desde app_settings (default: 10 GB)
     */
    async getDefaultBandwidthLimitBytes(): Promise<number> {
        const client = this.supabaseService.getClient();
        if (!client) return DEFAULT_BANDWIDTH_LIMIT_BYTES;

        try {
            const { data, error } = await client
                .from('app_settings')
                .select('value')
                .eq('key', 'default_bandwidth_limit_bytes')
                .maybeSingle();

            if (error || !data) {
                return DEFAULT_BANDWIDTH_LIMIT_BYTES;
            }

            const parsed = Number(data.value);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BANDWIDTH_LIMIT_BYTES;
        } catch {
            return DEFAULT_BANDWIDTH_LIMIT_BYTES;
        }
    }

    /**
     * Actualiza el límite global de ancho de banda por defecto en app_settings
     */
    async setDefaultBandwidthLimitBytes(limitBytes: number): Promise<number> {
        if (!Number.isFinite(limitBytes) || limitBytes <= 0) {
            throw new HttpException('El límite de ancho de banda debe ser mayor a 0', HttpStatus.BAD_REQUEST);
        }

        const client = this.supabaseService.getClient();
        if (!client) {
            throw new HttpException('Supabase no está configurado', HttpStatus.SERVICE_UNAVAILABLE);
        }

        const rounded = Math.round(limitBytes);
        const { error } = await client.from('app_settings').upsert({
            key: 'default_bandwidth_limit_bytes',
            value: rounded,
            updated_at: new Date().toISOString(),
        });

        if (error) {
            throw new HttpException(`Error al guardar límite global: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }

        return rounded;
    }

    /**
     * Obtiene o crea la fila de métricas del usuario en public.user_usage
     */
    async getOrCreateUserUsage(user: User): Promise<UserUsageRow> {
        const client = this.supabaseService.getClient();
        const fallback: UserUsageRow = {
            user_id: user.id,
            email: user.email || '',
            provider: this.resolveProvider(user),
            requests_count: 0,
            downloads_count: 0,
            bytes_transferred: 0,
            bandwidth_limit_bytes: null,
            last_active_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
        };

        if (!client) return fallback;

        const { data, error } = await client
            .from('user_usage')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();

        if (!error && data) {
            return {
                ...data,
                bytes_transferred: Number(data.bytes_transferred || 0),
                bandwidth_limit_bytes:
                    data.bandwidth_limit_bytes !== null && data.bandwidth_limit_bytes !== undefined
                        ? Number(data.bandwidth_limit_bytes)
                        : null,
            };
        }

        const { data: inserted, error: insertError } = await client
            .from('user_usage')
            .insert({
                user_id: user.id,
                email: user.email || '',
                provider: this.resolveProvider(user),
                requests_count: 0,
                downloads_count: 0,
                bytes_transferred: 0,
                last_active_at: new Date().toISOString(),
            })
            .select('*')
            .single();

        if (insertError || !inserted) {
            this.logger.warn(`No se pudo crear registro user_usage para ${user.email}: ${insertError?.message}`);
            return fallback;
        }

        return {
            ...inserted,
            bytes_transferred: Number(inserted.bytes_transferred || 0),
            bandwidth_limit_bytes:
                inserted.bandwidth_limit_bytes !== null && inserted.bandwidth_limit_bytes !== undefined
                    ? Number(inserted.bandwidth_limit_bytes)
                    : null,
        };
    }

    /**
     * Retorna el estado de cuota de ancho de banda para un usuario autenticado
     */
    async getUserQuotaStatus(user: User) {
        const [usage, defaultLimit] = await Promise.all([
            this.getOrCreateUserUsage(user),
            this.getDefaultBandwidthLimitBytes(),
        ]);

        const bandwidthLimitBytes = usage.bandwidth_limit_bytes ?? defaultLimit;
        const bytesTransferred = usage.bytes_transferred;
        const remainingBytes = Math.max(0, bandwidthLimitBytes - bytesTransferred);

        return {
            authenticated: true,
            email: user.email,
            isAdmin: user.app_metadata?.role === 'admin',
            allowed: bytesTransferred < bandwidthLimitBytes,
            unlimitedRequests: true,
            requestsCount: usage.requests_count,
            downloadsCount: usage.downloads_count,
            bytesTransferred,
            bandwidthLimitBytes,
            remainingBytes,
        };
    }

    /**
     * Valida que el usuario autenticado no haya superado su cuota de ancho de banda
     */
    async checkUserBandwidthQuota(user: User): Promise<void> {
        const status = await this.getUserQuotaStatus(user);
        if (!status.allowed) {
            const limitGb = (status.bandwidthLimitBytes / (1024 ** 3)).toFixed(2);
            throw new HttpException(
                `Has alcanzado tu límite de ancho de banda asignado (${limitGb} GB). Contacta al administrador para ampliarlo.`,
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }
    }

    /**
     * Incrementa el contador de solicitudes del usuario
     */
    async recordRequest(user: User): Promise<void> {
        const client = this.supabaseService.getClient();
        if (!client) return;

        try {
            const current = await this.getOrCreateUserUsage(user);
            await client
                .from('user_usage')
                .update({
                    email: user.email || current.email,
                    provider: this.resolveProvider(user),
                    requests_count: (current.requests_count || 0) + 1,
                    last_active_at: new Date().toISOString(),
                })
                .eq('user_id', user.id);
        } catch (err: any) {
            this.logger.warn(`Error registrando solicitud de usuario: ${err?.message}`);
        }
    }

    /**
     * Incrementa el contador de descargas del usuario
     */
    async recordDownload(user: User): Promise<void> {
        const client = this.supabaseService.getClient();
        if (!client) return;

        try {
            const current = await this.getOrCreateUserUsage(user);
            await client
                .from('user_usage')
                .update({
                    email: user.email || current.email,
                    provider: this.resolveProvider(user),
                    requests_count: (current.requests_count || 0) + 1,
                    downloads_count: (current.downloads_count || 0) + 1,
                    last_active_at: new Date().toISOString(),
                })
                .eq('user_id', user.id);
        } catch (err: any) {
            this.logger.warn(`Error registrando descarga de usuario: ${err?.message}`);
        }
    }

    /**
     * Suma los bytes transferidos al usuario cuando finaliza el stream del archivo
     */
    async recordBandwidth(userId: string, bytes: number): Promise<void> {
        const client = this.supabaseService.getClient();
        if (!client || !userId || bytes <= 0) return;

        try {
            const { data } = await client
                .from('user_usage')
                .select('bytes_transferred')
                .eq('user_id', userId)
                .maybeSingle();

            if (!data) return;

            const newTotal = Number(data.bytes_transferred || 0) + bytes;
            await client
                .from('user_usage')
                .update({
                    bytes_transferred: newTotal,
                    last_active_at: new Date().toISOString(),
                })
                .eq('user_id', userId);
        } catch (err: any) {
            this.logger.warn(`Error registrando ancho de banda para ${userId}: ${err?.message}`);
        }
    }

    /**
     * Asigna un límite personalizado en bytes a un usuario (o null para usar el global)
     */
    async setUserBandwidthLimit(userId: string, limitBytes: number | null): Promise<void> {
        const client = this.supabaseService.getClient();
        if (!client) {
            throw new HttpException('Supabase no está configurado', HttpStatus.SERVICE_UNAVAILABLE);
        }

        if (limitBytes !== null && (!Number.isFinite(limitBytes) || limitBytes <= 0)) {
            throw new HttpException('El límite debe ser mayor a 0 o null para usar el valor global', HttpStatus.BAD_REQUEST);
        }

        const valueToSave = limitBytes === null ? null : Math.round(limitBytes);

        // Asegurar que exista fila en user_usage aunque el usuario aún no haya hecho descargas
        const { data: existing } = await client
            .from('user_usage')
            .select('user_id')
            .eq('user_id', userId)
            .maybeSingle();

        if (!existing) {
            const { data: authData, error: authErr } = await client.auth.admin.getUserById(userId);
            if (authErr || !authData.user) {
                throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);
            }
            await client.from('user_usage').insert({
                user_id: userId,
                email: authData.user.email || '',
                provider: this.resolveProvider(authData.user),
                bandwidth_limit_bytes: valueToSave,
            });
            return;
        }

        const { error } = await client
            .from('user_usage')
            .update({ bandwidth_limit_bytes: valueToSave })
            .eq('user_id', userId);

        if (error) {
            throw new HttpException(`Error al actualizar límite del usuario: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Combina usuarios de Supabase Auth con sus métricas de Postgres para el panel admin
     */
    async getAllUsersWithUsage() {
        const client = this.supabaseService.getClient();
        if (!client) {
            throw new HttpException('Supabase no está configurado', HttpStatus.SERVICE_UNAVAILABLE);
        }

        const [authUsers, usageResult, defaultBandwidthLimitBytes] = await Promise.all([
            this.supabaseService.listAllUsers(),
            client.from('user_usage').select('*'),
            this.getDefaultBandwidthLimitBytes(),
        ]);

        const usageMap = new Map<string, UserUsageRow>();
        for (const row of usageResult.data || []) {
            usageMap.set(row.user_id, row);
        }

        const users = authUsers
            .map((u) => {
                const usage = usageMap.get(u.id);
                const customLimit =
                    usage?.bandwidth_limit_bytes !== null && usage?.bandwidth_limit_bytes !== undefined
                        ? Number(usage.bandwidth_limit_bytes)
                        : null;
                const bytesTransferred = Number(usage?.bytes_transferred || 0);

                return {
                    id: u.id,
                    email: u.email || '',
                    provider: (u.app_metadata?.provider as string) || 'email',
                    role: u.app_metadata?.role === 'admin' ? 'admin' : 'user',
                    createdAt: u.created_at,
                    lastSignInAt: u.last_sign_in_at || null,
                    lastActiveAt: usage?.last_active_at || u.last_sign_in_at || u.created_at,
                    requestsCount: Number(usage?.requests_count || 0),
                    downloadsCount: Number(usage?.downloads_count || 0),
                    bytesTransferred,
                    customBandwidthLimitBytes: customLimit,
                    effectiveBandwidthLimitBytes: customLimit ?? defaultBandwidthLimitBytes,
                };
            })
            .sort((a, b) => {
                const dateA = new Date(a.lastSignInAt || a.createdAt).getTime();
                const dateB = new Date(b.lastSignInAt || b.createdAt).getTime();
                return dateB - dateA;
            });

        const totalRequests = users.reduce((acc, u) => acc + u.requestsCount, 0);
        const totalDownloads = users.reduce((acc, u) => acc + u.downloadsCount, 0);
        const totalBytesTransferred = users.reduce((acc, u) => acc + u.bytesTransferred, 0);

        return {
            defaultBandwidthLimitBytes,
            summary: {
                totalUsers: users.length,
                totalRequests,
                totalDownloads,
                totalBytesTransferred,
            },
            users,
        };
    }
}
