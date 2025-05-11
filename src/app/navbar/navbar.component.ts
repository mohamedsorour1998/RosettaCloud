import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { Router, NavigationStart, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription, filter } from 'rxjs';

import { UserService, User } from '../services/user.service';
import { ThemeService } from '../services/theme.service';
/* Bootstrap ESM modules */
import Collapse from 'bootstrap/js/dist/collapse'; // Keep for Collapse
// Dropdown import is removed as we'll rely on data attributes

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent implements OnInit, AfterViewInit, OnDestroy {
  isLoggedIn = false;
  currentUser: User | null = null;

  /* collapse (burger) */
  @ViewChild('collapseRef', { static: false })
  collapseEl!: ElementRef<HTMLElement>;
  private collapse?: Collapse;

  /* avatar dropdown related properties are removed */
  // @ViewChild('dropToggle', { static: false })
  // dropToggleEl!: ElementRef<HTMLElement>;
  // private dropdown?: Dropdown; // Removed

  private subs: Subscription[] = [];

  constructor(
    private userSvc: UserService,
    private router: Router,
    public themeService: ThemeService
  ) {}

  ngOnInit(): void {
    this.subs.push(
      this.userSvc.currentUser$.subscribe((u) => {
        this.currentUser = u;
        this.isLoggedIn = !!u;

        // No longer need to manually re-initialize dropdown here
        // Bootstrap's data-bs-toggle will handle it when the element appears/re-appears
      })
    );

    /* Auto‑close burger when navigating */
    this.subs.push(
      this.router.events
        .pipe(filter((e) => e instanceof NavigationStart))
        .subscribe(() => this.collapse?.hide())
    );
  }

  ngAfterViewInit(): void {
    // Initialize collapse for mobile menu
    // Using a small timeout can help ensure the element is fully rendered,
    // especially in complex layouts or if there are parent *ngIf directives.
    setTimeout(() => {
      if (this.collapseEl?.nativeElement) {
        this.collapse = new Collapse(this.collapseEl.nativeElement, {
          toggle: false, // Initialize collapsed
        });
      }
      // Manual dropdown initialization is removed
    }, 100); // You can adjust or remove this timeout if collapse initializes reliably without it
  }

  // initializeDropdown method is removed

  get initials(): string {
    if (!this.currentUser?.name) return 'U';
    const p = this.currentUser.name.trim().split(/\s+/);
    return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  logout(): void {
    this.userSvc.logout();
    this.router.navigate(['/']);
    this.collapse?.hide(); // Hide burger menu on logout
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());

    // Dropdown disposal is removed as it's handled by global Bootstrap or not needed
    // if (this.dropdown) {
    //   this.dropdown.dispose();
    // }

    if (this.collapse) {
      this.collapse.dispose();
    }
  }
}
