import * as fs from 'fs';
import * as path from 'path';

export interface ZipInputFile {
    name: string;
    filePath: string;
}

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

async function computeFileCrc32AndSize(filePath: string): Promise<{ crc32: number; size: number }> {
    return new Promise((resolve, reject) => {
        let crc = 0xffffffff;
        let size = 0;
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk: Buffer | string) => {
            const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
            size += buf.length;
            for (let i = 0; i < buf.length; i++) {
                crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
            }
        });
        stream.on('end', () => resolve({ crc32: (crc ^ 0xffffffff) >>> 0, size }));
        stream.on('error', reject);
    });
}

function writeBufferToStream(stream: fs.WriteStream, buffer: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        if (stream.write(buffer)) {
            resolve();
            return;
        }
        stream.once('drain', resolve);
        stream.once('error', reject);
    });
}

function pipeFileToStream(filePath: string, dest: fs.WriteStream): Promise<void> {
    return new Promise((resolve, reject) => {
        const src = fs.createReadStream(filePath);
        src.on('data', (chunk: Buffer | string) => {
            const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
            if (!dest.write(buf)) {
                src.pause();
                dest.once('drain', () => src.resume());
            }
        });
        src.on('end', resolve);
        src.on('error', reject);
    });
}

function toDosTimeDate(date: Date): { dosTime: number; dosDate: number } {
    const year = Math.max(1980, date.getFullYear());
    const dosTime =
        ((date.getHours() & 0x1f) << 11) |
        ((date.getMinutes() & 0x3f) << 5) |
        ((date.getSeconds() >> 1) & 0x1f);
    const dosDate =
        (((year - 1980) & 0x7f) << 9) |
        (((date.getMonth() + 1) & 0x0f) << 5) |
        (date.getDate() & 0x1f);
    return { dosTime, dosDate };
}

/**
 * Streams multiple local files into a standard STORE (method 0) ZIP archive
 * without loading entire files into RAM.
 */
export async function createZipFromFiles(files: ZipInputFile[], outputZipPath: string): Promise<number> {
    if (files.length === 0) {
        throw new Error('No hay archivos para empaquetar en el archivo ZIP.');
    }

    const outStream = fs.createWriteStream(outputZipPath);
    const centralDirectoryRecords: Buffer[] = [];
    const seenNames = new Set<string>();
    let offset = 0;

    try {
        for (let idx = 0; idx < files.length; idx++) {
            const input = files[idx];
            const rawBase = path.basename(input.name || `item_${idx + 1}`).replace(/[^\w.\-() ]+/g, '_');
            let entryName = rawBase || `item_${idx + 1}`;
            if (seenNames.has(entryName)) {
                const parsed = path.parse(entryName);
                entryName = `${parsed.name}_${idx + 1}${parsed.ext}`;
            }
            seenNames.add(entryName);

            const nameBuf = Buffer.from(entryName, 'utf8');
            const { crc32, size } = await computeFileCrc32AndSize(input.filePath);
            const stat = fs.statSync(input.filePath);
            const { dosTime, dosDate } = toDosTimeDate(stat.mtime);

            // Local file header (30 bytes + filename)
            const localHeader = Buffer.alloc(30);
            localHeader.writeUInt32LE(0x04034b50, 0); // signature
            localHeader.writeUInt16LE(20, 4); // version needed to extract
            localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
            localHeader.writeUInt16LE(0, 8); // compression method: STORE
            localHeader.writeUInt16LE(dosTime, 10);
            localHeader.writeUInt16LE(dosDate, 12);
            localHeader.writeUInt32LE(crc32, 14);
            localHeader.writeUInt32LE(size, 18); // compressed size
            localHeader.writeUInt32LE(size, 22); // uncompressed size
            localHeader.writeUInt16LE(nameBuf.length, 26);
            localHeader.writeUInt16LE(0, 28); // extra field length

            await writeBufferToStream(outStream, localHeader);
            await writeBufferToStream(outStream, nameBuf);
            await pipeFileToStream(input.filePath, outStream);

            // Central directory header (46 bytes + filename)
            const cdHeader = Buffer.alloc(46);
            cdHeader.writeUInt32LE(0x02014b50, 0); // signature
            cdHeader.writeUInt16LE(20, 4); // version made by
            cdHeader.writeUInt16LE(20, 6); // version needed
            cdHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
            cdHeader.writeUInt16LE(0, 10); // STORE
            cdHeader.writeUInt16LE(dosTime, 12);
            cdHeader.writeUInt16LE(dosDate, 14);
            cdHeader.writeUInt32LE(crc32, 16);
            cdHeader.writeUInt32LE(size, 20);
            cdHeader.writeUInt32LE(size, 24);
            cdHeader.writeUInt16LE(nameBuf.length, 28);
            cdHeader.writeUInt16LE(0, 30); // extra length
            cdHeader.writeUInt16LE(0, 32); // comment length
            cdHeader.writeUInt16LE(0, 34); // disk number start
            cdHeader.writeUInt16LE(0, 36); // internal attrs
            cdHeader.writeUInt32LE(0, 38); // external attrs
            cdHeader.writeUInt32LE(offset, 42); // relative offset of local header

            centralDirectoryRecords.push(Buffer.concat([cdHeader, nameBuf]));
            offset += 30 + nameBuf.length + size;
        }

        const cdBuffer = Buffer.concat(centralDirectoryRecords);
        await writeBufferToStream(outStream, cdBuffer);

        // End of central directory record (22 bytes)
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(0, 4);
        eocd.writeUInt16LE(0, 6);
        eocd.writeUInt16LE(files.length, 8);
        eocd.writeUInt16LE(files.length, 10);
        eocd.writeUInt32LE(cdBuffer.length, 12);
        eocd.writeUInt32LE(offset, 16);
        eocd.writeUInt16LE(0, 20);

        await writeBufferToStream(outStream, eocd);
        await new Promise<void>((resolve, reject) => {
            outStream.end(() => resolve());
            outStream.on('error', reject);
        });

        return fs.statSync(outputZipPath).size;
    } catch (err) {
        outStream.destroy();
        if (fs.existsSync(outputZipPath)) {
            try {
                fs.unlinkSync(outputZipPath);
            } catch { }
        }
        throw err;
    }
}
