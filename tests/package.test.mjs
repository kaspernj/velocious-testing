import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import test from "node:test"

import {build as bundle} from "esbuild"

const exec = promisify(execFile)
const TEST_DURATION_PATTERN = String.raw`\((?:\d+ms|\d+\.\d{3}s)\)`
const BASELINE_COMMIT = "5906c839dc21b296147c3a25fc9e66cd42000780"

/** @param {Record<string, any>} tree @returns {boolean} */
function hasVelociousDependency(tree) {
  if (Object.hasOwn(tree.dependencies || {}, "velocious")) return true
  return Object.values(tree.dependencies || {}).some((dependency) => hasVelociousDependency(dependency))
}

/** @param {string} directory */
async function materializeBaselineSourceCopy(directory) {
  await mkdir(path.join(directory, "src"), {recursive: true})
  for (const file of ["package.json", "src/context.js", "src/events.js", "src/index.js", "src/matchers.js", "src/mocks.js"]) {
    const contents = (await exec("git", ["show", `${BASELINE_COMMIT}:${file}`], {cwd: process.cwd()})).stdout
    await writeFile(path.join(directory, file), contents)
  }
}

/** @param {string} directory */
async function materializeCandidateSourceCopy(directory) {
  await mkdir(directory, {recursive: true})
  await cp("src", path.join(directory, "src"), {recursive: true})
  await cp("package.json", path.join(directory, "package.json"))
}

test("lockfile and package metadata contain no Velocious dependency", async () => {
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"))
  assert.equal(hasVelociousDependency(lock.packages?.[""] || {}), false)
  assert.equal(Object.keys(lock.packages || {}).some((name) => name === "node_modules/velocious"), false)
})

