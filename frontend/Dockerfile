FROM node:24-alpine

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN npm install -g @angular/cli

RUN npm install --legacy-peer-deps --unsafe-perm --force

CMD ["ng", "serve", "--host", "0.0.0.0", "--disable-host-check"]
