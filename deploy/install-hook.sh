#!/bin/bash
# Spielt deploy/post-receive auf den Linevast-Server auf.
set -euo pipefail
HOST="deploy@dein-server.example"
KEY="$HOME/.ssh/deploy_key"
HOOK="$(cd "$(dirname "$0")" && pwd)/post-receive"
scp -i "$KEY" "$HOOK" "$HOST:/home/deploy/git/dorfkino-reservierung.git/hooks/post-receive"
ssh -i "$KEY" "$HOST" 'chmod +x /home/deploy/git/dorfkino-reservierung.git/hooks/post-receive && echo "Hook aufgespielt."'