test("root and runner bundle for browsers without Node built-ins", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-bundle-"))
  try {
    for (const entry of ["src/index.js", "src/runner.js"]) {
      const result = await bundle({entryPoints: [entry], bundle: true, format: "esm", platform: "browser", write: false, metafile: true})
      assert.ok(result.outputFiles[0].text.length > 0)
      const inputPaths = Object.keys(result.metafile.inputs)
      if (entry === "src/index.js") {
        assert.ok(inputPaths.includes("src/equality.js"))
        assert.ok(inputPaths.includes("src/fake-timers.js"))
        assert.ok(inputPaths.includes("src/mocks.js"))
      }
      assert.ok(inputPaths.includes("src/real-time.js"))
      assert.ok(inputPaths.includes("src/shared-runtime-state.js"))
      assert.equal(inputPaths.some((input) => input.startsWith("node:")), false)
      assert.doesNotMatch(result.outputFiles[0].text, /\bimport\.meta\b/u)
      for (const inputPath of inputPaths) {
        assert.doesNotMatch(await readFile(inputPath, "utf8"), /\bimport\.meta\b/u, `${inputPath} contains raw import.meta`)
      }
    }
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test("baseline and advanced-matcher package copies reject mixed context schemas in both load orders", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-mixed-copies-"))
  const baseline = path.join(fixture, "baseline")
  const candidate = path.join(fixture, "candidate")
  try {
    await materializeBaselineSourceCopy(baseline)
    await materializeCandidateSourceCopy(candidate)
    const probes = []
    for (const order of [[baseline, candidate], [candidate, baseline]]) {
      const firstSpecifier = JSON.stringify(path.join(order[0], "src", "index.js"))
      const secondSpecifier = JSON.stringify(path.join(order[1], "src", "index.js"))
      const probe = await exec("node", ["--input-type=module", "--eval", [
        `const first = await import(${firstSpecifier});`,
        "let second; let error;",
        `try { second = await import(${secondSpecifier}) } catch (caught) { error = caught }`,
        "let candidateContract;",
        `if (second && ${JSON.stringify(order[1] === candidate)}) {`,
        "  const installed = second.installGlobals({});",
        "  const contextExpectation = second.defaultTestContext.expect(Promise.resolve(1));",
        "  candidateContract = {",
        "    resolves: typeof contextExpectation.resolves,",
        "    rejects: typeof contextExpectation.rejects,",
        "    extend: typeof second.defaultTestContext.expect.extend,",
        "    any: typeof second.defaultTestContext.expect.any,",
        "    globalExtend: typeof installed.expect.extend",
        "  };",
        "}",
        "console.log(JSON.stringify({firstSchema: first.defaultTestContext.schemaVersion, secondLoaded: Boolean(second), error: error?.message, candidateContract}));"
      ].join("\n")], {cwd: fixture})
      probes.push(JSON.parse(probe.stdout))
    }

    assert.deepEqual(probes, [
      {
        firstSchema: 2,
        secondLoaded: false,
        error: "Incompatible @velocious/testing default context: found protocol 1/schema 2, expected protocol 1/schema 3"
      },
      {
        firstSchema: 3,
        secondLoaded: false,
        error: "Incompatible @velocious/testing default context: found protocol 1/schema 3, expected protocol 1/schema 2"
      }
    ])
  } finally {
    await rm(fixture, {recursive: true, force: true})
  }
})

test("compatible physical package copies share asymmetric matcher identity", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-compatible-copies-"))
  const first = path.join(fixture, "first")
  const second = path.join(fixture, "second")
  try {
    await materializeCandidateSourceCopy(first)
    await materializeCandidateSourceCopy(second)
    const probe = await exec("node", ["--input-type=module", "--eval", [
      `const first = await import(${JSON.stringify(path.join(first, "src", "index.js"))});`,
      `const second = await import(${JSON.stringify(path.join(second, "src", "index.js"))});`,
      "second.expect({id: 7, tags: [\"admin\"]}).toEqual(first.objectContaining({",
      "  id: first.any(Number),",
      "  tags: first.arrayContaining([first.stringContaining(\"min\")])",
      "}));",
      "first.expect(\"Grace Hopper\").toEqual(second.stringMatching(/Hopper$/u));",
      "console.log(JSON.stringify({firstSchema: first.CONTEXT_SCHEMA_VERSION, secondSchema: second.CONTEXT_SCHEMA_VERSION}));"
    ].join("\n")], {cwd: fixture})

    assert.deepEqual(JSON.parse(probe.stdout), {firstSchema: 3, secondSchema: 3})
  } finally {
    await rm(fixture, {recursive: true, force: true})
  }
})

test("a later physical copy keeps runner deadlines on the shared real clock", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-shared-clock-"))
  const first = path.join(fixture, "first")
  const second = path.join(fixture, "second")
  try {
    await materializeCandidateSourceCopy(first)
    await materializeCandidateSourceCopy(second)
    const probe = await exec("node", ["--input-type=module", "--eval", [
      "const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);",
      "const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);",
      `const first = await import(${JSON.stringify(path.join(first, "src", "index.js"))});`,
      "const clock = first.createFakeTimers({now: 9000});",
      "clock.install();",
      "try {",
      `  const second = await import(${JSON.stringify(path.join(second, "src", "index.js"))});`,
      `  const {runTests} = await import(${JSON.stringify(path.join(second, "src", "runner.js"))});`,
      "  const context = second.createTestContext();",
      "  const events = [];",
      "  context.describe(\"late copy\", () => {",
      "    context.it(\"times out\", {timeoutMs: 10}, () => new Promise(() => {}));",
      "  });",
      "  const runPromise = runTests({context, reporter: {onEvent: (event) => events.push(event)}});",
      "  let safetyTimer;",
      "  const outcome = await Promise.race([",
      "    runPromise.then(() => \"runner\"),",
      "    new Promise((resolve) => { safetyTimer = nativeSetTimeout(() => resolve(\"safety\"), 200) })",
      "  ]);",
      "  nativeClearTimeout(safetyTimer);",
      "  if (outcome === \"safety\") clock.advanceBy(10);",
      "  const result = await runPromise;",
      "  console.log(JSON.stringify({",
      "    outcome,",
      "    status: result.tests[0].status,",
      "    message: result.tests[0].error?.message,",
      "    realTimestamps: events.length > 0 && events.every((event) => event.timestamp !== 9000 && event.timestamp !== 9010)",
      "  }));",
      "} finally { clock.restore() }"
    ].join("\n")], {cwd: fixture, timeout: 2_000})

    assert.deepEqual(JSON.parse(probe.stdout), {
      outcome: "runner",
      status: "failed",
      message: "Timed out after 10ms: late copy times out",
      realTimestamps: true
    })
  } finally {
    await rm(fixture, {recursive: true, force: true})
  }
})

