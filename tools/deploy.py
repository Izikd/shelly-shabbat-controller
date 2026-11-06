#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Upgrade the Shabbat controller scripts on a Shelly over its RPC API.

    python3 tools/deploy.py 192.168.1.50
    python3 tools/deploy.py shelly.example.com --password secret
    python3 tools/deploy.py 192.168.1.50 --dry-run      # only show what would change
    python3 tools/deploy.py 192.168.1.50 --release latest   # install a GitHub release

Where the scripts come from: dist/ of this checkout (`npm run build`, or --build), or with
--release the files attached to a GitHub release. The repository is public, so no token is
needed; GITHUB_TOKEN / GH_TOKEN, or a logged-in `gh` CLI, is used if present.

Steps: find the controller and `shabbat_ui` scripts on the
device (creating them if missing), upload only the ones whose code differs, verify each
upload by reading it back, restart the controller and report its memory and state.
A script whose code already matches is left alone, so re-running is harmless.

Only the Python standard library is used. If the device has a password, it is sent with
HTTP digest auth (user `admin`), as Shelly Gen2+ devices expect.
"""
import argparse
import hashlib
import http.client
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI_NAME = "shabbat_ui"            # the page loader looks the UI script up by this name (prefix)
CTRL_NAME = "shabbat_controller"
# scripts whose name starts with one of these are the controller (the first is the old name)
CTRL_PREFIXES = ("shabbat_controller", "shabbat_elevator")
CHUNK = 1024                      # characters per Script.PutCode call
# Some reverse proxies / WAFs block Python's default "Python-urllib" user agent.
USER_AGENT = "shabbat-deploy/1.0"
REPO = "Izikd/shelly-shabbat-controller"
GITHUB_API = os.environ.get("GITHUB_API_URL", "https://api.github.com")


class RpcError(Exception):
    pass


class NetError(RpcError):
    """No usable reply (timeout, dropped connection): the call may or may not have run."""


class Shelly:
    def __init__(self, host, password=None, timeout=30):
        if "://" not in host:
            host = self._pick_scheme(host, timeout)
        self.url = host.rstrip("/") + "/rpc"
        self.password = password
        self.timeout = timeout
        self.auth_header = None
        self._nc = 0
        self._id = 0

    @staticmethod
    def _pick_scheme(host, timeout):
        """Bare host: use HTTPS if it answers, otherwise HTTP (a Shelly on the LAN is HTTP)."""
        for scheme in ("https", "http"):
            url = f"{scheme}://{host}"
            try:
                req = urllib.request.Request(url + "/rpc/Shelly.GetDeviceInfo",
                                             headers={"User-Agent": USER_AGENT})
                urllib.request.urlopen(req, timeout=min(timeout, 10)).close()
                return url
            except urllib.error.HTTPError:
                return url  # it answered (e.g. 401), so the scheme works
            except (urllib.error.URLError, OSError):
                continue
        raise SystemExit(f"error: cannot reach {host} over https or http")

    def _digest(self, challenge, body_method="POST", uri="/rpc"):
        p = dict(re.findall(r'(\w+)="?([^",]+)"?', challenge))
        algo = p.get("algorithm", "SHA-256").upper()
        h = (lambda s: hashlib.sha256(s.encode()).hexdigest()) if "256" in algo else \
            (lambda s: hashlib.md5(s.encode()).hexdigest())
        self._nc += 1
        nc = f"{self._nc:08x}"
        cnonce = os.urandom(8).hex()
        ha1 = h(f"admin:{p['realm']}:{self.password}")
        ha2 = h(f"{body_method}:{uri}")
        resp = h(f"{ha1}:{p['nonce']}:{nc}:{cnonce}:auth:{ha2}")
        return (f'Digest username="admin", realm="{p["realm"]}", nonce="{p["nonce"]}", '
                f'uri="{uri}", algorithm={algo}, response="{resp}", qop=auth, nc={nc}, '
                f'cnonce="{cnonce}"')

    def call(self, method, params=None, _retry=True, net_retries=3):
        """One RPC. Network failures (timeouts, dropped connections - common through a tunnel)
        are retried; pass net_retries=0 for calls that must not be repeated blindly."""
        for attempt in range(net_retries + 1):
            try:
                return self._call(method, params, _retry)
            except (urllib.error.URLError, TimeoutError, ConnectionError,
                    http.client.HTTPException) as e:
                if isinstance(e, urllib.error.HTTPError):
                    raise RpcError(f"{method}: {e}") from e
                if attempt == net_retries:
                    raise NetError(f"{method}: {getattr(e, 'reason', e)}") from e
                time.sleep(2 ** attempt)

    def _call(self, method, params, _retry):
        self._id += 1
        # ensure_ascii=False: the Shelly rejects \u escapes in script code, send raw UTF-8.
        body = json.dumps({"id": self._id, "method": method, "params": params or {}},
                          ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
        if self.auth_header:
            headers["Authorization"] = self.auth_header
        req = urllib.request.Request(self.url, data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                res = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 401 and _retry:
                if not self.password:
                    raise SystemExit("error: the device requires a password (use --password)")
                self.auth_header = self._digest(e.headers.get("WWW-Authenticate", ""),
                                                uri=urllib.parse.urlparse(self.url).path)
                return self._call(method, params, _retry=False)
            if e.code == 401:
                raise SystemExit("error: the device rejected the password")
            raise RpcError(f"{method}: HTTP {e.code} {e.reason}")
        if "error" in res:
            raise RpcError(f"{method}: {res['error'].get('message')} ({res['error'].get('code')})")
        return res.get("result")

    def get_code(self, sid):
        # offset/len are in bytes. Small pieces: one ~28 KB read rebooted a Pro 1. The built
        # scripts are pure ASCII, so a piece never splits a character (older UTF-8 code on the
        # device may read back garbled, which only means it differs and gets replaced).
        raw, offset = b"", 0
        while True:
            r = self.call("Script.GetCode", {"id": sid, "offset": offset, "len": 4096})
            piece = r["data"].encode("utf-8")
            raw += piece
            offset += len(piece)
            if not r.get("left") or not piece:
                return raw.decode("utf-8", errors="replace")

    def code_len(self, sid):
        """Length of the script's code on the device, in bytes."""
        r = self.call("Script.GetCode", {"id": sid, "offset": 0, "len": 1})
        return len(r["data"].encode("utf-8")) + (r.get("left") or 0)

    def put_code(self, sid, code, max_failures=20):
        """Upload in chunks. If a reply is lost, the chunk may or may not have been applied, so
        an appended chunk is never simply re-sent (it could be doubled): the upload resumes from
        the length the device reports. The built scripts are ASCII, so bytes == characters."""
        if not code.isascii():
            raise SystemExit("error: refusing to upload non-ASCII code (run `npm run build`)")
        i, failures = 0, 0
        while i < len(code):
            piece = code[i:i + CHUNK]
            try:
                self.call("Script.PutCode", {"id": sid, "code": piece, "append": i > 0},
                          net_retries=0)
                i += len(piece)
                print(f"\r    uploaded {i}/{len(code)} chars", end="", flush=True)
            except NetError as e:
                failures += 1
                print(f"\n    lost reply at {i} chars ({e}); checking the device", flush=True)
                if failures > max_failures:
                    raise
                time.sleep(min(2 ** failures, 10))
                if i == 0:
                    continue  # the first chunk replaces the code: safe to send again
                have = self.code_len(sid)
                if have not in (i, i + len(piece)):
                    print(f"    device has {have} chars, expected {i} or {i + len(piece)}; restarting")
                    i = 0
                else:
                    i = have
        print()


