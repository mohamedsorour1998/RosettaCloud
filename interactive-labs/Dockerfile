FROM codercom/code-server:latest

############################
# 1) PREREQUISITES
############################
USER root

RUN apt-get update \
     && apt-get install -y \
     nano \
     debian-keyring \
     debian-archive-keyring \
     apt-transport-https \
     curl \
     gnupg \
     && rm -rf /var/lib/apt/lists/*

RUN echo "root ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
     && echo "coder ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
############################
# 2) CODE-SERVER CONFIGURATION
############################

RUN mkdir -p /data/User /data/extensions /data/logs /data/Machine \
     && chmod -R 777 /data \
     && chown -R coder:coder /data
USER coder
RUN printf '%s\n' \
     '{' \
     '  "workbench.colorTheme": "Default Dark+",' \
     '  "workbench.preferredDarkColorTheme": "Default Dark+",' \
     '  "auto-run-command.commands": [' \
     '    { "command": "workbench.action.terminal.toggleTerminal" }' \
     '  ]' \
     '}' \
     > /data/User/settings.json

RUN code-server \
     --extensions-dir /data/extensions \
     --user-data-dir /data \
     --install-extension ms-python.python \
     # --install-extension amazonwebservices.aws-toolkit-vscode \
     # --install-extension editorconfig.editorconfig \
     # --install-extension esbenp.prettier-vscode \
     # --install-extension formulahendry.auto-close-tag \
     # --install-extension formulahendry.auto-rename-tag \
     # --install-extension formulahendry.code-runner \
     # --install-extension github.copilot \
     # --install-extension github.copilot-chat \
     # --install-extension github.vscode-github-actions \
     # --install-extension hashicorp.terraform \
     # --install-extension hussamadil.ayat \
     # --install-extension mechatroner.rainbow-csv \
     # --install-extension mellowmarshmallow.groovy \
     # --install-extension mongodb.mongodb-vscode \
     # --install-extension ms-azuretools.vscode-docker \
     # --install-extension ms-kubernetes-tools.vscode-kubernetes-tools \
     # --install-extension ms-python.black-formatter \
     # --install-extension ms-python.debugpy \
     # --install-extension ms-python.isort \
     # --install-extension ms-python.vscode-pylance \
     # --install-extension postman.postman-for-vscode \
     # --install-extension redhat.vscode-xml \
     # --install-extension redhat.vscode-yaml \
     # --install-extension sonarsource.sonarlint-vscode \
     # --install-extension streetsidesoftware.code-spell-checker \
     # --install-extension tomoki1207.pdf \
     # --install-extension tonybaloney.vscode-pets \
     # --install-extension vincaslt.highlight-matching-tag \
     # --install-extension visualstudioexptteam.intellicode-api-usage-examples \
     # --install-extension visualstudioexptteam.vscodeintellicode \
     # --install-extension wholroyd.jinja \
     # --install-extension zainchen.json \
     --install-extension zhuangtongfa.material-theme

############################
# 3) CADDY INSTALLATION & CONFIGURATION
############################
USER root

RUN curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
     | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
     && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
     | tee /etc/apt/sources.list.d/caddy-stable.list \
     && apt-get update \
     && apt-get install -y caddy \
     && rm -rf /var/lib/apt/lists/*

RUN printf '%s\n' \
     ':80 {' \
     '  header {' \
     '    -X-Frame-Options' \
     '    -Content-Security-Policy' \
     '    Content-Security-Policy "frame-ancestors *"' \
     '  }' \
     '  reverse_proxy 127.0.0.1:8080' \
     '}' \
     > /etc/caddy/Caddyfile \
     && caddy fmt --overwrite /etc/caddy/Caddyfile

############################
# 4) STARTUP SCRIPT
############################
RUN printf '%s\n' \
     '#!/usr/bin/env bash' \
     'set -e' \
     'caddy run --config /etc/caddy/Caddyfile &' \
     'sudo -u coder /usr/bin/code-server \
     --host 127.0.0.1 \
     --port 8080 \
     --auth none \
     --user-data-dir /data \
     --extensions-dir /data/extensions \
     /home/coder/project' \
     > /usr/local/bin/start.sh \
     && chmod +x /usr/local/bin/start.sh

############################
# 5) RUNTIME
############################
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/start.sh"]