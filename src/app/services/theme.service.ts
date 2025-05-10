import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark' | 'auto';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  // Use signal for reactive updates
  currentTheme = signal<Theme>('dark');

  constructor() {
    this.initializeTheme();
  }

  private initializeTheme(): void {
    // Check localStorage first
    const storedTheme = localStorage.getItem('theme') as Theme;

    if (storedTheme && ['light', 'dark', 'auto'].includes(storedTheme)) {
      this.currentTheme.set(storedTheme);
    } else if (
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      // If no stored theme, check system preference
      this.currentTheme.set('dark');
    } else {
      this.currentTheme.set('light');
    }

    // Apply the theme
    this.applyTheme(this.currentTheme());

    // Listen for system preference changes if in auto mode
    if (this.currentTheme() === 'auto') {
      this.setupSystemPreferenceListener();
    }
  }

  public setTheme(theme: Theme): void {
    this.currentTheme.set(theme);
    localStorage.setItem('theme', theme);
    this.applyTheme(theme);
  }

  public toggleTheme(): void {
    const newTheme = this.currentTheme() === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
  }

  private applyTheme(theme: Theme): void {
    if (theme === 'auto') {
      // Use system preference
      const systemPrefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)'
      ).matches;
      document.documentElement.setAttribute(
        'data-bs-theme',
        systemPrefersDark ? 'dark' : 'light'
      );
      this.setupSystemPreferenceListener();
    } else {
      // Remove any listeners when not in auto mode
      window
        .matchMedia('(prefers-color-scheme: dark)')
        .removeEventListener('change', this.handleSystemPreferenceChange);
      // Set specific theme
      document.documentElement.setAttribute('data-bs-theme', theme);
    }
  }

  private setupSystemPreferenceListener(): void {
    // Make sure to remove any existing listeners first
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .removeEventListener('change', this.handleSystemPreferenceChange);
    // Then add the listener
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', this.handleSystemPreferenceChange);
  }

  private handleSystemPreferenceChange = (e: MediaQueryListEvent): void => {
    if (this.currentTheme() === 'auto') {
      document.documentElement.setAttribute(
        'data-bs-theme',
        e.matches ? 'dark' : 'light'
      );
    }
  };
}
