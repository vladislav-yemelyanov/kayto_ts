#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { arch, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = dirname(__dirname);

const repo = process.env.KAYTO_REPO ?? "vladislav-yemelyanov/kayto";
const versionInputRaw = process.env.KAYTO_VERSION?.trim();

const installDir = join(rootDir, ".kayto", "bin");
const metadataPath = join(rootDir, ".kayto", "metadata.json");

function userError(problem, actions = []) {
  const lines = [problem];
  if (actions.length > 0) {
    lines.push("What to do:");
    actions.forEach((action, index) => {
      lines.push(`${index + 1}. ${action}`);
    });
  }

  const err = new Error(lines.join("\n"));
  err.name = "KaytoInstallError";
  return err;
}

function unique(values) {
  return [...new Set(values)];
}

function getVersionCandidates(version) {
  const trimmed = version.replace(/^v/, "");
  return {
    tags: unique([version, `v${trimmed}`, trimmed]),
    assets: unique([version, `v${trimmed}`, trimmed]),
  };
}

function validateInputs() {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw userError(
      `Invalid KAYTO_REPO: \"${repo}\". Expected format: <owner>/<repo>.`,
      [
        "Set KAYTO_REPO correctly, e.g. vladislav-yemelyanov/kayto.",
        "Remove KAYTO_REPO to use the default repository.",
      ],
    );
  }

  const checksum = process.env.KAYTO_SHA256?.trim();
  if (checksum && !/^[a-fA-F0-9]{64}$/.test(checksum)) {
    throw userError(
      "KAYTO_SHA256 must be a 64-character hex SHA-256 string.",
      [
        "Use checksum format like: e3b0c44298fc1c149afbf4c8996fb924...",
        "Unset KAYTO_SHA256 to auto-resolve checksum from release files.",
      ],
    );
  }
}

function getTarget() {
  const p = platform();
  const a = arch();

  let targetOs;
  let ext;

  if (p === "darwin") {
    targetOs = "apple-darwin";
    ext = "tar.gz";
  } else if (p === "linux") {
    targetOs = "unknown-linux-gnu";
    ext = "tar.gz";
  } else if (p === "win32") {
    targetOs = "pc-windows-gnu";
    ext = "zip";
  } else {
    throw userError(`Unsupported platform: ${p}.`, [
      "Use macOS, Linux, or Windows.",
      "Or install kayto manually from GitHub release assets.",
    ]);
  }

  let targetArch;
  if (a === "x64") {
    targetArch = "x86_64";
  } else if (a === "arm64") {
    targetArch = "aarch64";
  } else {
    throw userError(`Unsupported architecture: ${a}.`, [
      "Use x64 or arm64 machine.",
      "Or install a compatible binary manually.",
    ]);
  }

  if (p === "win32" && targetArch !== "x86_64") {
    throw userError(`Windows build is available only for x86_64, got ${targetArch}.`, [
      "Use x64 Windows environment.",
      "Or build kayto from source on your machine.",
    ]);
  }

  return {
    binaryName: p === "win32" ? "kayto.exe" : "kayto",
    target: `${targetArch}-${targetOs}`,
    ext,
  };
}

function readMetadata() {
  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch {
    return null;
  }
}

