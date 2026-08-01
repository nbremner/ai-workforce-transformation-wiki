#!/usr/bin/env node
/**
 * Publication-boundary verifier.
 *
 * Default mode validates both the generated `content/` tree and the built
 * `public/` artifact. `--content-only` validates just `content/` (pre-build).
 * When `--source` points at the canonical wiki checkout, expected page counts
 * are computed from the allowlisted canonical inputs instead of trusting the
 * generated tree; there is deliberately no fixed expected page count.
 *
 * Usage:
 *   node scripts/verify-publication.mjs --content content --public public [--source .source-wiki/wiki] [--content-only]
 */
import fs from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import YAML from "yaml"

const STRIPPED_KEYS = ["drive_file_id", "file_hash"]
const MAP_PAGES = ["topic-map.md", "open-questions.md", "research-gaps.md", "watchlist.md"]
const ROOT_FILES = ["index.md", ...MAP_PAGES]
const errors = []

function problem(message) {
  errors.push(message)
}

function listDir(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : null
}

function mdNames(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
}

function checkContent(contentDir, sourceDir) {
  const entries = listDir(contentDir)
  if (!entries) {
    problem(`content directory missing: ${contentDir}`)
    return { topics: [], sources: [] }
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) problem(`symlink in content/: ${entry.name}`)
    if (entry.isFile() && !ROOT_FILES.includes(entry.name)) {
      problem(`unexpected file in content/ root: ${entry.name}`)
    }
    if (entry.isDirectory() && !["topics", "sources"].includes(entry.name)) {
      problem(`unexpected directory in content/: ${entry.name}`)
    }
  }
  for (const name of ROOT_FILES) {
    if (!entries.some((entry) => entry.isFile() && entry.name === name)) {
      problem(`content/${name} is missing`)
    }
  }

  const topics = fs.existsSync(path.join(contentDir, "topics"))
    ? mdNames(path.join(contentDir, "topics"))
    : (problem("content/topics/ is missing"), [])
  const sources = fs.existsSync(path.join(contentDir, "sources"))
    ? mdNames(path.join(contentDir, "sources"))
    : (problem("content/sources/ is missing"), [])

  for (const sub of ["topics", "sources"]) {
    const dir = path.join(contentDir, sub)
    if (!fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) problem(`symlink in content/${sub}/: ${entry.name}`)
      else if (!entry.isFile() || !entry.name.endsWith(".md")) {
        problem(`non-Markdown entry in content/${sub}/: ${entry.name}`)
      }
    }
  }

  if (topics.includes("schema.md") || sources.includes("schema.md")) {
    problem("schema.md leaked into content/")
  }

  const allFiles = [
    ...ROOT_FILES.map((name) => path.join(contentDir, name)),
    ...topics.map((name) => path.join(contentDir, "topics", name)),
    ...sources.map((name) => path.join(contentDir, "sources", name)),
  ]
  for (const file of allFiles) {
    if (!fs.existsSync(file)) continue
    const raw = fs.readFileSync(file, "utf8")
    for (const key of STRIPPED_KEYS) {
      if (raw.includes(key)) problem(`literal "${key}" present in ${file}`)
    }
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
    if (!match) {
      problem(`missing frontmatter in ${file}`)
      continue
    }
    let parsed
    try {
      parsed = YAML.parse(match[1])
    } catch (err) {
      problem(`malformed frontmatter in ${file}: ${err.message}`)
      continue
    }
    for (const key of STRIPPED_KEYS) {
      if (parsed && key in parsed) problem(`frontmatter key "${key}" present in ${file}`)
    }
  }

  if (sourceDir) {
    if (!fs.existsSync(sourceDir)) {
      problem(`canonical source directory missing: ${sourceDir}`)
    } else {
      const expectedTopics = mdNames(path.join(sourceDir, "topics"))
      const expectedSources = mdNames(path.join(sourceDir, "sources"))
      if (JSON.stringify(expectedTopics) !== JSON.stringify(topics)) {
        problem(
          `content/topics/ does not match canonical topics/ (${topics.length} vs ${expectedTopics.length} expected)`,
        )
      }
      if (JSON.stringify(expectedSources) !== JSON.stringify(sources)) {
        problem(
          `content/sources/ does not match canonical sources/ (${sources.length} vs ${expectedSources.length} expected)`,
        )
      }
    }
  }

  return { topics, sources }
}

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

function pageExists(publicDir, slug) {
  return (
    fs.existsSync(path.join(publicDir, `${slug}.html`)) ||
    fs.existsSync(path.join(publicDir, slug, "index.html"))
  )
}

function checkPublic(publicDir, topics, sources) {
  if (!fs.existsSync(publicDir)) {
    problem(`public directory missing: ${publicDir}`)
    return
  }

  // Expected page slugs, computed from the generated content (which is itself
  // checked against the canonical inputs above). No fixed page count.
  const expected = new Set(["index", "404", "topics", "sources", "topics/index", "sources/index"])
  for (const name of MAP_PAGES) expected.add(name.replace(/\.md$/, ""))
  for (const name of topics) expected.add(`topics/${name.replace(/\.md$/, "")}`)
  for (const name of sources) expected.add(`sources/${name.replace(/\.md$/, "")}`)

  if (!fs.existsSync(path.join(publicDir, "index.html"))) problem("public/index.html missing")
  for (const name of MAP_PAGES) {
    const slug = name.replace(/\.md$/, "")
    if (!pageExists(publicDir, slug)) problem(`map page missing in public/: ${slug}`)
  }
  if (!pageExists(publicDir, "topics")) problem("topics folder page missing in public/")
  if (!pageExists(publicDir, "sources")) problem("sources folder page missing in public/")
  for (const name of topics) {
    if (!pageExists(publicDir, `topics/${name.replace(/\.md$/, "")}`)) {
      problem(`topic page missing in public/: ${name}`)
    }
  }
  for (const name of sources) {
    if (!pageExists(publicDir, `sources/${name.replace(/\.md$/, "")}`)) {
      problem(`source page missing in public/: ${name}`)
    }
  }

  for (const file of walk(publicDir)) {
    const rel = path.relative(publicDir, file).split(path.sep).join("/")
    if (rel.endsWith(".html") && !rel.startsWith("static/")) {
      const slug = rel.replace(/\.html$/, "").replace(/\/index$/, "") || "index"
      if (!expected.has(slug) && slug !== "index") {
        problem(`public/ contains a page outside the publication boundary: ${rel}`)
      }
    }
    const buf = fs.readFileSync(file)
    for (const key of STRIPPED_KEYS) {
      if (buf.includes(key)) problem(`literal "${key}" appears in public artifact: ${rel}`)
    }
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      content: { type: "string" },
      public: { type: "string" },
      source: { type: "string" },
      "content-only": { type: "boolean", default: false },
    },
  })
  if (!values.content || (!values["content-only"] && !values.public)) {
    console.error(
      "usage: verify-publication.mjs --content <dir> --public <dir> [--source <wiki-dir>] [--content-only]",
    )
    process.exit(1)
  }

  const { topics, sources } = checkContent(path.resolve(values.content), values.source)
  if (!values["content-only"]) {
    checkPublic(path.resolve(values.public), topics, sources)
  }

  if (errors.length > 0) {
    console.error(`verify-publication: FAILED (${errors.length} problem(s))`)
    for (const message of errors) console.error(`  - ${message}`)
    process.exit(1)
  }
  console.log(
    `verify-publication: OK (${values["content-only"] ? "content-only" : "content+public"}; ${topics.length} topics, ${sources.length} sources)`,
  )
}

main()
