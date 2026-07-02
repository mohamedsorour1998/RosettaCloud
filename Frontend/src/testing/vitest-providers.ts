import { commonTestProviders } from './common-test-providers';

/**
 * Global Angular providers merged into the TestBed environment for EVERY Vitest
 * test, via `angular.json` -> `test.options.providersFile`.  The `@angular/build`
 * unit-test builder imports the DEFAULT export of this file and adds it to the
 * root `TestModule` of `getTestBed().initTestEnvironment(...)` (alongside an
 * auto-added `provideZoneChangeDetection()` because zone.js is a polyfill).
 *
 * This gives every spec HttpClient + Router/ActivatedRoute without per-file
 * wiring — the Vitest-native replacement for the Karma global `beforeEach`.
 * Hand-written specs that need the HTTP testing backend still add
 * `provideHttpClientTesting()` themselves; that child-injector provider
 * overrides the real backend supplied here.
 */
export default commonTestProviders;
