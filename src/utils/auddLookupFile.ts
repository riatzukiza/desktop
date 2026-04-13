
import path from 'node:path';
import { promises as fs } from 'node:fs';

export async function auddLookupFile(
  file: string,
  audToken: string,
): Promise<unknown | null> {
  if (!audToken) return null;
  const fd = new FormData();
  fd.append('api_token', audToken);
  fd.append('return', 'apple_music,spotify,deezer');
  fd.append('file', new Blob([await fs.readFile(file)]), path.basename(file));
  const r = await fetch('https://api.audd.io/', {
    method: 'POST',
    body: fd,
  });
  if (!r.ok) return null;
  const j = (await r.json()) as unknown;
  return j;
}
