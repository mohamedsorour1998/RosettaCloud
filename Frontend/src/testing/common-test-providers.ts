import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

/**
 * Common providers merged into every spec's TestBed via the global setup
 * (see global-test-setup.spec.ts for Karma, test-setup.ts for Vitest).
 *
 * Intentionally uses the REAL HttpClient (not the testing backend) so that
 * the auto-generated "should create" smoke tests can instantiate components
 * that inject API services, WITHOUT interfering with hand-written tests that
 * add `provideHttpClientTesting()` themselves (their testing backend overrides
 * this one).  `provideRouter([])` supplies Router + ActivatedRoute.
 */
export const commonTestProviders = [provideHttpClient(), provideRouter([])];
