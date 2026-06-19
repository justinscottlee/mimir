# Mimir sandbox image — the container workspaces execute code in.
#
# The default SANDBOX_IMAGE is python:3.12-slim, which only has Python. This
# image trades a larger pull for a batteries-included toolchain so an agent can
# compile C/C++, build Rust and Go, and run Node or Python without first
# apt-installing anything (which only works when SANDBOX_NETWORK=bridge anyway).
#
# Build it as the tag the app expects:
#   docker compose build sandbox-image
#   # or, standalone:
#   docker build -t mimir-sandbox:latest ./sandbox
# Then point the sandbox at it with SANDBOX_IMAGE=mimir-sandbox:latest.
#
# The image only needs the tools present; it never runs as a server — Mimir
# starts it with `sleep infinity` and execs commands inside it.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    # Let `pip install` work against the system interpreter (Debian marks it as
    # externally managed under PEP 668; the sandbox is disposable, so allow it).
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONUNBUFFERED=1 \
    # Keep Go's caches inside the (writable) workspace area at runtime.
    GOFLAGS=-buildvcs=false

RUN apt-get update && apt-get install -y --no-install-recommends \
      # C / C++ toolchain
      build-essential \
      gcc \
      g++ \
      make \
      cmake \
      pkg-config \
      # Python
      python3 \
      python3-pip \
      python3-venv \
      python3-dev \
      # JavaScript / TypeScript
      nodejs \
      npm \
      # Go
      golang-go \
      # Rust
      rustc \
      cargo \
      # Common CLI tooling agents reach for
      git \
      curl \
      wget \
      ca-certificates \
      jq \
      ripgrep \
      unzip \
      zip \
      less \
      nano \
      procps \
    && rm -rf /var/lib/apt/lists/*

# A predictable, writable working directory matching the app's SANDBOX workdir.
WORKDIR /workspace

# Default command; Mimir overrides this with `sleep infinity` when it creates
# the container, but a sensible default keeps `docker run` usable for debugging.
CMD ["sleep", "infinity"]
