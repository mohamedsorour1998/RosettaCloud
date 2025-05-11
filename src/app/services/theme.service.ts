// src/app/services/theme.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private themeSubject = new BehaviorSubject<string>(this.getInitialTheme());
  theme$ = this.themeSubject.asObservable();

  constructor() {
    // Apply the initial theme when service starts
    this.applyTheme(this.themeSubject.value);
  }

  private getInitialTheme(): string {
    // Check localStorage first
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme === 'dark' || storedTheme === 'light') {
      return storedTheme;
    }

    // Check system preference as fallback
    if (
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }

    // Default to light
    return 'light';
  }

  // Get current theme
  currentTheme(): string {
    return this.themeSubject.value;
  }

  // Toggle between light and dark
  toggleTheme(): void {
    const newTheme = this.themeSubject.value === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
  }

  // Set theme explicitly
  setTheme(theme: string): void {
    if (theme !== 'dark' && theme !== 'light') {
      console.error('Invalid theme value:', theme);
      return;
    }

    // Update the subject
    this.themeSubject.next(theme);

    // Save to localStorage
    localStorage.setItem('theme', theme);

    // Apply to document
    this.applyTheme(theme);
  }

  // Apply theme to document
  private applyTheme(theme: string): void {
    document.documentElement.setAttribute('data-bs-theme', theme);
    console.log(`Theme applied: ${theme}`);
  }
}
