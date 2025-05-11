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
import Collapse from 'bootstrap/js/dist/collapse';

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
    setTimeout(() => {
      if (this.collapseEl?.nativeElement) {
        this.collapse = new Collapse(this.collapseEl.nativeElement, {
          toggle: false, // Initialize collapsed
        });
      }
    }, 100);
  }

  /**
   * Toggle the mobile menu open/closed
   * This explicitly handles both opening and closing
   */
  toggleMenu(): void {
    if (this.collapse) {
      if (this.collapseEl.nativeElement.classList.contains('show')) {
        this.collapse.hide();
      } else {
        this.collapse.show();
      }
    }
  }

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

    if (this.collapse) {
      this.collapse.dispose();
    }
  }
}