def read_dist(name):
    path = os.path.join(ROOT, "dist", name)
    if not os.path.exists(path):
        raise SystemExit(f"error: {path} missing - run `npm run build`, or use --build or --release")
    with open(path, encoding="utf-8") as f:
        return f.read()


def code_version(code):
    """Version from the first line of a built script ("... - version v1.0.0 - commit e59860a
    - ..."): "v1.0.0 (e59860a)" for a release build, "e59860a" for any other build."""
    first = code.split("\n", 1)[0]
    v, c = re.search(r"version (\S+)", first), re.search(r"commit (\S+)", first)
    if not v and not c:
        return "unknown"
    cid = c.group(1) if c else "?"
    label = f"{v.group(1)} ({cid})" if v and v.group(1) != "dev" else cid
    b = re.search(r"built (\d{4}-\d\d-\d\dT\d\d:\d\dZ)", first)
    return f"{label}, built {b.group(1)}" if b else label


def same_code(a, b):
    """Equal apart from the build time in the first line: rebuilding the same commit must not
    re-upload (and restart the controller) just because the clock moved."""
    strip = lambda s: re.sub(r" - built \d{4}-\d\d-\d\dT\d\d:\d\dZ", "", s, count=1)
    return strip(a) == strip(b)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def github_token():
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if tok:
        return tok
    try:
        out = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def release_files(repo, tag, names):
    """Download the named assets of a GitHub release ("latest" or a tag). Returns
    ({name: text}, tag)."""
    token = github_token()

    def get(url, accept, auth=True):
        h = {"User-Agent": USER_AGENT, "Accept": accept}
        if token and auth:
            h["Authorization"] = f"Bearer {token}"
        # asset downloads redirect to storage that rejects the GitHub token: follow by hand
        opener = urllib.request.build_opener(_NoRedirect)
        try:
            with opener.open(urllib.request.Request(url, headers=h), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                return get(e.headers["Location"], accept, auth=False)
            if e.code == 404:
                hint = "" if token else " (private repository? set GITHUB_TOKEN or log in with gh)"
                raise SystemExit(f"error: release '{tag}' not found in {repo}{hint}")
            raise SystemExit(f"error: GitHub {url}: HTTP {e.code} {e.reason}")

    path = "releases/latest" if tag == "latest" else f"releases/tags/{urllib.parse.quote(tag)}"
    rel = json.loads(get(f"{GITHUB_API}/repos/{repo}/{path}", "application/vnd.github+json"))
    assets = {a["name"]: a for a in rel.get("assets", [])}
    out = {}
    for n in names:
        if n not in assets:
            raise SystemExit(f"error: release {rel.get('tag_name')} has no asset {n}")
        out[n] = get(assets[n]["url"], "application/octet-stream").decode("utf-8")
    return out, rel.get("tag_name")


def find_or_create(dev, scripts, match, create_name, dry_run):
    for s in scripts:
        if match(s["name"] or ""):
            return s
    if dry_run:
        print(f"  would create script '{create_name}'")
        return None
    sid = dev.call("Script.Create", {"name": create_name})["id"]
    print(f"  created script '{create_name}' (id {sid})")
    return {"id": sid, "name": create_name, "enable": False, "running": False}


def deploy_one(dev, script, code, label, restart, dry_run):
    """Returns True when the code on the device was (or would be) replaced."""
    current = dev.get_code(script["id"]) if script else ""
    if same_code(current, code):
        print(f"  {label}: id {script['id']} '{script['name']}' already up to date "
              f"({code_version(code)}, {len(code)} chars)")
        return False
    old = code_version(current) if current else "none"
    print(f"  {label}: id {script['id'] if script else '-'} '{script['name'] if script else '-'}' "
          f"{old} -> {code_version(code)} ({len(current)} -> {len(code)} chars)")
    if dry_run:
        return True
    if restart and script.get("running"):
        dev.call("Script.Stop", {"id": script["id"]})
        print("    stopped")
    dev.put_code(script["id"], code)
    if dev.get_code(script["id"]) != code:
        raise SystemExit(f"error: {label} verification failed - code on device differs from what "
                         "was uploaded. Re-run the deploy.")
    print("    verified")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("host", nargs="?", default=os.environ.get("SHELLY_HOST"),
                    help="device IP or domain, optionally with http:// or https:// "
                         "(or set SHELLY_HOST)")
    ap.add_argument("--password", default=os.environ.get("SHELLY_PASSWORD"),
                    help="device password (or set SHELLY_PASSWORD)")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--build", action="store_true",
                     help="run `npm run build` first (needs `npm install`)")
    src.add_argument("--release", metavar="TAG",
                     help="install a GitHub release instead of dist/: a tag (v1.0.0) or 'latest'")
    ap.add_argument("--repo", default=REPO, help=f"GitHub repository for --release (default {REPO})")
    ap.add_argument("--no-ui", action="store_true", help="do not touch the shabbat_ui script")
    ap.add_argument("--restart", action="store_true",
                    help="restart the controller even if its code is unchanged")
    ap.add_argument("--dry-run", action="store_true", help="show what would change, write nothing")
    args = ap.parse_args()
    if not args.host:
        ap.error("no device: give its address, or set SHELLY_HOST")

    ctrl_name = "shabbat_controller.js"
    names = [ctrl_name] + ([] if args.no_ui else ["shabbat_ui.js"])
    if args.release:
        files, tag = release_files(args.repo, args.release, names)
        print(f"Release {tag} from {args.repo}")
    else:
        if args.build:
            subprocess.run(["node", os.path.join(ROOT, "tools", "build.mjs")], check=True)
        files = {n: read_dist(n) for n in names}
    ctrl_code = files[ctrl_name]
    ui_code = None if args.no_ui else files["shabbat_ui.js"]

    dev = Shelly(args.host, args.password)
    info = dev.call("Shelly.GetDeviceInfo")
    print(f"Device {info.get('id')} ({info.get('model')}, fw {info.get('ver')}) at {dev.url}")
    if not info.get("auth_en"):
        print("  warning: device has no password set")

    scripts = dev.call("Script.List")["scripts"]
    ctrl = find_or_create(dev, scripts, lambda n: n.startswith(CTRL_PREFIXES),
                          CTRL_NAME, args.dry_run)
    ui = None if args.no_ui else find_or_create(dev, scripts, lambda n: n.startswith(UI_NAME),
                                                UI_NAME, args.dry_run)

    # The page first: uploading it does not touch the running controller. The controller is
    # stopped only for its own upload; if that fails, try to start it again before giving up.
    if ui_code is not None:
        deploy_one(dev, ui, ui_code, "settings page", False, args.dry_run)
    try:
        ctrl_changed = deploy_one(dev, ctrl, ctrl_code, "controller", True, args.dry_run)
    except BaseException:
        if not args.dry_run:
            try:
                dev.call("Script.Start", {"id": ctrl["id"]})
                print("  controller start attempted after the failure - check its state")
            except Exception as e:
                print(f"  CONTROLLER IS STOPPED ({e}) - re-run the deploy")
        raise

    if args.dry_run:
        print("Dry run - nothing written.")
        return

    # The UI script must never run: it only stores page code.
    if ui and (ui.get("running") or ui.get("enable")):
        if ui.get("running"):
            dev.call("Script.Stop", {"id": ui["id"]})
        dev.call("Script.SetConfig", {"id": ui["id"], "config": {"enable": False}})
        print("  settings page script stopped / run-on-startup disabled (it must not run)")

    if ctrl["name"] != CTRL_NAME and ctrl["name"].startswith("shabbat_elevator"):
        dev.call("Script.SetConfig", {"id": ctrl["id"], "config": {"name": CTRL_NAME}})
        print(f"  controller: renamed '{ctrl['name']}' -> '{CTRL_NAME}'")
        ctrl["name"] = CTRL_NAME
    if not ctrl.get("enable"):
        dev.call("Script.SetConfig", {"id": ctrl["id"], "config": {"enable": True}})
        print("  controller: enabled run on startup")
    status = dev.call("Script.GetStatus", {"id": ctrl["id"]})
    if ctrl_changed or args.restart or not status.get("running"):
        if status.get("running"):
            dev.call("Script.Stop", {"id": ctrl["id"]})
        dev.call("Script.Start", {"id": ctrl["id"]})
        print("  controller started; waiting for it to settle...")
        time.sleep(10)

    status = dev.call("Script.GetStatus", {"id": ctrl["id"]})
    if not status.get("running"):
        raise SystemExit(f"error: controller is not running: {status}")
    print(f"Controller running: mem used {status.get('mem_used')}, peak {status.get('mem_peak')}, "
          f"free {status.get('mem_free')} bytes")
    if status.get("errors"):
        print(f"  warning: script errors: {status['errors']}")
    try:
        st = dev.call("Script.ShabbatGet", {"id": ctrl["id"]})["st"]
        off = dev.call("Sys.GetStatus").get("utc_offset", 0)  # show times in the device's zone
        fmt = lambda t: time.strftime("%a %d %b %H:%M", time.gmtime(t + off)) if t else "-"
        cur, nxt, on = st.get("cur"), st.get("next"), st.get("nextOn")
        print(f"  clock synced: {st.get('synced')}, automation: {st.get('auto')}, "
              f"relay: {'ON' if st.get('relay') else 'off'}")
        print(f"  current window: {cur['t'] + ' until ' + fmt(cur['e']) if cur else 'none'}")
        if nxt:
            print(f"  next window: {nxt['t']} {fmt(nxt['s'])} -> {fmt(nxt['e'])}")
        if on:
            print(f"  next relay ON: {fmt(on[0])} -> {fmt(on[1])}")
    except RpcError as e:
        print(f"  warning: ShabbatGet failed ({e}); the controller may still be starting")
    host = dev.url[:-len("/rpc")]
    print(f"Settings page: {host}/script/{ctrl['id']}/ui")


if __name__ == "__main__":
    try:
        main()
    except RpcError as e:
        raise SystemExit(f"error: {e}")
