/**
 * @webflix/application — public surface (D2-LOCAL).
 *
 * Use-cases orchestrate the (pure) domain rules over the ports defined in
 * `./ports.ts`; entity shapes in `./types.ts` mirror `@webflix/domain` and are
 * bridged by adapters at the edges. Adapters implement the ports:
 *
 *   - LocalStore           -> packages/webflix-local-store
 *   - IndexingPort         -> packages/webflix-indexer
 *   - ProviderMetadataPort -> packages/webflix-providers
 *   - CredentialPort       -> desktop keychain adapter (contract re-export)
 */
export * from './types';
export * from './ports';
export * from './path-safety';
export * from './indexing-session';
export * from './add-local-files-to-library';
export * from './manage-collections';
export * from './track-playback-progress';
export * from './refresh-provider-metadata';
export * from './run-indexing-job';
