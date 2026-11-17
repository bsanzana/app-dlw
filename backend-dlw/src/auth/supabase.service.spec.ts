import { SupabaseService } from './supabase.service';

describe('SupabaseService', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        delete process.env.SUPABASE_URL;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        delete process.env.ADMIN_EMAIL;
        delete process.env.ADMIN_PASSWORD;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('should handle missing Supabase env vars gracefully', async () => {
        const service = new SupabaseService();
        expect(service.isConfigured()).toBe(false);
        expect(await service.verifyToken('abc')).toBeNull();
        expect(await service.listAllUsers()).toEqual([]);
        await expect(service.seedAdminUser()).resolves.toBeUndefined();
    });

    it('should seed base admin user when ADMIN_EMAIL and ADMIN_PASSWORD are set and user does not exist', async () => {
        process.env.ADMIN_EMAIL = 'admin@dlw.cl';
        process.env.ADMIN_PASSWORD = 'super-secret-password';

        const service = new SupabaseService();
        const mockAdmin = {
            listUsers: jest.fn().mockResolvedValue({ data: { users: [] }, error: null }),
            createUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
            updateUserById: jest.fn(),
        };
        (service as any).client = { auth: { admin: mockAdmin } };

        await service.seedAdminUser();

        expect(mockAdmin.createUser).toHaveBeenCalledWith({
            email: 'admin@dlw.cl',
            password: 'super-secret-password',
            email_confirm: true,
            app_metadata: { role: 'admin' },
        });
    });

    it('should upgrade existing user to admin role if missing', async () => {
        process.env.ADMIN_EMAIL = 'admin@dlw.cl';
        process.env.ADMIN_PASSWORD = 'super-secret-password';

        const service = new SupabaseService();
        const mockAdmin = {
            listUsers: jest.fn().mockResolvedValue({
                data: {
                    users: [{ id: 'u1', email: 'admin@dlw.cl', app_metadata: { provider: 'email' } }],
                },
                error: null,
            }),
            createUser: jest.fn(),
            updateUserById: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
        };
        (service as any).client = { auth: { admin: mockAdmin } };

        await service.seedAdminUser();

        expect(mockAdmin.createUser).not.toHaveBeenCalled();
        expect(mockAdmin.updateUserById).toHaveBeenCalledWith('u1', {
            app_metadata: { provider: 'email', role: 'admin' },
        });
    });

    it('should verify valid token and return user', async () => {
        const service = new SupabaseService();
        const mockUser = { id: 'u-123', email: 'test@dlw.cl' };
        (service as any).client = {
            auth: {
                getUser: jest.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
            },
        };

        const user = await service.verifyToken('valid-jwt');
        expect(user).toEqual(mockUser);
    });
});
