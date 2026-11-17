import { HttpException } from '@nestjs/common';
import { AdminController } from './admin.controller';

describe('AdminController', () => {
    const mockUsageService: any = {
        getAllUsersWithUsage: jest.fn(),
        setDefaultBandwidthLimitBytes: jest.fn(),
        setUserBandwidthLimit: jest.fn(),
    };
    const mockSupabaseService: any = {
        setUserRole: jest.fn(),
    };

    let controller: AdminController;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new AdminController(mockUsageService, mockSupabaseService);
    });

    it('should return users and usage summary', async () => {
        const payload = { defaultBandwidthLimitBytes: 10737418240, summary: { totalUsers: 1 }, users: [] };
        mockUsageService.getAllUsersWithUsage.mockResolvedValue(payload);

        await expect(controller.getUsers()).resolves.toEqual(payload);
    });

    it('should update default bandwidth limit', async () => {
        mockUsageService.setDefaultBandwidthLimitBytes.mockResolvedValue(21474836480);
        await expect(controller.updateDefaultBandwidth(21474836480)).resolves.toEqual({
            defaultBandwidthLimitBytes: 21474836480,
        });
    });

    it('should update user custom bandwidth limit', async () => {
        await expect(controller.updateUserBandwidth('u1', 5368709120)).resolves.toEqual({
            userId: 'u1',
            customBandwidthLimitBytes: 5368709120,
        });
        expect(mockUsageService.setUserBandwidthLimit).toHaveBeenCalledWith('u1', 5368709120);
    });

    it('should prevent admin from removing their own admin role', async () => {
        await expect(
            controller.updateUserRole('admin-1', 'user', { user: { id: 'admin-1' } } as any),
        ).rejects.toThrow(HttpException);
    });

    it('should allow promoting another user to admin', async () => {
        mockSupabaseService.setUserRole.mockResolvedValue({
            id: 'u2',
            email: 'yo@dlw.cl',
            app_metadata: { role: 'admin' },
        });

        const res = await controller.updateUserRole('u2', 'admin', { user: { id: 'admin-1' } } as any);
        expect(res).toEqual({ id: 'u2', email: 'yo@dlw.cl', role: 'admin' });
    });
});
