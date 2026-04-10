#!/usr/bin/env python3
"""
PreToolUse hook: blocks Write to draft-session-*-final.md and output/draft-week-*.md
unless a matching .verified sidecar exists AND its SHA-256 matches the content being written.

This is the defense-in-depth layer for the editorial-verify-draft.js gate. The verifier
script is the ONLY process that should ever write these files. The verifier writes the
content AND the sidecar atomically; anything else writing these paths without a sidecar
is almost certainly a hallucination bypass attempt.

Hook contract:
  input: JSON on stdin with tool_name and tool_input (file_path, content)
  output: empty JSON to allow, or exit code 2 with stderr to block
"""
import json
import sys
import re
import hashlib
import os

# Paths that require verification
GATED_PATTERNS = [
    re.compile(r'data/editorial/drafts/draft-session-\d+-final\.md$'),
    re.compile(r'output/draft-week-\d+\.md$'),
]

def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        print('{}')
        return

    tool_name = data.get('tool_name', '')
    if tool_name != 'Write':
        print('{}')
        return

    tool_input = data.get('tool_input', {}) or {}
    file_path = tool_input.get('file_path', '')
    if not file_path:
        print('{}')
        return

    # Normalise to forward slashes for matching
    normalised = file_path.replace('\\', '/')

    gated = False
    for pattern in GATED_PATTERNS:
        if pattern.search(normalised):
            gated = True
            break

    if not gated:
        print('{}')
        return

    # Gated file — require a matching .verified sidecar
    content = tool_input.get('content', '')
    sidecar_path = file_path + '.verified'

    if not os.path.exists(sidecar_path):
        sys.stderr.write(
            f'BLOCKED: writing to {file_path} requires a .verified sidecar.\n'
            f'These paths are the output of scripts/editorial-verify-draft.js.\n'
            f'Do not write them directly. Write to draft-session-N-v2.md first,\n'
            f'then invoke the verifier which will produce the final file and sidecar.\n'
        )
        sys.exit(2)

    try:
        with open(sidecar_path, 'r') as f:
            sidecar = json.load(f)
    except Exception as e:
        sys.stderr.write(f'BLOCKED: {sidecar_path} exists but cannot be parsed: {e}\n')
        sys.exit(2)

    expected_hash = sidecar.get('source_draft_sha256')
    if not expected_hash:
        sys.stderr.write(f'BLOCKED: {sidecar_path} missing source_draft_sha256 field.\n')
        sys.exit(2)

    actual_hash = hashlib.sha256(content.encode('utf-8')).hexdigest()
    if actual_hash != expected_hash:
        sys.stderr.write(
            f'BLOCKED: content hash mismatch for {file_path}.\n'
            f'  Expected (from sidecar): {expected_hash[:16]}...\n'
            f'  Actual (what you tried to write): {actual_hash[:16]}...\n'
            f'The file content was modified after verification. Re-run the verifier.\n'
        )
        sys.exit(2)

    # Hash matches — allow the write
    print('{}')

if __name__ == '__main__':
    main()
