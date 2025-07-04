import { Injectable } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
  UrlTree,
} from '@angular/router';
import { Observable } from 'rxjs';
import { UserService } from '../services/user.service';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate {
  constructor(private userService: UserService, private router: Router) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ):
    | Observable<boolean | UrlTree>
    | Promise<boolean | UrlTree>
    | boolean
    | UrlTree {
    // Check if user is logged in
    if (this.userService.isLoggedIn()) {
      // Check role restrictions if specified
      const requiredRole = route.data['requiredRole'] as string;

      if (requiredRole) {
        const user = this.userService.getCurrentUser();

        if (user && user.role === requiredRole) {
          return true;
        } else {
          // Redirect to unauthorized page if role doesn't match
          return this.router.createUrlTree(['/unauthorized']);
        }
      }

      // No role restrictions or role matches
      return true;
    }

    // Store the attempted URL for redirecting after login
    const returnUrl = state.url;

    // Redirect to login page with return URL
    return this.router.createUrlTree(['/login'], {
      queryParams: { returnUrl },
    });
  }
}
