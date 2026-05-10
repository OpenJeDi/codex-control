import posix from './posix.mjs';
import windows from './windows.mjs';

export const hostPlatform = process.platform === 'win32' ? windows : posix;
