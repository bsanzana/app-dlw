import { GalleryDlProvider } from './gallery-dl.provider';

describe('GalleryDlProvider', () => {
    let provider: GalleryDlProvider;

    beforeEach(() => {
        provider = new GalleryDlProvider();
    });

    describe('isGalleryPreferredUrl', () => {
        it('should detect Facebook photo/album URLs and image hosts while leaving Facebook reels/videos to yt-dlp first', () => {
            expect(provider.isGalleryPreferredUrl('https://www.facebook.com/photo/?fbid=123456')).toBe(true);
            expect(provider.isGalleryPreferredUrl('https://m.facebook.com/page/photos/a.123/456/')).toBe(true);
            expect(provider.isGalleryPreferredUrl('https://www.pinterest.com/pin/12345/')).toBe(true);
            expect(provider.isGalleryPreferredUrl('https://imgur.com/gallery/abc')).toBe(true);

            // Videos should still try yt-dlp first
            expect(provider.isGalleryPreferredUrl('https://www.facebook.com/reel/123456')).toBe(false);
            expect(provider.isGalleryPreferredUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
        });
    });

    describe('parseJsonOutput', () => {
        it('should parse a single Facebook photo JSON output', () => {
            const mockJson = JSON.stringify([
                [2, { title: 'Foto de Prueba', uploader: 'Mi Pagina' }],
                [3, 'https://scontent.fbcdn.net/photo1.jpg', { extension: 'jpg', width: 1080, height: 1350, filename: 'photo1' }],
            ]);

            const parsed = provider.parseJsonOutput(mockJson, 'https://www.facebook.com/photo/?fbid=1');
            expect(parsed.title).toBe('Foto de Prueba');
            expect(parsed.uploader).toBe('Mi Pagina');
            expect(parsed.items).toHaveLength(1);
            expect(parsed.items[0].ext).toBe('jpg');
            expect(parsed.items[0].isVideo).toBe(false);
            expect(parsed.items[0].width).toBe(1080);
        });

        it('should parse multiple carousel items into multiple entries', () => {
            const mockJson = JSON.stringify([
                [2, { description: 'Carrusel IG', username: 'perfil_test' }],
                [3, 'https://cdn.ig.com/img1.jpg', { extension: 'jpg', width: 1080, height: 1080 }],
                [3, 'https://cdn.ig.com/img2.png', { extension: 'png', width: 1080, height: 1080 }],
            ]);

            const parsed = provider.parseJsonOutput(mockJson, 'https://www.instagram.com/p/xyz/');
            expect(parsed.title).toBe('Carrusel IG');
            expect(parsed.uploader).toBe('perfil_test');
            expect(parsed.items).toHaveLength(2);
            expect(parsed.items[0].ext).toBe('jpg');
            expect(parsed.items[1].ext).toBe('png');
        });
    });
});
