#!/usr/bin/env node

import fs from "node:fs/promises"

await fs.chmod(new URL("../build/node/cli.js", import.meta.url), 0o755)
