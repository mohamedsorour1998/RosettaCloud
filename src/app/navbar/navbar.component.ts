import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  HostListener,
  Renderer2,
  NgZone,
} from '@angular/core';
import { Router, NavigationStart, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription, filter } from 'rxjs';

import { UserService, User } from '../services/user.service';
import { ThemeService } from '../services/theme.service';
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
  isMenuOpen = false;
  isScrolled = false;

  @ViewChild('collapseRef', { static: false })
  collapseEl!: ElementRef<HTMLElement>;
  private collapse?: Collapse;

  private subs: Subscription[] = [];

  constructor(
    private userSvc: UserService,
    private router: Router,
    public themeService: ThemeService,
    private renderer: Renderer2,
    private ngZone: NgZone
  ) {}

  @HostListener('window:scroll')
  onWindowScroll() {
    this.isScrolled = window.scrollY > 10;
  }

  ngOnInit(): void {
    this.subs.push(
      this.userSvc.currentUser$.subscribe((u) => {
        this.currentUser = u;
        this.isLoggedIn = !!u;
      })
    );

    this.subs.push(
      this.router.events
        .pipe(filter((e) => e instanceof NavigationStart))
        .subscribe(() => this.hideMobileMenu())
    );

    this.onWindowScroll();
  }

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => {
      setTimeout(() => {
        if (!this.collapseEl) return;

        this.collapse = new Collapse(this.collapseEl.nativeElement, {
          toggle: false,
        });

        this.collapseEl.nativeElement.addEventListener(
          'shown.bs.collapse',
          () => {
            this.ngZone.run(() => {
              this.isMenuOpen = true;
              this.disableBodyScroll();
            });
          }
        );

        this.collapseEl.nativeElement.addEventListener(
          'hidden.bs.collapse',
          () => {
            this.ngZone.run(() => {
              this.isMenuOpen = false;
              this.enableBodyScroll();
            });
          }
        );
      }, 100);
    });
  }

  toggleMenu(): void {
    this.collapse?.toggle();
  }

  hideMobileMenu(): void {
    if (this.collapse && this.isMenuOpen) {
      this.collapse.hide();
    }
  }

  private disableBodyScroll(): void {
    this.renderer.addClass(document.body, 'overflow-hidden');
    this.renderer.addClass(document.body, 'mobile-menu-open');
  }

  private enableBodyScroll(): void {
    this.renderer.removeClass(document.body, 'overflow-hidden');
    this.renderer.removeClass(document.body, 'mobile-menu-open');
  }

  get initials(): string {
    if (!this.currentUser?.name) return 'U';
    const p = this.currentUser.name.trim().split(/\s+/);
    return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  logout(e: Event): void {
    e.preventDefault();
    this.userSvc.logout();
    this.router.navigate(['/']);
    this.hideMobileMenu();
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.collapse?.dispose();
    this.enableBodyScroll();
  }
}
