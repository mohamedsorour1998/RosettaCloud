import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { LabService } from './lab.service';
import { environment } from '../../environments/environment';

describe('LabService', () => {
  let svc: LabService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(LabService);
    http = TestBed.inject(HttpTestingController);
    // LabService and its injected UserService each fire a health-check on construction.
    http.match((r) => r.url.endsWith('/health-check')).forEach((r) => r.flush('ok'));
  });

  afterEach(() => http.verify());

  it('should be created', () => {
    expect(svc).toBeTruthy();
  });

  it('maps a phantom { error } body (HTTP 200) to a thrown error', () => {
    let err: Error | undefined;
    svc.getLabInfo('lab-x').subscribe({ error: (e) => (err = e) });

    http
      .expectOne((r) => r.url.startsWith(`${environment.apiUrl}/labs/lab-x`))
      .flush({ error: 'lab not found' }); // lab-service returns this with HTTP 200

    expect(err?.message).toBe('lab not found');
  });

  it('checkQuestion sends snake_case pod_name and does NOT double-write progress', () => {
    svc.checkQuestion('pod-1', 'm', 'l', 1).subscribe();

    const req = http.expectOne((r) => r.url.includes('/questions/m/l/1/check'));
    expect(req.request.body).toEqual({ pod_name: 'pod-1' });
    req.flush({ status: 'success', message: 'Question 1 completed', completed: true });

    // Progress is tracked server-side now — the client must NOT POST progress.
    http.expectNone((r) => r.url.includes('/progress/'));
  });

  it('surfaces the RFC7807 detail from a lab-quota 403 on launch', () => {
    let err: Error | undefined;
    svc.launchLab('u1').subscribe({ error: (e) => (err = e) });

    const body = {
      title: 'Forbidden',
      status: 403,
      detail: 'Weekly lab time quota exhausted.',
      code: 'LAB_QUOTA_EXHAUSTED',
      payload: { minutes_remaining: 0 },
    };
    // launchLab pipes retry(1): the initial request + one retry, both 403.
    for (let i = 0; i < 2; i++) {
      http
        .expectOne(`${environment.apiUrl}/labs`)
        .flush(body, { status: 403, statusText: 'Forbidden' });
    }

    expect(err?.message).toBe('Weekly lab time quota exhausted.');
  });
});
