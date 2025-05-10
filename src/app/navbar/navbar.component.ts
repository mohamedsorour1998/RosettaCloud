import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ViewChildren,
  ElementRef,
  QueryList,
} from '@angular/core';
import { Router, NavigationStart, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription, filter } from 'rxjs';

import { UserService, User } from '../services/user.service';

/* Bootstrap ESM modules */
import Collapse from 'bootstrap/js/dist/collapse';
import Dropdown from 'bootstrap/js/dist/dropdown';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent implements OnInit, AfterViewInit, OnDestroy {
  /* ------------------------------------------------------------------ */
  isLoggedIn = false;
  currentUser: User | null = null;

  /* collapse (burger) */
  @ViewChild('collapseRef', { static: false })
  collapseEl!: ElementRef<HTMLElement>;
  private collapse?: Collapse;

  /* avatar dropdowns */
  @ViewChildren('dropToggle')
  dropToggles!: QueryList<ElementRef<HTMLElement>>;
  private dropdowns: Dropdown[] = [];

  private subs: Subscription[] = [];

  /* ------------------------------------------------------------------ */
  constructor(private userSvc: UserService, private router: Router) {}

  ngOnInit(): void {
    this.subs.push(
      this.userSvc.currentUser$.subscribe((u) => {
        this.currentUser = u;
        this.isLoggedIn = !!u;
        this.refreshDropdowns();
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
    this.collapse = new Collapse(this.collapseEl.nativeElement, {
      toggle: false,
    });

    /* build dropdowns initially + whenever toggles list changes */
    this.dropToggles.changes.subscribe(() => this.refreshDropdowns());
    this.refreshDropdowns();
  }

  /* ------------------------------------------------------------------ */
  get initials(): string {
    if (!this.currentUser?.name) return 'U';
    const p = this.currentUser.name.trim().split(/\s+/);
    return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  logout(): void {
    this.userSvc.logout();
    this.router.navigate(['/']);
    this.collapse?.hide();
  }

  /* ------------------------------------------------------------------ */
  private refreshDropdowns(): void {
    /* dispose old instances */
    this.dropdowns.forEach((d) => d.dispose());
    this.dropdowns = [];

    /* create new ones if logged‑in */
    if (this.isLoggedIn) {
      this.dropdowns = this.dropToggles.map(
        (el) => new Dropdown(el.nativeElement) // default autoClose behaviour
      );
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.dropdowns.forEach((d) => d.dispose());
    this.collapse?.dispose();
  }
}
