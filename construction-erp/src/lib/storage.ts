import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from './env';
import { AppError } from './db';

export const ALLOWED: Record<string, { ext: string[]; magic: (b: Buffer) => boolean }> = {
  'application/pdf': { ext: ['pdf'], magic: b => b.subarray(0, 5).toString() === '%PDF-' },
  'image/jpeg': { ext: ['jpg', 'jpeg'], magic: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: ['png'], magic: b => b.subarray(1, 4).toString() === 'PNG' },
  'text/csv': { ext: ['csv'], magic: b => !b.includes(0) },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: ['xlsx'], magic: b => b[0] === 0x50 && b[1] === 0x4b },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: ['docx'], magic: b => b[0] === 0x50 && b[1] === 0x4b },
  'application/zip': { ext: ['zip'], magic: b => b[0] === 0x50 && b[1] === 0x4b },
};

export function validateUpload(name: string, declaredMime: string, data: Buffer): { mime: string; safeName: string } {
  const maxBytes = env.maxUploadMb * 1024 * 1024;
  if (data.length === 0) throw new AppError('The file is empty.', 'upload');
  if (data.length > maxBytes) throw new AppError(`The file is larger than ${env.maxUploadMb} MB.`, 'upload');
  const safeName = path.basename(name).replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'file';
  const ext = safeName.split('.').pop()?.toLowerCase() ?? '';
  const rule = ALLOWED[declaredMime];
  if (!rule || !rule.ext.includes(ext)) throw new AppError('This file type is not allowed. Use PDF, JPG, PNG, CSV, XLSX, DOCX or ZIP.', 'upload');
  if (!rule.magic(data)) throw new AppError('The file content does not match its type.', 'upload');
  return { mime: declaredMime, safeName };
}

const root = () => path.resolve(env.storageDir);
/** Keys are random and never derived from user input; files are never served from a public path. */
export async function putObject(orgId: string, data: Buffer): Promise<{ key: string; sha256: string }> {
  const key = `${orgId}/${crypto.randomUUID()}`;
  const full = path.join(root(), key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data, { mode: 0o600 });
  return { key, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}
export async function getObject(key: string): Promise<Buffer> {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new AppError('Invalid file', 'file', 400);
  return fs.readFile(full);
}
export async function deleteObject(key: string) {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error('invalid key');
  await fs.rm(full, { force: true });
}
