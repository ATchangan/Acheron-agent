#!/usr/bin/env bash
set -euo pipefail

log() { printf '[install-agent-plugin-v2] %s\n' "$*" >&2; }
fail() { printf '[install-agent-plugin-v2][ERROR] %s\n' "$*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }

# Target user/home detection follows the legacy Agent installer convention:
#   1. INSTALL_AS_USER, 2. SUDO_USER, 3. current user.
USERNAME="${INSTALL_AS_USER:-${SUDO_USER:-$(whoami)}}"
USER_HOME="$(eval echo "~$USERNAME")"

FORCE="${FORCE:-0}"
ALLOW_SYSTEM_PYTHON="${ALLOW_SYSTEM_PYTHON:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROVIDER_SRC="${AGENT_PROVIDER_SRC:-$REPO_ROOT/agent-plugin/memory/memory_tencentdb}"

AGENT_HOME="${AGENT_HOME:-$USER_HOME/.agent}"
AGENT_AGENT_DIR="${AGENT_AGENT_DIR:-$AGENT_HOME/agent-agent}"
AGENT_CONFIG="${AGENT_CONFIG:-$AGENT_HOME/config.yaml}"
AGENT_ENV="${AGENT_ENV:-$AGENT_HOME/.env}"
AGENT_MEMORY_PLUGIN_DIR="${AGENT_MEMORY_PLUGIN_DIR:-$AGENT_AGENT_DIR/plugins/memory}"
PROVIDER_TARGET="$AGENT_MEMORY_PLUGIN_DIR/memory_tencentdb"

TDAI_MEMORY_ENDPOINT="${TDAI_MEMORY_ENDPOINT:-http://127.0.0.1:8420}"
TDAI_MEMORY_API_KEY="${TDAI_MEMORY_API_KEY:-local}"
TDAI_MEMORY_SERVICE_ID="${TDAI_MEMORY_SERVICE_ID:-default}"
WRITE_AGENT_ENV="${WRITE_AGENT_ENV:-1}"
WRITE_AGENT_CONFIG="${WRITE_AGENT_CONFIG:-1}"

if [[ ! -d "$PROVIDER_SRC" ]]; then
  fail "Agent provider directory not found: $PROVIDER_SRC"
fi

if [[ ! -d "$AGENT_AGENT_DIR" ]]; then
  log "WARN: Agent agent dir not found: $AGENT_AGENT_DIR"
  log "      Set AGENT_AGENT_DIR if Agent is installed elsewhere."
fi

log "Installing Agent provider"
mkdir -p "$AGENT_MEMORY_PLUGIN_DIR"
if [[ -e "$PROVIDER_TARGET" || -L "$PROVIDER_TARGET" ]]; then
  if [[ "$FORCE" == "1" ]]; then
    rm -rf "$PROVIDER_TARGET"
  else
    fail "target already exists: $PROVIDER_TARGET (set FORCE=1 to overwrite)"
  fi
fi
ln -s "$PROVIDER_SRC" "$PROVIDER_TARGET"
log "Provider linked: $PROVIDER_TARGET -> $PROVIDER_SRC"

log "Checking Agent config"
if [[ "$WRITE_AGENT_CONFIG" == "1" ]]; then
  log "Enabling memory.provider=memory_tencentdb in $AGENT_CONFIG"
  mkdir -p "$(dirname "$AGENT_CONFIG")"
  if [[ -f "$AGENT_CONFIG" ]]; then
    cp "$AGENT_CONFIG" "$AGENT_CONFIG.bak.$(date +%Y%m%d%H%M%S)"
  fi

  AGENT_CONFIG="$AGENT_CONFIG" python3 <<'PY'
import os
import re
from pathlib import Path

path = Path(os.environ["AGENT_CONFIG"])
provider_line = "  provider: memory_tencentdb"


def update_with_pyyaml(text: str) -> str:
    import yaml
    data = yaml.safe_load(text) if text.strip() else {}
    if not isinstance(data, dict):
        data = {}
    memory = data.get("memory")
    if not isinstance(memory, dict):
        memory = {}
    data["memory"] = memory
    memory["provider"] = "memory_tencentdb"
    return yaml.safe_dump(data, sort_keys=False, allow_unicode=True)


def update_minimal(text: str) -> str:
    lines = text.splitlines()
    memory_start = None
    memory_end = None
    for i, line in enumerate(lines):
        if re.match(r"^memory\s*:\s*(#.*)?$", line):
            memory_start = i
            memory_end = len(lines)
            for j in range(i + 1, len(lines)):
                if lines[j] and not lines[j].startswith((" ", "\t")):
                    memory_end = j
                    break
            break

    if memory_start is None:
        if lines and lines[-1].strip():
            lines.append("")
        lines.extend(["memory:", provider_line])
        return "\n".join(lines) + "\n"

    for i in range(memory_start + 1, memory_end):
        if re.match(r"^\s*provider\s*:", lines[i]):
            indent = re.match(r"^(\s*)", lines[i]).group(1) or "  "
            lines[i] = f"{indent}provider: memory_tencentdb"
            return "\n".join(lines) + "\n"

    insert_at = memory_start + 1
    lines.insert(insert_at, provider_line)
    return "\n".join(lines) + "\n"


text = path.read_text() if path.exists() else ""
try:
    updated = update_with_pyyaml(text)
except Exception:
    updated = update_minimal(text)
path.write_text(updated)
PY
else
  if [[ -f "$AGENT_CONFIG" ]] && sed -n '/^memory:/,/^[[:alpha:]_][[:alnum:]_]*:/p' "$AGENT_CONFIG" | grep -q 'provider: memory_tencentdb'; then
    log "memory.provider already set to memory_tencentdb"
  else
    log "Provider installed but NOT enabled because WRITE_AGENT_CONFIG=$WRITE_AGENT_CONFIG. Add/edit in $AGENT_CONFIG:"
    cat >&2 <<'EOF'

memory:
  provider: memory_tencentdb
EOF
  fi
fi

_update_env() {
  local key="$1"
  local value="$2"
  local file="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  local tmp
  tmp="$(mktemp)"
  grep -v -E "^(# *)?${key}=" "$file" > "$tmp" || true
  local escaped="$value"
  escaped="${escaped//\\/\\\\}"
  escaped="${escaped//\"/\\\"}"
  printf '%s="%s"\n' "$key" "$escaped" >> "$tmp"
  mv "$tmp" "$file"
}

if [[ "$WRITE_AGENT_ENV" == "1" ]]; then
  log "Writing Memory SDK env vars to $AGENT_ENV"
  _update_env "TDAI_MEMORY_ENDPOINT" "$TDAI_MEMORY_ENDPOINT" "$AGENT_ENV"
  _update_env "TDAI_MEMORY_API_KEY" "$TDAI_MEMORY_API_KEY" "$AGENT_ENV"
  _update_env "TDAI_MEMORY_SERVICE_ID" "$TDAI_MEMORY_SERVICE_ID" "$AGENT_ENV"
fi

cat >&2 <<EOF

[install-agent-plugin-v2] Done.
Provider installed at:
  $PROVIDER_TARGET

Agent config:
  $AGENT_CONFIG
  memory.provider = memory_tencentdb

Gateway env (written to $AGENT_ENV):
  TDAI_MEMORY_ENDPOINT="$TDAI_MEMORY_ENDPOINT"
  TDAI_MEMORY_API_KEY="$TDAI_MEMORY_API_KEY"
  TDAI_MEMORY_SERVICE_ID="$TDAI_MEMORY_SERVICE_ID"
EOF
