import { parseArgs, isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { repository, recordsAt } from "./repository.mjs";

const fail = (message, retryable = false) =>
  Object.assign(new Error(message), { retryable });
const unsynced = () =>
  fail("本次材料尚未同步到分享服务；请先提交推送，再稍后重试。", true);
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
    throw fail("地址须为无凭据的 HTTPS 或本机 HTTP。");
  return url;
};

function repositoryUrl(origin) {
  const ssh = /^(?:git@|ssh:\/\/git@)(github\.com)[:/]([^?#]+)$/.exec(origin);
  const url = safeUrl(ssh ? `https://${ssh[1]}/${ssh[2]}` : origin);
  const path = url.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "");
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.search ||
    url.hash ||
    !/^\/[\w.-]+\/[\w.-]+$/.test(path)
  )
    throw fail("origin 不是受支持的 GitHub 仓库地址。");
  return `https://github.com${path}`;
}

async function read(url, { timeoutMs, json = true } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.body) throw fail("服务返回空响应，材料尚不可读。");
    const reader = response.body.getReader(),
      chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > (response.ok ? 8 * 1024 * 1024 : 64 * 1024))
          throw fail("分享响应超过大小限制（成功响应最多 8 MiB）。");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const body = Buffer.concat(chunks).toString("utf8");
    if (!response.ok) {
      let code;
      try {
        code = JSON.parse(body).error?.code;
      } catch {}
      throw fail(
        `匿名读取失败（HTTP ${response.status}）；请检查目标和服务读取权限。`,
        response.status === 409 ||
          (response.status === 404 && code === "SHARE_SOURCE_UNAVAILABLE"),
      );
    }
    if (!json) {
      if (
        response.status !== 200 ||
        !response.headers.get("content-type")?.includes("text/html") ||
        !body.trim() ||
        !/<(?:!doctype|html|head|body|div|main|h1)\b/i.test(body)
      )
        throw fail("原型未返回可展示的 HTML 材料。");
      if (
        /(?:passport|sso|login)\.(?:bytedance\.(?:net|com)|feishu\.cn|larksuite\.com)/i.test(
          body,
        )
      )
        throw fail("原型被平台登录页拦截，不能匿名查看。");
      return body;
    }
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw fail("服务未返回 JSON；请检查是否被平台登录页拦截。");
    return JSON.parse(body);
  } catch (error) {
    if (Object.hasOwn(error, "retryable")) throw error;
    throw fail("匿名读取未完成；请检查网络、超时或登录重定向。");
  } finally {
    if (response?.body && !response.body.locked)
      await response.body.cancel().catch(() => {});
  }
}

/**
 * Returns only an anonymously verified link, using committed local material.
 * @param {{ repo?: string, change?: string, document?: string, preview?: string, waitSeconds?: number, timeoutMs?: number }} options
 */