test("physical copies coordinate fake timer ownership and restore exactly", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-shared-timer-owner-"))
  const first = path.join(fixture, "first")
  const second = path.join(fixture, "second")
  try {
    await materializeCandidateSourceCopy(first)
    await materializeCandidateSourceCopy(second)
    const probe = await exec("node", ["--input-type=module", "--eval", [
      "const properties = [\"Date\", \"setTimeout\", \"clearTimeout\", \"setInterval\", \"clearInterval\"];",
      "const original = new Map(properties.map((property) => [property, Object.getOwnPropertyDescriptor(globalThis, property)]));",
      `const first = await import(${JSON.stringify(path.join(first, "src", "index.js"))});`,
      `const second = await import(${JSON.stringify(path.join(second, "src", "index.js"))});`,
      "const firstClock = first.createFakeTimers({now: 1000});",
      "const secondClock = second.createFakeTimers({now: 2000});",
      "firstClock.install();",
      "let overlapError;",
      "try { secondClock.install() } catch (error) { overlapError = error?.message }",
      "firstClock.restore();",
      "if (overlapError) {",
      "  secondClock.install();",
      "  secondClock.restore();",
      "} else {",
      "  secondClock.restore();",
      "}",
      "const restored = properties.every((property) => {",
      "  const actual = Object.getOwnPropertyDescriptor(globalThis, property);",
      "  const expected = original.get(property);",
      "  return actual?.value === expected?.value &&",
      "    actual?.writable === expected?.writable &&",
      "    actual?.enumerable === expected?.enumerable &&",
      "    actual?.configurable === expected?.configurable;",
      "});",
      "console.log(JSON.stringify({overlapError, restored}));"
    ].join("\n")], {cwd: fixture})

    assert.deepEqual(JSON.parse(probe.stdout), {
      overlapError: "Target already has fake timers installed",
      restored: true
    })
  } finally {
    await rm(fixture, {recursive: true, force: true})
  }
})

test("expect.extend reserves constructor fields atomically without poisoning new expectations", async () => {
  for (const reservedName of ["value", "negated", "changes", "settlement"]) {
    const probe = await exec("node", ["--input-type=module", "--eval", [
      `const {expect} = await import(${JSON.stringify(path.resolve("src/index.js"))});`,
      `const reservedName = ${JSON.stringify(reservedName)};`,
      "const definitions = {",
      "  toRemainUnregisteredAfterConflict() { return {pass: true, message: \"unused\"} },",
      "  [reservedName]() { return {pass: true, message: \"unused\"} }",
      "};",
      "let extendError;",
      "try { expect.extend(definitions) } catch (error) { extendError = error?.message }",
      "let ordinaryOk = false;",
      "try {",
      "  const ordinary = expect(1);",
      "  ordinaryOk = ordinary.value === 1 && ordinary.negated === false && Array.isArray(ordinary.changes) && ordinary.changes.length === 0;",
      "} catch {}",
      "let promiseOk = false;",
      "try {",
      "  const promise = Promise.resolve(1);",
      "  const promised = expect(promise).resolves;",
      "  promiseOk = promised.value === promise && promised.negated === false && promised.settlement === \"resolves\";",
      "} catch {}",
      "console.log(JSON.stringify({",
      "  extendError,",
      "  ordinaryOk,",
      "  promiseOk,",
      "  companionType: typeof expect(1).toRemainUnregisteredAfterConflict",
      "}));"
    ].join("\n")], {cwd: process.cwd()})

    assert.deepEqual(JSON.parse(probe.stdout), {
      extendError: `Custom matcher ${JSON.stringify(reservedName)} conflicts with an existing matcher`,
      ordinaryOk: true,
      promiseOk: true,
      companionType: "undefined"
    })
  }
})

