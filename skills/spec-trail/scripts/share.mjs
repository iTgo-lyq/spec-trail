import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { repository } from "./repository.mjs";

const safeUrl = (value) => {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error("地址须为无凭据的 HTTPS 或本机 HTTP。");
  return url;
};

function repositoryUrl(origin) {
  const ssh = /^(?:git@|ssh:\/\/git@)(github\.com)[:/]([^?#]+)$/.exec(origin);
  const url = safeUrl(ssh ? "https://" + ssh[1] + "/" + ssh[2] : origin);
  const path = url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "");
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.search ||
    url.hash ||
    !/^\/[\w.-]+\/[\w.-]+$/.test(path)
  )
    throw new Error("origin 不是受支持的 GitHub 仓库地址。");
  return "https://github.com" + path;
}

/**
 * Build a share link from local configuration without contacting the service.
 * @param {{ repo?: string, change?: string, document?: string, preview?: string }} options
 */
export async function getShareLink({
  repo: cwd = ".",
  change,
  document,
  preview,
} = {}) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(change ?? "") ||
    change.length > 200 ||
    (document && preview)
  )
    throw new Error(
      "指定一个合法 --change，并最多选择 --document 或 --preview 之一。",
    );
  if (
    document &&
    (document.startsWith("/") ||
      document.includes("\\") ||
      document.split("/").some((s) => !s || s === "." || s === ".."))
  )
    throw new Error("文档须为 Change 内的相对路径。");
  const repo = repository(cwd);
  if (!repo.config.openfolioUrl)
    throw new Error("尚未配置 workflow.openfolioUrl；请提供仓库材料链接。");
  const base = safeUrl(repo.config.openfolioUrl);
  if (base.search || base.hash || base.pathname !== "/")
    throw new Error("openfolioUrl 须为服务根地址，不含 query 或 hash。");
  const remote = repositoryUrl(repo.git(["remote", "get-url", "origin"]));
  const link = new URL("/share", base);
  link.search = new URLSearchParams({
    repository: remote,
    change,
    integrationBranch: repo.config.integrationBranch,
    ct: document ? "documents" : preview ? "previews" : "overview",
    ...(document ? { document } : {}),
    ...(preview ? { preview } : {}),
  }).toString();
  return { url: link.href };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { values } = parseArgs({
      options: Object.fromEntries(
        ["repo", "change", "document", "preview"].map((k) => [
          k,
          { type: "string" },
        ]),
      ),
    });
    const result = await getShareLink(values);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}
