import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process';
// Remove unused imports unless/ until you need them.
// import { promises as fs } from 'node:fs';
// import * as fscb from 'node:fs';
// import os from 'node:os';
// import path from 'node:path';
// If you want dotenv, prefer the side-effect form below.
// import 'dotenv/config';

export function sh(
  cmd: string,
  argv: readonly string[],
  opts: SpawnOptionsWithoutStdio = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });

    let out = '';
    let err = '';

    p.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    p.stderr?.on('data', (d: Buffer) => { err += d.toString(); });

    p.on('close', (code: number | null) => {
      code === 0 ? resolve(out) : reject(new Error(err || `nonzero ${cmd}`));
    });
  });
}

interface FpcalcJson {
  duration: number;
  fingerprint: string;
}

export async function fpcalc(file: string): Promise<FpcalcJson> {
  const out = await sh('fpcalc', ['-json', file]);
  const j = JSON.parse(out) as FpcalcJson;
  return {
    duration: j.duration,
    fingerprint: j.fingerprint,
  };
}

export const parseArgs = (args=process.argv): Record<string, boolean | string> => {
  const entries = args
    .slice(2)
    .reduce<Array<[string, string | boolean]>>((acc, v, i, arr) => {
      if (v.startsWith('--')) {
        const k = v.slice(2);
        const val =
          arr[i + 1] && !arr[i + 1].startsWith('--') ? (arr[i + 1] as string) : true;
        acc.push([k, val]);
      }
      return acc;
    }, []);

  return Object.fromEntries(entries);
};
