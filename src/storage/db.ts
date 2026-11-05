import { closeSync, constants, mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations/index.js';

const SQLITE_CONSTRAINT_FOREIGNKEY = 787;

export function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ERR_SQLITE_ERROR' &&
    'errcode' in error &&
    error.errcode === SQLITE_CONSTRAINT_FOREIGNKEY
  );
}

export function resolveDataDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir(),
): string {
  const path = platform === 'win32' ? win32 : posix;
  const override = env.CORTEX_DATA_DIR;
  if (override !== undefined) {
    if (!path.isAbsolute(override)) {
      throw new Error('CORTEX_DATA_DIR must be an absolute directory path');
    }
    return path.normalize(override);
  }

  if (platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', 'Cortex MCP');
  if (platform === 'win32') {
    const localData = env.LOCALAPPDATA;
    const base =
      localData && path.isAbsolute(localData)
        ? localData
        : path.join(home, 'AppData', 'Local');
    return path.join(base, 'Cortex MCP');
  }

  const xdgData = env.XDG_DATA_HOME;
  const base =
    xdgData && path.isAbsolute(xdgData)
      ? xdgData
      : path.join(home, '.local', 'share');
  return path.join(base, 'cortex-mcp');
}

export function openDatabase(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseSync {
  const dir = resolveDataDirectory(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'cortex.sqlite3');
  // Apply the requested mode at creation time, including when two processes open it.
  closeSync(
    openSync(
      file,
      constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    ),
  );

  const db = new DatabaseSync(file, { timeout: 5_000 });
  try {
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
