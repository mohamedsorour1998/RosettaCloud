"""Zip the agent bundle for AgentCore Runtime deployment."""
import os
import zipfile
import sys


def create_zip(source_dir, output_path):
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(source_dir):
            dirs[:] = [d for d in dirs if d not in (
                "__pycache__", ".git", ".venv", "node_modules",
                "tests", "cdk", "cdk.out",
            )]
            for f in files:
                if f.endswith(".pyc"):
                    continue
                full_path = os.path.join(root, f)
                arcname = os.path.relpath(full_path, source_dir)
                zf.write(full_path, arcname)


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/agent-bundle"
    out = sys.argv[2] if len(sys.argv) > 2 else "/asset-output/agent-code.zip"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    create_zip(src, out)
    print(f"Created {out}")
