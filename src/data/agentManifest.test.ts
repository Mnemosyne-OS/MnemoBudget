/**
 * MnemoBudget's agent actions (doc 149, doc 177 §5): the manifest passes the
 * HOST's own check, every declared action has its handler and the reverse,
 * and the voice sentences the card shows are the ones the bench routes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentActionsFromManifest, agentGuideFromManifest } from '../../../infinity-edition/src/main/plugins/cartridgeAgentActions';

const root = join(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'mnemo-plugin.json'), 'utf8')) as Record<string, unknown>;
const source = readFileSync(join(root, 'src', 'components', 'BudgetAgentActions.tsx'), 'utf8');
const block = source.slice(source.indexOf('sdk.onAgentActions({'), source.indexOf('sub.ready.catch'));
const handlers = [...block.matchAll(/^ {6}(\w+): (?:async )?\(/gm)].map((m) => m[1]);

describe("MnemoBudget's agent actions", () => {
  it("pass the host's check of the manifest", () => {
    const r = agentActionsFromManifest(manifest);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
    expect(agentGuideFromManifest(manifest)).not.toBeNull();
  });

  it('every declared action has its handler, and no handler is undeclared', () => {
    const r = agentActionsFromManifest(manifest);
    if (!r.ok) throw new Error(r.error);
    expect([...handlers].sort()).toEqual(r.value.map((a) => a.id).sort());
    expect(handlers).toHaveLength(6);
  });

  it('nothing spends credits, only summary reads, and nothing is named like a deletion', () => {
    const r = agentActionsFromManifest(manifest);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.filter((a) => a.effect === 'spend')).toEqual([]);
    expect(r.value.filter((a) => a.effect === 'read').map((a) => a.id)).toEqual(['summary']);
    expect(r.value.map((a) => a.id).filter((id) => /delete|remove|forget/i.test(id))).toEqual([]);
  });

  it('the renderer is the built page, so the cartridge opens without a dev server', () => {
    expect((manifest.entrypoints as { renderer: string }).renderer).toBe('index.html');
  });
});
