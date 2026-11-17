import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
    private readonly logger = new Logger(SupabaseService.name);
    private client: SupabaseClient | null = null;

    constructor() {
        const url = process.env.SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (url && serviceRoleKey) {
            this.client = createClient(url, serviceRoleKey, {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false,
                },
            });
        } else {
            this.logger.warn(
                'SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados. Autenticación y métricas Supabase deshabilitadas.',
            );
        }
    }

    async onModuleInit() {
        await this.seedAdminUser();
    }

    getClient(): SupabaseClient | null {
        return this.client;
    }

    isConfigured(): boolean {
        return this.client !== null;
    }

    /**
     * Crea o asegura el usuario administrador base usando ADMIN_EMAIL y ADMIN_PASSWORD del .env
     */
    async seedAdminUser(): Promise<void> {
        const adminEmail = process.env.ADMIN_EMAIL?.trim();
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!this.client || !adminEmail || !adminPassword) {
            return;
        }

        try {
            const { data: listData, error: listError } = await this.client.auth.admin.listUsers({
                page: 1,
                perPage: 1000,
            });

            if (listError) {
                this.logger.error(`Error listando usuarios para seed admin: ${listError.message}`);
                return;
            }

            const existing = listData.users.find(
                (u) => u.email?.toLowerCase() === adminEmail.toLowerCase(),
            );

            if (!existing) {
                const { error: createError } = await this.client.auth.admin.createUser({
                    email: adminEmail,
                    password: adminPassword,
                    email_confirm: true,
                    app_metadata: { role: 'admin' },
                });

                if (createError) {
                    this.logger.error(`Error creando usuario admin base: ${createError.message}`);
                } else {
                    this.logger.log(`Usuario administrador base creado: ${adminEmail}`);
                }
                return;
            }

            if (existing.app_metadata?.role !== 'admin') {
                const { error: updateError } = await this.client.auth.admin.updateUserById(
                    existing.id,
                    {
                        app_metadata: { ...existing.app_metadata, role: 'admin' },
                    },
                );

                if (updateError) {
                    this.logger.error(`Error asignando rol admin a ${adminEmail}: ${updateError.message}`);
                } else {
                    this.logger.log(`Rol admin asegurado para usuario base: ${adminEmail}`);
                }
            }
        } catch (err: any) {
            this.logger.error(`Fallo inesperado en seedAdminUser: ${err?.message || err}`);
        }
    }

    /**
     * Verifica un JWT de Supabase y devuelve el usuario autenticado o null
     */
    async verifyToken(token: string): Promise<User | null> {
        if (!this.client || !token) return null;

        try {
            const { data, error } = await this.client.auth.getUser(token);
            if (error || !data.user) {
                return null;
            }
            return data.user;
        } catch {
            return null;
        }
    }

    /**
     * Lista todos los usuarios registrados en Supabase Auth
     */
    async listAllUsers(): Promise<User[]> {
        if (!this.client) return [];

        const { data, error } = await this.client.auth.admin.listUsers({
            page: 1,
            perPage: 1000,
        });

        if (error) {
            throw new Error(`Error al listar usuarios de Supabase: ${error.message}`);
        }

        return data.users || [];
    }

    /**
     * Actualiza el rol ('admin' | 'user') en app_metadata de un usuario en Supabase
     */
    async setUserRole(userId: string, role: 'admin' | 'user'): Promise<User> {
        if (!this.client) {
            throw new Error('Supabase no está configurado');
        }

        const { data: userData, error: fetchError } = await this.client.auth.admin.getUserById(userId);
        if (fetchError || !userData.user) {
            throw new Error(fetchError?.message || 'Usuario no encontrado');
        }

        const { data, error } = await this.client.auth.admin.updateUserById(userId, {
            app_metadata: {
                ...userData.user.app_metadata,
                role,
            },
        });

        if (error || !data.user) {
            throw new Error(error?.message || 'No se pudo actualizar el rol del usuario');
        }

        return data.user;
    }
}
