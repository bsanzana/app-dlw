import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createZipFromFiles } from './zip.util';

describe('zip.util', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlw_zip_test_'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should create a valid ZIP archive with local headers, central directory, and EOCD', async () => {
        const fileA = path.join(tempDir, 'foto1.jpg');
        const fileB = path.join(tempDir, 'foto2.jpg');
        fs.writeFileSync(fileA, Buffer.from('fake-jpeg-data-1'));
        fs.writeFileSync(fileB, Buffer.from('fake-jpeg-data-222'));

        const outZip = path.join(tempDir, 'album.zip');
        const zipSize = await createZipFromFiles(
            [
                { name: '01.jpg', filePath: fileA },
                { name: '01.jpg', filePath: fileB }, // duplicate name test
            ],
            outZip,
        );

        expect(zipSize).toBeGreaterThan(0);
        const buf = fs.readFileSync(outZip);
        // Starts with Local File Header signature PK\x03\x04
        expect(buf.readUInt32LE(0)).toBe(0x04034b50);
        // Contains Central Directory signature PK\x01\x02 and EOCD PK\x05\x06
        expect(buf.includes(Buffer.from([0x50, 0x4b, 0x01, 0x02]))).toBe(true);
        expect(buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
        expect(buf.includes(Buffer.from('01.jpg'))).toBe(true);
        expect(buf.includes(Buffer.from('01_2.jpg'))).toBe(true);
    });

    it('should throw an error when given an empty file list', async () => {
        const outZip = path.join(tempDir, 'empty.zip');
        await expect(createZipFromFiles([], outZip)).rejects.toThrow(/No hay archivos/);
    });
});
