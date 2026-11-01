/**
 * Everything MnemoBudget asks of the host, in one place.
 *
 * Rule 9: every bridge call carries its own deadline. File calls answer in
 * milliseconds once the permission is granted: 15 s. The folder picker keeps
 * the SDK's long default: a person reading a dialog must not be timed out.
 */
import { MnemoCartridgeSDK } from '../sdk/mnemo-sdk';
import type { DirEntry, FolderIO } from './folderStore';
import { translate } from '../i18n';

/** Must match "name" in mnemo-plugin.json. */
export const PLUGIN_ID = '@mnemosyne-plugins/mnemo-budget';

/** The bridge to the host, named by the manifest's id. */
export const sdk = new MnemoCartridgeSDK(PLUGIN_ID);

const IO_TIMEOUT_MS = 15_000;

/** The four file calls the store makes, each with the 15 s budget. */
export const hostIO: FolderIO = {
  mkdir: (dirPath) => sdk.invoke('dialog.mkdir', { dirPath }, IO_TIMEOUT_MS),
  readDir: (dirPath) => sdk.invoke<{ success: boolean; files?: DirEntry[]; error?: string }>('dialog.readDir', { dirPath }, IO_TIMEOUT_MS),
  readFile: (filePath) => sdk.invoke('dialog.readFile', { filePath }, IO_TIMEOUT_MS),
  writeFile: (filePath, content) => sdk.invoke('dialog.writeFile', { filePath, content }, IO_TIMEOUT_MS),
};

/** A line's file leaves the folder: only ever on the person's own click (doc 177 §3 rule 6). */
export async function deleteFile(filePath: string): Promise<void> {
  const res = await sdk.invoke<{ success?: boolean; error?: string }>('dialog.deleteFile', { filePath }, IO_TIMEOUT_MS);
  if (res?.success === false) throw new Error(res.error ?? 'DELETE_FAILED');
}

/**
 * The folder the OS gives this app (doc 177 §12): `Mnemosyne Apps/MnemoBudget`
 * next to the vault root, so every app's files sit together. `create: false`
 * only names it (shown before anything is made). No timeout of ours: the
 * first call may open the host's permission box, which a person reads.
 * Rejects NO_VAULT_ROOT, or an unknown action on an older host: the picker stays.
 */
export async function appFolder(create: boolean): Promise<string> {
  const res = await sdk.invoke<{ folder?: unknown }>('dialog.appFolder', { create });
  if (typeof res?.folder !== 'string' || !res.folder) throw new Error('NO_FOLDER');
  return res.folder;
}

/** Opens the host's folder picker. Resolves null when the person cancels. */
export function pickFolder(): Promise<string | null> {
  return sdk.selectFolder();
}

export function openFolderInOS(folder: string): Promise<{ success: boolean; error?: string }> {
  return sdk.openInOS(folder);
}

// ── Where the budget lives ────────────────────────────────────────────────
// localStorage is primary and synchronous; the host mirror (doc 73) is what
// survives the iframe's origin changing under it (dev port vs packaged).

const FOLDER_KEY = 'mnemo_budget_folder';

/** The folder remembered in this frame, or null. */
export function readRememberedFolder(): string | null {
  try {
    return localStorage.getItem(FOLDER_KEY);
  } catch (err) {
    console.warn('[mnemo-budget] localStorage unreadable:', err);
    return null;
  }
}

/** The folder the host mirrors (doc 73), which survives the frame's origin changing. */
export async function readMirroredFolder(): Promise<string | null> {
  const res = await sdk.invoke<{ state: { folder?: unknown } | null }>('state.get', undefined, IO_TIMEOUT_MS);
  const folder = res?.state?.folder;
  return typeof folder === 'string' && folder.trim() ? folder : null;
}

/** Remembers the folder here and on the host. */
export async function rememberFolder(folder: string): Promise<void> {
  try {
    localStorage.setItem(FOLDER_KEY, folder);
  } catch (err) {
    console.warn('[mnemo-budget] localStorage write refused:', err);
  }
  await sdk.invoke('state.set', { state: { folder } }, IO_TIMEOUT_MS);
}

// ── Memory (doc 177 §4) ───────────────────────────────────────────────────
// The cartridge's own walled vault (doc 58): out of the federated chat until
// the person promotes it in the vault manager.

/** The spine every MnemoBudget chronicle carries. Host rule: ^[A-Z0-9_]{1,32}$ */
export const BUDGET_SPINE = 'BUDGET_LINE';

let sandbox: Promise<{ vault: string; unlocked: boolean }> | null = null;

/** Created on first use; a failure is not cached. */
export function ensureSandbox(): Promise<{ vault: string; unlocked: boolean }> {
  if (!sandbox) {
    sandbox = sdk.ensureSandbox().then(async ({ vault, unlocked }) => {
      try {
        await sdk.describeVaultTile({ icon: '💶', metrics: [{ label: translate('vault.linesMetric'), spine: BUDGET_SPINE }] });
      } catch (err) {
        // The tile is decoration; the vault works without it.
        console.warn('[mnemo-budget] vault tile not described:', err);
      }
      return { vault, unlocked };
    });
    sandbox.catch(() => {
      sandbox = null;
    });
  }
  return sandbox;
}

/** One chronicle. The checksum lets the host drop a line it already has. */
export async function rememberLine(content: string, sourceRef: string, checksum: string): Promise<void> {
  const { vault } = await ensureSandbox();
  await sdk.invoke('social.ingest', { vault, content, spineType: BUDGET_SPINE, sourceRef, checksum }, IO_TIMEOUT_MS);
}
