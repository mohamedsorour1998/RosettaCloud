import { TestBed } from '@angular/core/testing';
import { commonTestProviders } from './common-test-providers';

/**
 * A top-level `beforeEach` (module scope) registers on the ROOT test suite,
 * so it runs before EVERY spec in the run — before each spec's own
 * `configureTestingModule` in its describe-level `beforeEach`.  TestBed merges
 * provider arrays across calls made prior to first instantiation, so this adds
 * the common providers (HttpClient, Router/ActivatedRoute) to every test.
 *
 * This makes the auto-generated schematic "should create" specs green without
 * editing each one.  At the Vitest migration this same array is wired via the
 * Vitest setup file (test-setup.ts) and this .spec.ts helper is removed.
 */
beforeEach(() => {
  TestBed.configureTestingModule({ providers: [...commonTestProviders] });
});
