import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ThemeService } from '../services/theme.service';

interface AccessibilityOption {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  icon: string;
}

interface AccessibilityCategory {
  id: string;
  title: string;
  description: string;
  options: AccessibilityOption[];
}

@Component({
  selector: 'app-accessibility',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './accessibility.component.html',
  styleUrls: ['./accessibility.component.scss'],
})
export class AccessibilityComponent implements OnInit {
  // Current font size (100% by default)
  fontSize: number = 100;

  // Store original body class for reset
  originalBodyClass: string = '';

  // Text direction options
  textDirection: 'ltr' | 'rtl' = 'ltr';

  // Categories of accessibility options
  categories: AccessibilityCategory[] = [
    {
      id: 'visual',
      title: 'Visual Preferences',
      description:
        'Adjust the visual appearance of the platform to make content easier to see.',
      options: [
        {
          id: 'high-contrast',
          name: 'High Contrast',
          description: 'Increases the color contrast for better visibility',
          enabled: false,
          icon: 'bi-contrast',
        },
        {
          id: 'reduce-motion',
          name: 'Reduce Motion',
          description: 'Minimizes animations and moving effects',
          enabled: false,
          icon: 'bi-skip-forward',
        },
        {
          id: 'dark-mode',
          name: 'Dark Mode',
          description: 'Switches between light and dark themes',
          enabled: false,
          icon: 'bi-moon-stars',
        },
      ],
    },
    {
      id: 'reading',
      title: 'Reading Preferences',
      description: 'Adjust text display to make content easier to read.',
      options: [
        {
          id: 'dyslexia-friendly',
          name: 'Dyslexia-Friendly Font',
          description: 'Uses a font designed for readers with dyslexia',
          enabled: false,
          icon: 'bi-fonts',
        },
        {
          id: 'increased-spacing',
          name: 'Increased Spacing',
          description: 'Adds more space between lines and paragraphs',
          enabled: false,
          icon: 'bi-text-indent-left',
        },
        {
          id: 'highlight-links',
          name: 'Highlight Links',
          description: 'Makes links more prominent throughout the platform',
          enabled: false,
          icon: 'bi-link-45deg',
        },
      ],
    },
    {
      id: 'interaction',
      title: 'Interaction Preferences',
      description: 'Adjust how you interact with the platform.',
      options: [
        {
          id: 'keyboard-navigation',
          name: 'Enhanced Keyboard Navigation',
          description: 'Improves focus indicators for keyboard users',
          enabled: false,
          icon: 'bi-keyboard',
        },
        {
          id: 'input-assistance',
          name: 'Input Assistance',
          description: 'Provides extra time for form inputs and interactions',
          enabled: false,
          icon: 'bi-input-cursor',
        },
      ],
    },
  ];

  // Page content
  pageTitle: string = 'Accessibility Settings';
  pageDescription: string =
    'Customize your experience to make our platform more accessible for your needs.';

  // Section content
  fontSizeTitle: string = 'Font Size';
  fontSizeDescription: string = 'Adjust the text size across the platform.';

  textDirectionTitle: string = 'Text Direction';
  textDirectionDescription: string =
    'Choose the reading direction for content.';

  profileSectionTitle: string = 'Accessibility Profile';
  profileSectionDescription: string =
    'Save your preferences for future sessions.';

  saveButtonText: string = 'Save Preferences';
  resetButtonText: string = 'Reset to Default';

  // Status messages
  settingsSavedMessage: string = 'Your accessibility settings have been saved.';
  settingsResetMessage: string =
    'Accessibility settings have been reset to default.';

  // Show status message
  showStatusMessage: boolean = false;
  statusMessage: string = '';

  constructor(private themeService: ThemeService) {}

  ngOnInit(): void {
    // Store original body class
    this.originalBodyClass = document.body.className;

    // Load saved settings if any
    this.loadSavedSettings();

    // Apply dark mode from theme service
    const currentTheme = this.themeService.currentTheme();
    const darkModeOption = this.findOption('dark-mode');
    if (darkModeOption) {
      darkModeOption.enabled = currentTheme === 'dark';
      this.applyDarkMode(darkModeOption.enabled);
    }
  }

  /**
   * Find an option by ID
   */
  findOption(optionId: string): AccessibilityOption | null {
    for (const category of this.categories) {
      const option = category.options.find((opt) => opt.id === optionId);
      if (option) return option;
    }
    return null;
  }

  /**
   * Toggle an accessibility option
   */
  toggleOption(option: AccessibilityOption): void {
    option.enabled = !option.enabled;

    switch (option.id) {
      case 'high-contrast':
        this.applyHighContrast(option.enabled);
        break;
      case 'reduce-motion':
        this.applyReduceMotion(option.enabled);
        break;
      case 'dark-mode':
        this.applyDarkMode(option.enabled);
        break;
      case 'dyslexia-friendly':
        this.applyDyslexiaFont(option.enabled);
        break;
      case 'increased-spacing':
        this.applyIncreasedSpacing(option.enabled);
        break;
      case 'highlight-links':
        this.applyHighlightLinks(option.enabled);
        break;
      case 'keyboard-navigation':
        this.applyKeyboardNavigation(option.enabled);
        break;
      case 'input-assistance':
        this.applyInputAssistance(option.enabled);
        break;
    }

    // Save settings automatically
    this.saveSettings();
  }

  /**
   * Apply high contrast mode
   */
  applyHighContrast(enabled: boolean): void {
    if (enabled) {
      document.body.classList.add('high-contrast-mode');
    } else {
      document.body.classList.remove('high-contrast-mode');
    }
  }

  /**
   * Apply reduced motion
   */
  applyReduceMotion(enabled: boolean): void {
    if (enabled) {
      document.body.classList.add('reduce-motion');
    } else {
      document.body.classList.remove('reduce-motion');
    }
  }

