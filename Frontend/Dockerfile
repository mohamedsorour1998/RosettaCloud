FROM node:24-alpine AS builder

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN npm install -g @angular/cli && \
    npm install --legacy-peer-deps --unsafe-perm --force && \
    ng build --configuration=production

FROM nginx:alpine

COPY --from=builder /usr/src/app/dist/rosetta-cloud-frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
