import { Component, OnInit } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { NgIf } from '@angular/common';
import { FooterComponent } from './footer/footer.component';
import { NavbarComponent } from './navbar/navbar.component';
import { ThemeService } from './services/theme.service';
import { I18nService } from './services/i18n.service';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FooterComponent, NavbarComponent, NgIf],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  title = 'RosettaCloud-Frontend';
  isLabRoute = false;

  constructor(
    private themeService: ThemeService,
    private router: Router,
    private i18n: I18nService
  ) {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e: NavigationEnd) => {
        this.isLabRoute = e.urlAfterRedirects.startsWith('/lab/');
      });
  }

  ngOnInit(): void {
    this.i18n.setLang(this.i18n.lang());
  }
}
