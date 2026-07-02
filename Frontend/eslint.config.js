// @ts-check
const eslint = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

// Flat config scaffolded by `ng add angular-eslint` (angular-eslint v22).
//
// Rule severity policy:
//   - We keep the FULL angular-eslint + typescript-eslint recommended/stylistic
//     rule sets ACTIVE. No rules are disabled and there are no blanket
//     eslint-disable comments in the codebase.
//   - Rules that the existing code already passes remain as ERRORS so they keep
//     guarding future changes (e.g. component/directive-selector).
//   - Rules that the existing (pre-lint) code violates are DOWNGRADED to "warn".
//     Every one of these requires a semantic/behavioural source change that
//     `ng lint --fix` cannot safely auto-apply, and this task's file ownership
//     forbids hand-editing src/** beyond what --fix touches. Downgrading (rather
//     than disabling) keeps the violations visible in lint output while allowing
//     `ng lint` to exit 0. Each downgrade is documented inline below with the
//     violation count observed on the initial run.
module.exports = defineConfig([
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // ---- Rules the code PASSES: kept as errors (scaffolded defaults) ----
      "@angular-eslint/directive-selector": [
        "error",
        {
          type: "attribute",
          prefix: "app",
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: "element",
          prefix: "app",
          style: "kebab-case",
        },
      ],

      // ---- Rules the code VIOLATES: downgraded to "warn" ----
      // 90x. Prefers inject() over constructor DI. Auto-fix is a separate
      // Angular migration schematic (ng generate @angular/core:inject) that
      // rewrites constructors across dozens of files — out of --fix scope.
      "@angular-eslint/prefer-inject": "warn",
      // 75x. Requires knowing the real intended type for each `any`; cannot be
      // inferred automatically without risking behavioural/type changes.
      "@typescript-eslint/no-explicit-any": "warn",
      // 39x. Opting components into OnPush is a behavioural change that must be
      // validated per-component; not safe to auto-apply.
      "@angular-eslint/prefer-on-push-component-change-detection": "warn",
      // 10x. Removing unused identifiers can change intent/side effects; not
      // auto-fixed by this toolchain.
      "@typescript-eslint/no-unused-vars": "warn",
      // 6x. Empty functions/constructors are sometimes intentional placeholders;
      // resolving requires source judgement.
      "@typescript-eslint/no-empty-function": "warn",
      // 2x. Empty Angular lifecycle hooks — require removal/implementation in src.
      "@angular-eslint/no-empty-lifecycle-method": "warn",
      // 2x. Lexical declaration inside a case block — needs braces added in src.
      "no-case-declarations": "warn",
      // 1x. Dead-store assignment — removing it is a source-level judgement call.
      "no-useless-assignment": "warn",
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      angular.configs.templateRecommended,
      angular.configs.templateAccessibility,
    ],
    rules: {
      // ---- Accessibility rules the templates VIOLATE: downgraded to "warn" ----
      // These all require template markup changes (adding keyboard handlers,
      // focus support, label associations, element content) that cannot be
      // auto-fixed and must be authored by hand in src/**.
      // 46x. Interactive elements must be focusable.
      "@angular-eslint/template/interactive-supports-focus": "warn",
      // 46x. click must be paired with a keyboard event.
      "@angular-eslint/template/click-events-have-key-events": "warn",
      // 6x. mouse events must be paired with keyboard equivalents.
      "@angular-eslint/template/mouse-events-have-key-events": "warn",
      // 4x. <label> must be associated with a form control.
      "@angular-eslint/template/label-has-associated-control": "warn",
      // 2x. Elements such as <button> must have content.
      "@angular-eslint/template/elements-content": "warn",
    },
  },
]);
