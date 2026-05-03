#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const AUTHOR_URL = "https://evdboom.nl/projects/bindery";

function parseJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sortSemverKeys(keys) {
  return [...keys].sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const na = Number.isFinite(pa[i]) ? pa[i] : 0;
      const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
      if (na !== nb) {
        return na - nb;
      }
    }
    return 0;
  });
}

function requireVersionArg() {
  const raw = process.argv[2] || process.env.RELEASE_VERSION || process.env.GITHUB_REF_NAME || "";
  const normalized = raw.replace(/^v/, "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Expected version like 1.2.3, got: ${raw || "<empty>"}`);
  }
  return normalized;
}

const repoRoot = process.cwd();
const rootManifestPath = resolve(repoRoot, "manifest.json");
const pluginManifestPath = resolve(repoRoot, "obsidian-plugin", "manifest.json");
const versionsPath = resolve(repoRoot, "obsidian-plugin", "versions.json");

const version = requireVersionArg();

const rootManifest = parseJson(rootManifestPath);
const pluginManifest = parseJson(pluginManifestPath);
const versions = parseJson(versionsPath);

rootManifest.version = version;
pluginManifest.version = version;

rootManifest.authorUrl = AUTHOR_URL;
pluginManifest.authorUrl = AUTHOR_URL;

const minAppVersion = pluginManifest.minAppVersion || rootManifest.minAppVersion;
if (!minAppVersion) {
  throw new Error("Unable to determine minAppVersion from manifests.");
}

if (!versions[version]) {
  versions[version] = minAppVersion;
}
const sortedVersions = {};
for (const key of sortSemverKeys(Object.keys(versions))) {
  sortedVersions[key] = versions[key];
}

writeJson(rootManifestPath, rootManifest);
writeJson(pluginManifestPath, pluginManifest);
writeJson(versionsPath, sortedVersions);

console.log(`Synced Obsidian metadata for version ${version}`);