test("generated mock declarations accept string and symbol keys but reject numeric keys", async () => {
  await exec(path.resolve("node_modules/.bin/tsc"), [
    "--ignoreConfig",
    "--noEmit",
    "--strict",
    "--target", "ES2022",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "--lib", "ES2022,DOM",
    "--skipLibCheck",
    "tests/types/mock-scope.test.ts"
  ], {cwd: process.cwd()})
})

test("generated fake timer declarations expose the bounded root contract", async () => {
  await exec(path.resolve("node_modules/.bin/tsc"), [
    "--ignoreConfig",
    "--noEmit",
    "--strict",
    "--target", "ES2022",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "--lib", "ES2022,DOM",
    "--skipLibCheck",
    "tests/types/fake-timers.test.ts"
  ], {cwd: process.cwd()})
})

test("generated matcher declarations expose promise, asymmetric, and extensible custom contracts", async () => {
  await exec(path.resolve("node_modules/.bin/tsc"), [
    "--ignoreConfig",
    "--noEmit",
    "--strict",
    "--target", "ES2022",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "--lib", "ES2022,DOM",
    "--skipLibCheck",
    "tests/types/matchers.test.ts"
  ], {cwd: process.cwd()})
})

test("generated runner declarations expose the suite hook executor contract", async () => {
  await exec(path.resolve("node_modules/.bin/tsc"), [
    "--ignoreConfig",
    "--noEmit",
    "--strict",
    "--target", "ES2022",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "--lib", "ES2022,DOM",
    "--skipLibCheck",
    "tests/types/runner.test.ts"
  ], {cwd: process.cwd()})
})

