/**
 * An in-memory folder for tests: the four host calls the store makes, and
 * the files they leave, readable by the test.
 */
import type { FolderIO } from '../data/folderStore';

export function memoryIO(initial: Record<string, string> = {}): FolderIO & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  const dirs = new Set<string>();
  return {
    files,
    mkdir: async (p) => { dirs.add(p); return { success: true }; },
    readDir: async (p) => {
      const prefix = `${p}/`;
      const names = new Map<string, boolean>();
      for (const f of files.keys()) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        const [head, ...tail] = rest.split('/');
        names.set(head!, tail.length > 0);
      }
      for (const d of dirs) if (d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) names.set(d.slice(prefix.length), true);
      return { success: true, files: [...names].map(([name, isDirectory]) => ({ name, path: `${p}/${name}`, isDirectory })) };
    },
    readFile: async (p) => (files.has(p) ? { success: true, content: files.get(p)! } : { success: false, error: 'ENOENT' }),
    writeFile: async (p, c) => { files.set(p, c); return { success: true }; },
  };
}

