# syntax=docker/dockerfile:1

# ---- Build stage: Angular 22 SPA (requires Node >= 24.15) ----
# Use a glibc base (bookworm-slim) to exactly match the proven CI build runtime.
FROM node:24-bookworm-slim AS build
WORKDIR /app
# Install from the committed lockfile first for reproducible, cacheable deps.
COPY package.json package-lock.json ./
RUN npm ci
# Build the production bundle -> dist/rosetta-cloud-frontend/browser
COPY . .
RUN npm run build

# ---- Runtime stage: hardened, non-root nginx serving the static SPA on :8080 ----
FROM nginx:1.27-alpine AS runtime
# Replace the entire main nginx config: pid + all temp paths under /tmp, logs to
# stdout/stderr, listen on unprivileged :8080. This makes the container work with
# readOnlyRootFilesystem=true when /tmp is provided as an emptyDir volume.
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist/rosetta-cloud-frontend/browser /usr/share/nginx/html
EXPOSE 8080
# Run as a non-root uid (matches the k8s securityContext runAsUser: 1000).
USER 1000
STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]
