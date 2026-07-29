import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..")
const fixtureWiki = path.join(here, "fixtures", "wiki")
const adapter = path.join(repoRoot, "scripts", "prepare-content.mjs")

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prepare-content-"))
}

/** Copy the fixture wiki into a fresh temp dir so tests can mutate it. */
function freshWiki(tmp) {
  const src = path.join(tmp, "wiki")
  fs.cpSync(fixtureWiki, src, { recursive: true })
  return src
}

function runAdapter(source, dest) {
  return spawnSync(process.execPath, [adapter, "--source", source, "--dest", dest], {
    encoding: "utf8",
  })
}

function frontmatter(file) {
  const raw = fs.readFileSync(file, "utf8")
  const match = raw.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(match, `expected frontmatter in ${file}`)
  return YAML.parse(match[1])
}

function body(file) {
  const raw = fs.readFileSync(file, "utf8")
  return raw.replace(/^---\n[\s\S]*?\n---\n/, "")
}

test("overview.md becomes index.md and is not duplicated", () => {
  const tmp = makeTmp()
  const src = freshWiki(tmp)
  const dest = path.join(tmp, "content")
  const res = runAdapter(src, dest)
  assert.equal(res.status, 0, res.stderr)
  assert.ok(fs.existsSync(path.join(dest, "index.md")))
  assert.ok(!fs.existsSync(path.join(dest, "overview.md")))
})

test("topic and source relative paths are preserved", () => {
  const tmp = makeTmp()
  const src = freshWiki(tmp)
  const dest = path.join(tmp, "content")
  const res = runAdapter(src, dest)
  assert.equal(res.status, 0, res.stderr)
  assert.ok(fs.existsSync(path.join(dest, "topics", "example-topic.md")))
  assert.ok(fs.existsSync(path.join(dest, "sources", "2026-example-source.md")))
})

test("drive_file_id and file_hash are stripped from frontmatter", () => {
  const tmp = makeTmp()
  const src = freshWiki(tmp)
  const dest = path.join(tmp, "content")
  const res = runAdapter(src, dest)
  assert.equal(res.status, 0, res.stderr)
  const fm = frontmatter(path.join(dest, "sources", "2026-example-source.md"))
  assert.ok(!("drive_file_id" in fm))
  assert.ok(!("file_hash" in fm))
  const raw = fs.readFileSync(path.join(dest, "sources", "2026-example-source.md"), "utf8")
  assert.ok(!raw.includes("drive_file_id"))
  assert.ok(!raw.includes("file_hash"))
})

test("all other frontmatter fields survive", () => {
  const tmp = makeTmp()
  const src = freshWiki(tmp)
  const dest = path.join(tmp, "content")
  const res = runAdapter(src, dest)
  assert.equal(res.status, 0, res.stderr)
  const fm = frontmatter(path.join(dest, "sources", "2026-example-source.md"))
  assert.equal(fm.title, "An Example Source: With a Colon in the Title")
  assert.equal(fm.authors, "Example, Author")
  assert.equal(fm.year, 2026)
  assert.equal(fm.url, "https://example.org/paper")
  assert.equal(fm.doi, "https://doi.org/10.1234/example.2026")
  assert.equal(fm.source_type, "report")
  assert.equal(fm.publication_status, "other")
  assert.equal(String(fm.retrieved), "2026-07-28")
  assert.equal(fm.status, "active")
  assert.equal(String(fm.updated), "2026-07-28")
})

test("markdown bodies and wikilinks survive byte-for-byte", () => {
  const tmp = makeTmp()
  const src = freshWiki(tmp)
  const dest = path.join(tmp, "content")
  const res = runAdapter(src, dest)
  assert.equal(res.status, 0, res.stderr)
  const outBody = body(path.join(dest, "topics", "example-topic.md"))
  const inBody = body(path.join(src, "topics", "example-topic.md"))
  assert.equal(outBody, inBody)
  assert.ok(outBody.includes("[[2026-example-source]]"))
  assert.ok(outBody.includes("em dash — and “curly quotes”"))
  const indexBody = body(path.join(dest, "index.md"))
  assert.equal(indexBody, body(path.join(src, "overview.md")))
})

