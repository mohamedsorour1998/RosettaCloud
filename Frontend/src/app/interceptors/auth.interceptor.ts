import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { UserService } from '../services/user.service';
import { environment } from '../../environments/environment';

/**
 * Attaches the Cognito ID token as a Bearer token to all requests
 * destined for the RosettaCloud API.
 *
 * Uses the Angular 19 functional interceptor pattern so it integrates
 * cleanly with provideHttpClient(withInterceptors([...])).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const userService = inject(UserService);
  const token = userService.getAccessToken();

  if (token && req.url.startsWith(environment.apiUrl)) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  return next(req);
};
