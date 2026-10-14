// Deterministic packager for the Designer Studio installable candidate.
//
// 1. Builds the app-owned screen IIFE (vite.screen.config.ts) -> dist/screen.
// 2. Refuses any token the native frame grammar refuses
//    (src/daemon/app_screens_rpc.rs check_script_text / check_style_text),
//    and any external fetch/import in the emitted bytes. It never rewrites bytes.
// 3. Copies the exact bytes to package/screens/studio/{client.js,styles.css}.
// 4. Writes package/screens/studio/screens.json (app-screens/v2) with the real
//    sha256 + size of each byte body and provenance digests computed over
//    this repo's own inputs. No installed or shared SDK digest is claimed.
// Uses only node built-ins and the already-pinned vite in node_modules.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const read = (rel) => readFileSync(join(root, rel));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(relative(root, full));
  }
  return out;
}

function fail(message) {
  console.error(`package-screen: ${message}`);
  process.exit(1);
}

// 1. Build the approved IIFE with the pinned vite.
const build = spawnSync(
  process.execPath,
  [join(root, "node_modules/vite/bin/vite.js"), "build", "-c", "vite.screen.config.ts"],
  { cwd: root, stdio: "inherit" },
);
if (build.status !== 0) fail(`vite build exited ${build.status}`);

const outDir = join(root, "dist/screen");
const client = readFileSync(join(outDir, "client.js"));
const css = readFileSync(join(outDir, "styles.css"));

// 2. Offline grammar check, mirroring the native validator. Fail closed.
const clientText = client.toString("utf8");
const cssText = css.toString("utf8");
for (const token of ["</script", "<!--", "-->"]) {
  if (clientText.toLowerCase().includes(token)) fail(`client.js contains forbidden token ${token}`);
}
if (cssText.toLowerCase().includes("</style")) fail("styles.css contains forbidden token </style");
if (/@import|url\(\s*["']?https?:/i.test(cssText)) fail("styles.css has an external import or url()");
// Literal URLs inside the React runtime (error links, SVG/MathML namespaces) are
// inert strings, not fetches. Any other http(s) literal refuses.
const allowedLiterals = new Set([
  "https://react.dev/errors/",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xhtml",
]);
for (const match of clientText.matchAll(/https?:\/\/[^\s"'`)\\]*/g)) {
  const literal = match[0];
  const prefix = [...allowedLiterals].find((a) => literal.startsWith(a));
  // Exact inert namespace used by React's xml:base/xml:lang/xml:space setAttributeNS; not a fetch.
  if (!prefix && literal !== "http://www.w3.org/XML/1998/namespace") fail(`client.js contains an unlisted URL literal ${literal.slice(0, 80)}`);
}
// An IIFE has no static or dynamic import; the frame cannot resolve one.
if (/\bimport\s*\(/.test(clientText)) fail("client.js contains a dynamic import()");

// 3. Exact bytes into the package folder.
const pkgScreen = join(root, "package/screens/studio");
rmSync(pkgScreen, { recursive: true, force: true });
mkdirSync(pkgScreen, { recursive: true });
writeFileSync(join(pkgScreen, "client.js"), client);
writeFileSync(join(pkgScreen, "styles.css"), css);

// 4. Provenance over this repo's own inputs (deterministic, no timestamps).
const digestOf = (rels) =>
  sha(Buffer.concat(rels.flatMap((rel) => [Buffer.from(`${rel}\0`), read(rel), Buffer.from("\n")])));
const srcFiles = walk(join(root, "src"));
const packageSourceFiles = walk(join(root, "package")).filter((rel) => !rel.startsWith("package/screens/"));
const provenance = {
  // Own source: the src tree plus the packaged app definition files.
  source_digest: digestOf([...srcFiles, ...packageSourceFiles]),
  // App-internal frame adapter (bootstrap + port). Not a shipped public SDK.
  sdk_digest: digestOf(["src/host/bootstrap.ts", "src/host/port.ts"]),
  // Pinned toolchain inputs only; no host or node version is embedded.
  toolchain_digest: digestOf(["package.json", "pnpm-lock.yaml", "tsconfig.json", "vite.screen.config.ts"]),
};

const declaration = {
  contract: "app-screens/v2",
  app: "designer-studio",
  entry: "client.js",
  host_contract: "screen-media.v1",
  may: ["media.read", "media.publish"],
  assets: [
    { name: "client.js", media_type: "text/javascript", sha256: sha(client), size: client.length },
    { name: "styles.css", media_type: "text/css", sha256: sha(css), size: css.length },
  ],
  provenance,
};
writeFileSync(join(pkgScreen, "screens.json"), `${JSON.stringify(declaration, null, 2)}\n`);

const report = {
  files: [
    ...walk(join(root, "package")).map((rel) => ({ path: rel, bytes: statSync(join(root, rel)).size, sha256: sha(read(rel)) })),
  ],
  client_bytes: client.length,
  styles_bytes: css.length,
  provenance,
};
console.log(JSON.stringify(report, null, 2));
