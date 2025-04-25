FROM docker:28-dind AS docker-engine
FROM codercom/code-server:noble

############################
# 1) PREREQUISITES
############################
USER root

RUN echo "root ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
     && echo "coder ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

RUN apt-get update && \
     DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
     nano \
     debian-keyring \
     debian-archive-keyring \
     apt-transport-https \
     curl \
     gnupg \
     iproute2 \
     iptables \
     skopeo \
     fuse-overlayfs \
     ca-certificates && \
     rm -rf /var/lib/apt/lists/*

# Install Python and pip
RUN sudo apt update && sudo apt install python3 python3-pip python-is-python3 -y

# Install Node and npm
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && \
     \. "coder/.nvm/nvm.sh" && \
     nvm install 22

# Install Docker
COPY --from=docker-engine /usr/local/bin/                  /usr/local/bin/
COPY --from=docker-engine /usr/local/libexec/docker/       /usr/local/libexec/docker/
COPY --from=docker-engine /usr/local/bin/dockerd-entrypoint.sh /usr/local/bin/
RUN groupadd -f docker && usermod -aG docker coder

# Setup Kubectl
RUN curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
     install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && \
     rm kubectl

# Install Kind and pull the kindest/node:v1.33.0 image
RUN [ $(uname -m) = x86_64 ] && curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.27.0/kind-linux-amd64 && \
     chmod +x ./kind && \
     mv ./kind /usr/local/bin/kind
RUN skopeo copy \
     docker://docker.io/kindest/node:v1.33.0 \
     docker-archive:/kind-node.tar:kindest/node:v1.33.0

# Install Helm
RUN curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 && \
     chmod 700 get_helm.sh && \
     ./get_helm.sh && \
     rm get_helm.sh

############################
# 2) CODE-SERVER CONFIGURATION
############################
RUN mkdir -p /data/User /data/extensions /data/logs /data/Machine \
     && chmod -R 777 /data \
     && chown -R coder:coder /data

RUN sed -i '/"reportIssueUrl":/a \
     "extensionsGallery": { \
     "serviceUrl": "https://marketplace.visualstudio.com/_apis/public/gallery", \
     "itemUrl": "https://marketplace.visualstudio.com/items" \
     },' \
     /usr/lib/code-server/lib/vscode/product.json

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
     --install-extension amazonwebservices.aws-toolkit-vscode \
     --install-extension editorconfig.editorconfig \
     --install-extension esbenp.prettier-vscode \
     --install-extension formulahendry.auto-close-tag \
     --install-extension formulahendry.auto-rename-tag \
     --install-extension formulahendry.code-runner \
     --install-extension github.copilot \
     --install-extension github.copilot-chat \
     --install-extension github.vscode-github-actions \
     --install-extension hashicorp.terraform \
     --install-extension hussamadil.ayat \
     --install-extension mechatroner.rainbow-csv \
     --install-extension mellowmarshmallow.groovy \
     --install-extension mongodb.mongodb-vscode \
     --install-extension ms-azuretools.vscode-docker \
     --install-extension ms-kubernetes-tools.vscode-kubernetes-tools \
     --install-extension ms-python.black-formatter \
     --install-extension ms-python.debugpy \
     --install-extension ms-python.isort \
     --install-extension ms-python.vscode-pylance \
     --install-extension redhat.vscode-xml \
     --install-extension redhat.vscode-yaml \
     --install-extension sonarsource.sonarlint-vscode \
     --install-extension streetsidesoftware.code-spell-checker \
     --install-extension tomoki1207.pdf \
     --install-extension tonybaloney.vscode-pets \
     --install-extension vincaslt.highlight-matching-tag \
     --install-extension visualstudioexptteam.intellicode-api-usage-examples \
     --install-extension visualstudioexptteam.vscodeintellicode \
     --install-extension wholroyd.jinja \
     --install-extension zainchen.json \
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
     'nohup dockerd-entrypoint.sh dockerd > /var/log/dockerd.log 2>&1 &' \
     'while ! docker info > /dev/null 2>&1; do sleep 1; done' \
     'docker load -i /kind-node.tar' \
     'kind create cluster --image=kindest/node:v1.33.0 --name rosettacloud' \
     'sudo -u code kubectl cluster-info --context kind-rosettacloud' \
     'sudo -u coder kind get kubeconfig --name rosettacloud > /home/coder/.kube/config' \
     'chmod 600 /home/coder/.kube/config' \
     'sudo -u code kubectl config use-context kind-rosettacloud' \
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