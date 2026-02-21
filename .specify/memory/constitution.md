<!--
  Sync Impact Report
  ==================
  Version change: N/A (initial) → 1.0.0
  Modified principles: N/A (initial creation)
  Added sections:
    - Core Principles (4): Code Quality, Testing Standards,
      UX Consistency, Performance Requirements
    - Technology Constraints
    - Development Workflow
    - Governance
  Removed sections: N/A
  Templates requiring updates:
    - .specify/templates/plan-template.md — ✅ no updates needed
      (Constitution Check section is already generic/dynamic)
    - .specify/templates/spec-template.md — ✅ no updates needed
      (requirements and success criteria sections are compatible)
    - .specify/templates/tasks-template.md — ✅ no updates needed
      (phase structure accommodates testing and polish tasks)
    - .specify/templates/checklist-template.md — ✅ no updates needed
      (generic category structure is compatible)
    - .specify/templates/commands/ — no command files exist
  Follow-up TODOs: none
-->

# RosettaCloud Constitution

## Core Principles

### I. Code Quality — Service/Backend Separation

All Backend feature areas MUST follow the established service/backend
split pattern:

- `app/services/*.py` contains business logic orchestration only;
  it MUST NOT contain direct AWS SDK calls, Kubernetes API calls,
  or Momento SDK calls.
- `app/backends/*.py` contains concrete implementations against
  external systems. Each backend module maps to exactly one service.
- New features MUST create both a service and a backend module.
  Placing external-system calls directly in route handlers or
  services is a constitution violation.

Frontend code MUST comply with Angular strict mode and strict
template checking as enforced in `tsconfig.json`. New components
MUST use the standalone component pattern (no NgModules). TypeScript
files MUST use 2-space indentation and single quotes per
`.editorconfig`.

### II. Testing Standards

**Frontend**: Every new Angular service and component MUST have a
corresponding `.spec.ts` file. Tests run via `ng test` (Karma +
Jasmine). New features MUST NOT reduce existing test coverage.

**Backend**: The Backend currently has no test suite. When tests are
introduced, they MUST use `pytest` and follow the pattern:
`tests/unit/`, `tests/integration/`. Tests MUST be runnable with
`pytest` from the `Backend/` directory without requiring a live
Kubernetes cluster or AWS credentials (mock external dependencies).

**Lambda functions**: Each Lambda (`ai_chatbot`, `document_indexer`,
`feedback_request`, `momento_token_vending`) MUST have its
dependencies fully declared in its own `requirements.txt` or
`package.json`. Lambda handlers MUST be testable in isolation by
mocking boto3/Momento clients.

**General**: Tests MUST NOT depend on network access, real AWS
services, or shared mutable state between test cases.

### III. User Experience Consistency

All user-facing API endpoints MUST return consistent JSON error
shapes. The FastAPI backend MUST define shared exception handlers
rather than per-route try/except blocks.

Frontend environment files (`Frontend/src/environments/`) MUST
define identical keys across all build targets (`environment.ts`,
`environment.development.ts`, `environment.uat.ts`,
`environment.stg.ts`). Adding a new environment key to one file
MUST be propagated to all four files.

Real-time features (feedback, lab status) MUST use Momento Topics
for pub/sub — not polling. The frontend MUST obtain disposable
Momento tokens from the `momento_token_vending` Lambda; it MUST
NOT embed long-lived Momento API keys in client-side code.

Lab provisioning MUST create all three Kubernetes resources (Pod,
Service, Ingress rule) atomically. If any resource creation fails,
previously created resources for that lab MUST be cleaned up.

### IV. Performance Requirements

**Frontend bundle budgets** are enforced in `angular.json`:

- Initial bundle: warning at 500 kB, error at 1 MB.
- Component styles: warning at 4 kB, error at 8 kB.
- New dependencies MUST NOT cause budget violations. If a
  dependency pushes the bundle over budget, it MUST be lazy-loaded
  or replaced with a lighter alternative.

**Lab provisioning** MUST complete (Pod + Service + Ingress) in
under 5 seconds. Active labs MUST be tracked in Momento cache with
a 1-hour TTL to prevent resource leaks.

**AI responses** (chatbot and feedback) MUST stream the first chunk
to the client within 1 second of request receipt. The RAG retriever
MUST limit results to `k=2` unless explicitly overridden.

**Backend API** MUST use async handlers (`async def`) for all
routes that call external services (Bedrock, DynamoDB, Kubernetes,
Momento, S3) to avoid blocking the event loop.

## Technology Constraints

- **Primary AWS region**: `me-central-1` (UAE). All infrastructure
  defaults to this region.
- **Bedrock and ACM**: `us-east-1` only. Code that calls Bedrock
  MUST explicitly configure `region_name='us-east-1'`.
- **Container images**: All images MUST be pushed to ECR in
  `me-central-1` (account `339712964409`).
- **Kubernetes namespace**: All K8s resources MUST target the
  `openedx` namespace.
- **CI/CD authentication**: GitHub Actions MUST use OIDC role
  assumption. Static AWS credentials MUST NOT be stored in GitHub
  Secrets or committed to the repository.
- **Python**: Backend and Python Lambdas target Python 3.9+.
  Use `aioboto3` (not synchronous `boto3`) in the FastAPI backend
  for all AWS service calls.
- **Node.js**: The `momento_token_vending` Lambda uses Node.js.
  Changes MUST NOT introduce Python dependencies into this function.

## Development Workflow

- Each of the three top-level directories (Frontend, Backend,
  DevSecOps) has its own GitHub Actions workflow at
  `.github/workflows/actions.yml`, triggered manually via
  `workflow_dispatch`.
- Changes to Lambda function code MUST update the corresponding
  Dockerfile or deployment package, not just the handler source.
- Terraform changes MUST be previewed with `terraform plan
  -var-file="terraform.tfvars"` before apply. The remote state
  bucket (`rosettacloud-shared-terraform-backend`) MUST NOT be
  modified or recreated without explicit approval.
- Kubernetes manifest changes MUST be validated against the
  `openedx` namespace. New Ingress rules for labs MUST use the
  wildcard pattern `*.labs.dev.rosettacloud.app`.

## Governance

This constitution is the authoritative source of non-negotiable
engineering standards for RosettaCloud. All code changes — whether
new features, bug fixes, or refactors — MUST comply with these
principles.

**Amendments**: Any change to this constitution MUST be documented
with a version bump, rationale, and updated `Last Amended` date.
Version changes follow semantic versioning:

- MAJOR: Principle removed or fundamentally redefined.
- MINOR: New principle or section added, or existing principle
  materially expanded.
- PATCH: Clarification, typo fix, or non-semantic refinement.

**Compliance**: Plan documents MUST include a Constitution Check
section that verifies alignment with these principles before
implementation begins. Refer to `CLAUDE.md` for runtime development
commands and architecture reference.

**Version**: 1.0.0 | **Ratified**: 2026-02-21 | **Last Amended**: 2026-02-21
