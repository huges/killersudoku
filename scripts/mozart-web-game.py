"""Mozart web-game schema 2: fixed npm validation, without inherited secrets."""
from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

VALIDATOR_VERSION = "web-game/2"
MANIFEST = {"schema_version": 2, "profile": "web-game", "toolchain": "npm", "node_major": 22}
COMMANDS = {
    "lockfile": ["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
    "install": ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    "lint": ["npm", "run", "lint"],
    "test": ["npm", "run", "test"],
    "verify:catalog": ["npm", "run", "verify:catalog"],
    "build": ["npm", "run", "build"],
}


def execute_stage(argv, root, env):
    process = subprocess.Popen(argv, cwd=root, env=env, stdin=subprocess.DEVNULL,
                               start_new_session=True)
    try:
        code = process.wait(timeout=180)
    finally:
        # npm/test workers share this stage's group; reap them on success,
        # failure and timeout instead of leaving background processes behind.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
    if code:
        raise subprocess.CalledProcessError(code, argv)


def _json(root: Path, name: str) -> dict:
    path = root / name
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
        raise ValueError(f"Missing, linked or oversized file: {name}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"Expected JSON object: {name}")
    return value


def check_contract(root: Path, *, require_lock: bool = True) -> None:
    if _json(root, "mozart-software.json") != MANIFEST:
        raise ValueError("Expected exact web-game schema 2 npm manifest")
    package = _json(root, "package.json")
    engines = package.get("engines")
    if not isinstance(engines, dict) or engines.get("node") not in ("22.x", ">=22 <23"):
        raise ValueError("package.json engines.node must constrain Node 22")
    scripts = package.get("scripts", {})
    if not isinstance(scripts, dict) or any(not isinstance(scripts.get(k), str) or not scripts[k].strip()
                                            for k in ("lint", "test", "build")):
        raise ValueError("Required nonempty npm scripts: lint, test, build")
    if any(k in scripts for k in ("preinstall", "postinstall", "prepare", "prepublish", "prepublishOnly",
                                 "prelint", "postlint", "pretest", "posttest", "prebuild", "postbuild")):
        raise ValueError("Implicit pre/post npm lifecycle scripts are not supported")
    if any("npm ci" in scripts[k] or "npm install" in scripts[k] for k in ("lint", "test", "build")):
        raise ValueError("Validation scripts must not reinstall dependencies")
    if (root / ".npmrc").exists():
        raise ValueError("Project .npmrc is not supported; registry configuration is controlled")
    for name in ("node_modules", "dist"):
        if (root / name).is_symlink():
            raise ValueError(f"Linked output/dependency directory is not supported: {name}")

    if not require_lock:
        return
    lock = _json(root, "package-lock.json")
    if lock.get("lockfileVersion") not in (2, 3):
        raise ValueError("npm lockfile version 2 or 3 is required")
    packages = lock.get("packages")
    if not isinstance(packages, dict) or "" not in packages:
        raise ValueError("Lockfile must contain a packages inventory")
    for package_entry in packages.values():
        if not isinstance(package_entry, dict):
            raise TypeError("Invalid lockfile package entry")
        if package_entry.get("link"):
            raise ValueError("Linked dependencies are not supported")
        resolved = package_entry.get("resolved")
        if resolved:
            if not isinstance(resolved, str):
                raise ValueError("Invalid dependency URL")
            url = urlparse(resolved)
            if url.scheme != "https" or url.hostname != "registry.npmjs.org" or url.username or url.password:
                raise ValueError("Only public HTTPS npm registry dependencies are supported")


def clean_head(root: Path) -> None:
    result = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"],
                            cwd=root, capture_output=True, check=True, timeout=10)
    if result.stdout:
        raise ValueError("npm validation requires a clean checkout; ignore node_modules and dist")


def run(root: Path, phase: str) -> None:
    check_contract(root, require_lock=phase != "lockfile")
    if phase != "lockfile":
        clean_head(root)
    # Never forward provider tokens, database passwords, proxy credentials or user npm config.
    with tempfile.TemporaryDirectory(prefix="mozart-npm-") as cache:
        user_config = Path(cache) / "user.npmrc"
        global_config = Path(cache) / "global.npmrc"
        user_config.write_text("")
        global_config.write_text("")
        env = {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "HOME": cache, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "CI": "true",
            "NODE_OPTIONS": "--disable-wasm-trap-handler --max-old-space-size=256",
            "npm_config_cache": cache, "npm_config_userconfig": str(user_config),
            "npm_config_globalconfig": str(global_config), "npm_config_registry": "https://registry.npmjs.org/",
            "npm_config_ignore_scripts": "true", "npm_config_update_notifier": "false",
        }
        version = subprocess.check_output(["node", "--version"], env=env, text=True, timeout=10)
        if not version.strip().startswith("v22."):
            raise ValueError("Mozart web-game/2 requires Node 22.x")
        stages = {"lint": ["install", "lint"], "test": ["install", "lint", "test"],
                  "build": ["build"], "validate": ["install", "lint", "test", "verify:catalog", "build"], "lockfile": ["lockfile"]}[phase]
        print(f"Mozart {VALIDATOR_VERSION}; cwd={root}; Node={version.strip()}", flush=True)
        for stage in stages:
            print(f"stage={stage}: {' '.join(COMMANDS[stage])}", flush=True)
            if stage == "build" and (root / "dist").exists():
                shutil.rmtree(root / "dist")
            execute_stage(COMMANDS[stage], root, env)
        if phase == "lockfile":
            check_contract(root)
            if (root / "node_modules").exists():
                raise ValueError("Lockfile preparation must not install dependencies")
        else:
            clean_head(root)
        if phase in ("build", "validate"):
            dist = root / "dist"
            if dist.is_symlink() or not (dist / "index.html").is_file():
                raise ValueError("Build must produce dist/index.html")
            for path in dist.rglob("*"):
                if path.is_symlink():
                    raise ValueError("Build output must not contain symlinks")
            print("Static build artifact: dist/", flush=True)


def generate_lockfile(root: Path) -> None:
    check_contract(root, require_lock=False)
    package = _json(root, "package.json")
    if any(key in package for key in ("workspaces", "overrides", "bundledDependencies", "bundleDependencies")):
        raise ValueError("Workspace, override and bundled dependencies are not supported")
    for field in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
        dependencies = package.get(field, {})
        if not isinstance(dependencies, dict):
            raise TypeError("Dependencies must be objects")
        for name, spec in dependencies.items():
            if not re.fullmatch(r"(?:@[a-z0-9._-]+/)?[a-z0-9._-]+", name):
                raise ValueError("Invalid public npm package name")
            if not isinstance(spec, str) or not re.fullmatch(r"[0-9xX*.^~<>=| +\-]+", spec):
                raise ValueError("Only public registry numeric semver dependencies are supported")
    run(root, "lockfile")


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in ("lint", "test", "build", "validate", "lockfile"):
        print("usage: npm_web_game_validation.py {lint|test|build|validate|lockfile}", file=sys.stderr)
        return 2
    try:
        if sys.argv[1] == "lockfile":
            generate_lockfile(Path.cwd())
        else:
            run(Path.cwd(), sys.argv[1])
    except (ValueError, TypeError, OSError, subprocess.SubprocessError) as exc:
        print(f"Mozart {VALIDATOR_VERSION} failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