function writeMetadata(next) {
  try {
    writeFileSync(metadataPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch (error) {
    throw userError("Failed to write installation metadata.", [
      `Check write permissions for: ${metadataPath}`,
      "Try reinstalling package with sufficient permissions.",
      `Original error: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

function findBinaryRecursive(startDir, binaryName) {
  const entries = readdirSync(startDir, { withFileTypes: true });

  for (const entry of entries) {
    const abs = join(startDir, entry.name);

    if (entry.isFile() && entry.name === binaryName) {
      return abs;
    }

    if (entry.isDirectory()) {
      const nested = findBinaryRecursive(abs, binaryName);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

async function fetchText(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "kayto_ts-postinstall",
        Accept: "application/json, text/plain, application/octet-stream",
      },
    });
  } catch (error) {
    throw userError(`Network error while requesting ${url}.`, [
      "Check internet access and DNS settings.",
      "If you are behind proxy, configure proxy for Node.js/npm.",
      `Original error: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  if (!response.ok) {
    throw userError(`Request failed (${response.status}) ${url}`, [
      "Verify repository/tag/checksum file exists in GitHub release.",
      "If GitHub is rate-limited, retry later or use authenticated network.",
    ]);
  }

  return response.text();
}

async function resolveVersionInput() {
  if (versionInputRaw) {
    return versionInputRaw;
  }

  const url = `https://api.github.com/repos/${repo}/releases/latest`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "kayto_ts-postinstall",
        Accept: "application/vnd.github+json",
      },
    });
  } catch (error) {
    throw userError("Failed to resolve latest kayto release tag from GitHub.", [
      "Check internet access and DNS settings.",
      "Or set KAYTO_VERSION explicitly, e.g. KAYTO_VERSION=v0.1.32.",
      `Original error: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  if (!response.ok) {
    throw userError(`Failed to resolve latest release (${response.status}).`, [
      `Open: ${url}`,
      "Or set KAYTO_VERSION explicitly to a known tag.",
    ]);
  }

  const json = await response.json();
  const tag = typeof json?.tag_name === "string" ? json.tag_name.trim() : "";
  if (!tag) {
    throw userError("GitHub response does not contain a valid latest tag_name.", [
      "Set KAYTO_VERSION explicitly, e.g. KAYTO_VERSION=v0.1.32.",
      "Verify releases exist in the target repository.",
    ]);
  }

  return tag;
}

async function downloadFile(url, outFile) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "kayto_ts-postinstall",
        Accept: "application/octet-stream",
      },
    });
  } catch (error) {
    throw userError(`Network error while downloading archive from ${url}.`, [
      "Check internet/proxy configuration.",
      `Original error: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  if (!response.ok) {
    throw userError(`Download failed (${response.status}) ${url}`, [
      "Verify release/tag exists and contains the expected archive asset.",
      "Try setting KAYTO_VERSION to an existing tag.",
    ]);
  }

  const arrayBuffer = await response.arrayBuffer();
  writeFileSync(outFile, Buffer.from(arrayBuffer));
}

function sha256Hex(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function parseSha256Text(text, archiveName) {
  const normalized = text.trim().toLowerCase();
  const direct = normalized.match(/^[a-f0-9]{64}$/);
  if (direct) {
    return direct[0];
  }

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match) {
      continue;
    }

    const fileName = match[2].trim();
    if (fileName === archiveName) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

async function resolveExpectedSha256(repoName, tag, archiveName) {
  const base = `https://github.com/${repoName}/releases/download/${tag}`;
  const directCandidates = [
    `${base}/${archiveName}.sha256`,
    `${base}/${archiveName}.sha256.txt`,
  ];

  for (const url of directCandidates) {
    try {
      const text = await fetchText(url);
      const value = parseSha256Text(text, archiveName);
      if (value) {
        return { value, source: url };
      }
    } catch {
    }
  }

  const checksumFileCandidates = [
    "checksums.txt",
    "sha256sums.txt",
    "SHA256SUMS",
    "SHA256SUMS.txt",
  ];

  for (const fileName of checksumFileCandidates) {
    const url = `${base}/${fileName}`;
    try {
      const text = await fetchText(url);
      const value = parseSha256Text(text, archiveName);
      if (value) {
        return { value, source: url };
      }
    } catch {
    }
  }

  return null;
}

async function verifyArchiveChecksum(archivePath, archiveName, resolvedTag) {
  if (process.env.KAYTO_SKIP_CHECKSUM === "1") {
    console.warn("[kayto_ts] checksum verification is disabled via KAYTO_SKIP_CHECKSUM=1");
    return;
  }

  const expectedFromEnv = process.env.KAYTO_SHA256?.trim().toLowerCase();
  let expected = expectedFromEnv;
  let source = "KAYTO_SHA256";

  if (!expected) {
    const resolved = await resolveExpectedSha256(repo, resolvedTag, archiveName);
    if (!resolved) {
      throw userError(`Could not resolve SHA-256 for ${archiveName}.`, [
        `Publish checksum files in release ${resolvedTag} (e.g. checksums.txt).`,
        "Or provide checksum explicitly via KAYTO_SHA256.",
        "Or set KAYTO_SKIP_CHECKSUM=1 to bypass verification (not recommended).",
      ]);
    }

    expected = resolved.value;
    source = resolved.source;
  }

  const actual = sha256Hex(archivePath);
  if (actual !== expected) {
    throw userError(`Checksum mismatch for ${archiveName}.`, [
      `Expected: ${expected} (${source})`,
      `Actual:   ${actual}`,
      "Re-run install with KAYTO_FORCE_INSTALL=1 to re-download archive.",
      "If mismatch persists, verify release integrity and network/proxy behavior.",
    ]);
  }

  console.log(`[kayto_ts] verified SHA-256 for ${archiveName} (${source})`);
}

function extractArchive(archivePath, outDir, ext) {
  if (ext === "tar.gz") {
    const tar = spawnSync("tar", ["-xzf", archivePath, "-C", outDir], {
      stdio: "inherit",
    });

    if (tar.error) {
      throw userError("Failed to execute tar while extracting archive.", [
        "Install tar and make sure it is available in PATH.",
        `Original error: ${tar.error.message}`,
      ]);
    }

    if (tar.status !== 0) {
      throw userError("Failed to extract tar.gz archive.", [
        "Archive may be corrupted. Re-run with KAYTO_FORCE_INSTALL=1.",
        "Check tar output above for details.",
      ]);
    }

    return;
  }

  const ps = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: "inherit" },
  );

  if (ps.error) {
    throw userError("Failed to execute PowerShell while extracting archive.", [
      "Make sure PowerShell is installed and available in PATH.",
      `Original error: ${ps.error.message}`,
    ]);
  }

  if (ps.status !== 0) {
    throw userError("Failed to extract zip archive.", [
      "Archive may be corrupted. Re-run with KAYTO_FORCE_INSTALL=1.",
      "Check PowerShell output above for details.",
    ]);
  }
}

async function resolveAndDownloadArchive(tmpDir, target, ext, versionInput) {
  const candidates = getVersionCandidates(versionInput);
  const attempted = [];

  for (const tag of candidates.tags) {
    for (const assetVersion of candidates.assets) {
      const archive = `kayto-${assetVersion}-${target}.${ext}`;
      const url = `https://github.com/${repo}/releases/download/${tag}/${archive}`;
      const archivePath = join(tmpDir, archive);
      attempted.push(url);

      try {
        await downloadFile(url, archivePath);
        return {
          archivePath,
          archiveName: archive,
          resolvedTag: tag,
          resolvedAssetVersion: assetVersion,
        };
      } catch {
      }
    }
  }

  throw userError(`Could not download kayto archive for target ${target}.`, [
    `Requested version input: ${versionInput}`,
    `Tried tags: ${candidates.tags.join(", ")}`,
    `Repository: ${repo}`,
    "Check that release assets exist for your OS/arch target.",
    "Set KAYTO_VERSION to a known existing tag.",
    `Sample attempted URL: ${attempted[0] ?? "n/a"}`,
  ]);
}

function installBinary(extractedBinary, binaryPath) {
  try {
    copyFileSync(extractedBinary, binaryPath);
    if (platform() !== "win32") {
      chmodSync(binaryPath, 0o755);
    }
  } catch (error) {
    throw userError("Failed to install kayto binary into local package directory.", [
      `Target path: ${binaryPath}`,
      "Check directory write permissions.",
      `Original error: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

async function main() {
  validateInputs();

  const versionInput = await resolveVersionInput();
  const { binaryName, target, ext } = getTarget();
  const binaryPath = join(installDir, binaryName);

  const current = readMetadata();
  if (
    process.env.KAYTO_FORCE_INSTALL !== "1"
    && existsSync(binaryPath)
    && current?.versionInput === versionInput
    && current?.target === target
    && current?.repo === repo
  ) {
    console.log(`[kayto_ts] kayto already installed (${versionInput}, ${target})`);
    return;
  }

  mkdirSync(installDir, { recursive: true });

  const tmpDir = join(rootDir, ".kayto", "tmp");
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  try {
    console.log(`[kayto_ts] resolving release for ${target}`);
    const { archivePath, archiveName, resolvedTag, resolvedAssetVersion } = await resolveAndDownloadArchive(
      tmpDir,
      target,
      ext,
      versionInput,
    );

    console.log(
      `[kayto_ts] downloaded kayto-${resolvedAssetVersion}-${target}.${ext} (tag ${resolvedTag})`,
    );

    await verifyArchiveChecksum(archivePath, archiveName, resolvedTag);
    extractArchive(archivePath, tmpDir, ext);

    const extractedBinary = findBinaryRecursive(tmpDir, binaryName);
    if (!extractedBinary) {
      throw userError(`Could not find ${binaryName} in downloaded archive.`, [
        "Release asset structure may have changed.",
        `Verify asset content for tag ${resolvedTag} in repository ${repo}.`,
        "Try setting KAYTO_VERSION to another tag.",
      ]);
    }

    installBinary(extractedBinary, binaryPath);

    writeMetadata({
      repo,
      versionInput,
      resolvedTag,
      resolvedAssetVersion,
      target,
      installedAt: new Date().toISOString(),
    });

    console.log(`[kayto_ts] installed ${binaryName} (${resolvedAssetVersion}, ${target})`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[kayto_ts] postinstall failed:\n${message}`);
  process.exit(1);
});
