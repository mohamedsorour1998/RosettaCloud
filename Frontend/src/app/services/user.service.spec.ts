import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { UserService } from './user.service';
import { environment } from '../../environments/environment';

describe('UserService', () => {
  let svc: UserService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(UserService);
    http = TestBed.inject(HttpTestingController);
    // Constructor fires a health-check.
    http.match((r) => r.url.endsWith('/health-check')).forEach((r) => r.flush('ok'));
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(svc).toBeTruthy();
  });

  it('listUsers hits the strangler /users endpoint (not the mis-routed /api/users)', () => {
    svc.listUsers(50).subscribe();
    const req = http.expectOne(`${environment.apiUrl}/users?limit=50`);
    expect(req.request.method).toBe('GET');
    req.flush({ users: [], count: 0 });
  });

  it('handleError surfaces the RFC7807 detail (getUser 404)', () => {
    let err: Error | undefined;
    svc.getUser('u1').subscribe({ error: (e) => (err = e) });

    http.expectOne(`${environment.apiUrl}/users/u1`).flush(
      { title: 'Not Found', status: 404, detail: 'User not found', code: 'USER_NOT_FOUND' },
      { status: 404, statusText: 'Not Found' }
    );

    expect(err?.message).toBe('User not found');
  });
});
