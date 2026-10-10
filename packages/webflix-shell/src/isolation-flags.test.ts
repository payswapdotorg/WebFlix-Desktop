import { describe, expect, it } from 'vitest';

import {
  CHROME_IMPORT_ENV,
  DEFAULT_ISOLATION_FLAGS,
  FlagDisabledError,
  ISOLATION_FLAG_POLICY,
  PRODUCT_SURFACE_ENV,
  parseIsolationFlagValue,
  requireFlagEnabled,
  resolveIsolationFlags,
  type IsolationFlagName,
  type IsolationFlagPolicy,
} from './isolation-flags';

function policyFor(name: IsolationFlagName): IsolationFlagPolicy {
  const entry = ISOLATION_FLAG_POLICY.find((candidate) => candidate.name === name);
  if (!entry) {
    throw new Error(`missing policy entry for ${name}`);
  }
  return entry;
}

describe('isolation flag defaults (fail-closed)', () => {
  it('both flags default OFF', () => {
    expect(DEFAULT_ISOLATION_FLAGS.chromeImportEnabled).toBe(false);
    expect(DEFAULT_ISOLATION_FLAGS.webflixProductSurface).toBe(false);
  });

  it('resolves with no environment to both OFF', () => {
    expect(resolveIsolationFlags({})).toEqual({
      chromeImportEnabled: false,
      webflixProductSurface: false,
    });
    expect(resolveIsolationFlags({})).toEqual(DEFAULT_ISOLATION_FLAGS);
  });

  it('defaults are frozen', () => {
    expect(Object.isFrozen(DEFAULT_ISOLATION_FLAGS)).toBe(true);
    expect(Object.isFrozen(resolveIsolationFlags({}))).toBe(true);
  });

  it('flags are independent: enabling one leaves the other OFF', () => {
    const flags = resolveIsolationFlags({ [CHROME_IMPORT_ENV]: '1' });
    expect(flags.chromeImportEnabled).toBe(true);
    expect(flags.webflixProductSurface).toBe(false);
  });
});

describe('fail-closed flag parsing', () => {
  it('turns a flag on only for explicit opt-in values', () => {
    for (const raw of ['1', 'true', 'TRUE', 'True', 'yes', 'YES', 'on', 'On', ' 1 ']) {
      expect(parseIsolationFlagValue(raw)).toBe(true);
    }
  });

  it('stays OFF for unset, empty, and unrecognized values', () => {
    for (const raw of [undefined, '', '   ', '0', 'false', 'no', 'off', 'enabled', 'garbage']) {
      expect(parseIsolationFlagValue(raw)).toBe(false);
    }
  });
});

describe('environment resolution (freeze §6.1 migration aliases)', () => {
  it('reads canonical WEBFLIX_* variables', () => {
    const flags = resolveIsolationFlags({
      [CHROME_IMPORT_ENV]: '1',
      [PRODUCT_SURFACE_ENV]: 'true',
    });
    expect(flags.chromeImportEnabled).toBe(true);
    expect(flags.webflixProductSurface).toBe(true);
  });

  it('honors legacy ZCODE_* aliases during migration', () => {
    const flags = resolveIsolationFlags({
      ZCODE_ENABLE_CHROME_IMPORT: '1',
      ZCODE_ENABLE_PRODUCT_SURFACE: 'yes',
    });
    expect(flags.chromeImportEnabled).toBe(true);
    expect(flags.webflixProductSurface).toBe(true);
  });

  it('prefers canonical WEBFLIX_* over legacy ZCODE_*', () => {
    const flags = resolveIsolationFlags({
      [CHROME_IMPORT_ENV]: '0',
      ZCODE_ENABLE_CHROME_IMPORT: '1',
    });
    expect(flags.chromeImportEnabled).toBe(false);
  });
});

describe('flag policy (unreachable-IPC requirement)', () => {
  it('documents exactly two flags, both defaulting OFF', () => {
    expect(ISOLATION_FLAG_POLICY.map((entry) => entry.name)).toEqual([
      'chromeImportEnabled',
      'webflixProductSurface',
    ]);
    for (const entry of ISOLATION_FLAG_POLICY) {
      expect(entry.default).toBe(false);
      expect(DEFAULT_ISOLATION_FLAGS[entry.name]).toBe(entry.default);
    }
  });

  it('every off-guarantee demands unreachability, not hidden UI', () => {
    for (const entry of ISOLATION_FLAG_POLICY) {
      expect(entry.offGuarantee.toLowerCase()).toContain('unreachable');
      expect(entry.offGuarantee).toMatch(/IPC|channels/i);
    }
  });

  it('every off-guarantee is enforced in the main process', () => {
    for (const entry of ISOLATION_FLAG_POLICY) {
      expect(entry.offGuarantee.toLowerCase()).toContain('main process');
    }
  });

  it('every policy entry points at desktop enforcement sites', () => {
    for (const entry of ISOLATION_FLAG_POLICY) {
      expect(entry.enforcedIn.length).toBeGreaterThan(0);
      for (const file of entry.enforcedIn) {
        expect(file.startsWith('packages/desktop/')).toBe(true);
      }
    }
  });

  it('chromeImportEnabled gates cookie, localStorage, and credential import', () => {
    const entry = policyFor('chromeImportEnabled');
    expect(entry.env).toBe(CHROME_IMPORT_ENV);
    const gates = entry.gates.join(' ').toLowerCase();
    expect(gates).toContain('cookie');
    expect(gates).toContain('localstorage');
    expect(gates).toContain('credential');
  });

  it('webflixProductSurface gates Coding Plan/PayPal, CUA, Lark, remotes, force-update', () => {
    const entry = policyFor('webflixProductSurface');
    expect(entry.env).toBe(PRODUCT_SURFACE_ENV);
    const gates = entry.gates.join(' ');
    expect(gates).toContain('Coding Plan');
    expect(gates).toContain('PayPal');
    expect(gates).toContain('CUA');
    expect(gates).toContain('Lark');
    expect(gates).toContain('SSH');
    expect(gates).toContain('Docker');
    expect(gates).toContain('WSL');
    expect(gates).toContain('force-update');
  });
});

describe('requireFlagEnabled (defense in depth for IPC handlers)', () => {
  it('throws FlagDisabledError when the flag is OFF', () => {
    expect(() => requireFlagEnabled(DEFAULT_ISOLATION_FLAGS, 'chromeImportEnabled')).toThrow(
      FlagDisabledError,
    );
    expect(() => requireFlagEnabled(DEFAULT_ISOLATION_FLAGS, 'webflixProductSurface')).toThrow(
      FlagDisabledError,
    );
  });

  it('names the flag, the unreachability rule, and the enabling env var', () => {
    let thrown: unknown;
    try {
      requireFlagEnabled(DEFAULT_ISOLATION_FLAGS, 'chromeImportEnabled');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FlagDisabledError);
    const message = (thrown as FlagDisabledError).message;
    expect(message).toContain('chromeImportEnabled');
    expect(message.toLowerCase()).toContain('unreachable');
    expect(message).toContain(CHROME_IMPORT_ENV);
  });

  it('does not throw when the flag is ON', () => {
    const flags = resolveIsolationFlags({ [PRODUCT_SURFACE_ENV]: '1' });
    expect(() => requireFlagEnabled(flags, 'webflixProductSurface')).not.toThrow();
  });
});
