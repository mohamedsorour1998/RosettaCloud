import {
  Component,
  OnInit,
  HostListener,
  ElementRef,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationStart } from '@angular/router';
import { UserService, User } from '../services/user.service';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent implements OnInit, OnDestroy {
  isCollapsed = true;
  isLoggedIn = false;
  isDropdownOpen = false;
  currentUser: User | null = null;

  private subscriptions: Subscription[] = [];

  constructor(
    private userService: UserService,
    private router: Router,
    private elementRef: ElementRef
  ) {}

  ngOnInit(): void {
    // Subscribe to user changes
    this.subscriptions.push(
      this.userService.currentUser$.subscribe((user) => {
        this.currentUser = user;
        this.isLoggedIn = !!user;
      })
    );

    // Close dropdown on navigation
    this.subscriptions.push(
      this.router.events
        .pipe(filter((event) => event instanceof NavigationStart))
        .subscribe(() => {
          this.isDropdownOpen = false;
          this.isCollapsed = true;
        })
    );
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  toggleNavbar(): void {
    this.isCollapsed = !this.isCollapsed;
  }

  toggleDropdown(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  // Close dropdown when clicking outside
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    // Check if click target is outside the component
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isDropdownOpen = false;
      return;
    }

    // Check if click target is outside the dropdown
    const target = event.target as HTMLElement;
    if (
      this.isDropdownOpen &&
      !target.closest('.dropdown-menu') &&
      !target.closest('.user-dropdown-toggle')
    ) {
      this.isDropdownOpen = false;
    }
  }

  getUserInitials(): string {
    if (!this.currentUser?.name) return 'U';

    const nameParts = this.currentUser.name.split(' ');
    if (nameParts.length === 1) {
      return nameParts[0].charAt(0).toUpperCase();
    }

    return (
      nameParts[0].charAt(0) + nameParts[nameParts.length - 1].charAt(0)
    ).toUpperCase();
  }

  logout(): void {
    this.userService.logout();
    this.router.navigate(['/']);
  }
}
