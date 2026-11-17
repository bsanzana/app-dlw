import { HttpException, HttpStatus } from '@nestjs/common';
import { DEFAULT_BANDWIDTH_LIMIT_BYTES, UsageService } from './usage.service';

describe('UsageService', () => {
    const mockUser: any = {
        id: 'user-1',
        email: 'usuario@dlw.cl',
        app_metadata: { provider: 'google', role: 'user' },
    };

    it('should default user bandwidth limit to 10 GB and allow downloads below limit', async () => {
        const mockSupabase: any = {
            getClient: () => null,
        };
        const service = new UsageService(mockSupabase);

        const status = await service.getUserQuotaStatus(mockUser);
        expect(status.bandwidthLimitBytes).toBe(DEFAULT_BANDWIDTH_LIMIT_BYTES);
        expect(status.unlimitedRequests).toBe(true);
        expect(status.allowed).toBe(true);
    });

    it('should throw 429 when user exceeds assigned bandwidth quota', async () => {
        const mockSupabase: any = {
            getClient: () => null,
        };
        const service = new UsageService(mockSupabase);

        jest.spyOn(service, 'getUserQuotaStatus').mockResolvedValue({
            authenticated: true,
            email: mockUser.email,
            isAdmin: false,
            allowed: false,
            unlimitedRequests: true,
            requestsCount: 15,
            downloadsCount: 10,
            bytesTransferred: DEFAULT_BANDWIDTH_LIMIT_BYTES + 1024,
            bandwidthLimitBytes: DEFAULT_BANDWIDTH_LIMIT_BYTES,
            remainingBytes: 0,
        });

        await expect(service.checkUserBandwidthQuota(mockUser)).rejects.toThrow(HttpException);
        try {
            await service.checkUserBandwidthQuota(mockUser);
        } catch (err: any) {
            expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        }
    });

    it('should merge auth users and usage rows for admin table', async () => {
        const mockClient = {
            from: jest.fn((table: string) => {
                if (table === 'user_usage') {
                    return {
                        select: jest.fn().mockResolvedValue({
                            data: [
                                {
                                    user_id: 'u1',
                                    email: 'a@dlw.cl',
                                    provider: 'google',
                                    requests_count: 12,
                                    downloads_count: 4,
                                    bytes_transferred: 1024 * 1024 * 500,
                                    bandwidth_limit_bytes: null,
                                    last_active_at: '2026-11-17T12:00:00Z',
                                },
                            ],
                        }),
                    };
                }
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            maybeSingle: jest.fn().mockResolvedValue({
                                data: { value: DEFAULT_BANDWIDTH_LIMIT_BYTES },
                                error: null,
                            }),
                        }),
                    }),
                };
            }),
        };

        const mockSupabase: any = {
            getClient: () => mockClient,
            listAllUsers: jest.fn().mockResolvedValue([
                {
                    id: 'u1',
                    email: 'a@dlw.cl',
                    app_metadata: { provider: 'google', role: 'admin' },
                    created_at: '2026-11-10T10:00:00Z',
                    last_sign_in_at: '2026-11-17T12:00:00Z',
                },
            ]),
        };

        const service = new UsageService(mockSupabase);
        const result = await service.getAllUsersWithUsage();

        expect(result.summary.totalUsers).toBe(1);
        expect(result.summary.totalRequests).toBe(12);
        expect(result.summary.totalDownloads).toBe(4);
        expect(result.users[0].role).toBe('admin');
        expect(result.users[0].effectiveBandwidthLimitBytes).toBe(DEFAULT_BANDWIDTH_LIMIT_BYTES);
    });
});
