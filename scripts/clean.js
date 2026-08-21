#!/usr/bin/env node

import fs from "node:fs/promises"

await fs.rm(new URL("../build", import.meta.url), {force: true, recursive: true})