  /**
   * Apply dark mode
   */
  applyDarkMode(enabled: boolean): void {
    this.themeService.setTheme(enabled ? 'dark' : 'light');
  }

  /**
   * Apply dyslexia-friendly font
   */
  applyDyslexiaFont(enabled: boolean): void {
    if (enabled) {
      document.body.classList.add('dyslexia-font');
    } else {
      document.body.classList.remove('dyslexia-font');
    }
  }

  /**
   * Apply increased spacing
   */
  applyIncreasedSpacing(enabled: boolean): void {
    if (enabled) {
      document.body.classList.add('increased-spacing');
    } else {
      document.body.classList.remove('increased-spacing');
    }
  }

  /**
   * Apply highlight links
   */
  applyHighlightLinks(enabled: boolean): void {
    if (enabled) {
      document.body.classList.add('highlight-links');
    } else {
      document.body.classList.remove('highlight-links');
    }
  }

  /**
   * Apply keyboard navigation enhancements
   */
  applyKeyboardNavigation(enabled: boolean): void {
    if (enabled) {
      document.body.classList.add('enhanced-focus');
    } else {
      document.body.classList.remove('enhanced-focus');
    }
  }

  /**
   * Apply input assistance
   */
  applyInputAssistance(enabled: boolean): void {
    if (enabled) {
      document.body.classList.add('input-assistance');
    } else {
      document.body.classList.remove('input-assistance');
    }
  }

  /**
   * Increase font size
   */
  increaseFontSize(): void {
    if (this.fontSize < 200) {
      this.fontSize += 10;
      this.applyFontSize();
    }
  }

  /**
   * Decrease font size
   */
  decreaseFontSize(): void {
    if (this.fontSize > 70) {
      this.fontSize -= 10;
      this.applyFontSize();
    }
  }

  /**
   * Apply font size change
   */
  applyFontSize(): void {
    document.documentElement.style.setProperty(
      '--font-size-multiplier',
      `${this.fontSize / 100}`
    );
    this.saveSettings();
  }

  /**
   * Change text direction
   */
  changeTextDirection(direction: 'ltr' | 'rtl'): void {
    this.textDirection = direction;
    document.documentElement.dir = direction;
    this.saveSettings();
  }

  /**
   * Save all settings
   */
  saveSettings(): void {
    // Create settings object
    const settings = {
      fontSize: this.fontSize,
      textDirection: this.textDirection,
      options: this.categories.map((category) => {
        return {
          categoryId: category.id,
          options: category.options.map((option) => {
            return {
              id: option.id,
              enabled: option.enabled,
            };
          }),
        };
      }),
    };

    // Save to localStorage
    localStorage.setItem('accessibility_settings', JSON.stringify(settings));
  }

  /**
   * Manually save settings (button click)
   */
  saveSettingsManually(): void {
    this.saveSettings();
    this.showStatusMessage = true;
    this.statusMessage = this.settingsSavedMessage;

    // Hide message after 3 seconds
    setTimeout(() => {
      this.showStatusMessage = false;
    }, 3000);
  }

  /**
   * Load saved settings
   */
  loadSavedSettings(): void {
    const savedSettings = localStorage.getItem('accessibility_settings');
    if (!savedSettings) return;

    try {
      const settings = JSON.parse(savedSettings);

      // Apply font size
      if (settings.fontSize) {
        this.fontSize = settings.fontSize;
        this.applyFontSize();
      }

      // Apply text direction
      if (settings.textDirection) {
        this.textDirection = settings.textDirection;
        document.documentElement.dir = this.textDirection;
      }

      // Apply options
      if (settings.options) {
        settings.options.forEach((categorySetting: any) => {
          const category = this.categories.find(
            (c) => c.id === categorySetting.categoryId
          );
          if (category) {
            categorySetting.options.forEach((optionSetting: any) => {
              const option = category.options.find(
                (o) => o.id === optionSetting.id
              );
              if (option && option.enabled !== optionSetting.enabled) {
                option.enabled = optionSetting.enabled;
                this.toggleOption(option);
              }
            });
          }
        });
      }
    } catch (error) {
      console.error('Error loading accessibility settings:', error);
    }
  }

  /**
   * Reset all settings to default
   */
  resetSettings(): void {
    // Reset font size
    this.fontSize = 100;
    document.documentElement.style.removeProperty('--font-size-multiplier');

    // Reset text direction
    this.textDirection = 'ltr';
    document.documentElement.dir = 'ltr';

    // Reset all options
    this.categories.forEach((category) => {
      category.options.forEach((option) => {
        if (option.enabled) {
          option.enabled = false;

          switch (option.id) {
            case 'high-contrast':
              this.applyHighContrast(false);
              break;
            case 'reduce-motion':
              this.applyReduceMotion(false);
              break;
            case 'dark-mode':
              // Don't reset dark mode from here
              break;
            case 'dyslexia-friendly':
              this.applyDyslexiaFont(false);
              break;
            case 'increased-spacing':
              this.applyIncreasedSpacing(false);
              break;
            case 'highlight-links':
              this.applyHighlightLinks(false);
              break;
            case 'keyboard-navigation':
              this.applyKeyboardNavigation(false);
              break;
            case 'input-assistance':
              this.applyInputAssistance(false);
              break;
          }
        }
      });
    });

    // Clear saved settings
    localStorage.removeItem('accessibility_settings');

    // Show status message
    this.showStatusMessage = true;
    this.statusMessage = this.settingsResetMessage;

    // Hide message after 3 seconds
    setTimeout(() => {
      this.showStatusMessage = false;
    }, 3000);
  }
}
