import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminAuthGuard, OptionalSupabaseAuthGuard } from './auth.guards';

describe('Auth Guards', () => {
    const createContext = (headers: Record<string, string> = {}) => {
        const req: any = { headers };
        return {
            req,
            ctx: {
                switchToHttp: () => ({
                    getRequest: () => req,
                }),
            } as any,
        };
    };

    describe('OptionalSupabaseAuthGuard', () => {
        it('should allow anonymous requests without token', async () => {
            const supabaseService: any = { verifyToken: jest.fn() };
            const guard = new OptionalSupabaseAuthGuard(supabaseService);
            const { req, ctx } = createContext();

            await expect(guard.canActivate(ctx)).resolves.toBe(true);
            expect(req.user).toBeUndefined();
            expect(supabaseService.verifyToken).not.toHaveBeenCalled();
        });

        it('should attach req.user when Bearer token is valid', async () => {
            const mockUser = { id: 'u1', email: 'user@dlw.cl' };
            const supabaseService: any = { verifyToken: jest.fn().mockResolvedValue(mockUser) };
            const guard = new OptionalSupabaseAuthGuard(supabaseService);
            const { req, ctx } = createContext({ authorization: 'Bearer my-jwt' });

            await expect(guard.canActivate(ctx)).resolves.toBe(true);
            expect(req.user).toEqual(mockUser);
        });
    });

    describe('AdminAuthGuard', () => {
        it('should throw UnauthorizedException when token is missing', async () => {
            const guard = new AdminAuthGuard({ verifyToken: jest.fn() } as any);
            const { ctx } = createContext();
            await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
        });

        it('should throw ForbiddenException when user is not admin', async () => {
            const supabaseService: any = {
                verifyToken: jest.fn().mockResolvedValue({
                    id: 'u1',
                    email: 'user@dlw.cl',
                    app_metadata: { role: 'user' },
                }),
            };
            const guard = new AdminAuthGuard(supabaseService);
            const { ctx } = createContext({ authorization: 'Bearer user-jwt' });

            await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
        });

        it('should allow admin user', async () => {
            const adminUser = {
                id: 'a1',
                email: 'admin@dlw.cl',
                app_metadata: { role: 'admin' },
            };
            const supabaseService: any = {
                verifyToken: jest.fn().mockResolvedValue(adminUser),
            };
            const guard = new AdminAuthGuard(supabaseService);
            const { req, ctx } = createContext({ authorization: 'Bearer admin-jwt' });

            await expect(guard.canActivate(ctx)).resolves.toBe(true);
            expect(req.user).toEqual(adminUser);
        });
    });
});
