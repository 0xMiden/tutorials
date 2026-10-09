// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// The native export omits the typed-array normalization that the browser
// binding accepts. Adapt only its input container; all validation, note
// construction, and serialization still execute in the real native SDK.
vi.mock('@miden-sdk/miden-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof import('@miden-sdk/miden-sdk')>();
  return {
    ...sdk,
    NoteAttachment: new Proxy(sdk.NoteAttachment, {
      construct(target, args) {
        return Reflect.construct(target, args.map(value => value instanceof BigUint64Array ? Array.from(value) : value));
      },
    }),
  };
});
import { createEpochCollateralNote } from '../epoch-collateral';

const params = {
  sender: '0xfc442ceb5d7303b15da44080c20044',
  allocator: '0xfc442ceb5d7303b15da44080c20044',
  faucet: '0xfc90f0f4da30e51168453b60eafed7',
  amount: 1_000_000n,
  currentBlock: 51_337,
  recallBlocks: 2_000,
  bindingAttachmentFelts: [1n, 2n, 3n, 4n, 5n],
};

describe('Epoch collateral with the real v0.17 SDK', () => {
  it('builds and serializes a public P2IDE note without publishing it', () => {
    const note = createEpochCollateralNote(params);
    expect(note.serialize().length).toBeGreaterThan(0);
    expect(note.assets().fungibleAssets()[0].amount()).toBe(1_000_000n);
    const attachmentValues = note.attachments()[0].toWords().flatMap(word => Array.from(word.toU64s()));
    expect(attachmentValues).toEqual([1n, 2n, 3n, 4n, 5n, 0n, 0n, 0n]);
    expect(note.recipient().storage().items().map(felt => felt.asInt())).toContain(53_337n);
  });
  it('rejects an obsolete pre-v0.16 faucet account ID', () => {
    expect(() => createEpochCollateralNote({ ...params, faucet: '0x0a7d175ed63ec5200fb2ced86f6aa5' })).toThrow();
  });
  it('requires a positive recall window and mandate attachment', () => {
    expect(() => createEpochCollateralNote({ ...params, recallBlocks: 0 })).toThrow(/reclaim/);
    expect(() => createEpochCollateralNote({ ...params, bindingAttachmentFelts: [] })).toThrow(/attachment/);
    expect(() => createEpochCollateralNote({ ...params, bindingAttachmentFelts: [1n << 64n] })).toThrow(/canonical/);
  });
});
