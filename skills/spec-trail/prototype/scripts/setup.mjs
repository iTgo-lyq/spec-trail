#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  lstat,
  realpath,
  readdir,
} from "node:fs/promises";
import { join, dirname, resolve, relative, matchesGlob } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { validateWorkflow } from "../../scripts/state-schema.mjs";
import { withLock, checkedPath } from "./publishing.mjs";
import { discoverUpload } from "./openfolio-client.mjs";
import {
  packagePath,
  validatePrototype,
  validateManifest,
} from "./contract.mjs";
import { htmlIssues } from "./html.mjs";
const args = process.argv.slice(2),
  options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (
    ![
      "--repo",
      "--package",
      "--design",
      "--accept",
      "--decline",
      "--enable",
      "--configure",
      "--hosting",
      "--openfolio-url",
      "--upload-url",
      "--fetch-upload-url",
    ].includes(key)
  )
    throw Error(`Unknown option ${key}`);
  options[key] = ["--accept", "--decline", "--enable", "--configure", "--fetch-upload-url"].includes(key)
    ? true
    : args[++i];
}
const json = async (p) => JSON.parse(await readFile(p, "utf8"));
const exists = async (p) => {
  try {
    return await lstat(p);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};
try {
  if (
    [options["--accept"], options["--decline"], options["--enable"], options["--configure"]].filter(
      Boolean,
    ).length !== 1
  )
    throw Error("Choose --accept, --decline, --enable or --configure.");
  const cwd = resolve(options["--repo"] || ".");
  const root = execFileSync(
    "git",
    ["-C", cwd, "rev-parse", "--show-toplevel"],
    { encoding: "utf8" },
  ).trim();
  const configPath = checkedPath(root, "docs/project/workflow.json");
  let original = readFileSync(configPath, "utf8");
  const config = JSON.parse(original);
  if (options["--openfolio-url"] !== undefined)
    config.openfolioUrl = options["--openfolio-url"] === "none" ? null : options["--openfolio-url"];
  if (options["--fetch-upload-url"]) {
    if (options["--hosting"] !== "openfolio" || options["--upload-url"])
      throw Error("Use --fetch-upload-url with --hosting openfolio instead of --upload-url.");
    options["--upload-url"] = await discoverUpload(config.openfolioUrl);
  }
  const hosting = options["--hosting"]
    ? { provider: options["--hosting"], ...(options["--upload-url"] ? { uploadUrl: options["--upload-url"] } : {}) }
    : config.prototype?.hosting;
  if (options["--upload-url"] && !options["--hosting"])
    throw Error("Provide --hosting with --upload-url.");
  const persist = async (value) => {
    const next = { ...config, prototype: { ...value, ...(hosting ? { hosting } : {}) } };
    const issues = validateWorkflow(next);
    if (issues.length) throw Error(issues.join("; "));
    withLock(root, () => {
      if (readFileSync(configPath, "utf8") !== original) throw Error("Workflow changed; reload before configuring.");
      const tmp = `${configPath}.${randomUUID()}.tmp`;
      const body = JSON.stringify(next, null, 2) + "\n";
      try {
        writeFileSync(tmp, body, { flag: "wx", mode: 0o600 });
        renameSync(tmp, configPath);
        original = body;
        Object.assign(config, next);
      } finally { try { unlinkSync(tmp); } catch (e) { if (e.code !== "ENOENT") throw e; } }
    });
  };
  if (options["--configure"]) {
    await persist(config.prototype ?? { status: "pending", packagePath: options["--package"] || "packages/prototype" });
    console.log("Prototype hosting selection saved. Commit workflow.json to share it.");
  } else if (options["--decline"]) {
    await persist({ status: "disabled" });
    console.log("Prototype tracking disabled; existing files preserved.");
  } else {
    const location =
      options["--package"] ||
      config.prototype?.packagePath ||
      "packages/prototype";
    if (!packagePath(location)) throw Error("Invalid package path");
    if (
      config.prototype?.packagePath &&
      config.prototype.packagePath !== location
    )
      throw Error(
        "One package per project: migrate the existing package explicitly before changing its path.",
      );
    let cursor = root;
    for (const segment of location.split("/")) {
      cursor = join(cursor, segment);
      const st = await exists(cursor);
      if (st && (!st.isDirectory() || st.isSymbolicLink()))
        throw Error("Package ancestors must be regular directories");
    }
    const pkg = join(root, location);
    let design = options["--design"];
    if (design) {
      const actual = await realpath(resolve(root, design));
      if (
        relative(root, actual).startsWith("..") ||
        !(await lstat(actual)).isFile()
      )
        throw Error("Design source must be a regular repository file");
      design = relative(root, actual);
    }
    if (options["--accept"]) {
      // A fully configured package may be checked again without overwriting its contents.
      await persist({ status: "pending", packagePath: location });
      const existing = await exists(pkg);
      const contents = existing ? await readdir(pkg) : [];
      if (!contents.length) {
        await mkdir(pkg, { recursive: true });
        const scaffold = fileURLToPath(
          new URL("../assets/package", import.meta.url),
        );
        for (const name of await readdir(scaffold))
          await cp(join(scaffold, name), join(pkg, name), {
            recursive: true,
            force: false,
            errorOnExist: true,
          });
        await writeFile(
          join(pkg, "package.json"),
          JSON.stringify(
            {
              name: "prototype",
              private: true,
              type: "module",
              scripts: { build: `node build.mjs${hosting && hosting.provider !== "git" ? " --hosted" : ""}` },
            },
            null,
            2,
          ) + "\n",
          { flag: "wx" },
        );
        await writeFile(
          join(pkg, ".gitignore"),
          "node_modules/\ndist/\n.cache/\n*.log\n*.map\n",
          { flag: "wx" },
        );
        execFileSync(process.execPath, [join(pkg, "build.mjs"), ...(hosting && hosting.provider !== "git" ? ["--hosted"] : [])], {
          cwd: pkg,
          stdio: "inherit",
        });
        if (hosting && hosting.provider !== "git")
          await writeFile(join(pkg, "prototype.json"), JSON.stringify({ schemaVersion: 1, entries: [{ id: "welcome", title: "Welcome", sourcePath: `${location}/src/pages/welcome.html`, kind: "page", devices: ["pc-web"] }] }, null, 2) + "\n", { flag: "wx" });
      } else if (!(await exists(join(pkg, "package.json")))?.isFile())
        throw Error(
          "Existing directory preserved; provide package.json and self-contained preview output before --enable.",
        );
      for (const [file, body] of [
        [
          "AGENTS.md",
          "# Prototype package\n\nFollow the project AGENTS.md and DESIGN.md. Reuse shared components and tokens. Keep mock data local. The host builds and publishes static previews. Maintain current entries in prototype.json and immutable references in change.json.previews. Git preview/<id>/index.html is an explicit self-contained fallback. Reuse one package; prototypes remain optional.\n",
        ],
        [
          "DESIGN.md",
          design
            ? `# Design source\n\nFollow [the project design standard](${relative(pkg, join(root, design)).split("\\").join("/")}). Record only prototype-specific exceptions here; keep the source authoritative.\n`
            : await readFile(new URL("../assets/DESIGN.template.md", import.meta.url), "utf8"),
        ],
      ])
        if (!(await exists(join(pkg, file))))
          await writeFile(join(pkg, file), body, { flag: "wx" });
    }
    if (
      config.prototype?.status !== "pending" &&
      config.prototype?.status !== "enabled"
    )
      throw Error(
        "Initialize the prototype package with --accept before --enable.",
      );
    if (validatePrototype(config.prototype).length)
      throw Error("Invalid prototype configuration");
    if (options["--enable"] && config.prototype.status === "enabled")
      await persist({ status: "pending", packagePath: location });
    const packageJson = await json(join(pkg, "package.json"));
    if (!packageJson.name || packageJson.private !== true)
      throw Error("Prototype package requires a name and private:true");
    for (const file of ["AGENTS.md", "DESIGN.md"])
      if (!(await exists(join(pkg, file)))?.isFile())
        throw Error(`Missing ${file}`);
    const previews = (await exists(join(pkg, "preview")))
      ? await readdir(join(pkg, "preview"))
      : [];
    let count = 0;
    for (const name of previews) {
      const entry = join(pkg, "preview", name, "index.html");
      const st = await exists(entry);
      if (!st) continue;
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        relative(pkg, await realpath(entry)).startsWith("..")
      )
        throw Error("Preview entries must be regular files inside the package");
      const issues = htmlIssues(await readFile(entry, "utf8"));
      if (issues.length) throw Error(`${name}: ${issues.join("; ")}`);
      count++;
    }
    const manifestPath = join(pkg, "prototype.json");
    if (await exists(manifestPath)) {
      if ((await lstat(manifestPath)).isSymbolicLink())
        throw Error("Manifest must be a regular file");
      const issues = validateManifest(await json(manifestPath));
      if (issues.length) throw Error(issues.join("; "));
    } else if (count)
      await writeFile(
        manifestPath,
        JSON.stringify({ schemaVersion: 1, entries: [] }, null, 2) + "\n",
        { flag: "wx" },
      );
    else
      throw Error(
        "Provide prototype.json and host build/publish instructions, or self-contained Git previews, then run --enable.",
      );
    const rootPackage = join(root, "package.json");
    if (await exists(join(root, "pnpm-workspace.yaml"))) {
      const yaml = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
      // Read only the top-level packages list; preserve the rest of the YAML verbatim.
      const block =
        /^packages:[ \t]*(?:#.*)?\r?\n((?:(?:[ \t]+[^\r\n]*|[ \t]*)(?:\r?\n|$))*)/m.exec(
          yaml,
        )?.[1];
      if (!block)
        throw Error(
          "Existing pnpm workspace preserved: use a multiline packages glob list, then retry --enable.",
        );
      const patterns = [];
      for (const line of block.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith("#")) continue;
        const match =
          /^\s*-\s*(?:"([^"\\]*)"|'([^']*)'|([^\s#'"\[\]{},]+))\s*(?:#.*)?$/.exec(
            line,
          );
        if (!match)
          throw Error(
            "Existing pnpm packages list uses unsupported YAML; preserve it and normalize only that list before --enable.",
          );
        patterns.push(match[1] ?? match[2] ?? match[3]);
      }
      const included = patterns.some(
        (pattern) => !pattern.startsWith("!") && matchesGlob(location, pattern),
      );
      const excluded = patterns.some(
        (pattern) =>
          pattern.startsWith("!") && matchesGlob(location, pattern.slice(1)),
      );
      if (!included || excluded)
        throw Error(
          "Existing pnpm workspace preserved: include this package and remove any matching exclusion, then retry --enable.",
        );
    } else if (await exists(rootPackage)) {
      const value = await json(rootPackage);
      const entries = Array.isArray(value.workspaces)
        ? value.workspaces
        : value.workspaces?.packages;
      if (value.workspaces && !Array.isArray(entries))
        throw Error(
          "Unsupported workspace configuration preserved; integrate the package manually.",
        );
      if (!value.workspaces) value.workspaces = [];
      const target = Array.isArray(value.workspaces)
        ? value.workspaces
        : value.workspaces.packages;
      if (!target.includes(location)) target.push(location);
      await writeFile(rootPackage, JSON.stringify(value, null, 2) + "\n");
    }
    await persist({ status: "enabled", packagePath: location });
    console.log(
      `Prototype enabled: ${location}; ${count} static entry(s). Commit configuration, sources and outputs; publish the configuration baseline before viewing in OpenFolio.`,
    );
  }
} catch (e) {
  console.error(`Prototype setup: ${e.message}`);
  process.exitCode = 1;
}
