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
    ].includes(key)
  )
    throw Error(`Unknown option ${key}`);
  options[key] = ["--accept", "--decline", "--enable"].includes(key)
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
    [options["--accept"], options["--decline"], options["--enable"]].filter(
      Boolean,
    ).length !== 1
  )
    throw Error("Choose --accept, --decline or --enable.");
  const cwd = resolve(options["--repo"] || ".");
  const root = execFileSync(
    "git",
    ["-C", cwd, "rev-parse", "--show-toplevel"],
    { encoding: "utf8" },
  ).trim();
  const configPath = join(root, "docs/project/workflow.json");
  const config = await json(configPath);
  const persist = async (value) => {
    config.prototype = value;
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  };
  if (options["--decline"]) {
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
              scripts: { build: "node build.mjs" },
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
        execFileSync(process.execPath, [join(pkg, "build.mjs")], {
          cwd: pkg,
          stdio: "inherit",
        });
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
            : "# Design source\n\nReuse the project design tokens, typography, component library and accessibility conventions. Record the authoritative source here before adding a new visual direction. If no standard exists, establish one project-wide standard for this package.\n",
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