test("schema.md and arbitrary extra directories are not copied", () => {
  const tmp = makeTmp()
  const src = freshWiki(tmp)
  fs.writeFileSync(path.join(src, "schema.md"), "# Schema\n\nInternal contract.\n")
  fs.mkdirSync(path.join(src, "internal-notes"), { recursive: true })
  fs.writeFileSync(path.join(src, "internal-notes", "secret.md"), "# Secret\n")
  const dest = path.join(tmp, "content")
  const res = runAdapter(src, dest)
  assert.equal(res.status, 0, res.stderr)
  assert.ok(!fs.existsSync(path.join(dest, "schema.md")))
  assert.ok(!fs.existsSync(path.join(dest, "internal-notes")))
  const copied = fs.readdirSync(dest).sort()
  assert.deepEqual(copied, ["index.md", "sources", "topics"])
})

test("malformed frontmatter fails the build", () => {
  const tmp = makeTmp()
  const src = freshWiki(tmp)
  fs.writeFileSync(
    path.join(src, "topics", "broken.md"),
    "---\ntitle: [unclosed\nstatus: active\n---\n\n# Broken\n",
  )
  const dest = path.join(tmp, "content")
  const res = runAdapter(src, dest)
  assert.notEqual(res.status, 0)
  assert.match(res.stderr, /broken\.md/)
})

test("a symlink in an allowlisted directory fails the build", () => {
  const tmp = makeTmp()
  const src = freshWiki(tmp)
  fs.writeFileSync(path.join(tmp, "outside.md"), "# Outside\n")
  fs.symlinkSync(path.join(tmp, "outside.md"), path.join(src, "topics", "sneaky.md"))
  const dest = path.join(tmp, "content")
  const res = runAdapter(src, dest)
  assert.notEqual(res.status, 0)
  assert.match(res.stderr, /symlink/i)
})

test("a non-Markdown file in an allowlisted directory fails the build", () => {
  const tmp = makeTmp()
  const src = freshWiki(tmp)
  fs.writeFileSync(path.join(src, "sources", "raw.pdf"), "%PDF-1.4 fake\n")
  const dest = path.join(tmp, "content")
  const res = runAdapter(src, dest)
  assert.notEqual(res.status, 0)
  assert.match(res.stderr, /raw\.pdf/)
})

test("stale destination files disappear on the next run", () => {
  const tmp = makeTmp()
  const src = freshWiki(tmp)
  const dest = path.join(tmp, "content")
  fs.mkdirSync(path.join(dest, "topics"), { recursive: true })
  fs.writeFileSync(path.join(dest, "topics", "stale.md"), "# Stale\n")
  const res = runAdapter(src, dest)
  assert.equal(res.status, 0, res.stderr)
  assert.ok(!fs.existsSync(path.join(dest, "topics", "stale.md")))
})

test("missing overview, topics, or sources fails clearly", () => {
  for (const removal of ["overview.md", "topics", "sources"]) {
    const tmp = makeTmp()
    const src = freshWiki(tmp)
    fs.rmSync(path.join(src, removal), { recursive: true, force: true })
    const res = runAdapter(src, path.join(tmp, "content"))
    assert.notEqual(res.status, 0, `expected failure when ${removal} is missing`)
    assert.match(res.stderr, new RegExp(removal.replace(".", "\\.")))
  }
})

test("manifest reports counts and destination without private IDs", () => {
  const tmp = makeTmp()
  const src = freshWiki(tmp)
  const dest = path.join(tmp, "content")
  const res = runAdapter(src, dest)
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /topics:\s*1\b/)
  assert.match(res.stdout, /sources:\s*1\b/)
  assert.ok(res.stdout.includes(dest))
  assert.ok(!res.stdout.includes("1AbCdEfGhIjKlMnOpQrStUvWxYz012345"))
  assert.ok(!res.stdout.includes("0123456789abcdef"))
})
