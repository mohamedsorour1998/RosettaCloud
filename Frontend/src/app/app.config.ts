import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';

import { routes } from './app.routes';
import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { authInterceptor } from './interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Angular 22 flips the paramsInheritanceStrategy default 'emptyOnly' -> 'always'.
    // The app's route-param reads (login query params, lab :moduleUuid/:lessonUuid)
    // were written and tested against 'emptyOnly'; pin it explicitly so the upgrade
    // introduces no inherited-param behavior change. (Plan §7.5)
    provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'emptyOnly' })),
    provideHttpClient(withXhr(), withInterceptors([authInterceptor])),
  ],
};
