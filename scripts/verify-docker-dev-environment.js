#!/usr/bin/env node

import fs from "node:fs"

const BASE_DIGEST = "sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb"
const REQUIRED_TOOLS = ["bash", "curl", "git", "gh", "gnupg", "jq", "ripgrep", "fd-find", "fzf", "bat", "vim-tiny", "unzip", "rsync", "patch", "procps", "lsof", "iproute2", "dnsutils", "tini", "python3", "sqlite3", "shellcheck", "tmux", "zsh", "build-essential"]
const PROVIDER_PACKAGES = ["@moonshot-ai/kimi-code", "@openai/codex", "@anthropic-ai/claude-code", "opencode-ai"]

/** @param {string} dockerfile @param {string} compose @returns {string[]} */
export function verifyDockerContract(dockerfile, compose) {
  const problems = []
  if (!dockerfile.includes(`FROM ubuntu:26.04@${BASE_DIGEST}`)) problems.push("base image digest")
  if (/^COPY\s/mu.test(dockerfile)) problems.push("source COPY")
  if (/npm\s+(?:ci|install)(?!\s+--global)/u.test(dockerfile)) problems.push("project dependency install")
  if (!dockerfile.includes("node_24.x") || !dockerfile.includes("sha256sum --check")) problems.push("signed NodeSource 24 setup")
  for (const tool of REQUIRED_TOOLS) if (!dockerfile.includes(`    ${tool}`)) problems.push(`tool ${tool}`)
  for (const packageName of PROVIDER_PACKAGES) {
    if (!dockerfile.includes(`https://registry.npmjs.org/${packageName}/latest`)) problems.push(`latest metadata ${packageName}`)
    if (!dockerfile.includes(`    "${packageName}"`)) problems.push(`unversioned CLI ${packageName}`)
    if (dockerfile.includes(`${packageName}@`)) problems.push(`version-pinned CLI ${packageName}`)
  }
  for (const command of ["kimi", "codex", "claude", "opencode"]) if (!dockerfile.includes(`${command} --version`)) problems.push(`CLI probe ${command}`)
  if (!/^name: velocious-testing$/mu.test(compose)) problems.push("Compose project name")
  if (!compose.includes("source: ${DEV_HOME_PATH:-/home/dev}") || !compose.includes("target: /home/dev")) problems.push("complete development-home bind")
  if ((compose.match(/type: bind/gu) || []).length !== 1) problems.push("exactly one bind")
  if (/container_name|ports:|privileged:|\/var\/run\/docker\.sock/iu.test(compose)) problems.push("forbidden Compose capability")
  if (/hermes|threadwire|provider-runtime|auth\.json/iu.test(`${dockerfile}\n${compose}`)) problems.push("orchestrator-specific path")
  return problems
}

const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8")
const compose = fs.readFileSync(new URL("../compose.yml", import.meta.url), "utf8")
const problems = verifyDockerContract(dockerfile, compose)
if (verifyDockerContract(`${dockerfile}\nCOPY package.json .`, compose).length === problems.length) problems.push("negative COPY probe")
if (verifyDockerContract(dockerfile, `${compose}\n    ports: [\"3000:3000\"]`).length === problems.length) problems.push("negative ports probe")
if (problems.length) {
  console.error(`Docker development contract violations:\n- ${problems.join("\n- ")}`)
  process.exitCode = 1
} else {
  console.log("Docker development contract verified (including negative probes).")
}
