import fscb from 'node:fs';
import path from 'node:path';
import { sh } from "./misc.ts"
import {promises as fs} from 'node:fs';
import os from 'node:os';


export type PlaylistEntry = {
  url?: string;
  id?: string;
};

type PlaylistData = {
  entries?: PlaylistEntry[];
};

export async function listYtVideos(playlistUrl: string): Promise<string[]> {
  const j = await sh('yt-dlp', ['-J', '--flat-playlist', '--no-warnings', playlistUrl]);
  const data = JSON.parse(j) as PlaylistData;
  const entries = data.entries ?? [];
  return entries
    .map((e) =>
      e.url?.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${e.id ?? e.url}`,
    )
    .filter((entry): entry is string => Boolean(entry));
}
export async function readM3U(file: string): Promise<string[]> {
  const t = await fs.readFile(file, 'utf8');
  return t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

export function tmpdir(): string {
  const d = path.join(os.tmpdir(), `ytwall_screener_${Date.now()}`);
  fscb.mkdirSync(d, {
    recursive: true,
  });
  return d;
}

export async function sampleAudio(
  url: string,
  dir: string,
  sampleSeconds: number = 25,
): Promise<string> {
  const out = path.join(dir, '%(id)s.%(ext)s');
  const args = [
    '-f',
    'bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    '-N',
    '4',
    '--extract-audio',
    '--audio-format',
    'wav',
    '--download-sections',
    `*0-00:${String(sampleSeconds).padStart(2, '0')}`,
    '-o',
    out,
    url,
  ];
  await sh('yt-dlp', args);
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.wav'));
  const [first] = files;
  if (!first) throw new Error('no wav produced');
  return path.join(dir, first);
}
