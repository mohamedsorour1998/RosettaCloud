import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { authInterceptor } from './auth.interceptor';
import { UserService } from '../services/user.service';
import { environment } from '../../environments/environment';

describe('authInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        // Stub UserService so the interceptor reads the token from localStorage
        // without constructing the real service (which fires a health-check).
        { provide: UserService, useValue: { getAccessToken: () => localStorage.getItem('idToken') } },
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('attaches Bearer <idToken> to apiUrl requests', () => {
    localStorage.setItem('idToken', 'JWT123');
    client.get(`${environment.apiUrl}/users/u1`).subscribe();
    const req = http.expectOne(`${environment.apiUrl}/users/u1`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer JWT123');
    req.flush({});
  });

  it('does NOT attach the token to non-apiUrl hosts', () => {
    localStorage.setItem('idToken', 'JWT123');
    client.get('https://other.example.com/thing').subscribe();
    const req = http.expectOne('https://other.example.com/thing');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('does not attach an Authorization header when no token is stored', () => {
    client.get(`${environment.apiUrl}/public/stats`).subscribe();
    const req = http.expectOne(`${environment.apiUrl}/public/stats`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });
});
