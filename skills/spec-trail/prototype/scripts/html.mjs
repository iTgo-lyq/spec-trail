// A quick export check, not a security boundary. CSP and the browser check enforce runtime isolation.
export function htmlIssues(html) {
  const issues = [];
  if (!/<!doctype\s+html\b|<html\b/i.test(html)) issues.push("缺少 HTML 文档声明");
  const markup = html.replace(/<!--[\s\S]*?-->/g, "");
  const tags = markup.replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, "$1</script>").match(/<[a-z][^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (/^<(?:base|iframe|object|embed|link)\b/i.test(tag)) issues.push("不支持外部样式、base 或嵌入文档；请离线内联");
    for (const m of tag.matchAll(/\b(src|srcset|href|poster|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const v = (m[2] ?? m[3] ?? m[4]).trim();
      if (/^<script\b/i.test(tag) || !(v.startsWith("#") || /^data:/i.test(v))) issues.push(`资源 ${m[1]} 必须内联或为 data URL`);
    }
    if (/http-equiv\s*=\s*["']?refresh\b/i.test(tag)) issues.push("不支持自动跳转文档");
  }
  for (const style of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    if (/@import\b/i.test(style[1])) issues.push("CSS @import 必须内联");
    for (const url of style[1].matchAll(/url\(\s*["']?([^\s)'";]+)/gi)) if (!/^(data:|#)/i.test(url[1])) issues.push("CSS 资源必须使用 data URL");
  }
  return [...new Set(issues)];
}
export const sandboxCsp = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
