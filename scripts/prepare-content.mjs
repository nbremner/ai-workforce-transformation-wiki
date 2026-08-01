#!/usr/bin/env node
/**
 * Deterministic publication adapter.
 *
 * Generates the Quartz `content/` directory from a read-only checkout of the
 * canonical research wiki (nbremner/llm-research-wiki). The canonical repo
 * stays the single editable corpus; this script only copies an allowlisted
 * subset and strips internal provenance frontmatter.
 *
 * Allowlist (everything else is ignored, even if later added under wiki/):
 *   <source>/overview.md      -> <dest>/index.md
 *   <source>/topics/*.md      -> <dest>/topics/*.md
 *   <source>/sources/*.md     -> <dest>/sources/*.md
 *
 * Stripped frontmatter keys (removed from published copies only, never from
 * canonical files): drive_file_id, file_hash.
 *
 * Usage: node scripts/prepare-content.mjs --source .source-wiki/wiki --dest content
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import YAML from "yaml"

const STRIPPED_KEYS = ["drive_file_id", "file_hash"]

function fail(message) {
  console.error(`prepare-content: ${message}`)
  process.exit(1)
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      dest: { type: "string" },
    },
  })
  if (!values.source || !values.dest) {
    fail("usage: prepare-content.mjs --source <wiki-dir> --dest <content-dir>")
  }
  return { source: path.resolve(values.source), dest: path.resolve(values.dest) }
}

/** Reject symlinks and non-Markdown files instead of following or publishing them. */
function listMarkdown(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      fail(`refusing to publish symlink: ${full}`)
    }
    if (entry.isDirectory()) {
      fail(`unexpected directory inside allowlisted input: ${full}`)
    }
    if (!entry.name.endsWith(".md")) {
      fail(`refusing to publish non-Markdown file: ${full}`)
    }
    files.push(full)
  }
  return files.sort()
}

function assertRegularFile(file) {
  const stat = fs.lstatSync(file)
  if (stat.isSymbolicLink()) fail(`refusing to publish symlink: ${file}`)
  if (!stat.isFile()) fail(`not a regular file: ${file}`)
}

/**
 * Strip only STRIPPED_KEYS from the frontmatter block, preserving every other
 * byte of the file. The block is validated with the yaml dependency before and
 * after the splice; any inconsistency fails the build rather than publishing
 * partially transformed content.
 */
function transform(raw, file) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!match) {
    fail(`missing frontmatter block in ${file}`)
  }
  const [block, fmText] = match
  let parsed
  try {
    parsed = YAML.parse(fmText)
  } catch (err) {
    fail(`malformed YAML frontmatter in ${file}: ${err.message}`)
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`frontmatter in ${file} is not a mapping`)
  }

  const present = STRIPPED_KEYS.filter((key) => key in parsed)
  if (present.length === 0) return raw

  for (const key of present) {
    const value = parsed[key]
    if (value !== null && typeof value === "object") {
      fail(`refusing to strip non-scalar ${key} in ${file}`)
    }
  }

  const keptLines = fmText
    .split("\n")
    .filter((line) => !STRIPPED_KEYS.some((key) => new RegExp(`^${key}\\s*:`).test(line)))
  const newFmText = keptLines.join("\n")

  let reparsed
  try {
    reparsed = YAML.parse(newFmText)
  } catch (err) {
    fail(`frontmatter splice produced invalid YAML in ${file}: ${err.message}`)
  }
  const expectedKeys = Object.keys(parsed).filter((key) => !STRIPPED_KEYS.includes(key))
  const actualKeys = Object.keys(reparsed ?? {})
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    fail(`frontmatter splice changed keys in ${file}; refusing to publish`)
  }
  for (const key of expectedKeys) {
    if (JSON.stringify(parsed[key]) !== JSON.stringify(reparsed[key])) {
      fail(`frontmatter splice changed value of ${key} in ${file}; refusing to publish`)
    }
  }

  return `---\n${newFmText}\n---\n` + raw.slice(block.length)
}

function copyTransformed(srcFile, destFile) {
  assertRegularFile(srcFile)
  const raw = fs.readFileSync(srcFile, "utf8")
  fs.writeFileSync(destFile, transform(raw, srcFile))
}

/**
 * Keep the generated destination out of git via .git/info/exclude rather than
 * .gitignore: Quartz's content glob honors .gitignore and would otherwise see
 * zero input files. Best-effort — skipped when not running inside a git repo.
 */
function ensureGitExclude(dest) {
  let dir = path.dirname(dest)
  while (dir !== path.dirname(dir)) {
    const gitDir = path.join(dir, ".git")
    if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
      const rel = path.relative(dir, dest)
      if (rel.startsWith("..")) return
      const pattern = `${rel.split(path.sep).join("/")}/`
      const excludeFile = path.join(gitDir, "info", "exclude")
      const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : ""
      if (!existing.split("\n").includes(pattern)) {
        fs.mkdirSync(path.dirname(excludeFile), { recursive: true })
        fs.writeFileSync(excludeFile, existing.replace(/\n?$/, "\n") + pattern + "\n")
      }
      return
    }
    dir = path.dirname(dir)
  }
}

function sourceRevision(source) {
  try {
    return execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return "unknown"
  }
}

function main() {
  const { source, dest } = parseCli()

  const overview = path.join(source, "overview.md")
  const topicsDir = path.join(source, "topics")
  const sourcesDir = path.join(source, "sources")
  if (!fs.existsSync(overview)) fail(`missing required input: ${overview} (overview.md)`)
  if (!fs.existsSync(topicsDir)) fail(`missing required input directory: ${topicsDir} (topics)`)
  if (!fs.existsSync(sourcesDir)) fail(`missing required input directory: ${sourcesDir} (sources)`)

  const topicFiles = listMarkdown(topicsDir)
  const sourceFiles = listMarkdown(sourcesDir)

  ensureGitExclude(dest)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(path.join(dest, "topics"), { recursive: true })
  fs.mkdirSync(path.join(dest, "sources"), { recursive: true })

  copyTransformed(overview, path.join(dest, "index.md"))
  for (const file of topicFiles) {
    copyTransformed(file, path.join(dest, "topics", path.basename(file)))
  }
  for (const file of sourceFiles) {
    copyTransformed(file, path.join(dest, "sources", path.basename(file)))
  }

  console.log(
    [
      "prepare-content manifest",
      `  source revision: ${sourceRevision(source)}`,
      `  topics: ${topicFiles.length}`,
      `  sources: ${sourceFiles.length}`,
      `  destination: ${dest}`,
    ].join("\n"),
  )
}

main()
