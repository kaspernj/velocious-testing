# Canonical source-independent development image for @velocious/testing.
FROM ubuntu:26.04@sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb

ARG NODEJS_VERSION=24.18.1-1nodesource1
ARG NODESOURCE_KEY_SHA256=b42e0321dabdc24e892115da705cf061167eac12a317f23d329862d0aa0a271d

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    wget \
    git \
    git-lfs \
    gh \
    openssh-client \
    gnupg \
    jq \
    ripgrep \
    fd-find \
    fzf \
    less \
    file \
    tree \
    bat \
    nano \
    vim-tiny \
    unzip \
    zip \
    xz-utils \
    bzip2 \
    tar \
    gzip \
    rsync \
    patch \
    diffutils \
    gawk \
    findutils \
    coreutils \
    procps \
    psmisc \
    lsof \
    iproute2 \
    iputils-ping \
    dnsutils \
    netcat-openbsd \
    socat \
    util-linux \
    tini \
    python3 \
    python3-venv \
    python3-pip \
    sqlite3 \
    shellcheck \
    tmux \
    zsh \
    man-db \
    build-essential \
    pkg-config \
    libssl-dev \
  && install -d -m 0755 /etc/apt/keyrings \
  && curl --fail --silent --show-error --location https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key --output /etc/apt/keyrings/nodesource.asc \
  && echo "${NODESOURCE_KEY_SHA256}  /etc/apt/keyrings/nodesource.asc" | sha256sum --check --strict - \
  && gpg --dearmor --output /etc/apt/keyrings/nodesource.gpg /etc/apt/keyrings/nodesource.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
  && apt-get update \
  && apt-get install --yes --no-install-recommends "nodejs=${NODEJS_VERSION}" \
  && ln --symbolic /usr/bin/fdfind /usr/local/bin/fd \
  && ln --symbolic /usr/bin/batcat /usr/local/bin/bat \
  && test "$(node --version)" = "v${NODEJS_VERSION%-1nodesource1}" \
  && rm -rf /var/lib/apt/lists/*

RUN test "$(id -u ubuntu)" = "1000" \
  && test "$(id -g ubuntu)" = "1000" \
  && usermod --login dev --home /home/dev --move-home ubuntu \
  && groupmod --new-name dev ubuntu

ADD https://registry.npmjs.org/@moonshot-ai/kimi-code/latest /tmp/cli-metadata/kimi-code.json
ADD https://registry.npmjs.org/@openai/codex/latest /tmp/cli-metadata/codex.json
ADD https://registry.npmjs.org/@anthropic-ai/claude-code/latest /tmp/cli-metadata/claude-code.json
ADD https://registry.npmjs.org/opencode-ai/latest /tmp/cli-metadata/opencode.json

RUN npm install --global --prefix /usr/local \
    --strict-allow-scripts \
    --allow-scripts="@anthropic-ai/claude-code,@moonshot-ai/kimi-code,node-pty,opencode-ai" \
    "@moonshot-ai/kimi-code" \
    "@openai/codex" \
    "@anthropic-ai/claude-code" \
    "opencode-ai" \
  && kimi --version \
  && codex --version \
  && claude --version \
  && opencode --version \
  && npm cache clean --force \
  && rm -rf /tmp/cli-metadata

USER dev
ENV HOME=/home/dev
WORKDIR /home/dev/velocious-testing
CMD ["sleep", "infinity"]