test("packed tarball has explicit exports, resolvable maps, declarations, executable CLI, and works standalone", async () => {
  const artifactDirectory = path.resolve("tmp/package")
  const cacheDirectory = path.resolve("tmp/npm-cache")
  await mkdir(artifactDirectory, {recursive: true})
  const dry = JSON.parse((await exec("npm", ["pack", "--dry-run", "--json", "--cache", cacheDirectory], {cwd: process.cwd()})).stdout)[0]
  const names = dry.files.map((file) => file.path)
  for (const required of ["package.json", "build/index.js", "build/index.d.ts", "build/equality.js", "build/equality.d.ts", "build/fake-timers.js", "build/fake-timers.d.ts", "build/matchers.js", "build/matchers.d.ts", "build/mocks.js", "build/mocks.d.ts", "build/real-time.js", "build/real-time.d.ts", "build/runner.js", "build/runner.d.ts", "build/node/index.js", "build/node/index.d.ts", "build/node/cli.js", "docs/fake-timers.md", "docs/matchers.md", "docs/test-doubles.md", "README.md", "LICENSE"]) {
    assert.ok(names.includes(required), `missing ${required}`)
  }
  assert.ok(names.includes("src/index.js"))
  assert.ok(names.includes("src/node/index.js"))
  assert.equal(names.some((name) => name.startsWith("tests/")), false)
  const shippedPaths = new Set(names)
  for (const mapPath of names.filter((name) => name.endsWith(".map"))) {
    const map = JSON.parse(await readFile(mapPath, "utf8"))
    map.sources.forEach((source, index) => {
      if (typeof map.sourcesContent?.[index] === "string") return
      const resolvedSource = path.posix.normalize(path.posix.join(path.posix.dirname(mapPath), source))
      assert.ok(shippedPaths.has(resolvedSource), `${mapPath} references missing source ${resolvedSource}`)
    })
  }

  const packed = JSON.parse((await exec("npm", ["pack", "--json", "--pack-destination", artifactDirectory, "--cache", cacheDirectory], {cwd: process.cwd()})).stdout)[0]
  const tarball = path.join(artifactDirectory, packed.filename)
  const fixture = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-standalone-"))
  try {
    await writeFile(path.join(fixture, "package.json"), JSON.stringify({name: "standalone-smoke", private: true, type: "module"}))
    await exec("npm", ["install", "--ignore-scripts", "--cache", cacheDirectory, tarball], {cwd: fixture})
    const installedPackage = path.join(fixture, "node_modules", "@velocious", "testing")
    const rootDeclarations = await readFile(path.join(installedPackage, "build", "index.d.ts"), "utf8")
    const matcherDeclarations = await readFile(path.join(installedPackage, "build", "matchers.d.ts"), "utf8")
    const mockDeclarations = await readFile(path.join(installedPackage, "build", "mocks.d.ts"), "utf8")
    const timerDeclarations = await readFile(path.join(installedPackage, "build", "fake-timers.d.ts"), "utf8")
    assert.match(rootDeclarations, /createFakeTimers.*\.\/fake-timers\.js/u)
    for (const publicType of ["FakeTimerOptions", "FakeTimers", "FakeTimerTarget"]) {
      assert.match(rootDeclarations, new RegExp(`export type ${publicType}\\b`, "u"))
      assert.match(timerDeclarations, new RegExp(`export type ${publicType}\\b`, "u"))
    }
    assert.match(rootDeclarations, /createMockScope, mock.*\.\/mocks\.js/u)
    for (const publicName of ["any", "anything", "Expect", "PromiseExpectation", "stringContaining", "stringMatching"]) {
      assert.match(rootDeclarations, new RegExp(`\\b${publicName}\\b`, "u"))
    }
    for (const publicType of ["AsymmetricMatcher", "CustomMatcher", "CustomMatcherContext", "CustomMatcherDefinitions", "CustomMatcherResult"]) {
      assert.match(rootDeclarations, new RegExp(`export type ${publicType}\\b`, "u"))
    }
    assert.match(matcherDeclarations, /function extend\(definitions: CustomMatcherDefinitions\): void/u)
    assert.match(matcherDeclarations, /get resolves\(\): PromiseExpectation/u)
    assert.match(matcherDeclarations, /get rejects\(\): PromiseExpectation/u)
    for (const publicName of ["fn", "spyOn", "stub", "clearAll", "resetAll", "restoreAll"]) {
      assert.match(mockDeclarations, new RegExp(`\\b${publicName}\\b`, "u"))
    }
    const physicalCopy = path.join(fixture, "physical-copy")
    await cp(installedPackage, physicalCopy, {recursive: true})
    const compatibleCopies = await exec("node", ["--input-type=module", "--eval", [
      `const first = await import(${JSON.stringify(path.join(installedPackage, "build", "index.js"))});`,
      `const second = await import(${JSON.stringify(path.join(physicalCopy, "build", "index.js"))});`,
      'if (first.defaultTestContext !== second.defaultTestContext) throw new Error("schema-3 copies split the default context")',
      'first.describe("shared physical tree", () => first.it("visible", () => {}));',
      'if (second.defaultTestContext.registry.suites.at(-1)?.name !== "shared physical tree") throw new Error("registration was not shared")',
      'console.log(`${first.defaultTestContext.protocolMajor}/${first.defaultTestContext.schemaVersion}`)'
    ].join("\n")], {cwd: fixture})
    assert.equal(compatibleCopies.stdout.trim(), "1/3")
    await exec("node", ["--input-type=module", "--eval", [
      'globalThis[Symbol.for("@velocious/testing.default-context.v1")] = {protocolMajor: 1, schemaVersion: 1, registry: {suites: []}};',
      `await import(${JSON.stringify(path.join(physicalCopy, "build", "index.js"))}).then(`,
      '  () => { throw new Error("schema mismatch unexpectedly registered") },',
      '  (error) => { if (!/found protocol 1\\/schema 1, expected protocol 1\\/schema 3/.test(error.message)) throw error }',
      ')'
    ].join("\n")], {cwd: fixture})
    await mkdir(path.join(fixture, "tests"))
    await writeFile(path.join(fixture, "tests", "smoke.test.js"), [
      'import {describe, expect, it} from "@velocious/testing"',
      'describe("standalone", () => {',
      '  it("selected by line", () => expect(2 + 2).toEqual(4))',
      '  it("not selected by line", () => expect(true).toBeTrue())',
      '})'
    ].join("\n"))
    const cli = await exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), [], {cwd: fixture})
    assert.match(cli.stdout, new RegExp(`^✓ standalone selected by line ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(cli.stdout, new RegExp(`^✓ standalone not selected by line ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(cli.stdout, /2 passed, 0 failed, 2 total/)
    const locationProbe = await exec("node", ["--input-type=module", "--eval", [
      'import {runNodeTests} from "@velocious/testing/node";',
      'const result = await runNodeTests({candidates: ["tests/smoke.test.js"]});',
      'console.log(JSON.stringify(result.tests.map((test) => test.location)));'
    ].join("\n")], {cwd: fixture})
    assert.deepEqual(JSON.parse(locationProbe.stdout), [
      {filePath: path.join(fixture, "tests", "smoke.test.js"), line: 3},
      {filePath: path.join(fixture, "tests", "smoke.test.js"), line: 4}
    ])
    const byLine = await exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["tests/smoke.test.js:3"], {cwd: fixture})
    assert.match(byLine.stdout, new RegExp(`^✓ standalone selected by line ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.doesNotMatch(byLine.stdout, /✓ standalone not selected by line/)
    assert.match(byLine.stdout, /1 passed, 0 failed, 1 total/)
    await writeFile(path.join(fixture, "tests", "falsy.test.js"), [
      'import {describe, it} from "@velocious/testing"',
      'describe("standalone falsy failure", () => {',
      '  it("fails", () => { throw undefined })',
      '})'
    ].join("\n"))
    await assert.rejects(
      exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["tests/falsy.test.js"], {cwd: fixture}),
      (error) => error.code === 1 &&
        new RegExp(`^✗ standalone falsy failure fails ${TEST_DURATION_PATTERN}$`, "mu").test(error.stdout) &&
        /0 passed, 1 failed, 1 total/.test(error.stdout) && /undefined/.test(error.stderr)
    )
    await writeFile(path.join(fixture, "tests", "retry.test.js"), [
      'import {describe, it} from "@velocious/testing"',
      "let attempts = 0",
      'describe("standalone retry", () => {',
      '  it("passes after retry", {retries: 1}, () => {',
      "    attempts += 1",
      '    if (attempts === 1) throw new Error("retry")',
      "  })",
      "})"
    ].join("\n"))
    const retried = await exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["tests/retry.test.js"], {cwd: fixture})
    assert.match(retried.stdout, new RegExp(`^✓ standalone retry passes after retry ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(retried.stdout, /1 passed, 0 failed, 1 total/)
    await writeFile(path.join(fixture, "tests", "setup-blocked.test.js"), [
      'import {beforeAll, describe, it} from "@velocious/testing"',
      'describe("standalone setup", () => {',
      '  beforeAll(() => { throw new Error("setup blocked") })',
      '  it("does not run", () => {})',
      "})"
    ].join("\n"))
    await assert.rejects(
      exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["tests/setup-blocked.test.js"], {cwd: fixture}),
      (error) => error.code === 1 &&
        /^✗ standalone setup does not run \(not run\)$/mu.test(error.stdout) &&
        /0 passed, 1 failed, 1 total/.test(error.stdout) && /setup blocked/.test(error.stderr)
    )
    await writeFile(path.join(fixture, "tests", "stage1.test.js"), [
      'import {describe, fdescribe, fit, it, test, xdescribe, xit, xtest} from "@velocious/testing"',
      'describe("focus", () => {',
      '  it("ordinary", () => {})',
      '  fit("fit", () => {})',
      '  it.only("it only", () => {})',
      '  xit("xit", () => { throw new Error("xit ran") })',
      '  xtest("xtest", () => { throw new Error("xtest ran") })',
      '  it.todo("todo")',
      '})',
      'fdescribe("table", () => {',
      '  test("test alias", () => {})',
      '  it.each([["array", 2], {kind: "object"}])("row %# %s", () => {})',
      '})',
      'xdescribe("skipped suite", () => {',
      '  it("child", () => { throw new Error("skipped suite ran") })',
      '})',
      'describe.todo("todo suite", () => {',
      '  it("child", () => { throw new Error("todo suite ran") })',
      '})'
    ].join("\n"))
    const stageOneProbe = await exec("node", ["--input-type=module", "--eval", [
      'import {runNodeTests} from "@velocious/testing/node";',
      'const focused = await runNodeTests({candidates: ["tests/stage1.test.js"]});',
      'const all = await runNodeTests({candidates: ["tests/stage1.test.js"], ignoreFocus: true});',
      'const view = (result) => ({status: result.status, counts: result.counts, tests: result.tests.map((entry) => entry.fullName), nonRuns: result.nonRunTests.map((entry) => [entry.fullName, entry.status])});',
      'console.log(JSON.stringify({focused: view(focused), all: view(all)}));'
    ].join("\n")], {cwd: fixture})
    assert.deepEqual(JSON.parse(stageOneProbe.stdout), {
      focused: {
        status: "passed",
        counts: {total: 5, passed: 5, failed: 0, skipped: 6},
        tests: ["focus fit", "focus it only", "table test alias", "table row 0 array", "table row 1 [object Object]"],
        nonRuns: []
      },
      all: {
        status: "passed",
        counts: {total: 6, passed: 6, failed: 0, skipped: 5},
        tests: ["focus ordinary", "focus fit", "focus it only", "table test alias", "table row 0 array", "table row 1 [object Object]"],
        nonRuns: [
          ["focus xit", "skipped"],
          ["focus xtest", "skipped"],
          ["focus todo", "todo"],
          ["skipped suite child", "skipped"],
          ["todo suite child", "todo"]
        ]
      }
    })
    await writeFile(path.join(fixture, "tests", "stage2.test.js"), [
      'import {createMockScope, describe, expect, it, mock} from "@velocious/testing"',
      'if (typeof mock.fn !== "function") throw new Error("default mock scope is missing")',
      'describe("stage2 doubles", () => {',
      '  it("records calls for matchers", () => {',
      '    const fn = createMockScope().fn().mockReturnValueOnce("first").mockReturnValue("later")',
      '    if (fn() !== "first" || fn() !== "later") throw new Error("mock behavior failed")',
      '    expect(fn).toHaveBeenCalledTimes(2)',
      '    expect(fn).toHaveBeenNthCalledWith(1)',
      '  })',
      '  it("restores exact properties", () => {',
      '    const scope = createMockScope()',
      '    const target = {method(value) { return value + 1 }}',
      '    const descriptor = Object.getOwnPropertyDescriptor(target, "method")',
      '    scope.spyOn(target, "method")',
      '    expect(target.method(2)).toBe(3)',
      '    scope.restoreAll()',
      '    expect(Object.getOwnPropertyDescriptor(target, "method")).toEqual(descriptor)',
      '  })',
      '})'
    ].join("\n"))
    const stageTwo = await exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["tests/stage2.test.js"], {cwd: fixture})
    assert.match(stageTwo.stdout, new RegExp(`^✓ stage2 doubles records calls for matchers ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(stageTwo.stdout, new RegExp(`^✓ stage2 doubles restores exact properties ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(stageTwo.stdout, /2 passed, 0 failed, 2 total/)
    await writeFile(path.join(fixture, "tests", "stage3.test.js"), [
      'import {any, createMockScope, describe, expect, it, objectContaining, stringMatching} from "@velocious/testing"',
      'expect.extend({',
      '  toHaveId(received, id) {',
      '    return {pass: this.equals(received, objectContaining({id})), message: `Expected ${this.format(received)} to have id ${id}`}',
      '  }',
      '})',
      'describe("stage3 matchers", () => {',
      '  it("awaits promise chains", () => expect(Promise.resolve({id: 7})).resolves.toHaveId(7))',
      '  it("composes asymmetric mock arguments", async () => {',
      '    const send = createMockScope().fn()',
      '    send({id: 7, name: "Ada"})',
      '    expect(send).toHaveBeenCalledWith(objectContaining({id: any(Number), name: stringMatching(/^Ada$/u)}))',
      '    await expect(Promise.reject(new TypeError("failure"))).rejects.toThrow(TypeError)',
      '  })',
      '})'
    ].join("\n"))
    const stageThree = await exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["tests/stage3.test.js"], {cwd: fixture})
    assert.match(stageThree.stdout, new RegExp(`^✓ stage3 matchers awaits promise chains ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(stageThree.stdout, new RegExp(`^✓ stage3 matchers composes asymmetric mock arguments ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(stageThree.stdout, /2 passed, 0 failed, 2 total/)
    await writeFile(path.join(fixture, "tests", "stage4.test.js"), [
      'import {createFakeTimers, describe, expect, it} from "@velocious/testing"',
      'describe("stage4 fake timers", () => {',
      '  it("advances installed timers", () => {',
      '    const timers = createFakeTimers({now: 1000})',
      '    timers.install()',
      '    try {',
      '      let observed',
      '      setTimeout(() => { observed = Date.now() }, 25)',
      '      timers.advanceBy(25)',
      '      expect(observed).toBe(1025)',
      '    } finally { timers.restore() }',
      '  })',
      '})'
    ].join("\n"))
    const stageFour = await exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["tests/stage4.test.js"], {cwd: fixture})
    assert.match(stageFour.stdout, new RegExp(`^✓ stage4 fake timers advances installed timers ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(stageFour.stdout, /1 passed, 0 failed, 1 total/)
    const diffProbe = await exec("node", ["--input-type=module", "--eval", [
      'import {expect} from "@velocious/testing";',
      'try { expect({z: 2, a: 1}).toEqual({a: 2}) } catch (error) { console.log(JSON.stringify(error.message)) }'
    ].join("\n")], {cwd: fixture})
    assert.equal(JSON.parse(diffProbe.stdout), [
      '{"z":2,"a":1} wasn\'t equal to {"a":2}',
      "Diff:",
      "  $.a: expected 2, received 1",
      "  $.z: expected <missing>, received 2"
    ].join("\n"))
    await assert.rejects(
      exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["--example", "missing"], {cwd: fixture}),
      (error) => error.code === 1 && /No tests matched/.test(error.stderr)
    )
    await exec("node", ["--input-type=module", "--eval", [
      'import "@velocious/testing";',
      'import "@velocious/testing/runner";',
      'import "@velocious/testing/node";',
      'import {createRequire} from "node:module";',
      'const require = createRequire(import.meta.url);',
      'try { require.resolve("velocious"); process.exitCode = 2 } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error }'
    ].join("\n")], {cwd: fixture})
    const tree = JSON.parse((await exec("npm", ["ls", "--all", "--json"], {cwd: fixture})).stdout)
    assert.equal(hasVelociousDependency(tree), false)
  } finally {
    await rm(fixture, {recursive: true, force: true})
    await rm(cacheDirectory, {recursive: true, force: true})
  }
})
