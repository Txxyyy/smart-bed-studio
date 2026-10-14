#!/bin/bash
# Claude Code 云端会话启动：对齐 .nvmrc 的 Node 版本并安装锁定依赖。
# 本地（Codex / 本机 Claude Code）不执行，沿用开发者自己的 nvm 环境。
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

want="$(tr -d ' \nv' < .nvmrc)"
have="$(node -v 2>/dev/null | tr -d 'v' || true)"

if [ "$have" != "$want" ]; then
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) arch="" ;;
  esac
  dir="$HOME/.cache/node-v$want"
  if [ -n "$arch" ] && [ ! -x "$dir/bin/node" ]; then
    name="node-v$want-linux-$arch"
    tmp="$(mktemp -d)"
    if curl -fsSL "https://nodejs.org/dist/v$want/$name.tar.xz" -o "$tmp/$name.tar.xz" \
      && curl -fsSL "https://nodejs.org/dist/v$want/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" \
      && (cd "$tmp" && grep " $name.tar.xz\$" SHASUMS256.txt | sha256sum -c - >/dev/null); then
      mkdir -p "$dir"
      tar -xJf "$tmp/$name.tar.xz" -C "$dir" --strip-components=1
    else
      echo "警告：无法下载 Node $want，继续使用当前 Node ${have:-未安装}" >&2
    fi
    rm -rf "$tmp"
  fi
  if [ -x "$dir/bin/node" ]; then
    export PATH="$dir/bin:$PATH"
    if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
      echo "export PATH=\"$dir/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
    fi
  fi
fi

# 容器状态会在 hook 完成后缓存，npm install 可复用已有 node_modules；锁文件不变时结果与 npm ci 一致。
npm install --no-audit --no-fund --loglevel=error
echo "Node $(node -v)，依赖已安装"