export async function getShareLink({
  repo: cwd = ".",
  change,
  document,
  preview,
  waitSeconds = 70,
  timeoutMs = 20_000,
} = {}) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(change ?? "") ||
    change.length > 200 ||
    (document && preview)
  )
    throw fail(
      "指定一个合法 --change，并最多选择 --document 或 --preview 之一。",
    );
  if (
    !Number.isFinite(waitSeconds) ||
    waitSeconds < 0 ||
    waitSeconds > 120 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000
  )
    throw fail("等待时间须为 0–120 秒，请求超时须为 1–60000 毫秒。");
  if (
    document &&
    (document.startsWith("/") ||
      document.includes("\\") ||
      document.split("/").some((s) => !s || s === "." || s === ".."))
  )
    throw fail("文档须为 Change 内的相对路径。");
  const repo = repository(cwd);
  if (!repo.config.openfolioUrl)
    throw fail("尚未配置 workflow.openfolioUrl；无需配置分享账号。");
  const base = safeUrl(repo.config.openfolioUrl);
  if (base.search || base.hash || base.pathname !== "/")
    throw fail("openfolioUrl 须为服务根地址，不含 query 或 hash。");
  let remote;
  try {
    remote = repositoryUrl(repo.git(["remote", "get-url", "origin"]));
  } catch {
    throw fail("无法从 origin 读取无凭据的 GitHub 仓库地址。");
  }
  const records = recordsAt(repo, "HEAD", change);
  if (
    records.length !== 1 ||
    records[0].error ||
    records[0].state?.id !== change
  )
    throw fail("当前提交未包含唯一的目标 Change。");
  const local = records[0],
    directory = local.path.slice(0, -"/change.json".length);
  const material = document ?? "change.json";
  let blob;
  try {
    blob = repo.git(["rev-parse", `HEAD:${directory}/${material}`]);
    if (repo.git(["cat-file", "-t", blob]) !== "blob") throw Error();
    if (
      repo.git([
        "status",
        "--porcelain",
        "--",
        `${repo.root}/${directory}/${material}`,
      ])
    )
      throw fail("目标材料有未提交修改；请提交推送后再生成链接。");
  } catch (e) {
    if (Object.hasOwn(e, "retryable")) throw e;
    throw fail("目标材料尚未提交或路径不存在。");
  }
  const localPreview = preview
    ? local.state.previews?.find((p) => p.id === preview)
    : undefined;
  if (preview && !localPreview?.artifact)
    throw fail("当前提交尚未登记目标原型产物。");
  let previewBlob;
  if (localPreview?.artifact.type === "git") {
    const path = `${localPreview.artifact.path}/index.html`;
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((s) => !s || s === "." || s === "..")
    )
      throw fail("Git 原型路径不合法。");
    try {
      previewBlob = repo.git(["rev-parse", `HEAD:${path}`]);
      if (repo.git(["cat-file", "-t", previewBlob]) !== "blob") throw Error();
      if (repo.git(["status", "--porcelain", "--", `${repo.root}/${path}`]))
        throw fail("Git 原型 HTML 有未提交修改。");
    } catch (error) {
      if (Object.hasOwn(error, "retryable")) throw error;
      throw fail("Git 原型 HTML 尚未提交或不存在。");
    }
  }
  const scope = new URLSearchParams({
    repository: remote,
    change,
    integrationBranch: repo.config.integrationBranch,
  });
  const endpoint = (path, snapshot) => {
    const url = new URL(`/api/shared-changes/${path}`, base);
    url.search = scope.toString();
    if (snapshot) url.searchParams.set("snapshot", snapshot);
    return url;
  };
  const link = new URL("/share", base);
  link.search = scope.toString();
  link.searchParams.set("ct", "overview");
  if (document) {
    link.searchParams.set("ct", "documents");
    link.searchParams.set("document", document);
  }
  if (preview) {
    link.searchParams.set("ct", "previews");
    link.searchParams.set("preview", preview);
  }
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    try {
      const value = await read(endpoint("change"), { timeoutMs });
      const primary = value.change?.candidates?.find(
        (c) => c.key === value.change.primary,
      );
      if (
        value.change?.id !== change ||
        value.projectName?.toLowerCase() !==
          remote.slice("https://github.com/".length).toLowerCase() ||
        !primary ||
        !/^[a-f0-9]{40,64}$/.test(primary.commit) ||
        !primary.branch ||
        !value.snapshotId ||
        !Array.isArray(value.documents)
      )
        throw fail("服务返回的 Change 来源与目标不一致。");
      if (preview) {
        const descriptor = await read(endpoint("previews", value.snapshotId), {
          timeoutMs,
        });
        const entry = descriptor.entries?.find((p) => p.id === preview);
        if (descriptor.changeId !== change)
          throw fail("原型来源与目标不一致。");
        if (
          !entry?.available ||
          !isDeepStrictEqual(entry.artifact, localPreview.artifact)
        )
          throw unsynced();
        if (previewBlob && entry.blob !== previewBlob) throw unsynced();
        const url = safeUrl(new URL(entry.url, base).href);
        if (
          entry.artifact.type === "git" &&
          (url.origin !== base.origin ||
            !url.pathname.startsWith("/api/shared-changes/"))
        )
          throw fail("Git 原型地址超出分享范围。");
        if (
          entry.artifact.type === "hosted" &&
          url.href !== safeUrl(entry.artifact.url).href
        )
          throw fail("托管原型地址与登记产物不一致。");
        await read(url, { timeoutMs, json: false });
      } else {
        const ref = value.documents.find(
          (d) =>
            d.branch === primary.branch &&
            d.commit === primary.commit &&
            d.path === `${primary.directory}/${material}`,
        );
        if (!ref || ref.blob !== blob) throw unsynced();
        if (!ref.readable || !["markdown", "json"].includes(ref.kind))
          throw fail("目标文档不能读取正文。");
        const body = await read(
          endpoint(`documents/${encodeURIComponent(ref.id)}`, value.snapshotId),
          { timeoutMs },
        );
        if (
          body.document?.id !== ref.id ||
          body.document?.commit !== primary.commit ||
          body.document?.blob !== blob ||
          typeof body.body !== "string"
        )
          throw fail("文档响应来源与目标不一致。");
      }
      return {
        url: link.href,
        repository: remote,
        change,
        branch: primary.branch,
        commit: primary.commit,
        ...(document ? { document } : {}),
        ...(preview ? { preview } : {}),
      };
    } catch (error) {
      if (!error.retryable || Date.now() >= deadline) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(10_000, deadline - Date.now())),
      );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { values } = parseArgs({
      options: Object.fromEntries(
        ["repo", "change", "document", "preview", "wait-seconds"].map((k) => [
          k,
          { type: "string" },
        ]),
      ),
    });
    const result = await getShareLink({
      ...values,
      waitSeconds:
        values["wait-seconds"] === undefined
          ? 70
          : Number(values["wait-seconds"]),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
