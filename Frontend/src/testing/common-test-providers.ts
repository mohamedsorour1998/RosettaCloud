import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

/**
 * Common providers merged into every spec's TestBed via the Vitest
 * `providersFile` (see vitest-providers.ts, wired in angular.json).
 *
 * Intentionally uses the REAL HttpClient (not the testing backend) so that
 * the auto-generated "should create" smoke tests can instantiate components
 * that inject API services, WITHOUT interfering with hand-written tests that
 * add `provideHttpClientTesting()` themselves (their testing backend overrides
 * this one).  `provideRouter([])` supplies Router + ActivatedRoute.
 */
export const commonTestProviders = [
  provideHttpClient(),
  // A catch-all router so components that navigate during a smoke test
  // (e.g. profile-wizard -> /login when unauthenticated) resolve silently
  // instead of throwing NG04002, which Vitest would surface as an unhandled
  // error. Mirrors the app's own `**` -> '' wildcard.
  provideRouter([
    { path: '', children: [] },
    { path: '**', redirectTo: '' },
  ]),
];
