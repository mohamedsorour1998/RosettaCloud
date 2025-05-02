import { Injectable } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
} from '@angular/router';
import { UserService } from '../services/user.service';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate {
  constructor(private userService: UserService, private router: Router) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): boolean {
    const isLoggedIn = this.checkIfUserIsLoggedIn();

    if (!isLoggedIn) {
      // Store the attempted URL for redirecting after login
      sessionStorage.setItem('redirectUrl', state.url);

      // Redirect to login page
      this.router.navigate(['/login']);
      return false;
    }

    return true;
  }

  private checkIfUserIsLoggedIn(): boolean {
    return this.userService.isLoggedIn();
  }
}
