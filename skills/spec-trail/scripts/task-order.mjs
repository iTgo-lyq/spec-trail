// Shared task scheduling contract. Node.js built-ins only.

/** @param {Record<string, string[]>} edges */
export function cyclicNodes(edges) {
  const index = new Map(),
    low = new Map(),
    stack = [],
    active = new Set();
  /** @type {Set<string>} */
  const cycles = new Set();
  const adjacent = (id) => (Object.hasOwn(edges, id) ? edges[id] : []);
  let next = 0;
  function visit(id) {
    index.set(id, next);
    low.set(id, next++);
    stack.push(id);
    active.add(id);
    for (const target of adjacent(id)) {
      if (!index.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id), low.get(target)));
      } else if (active.has(target))
        low.set(id, Math.min(low.get(id), index.get(target)));
    }
    if (low.get(id) !== index.get(id)) return;
    const component = [];
    let node;
    do {
      node = stack.pop();
      active.delete(node);
      component.push(node);
    } while (node !== id);
    if (component.length > 1 || adjacent(id).includes(id))
      component.forEach((n) => cycles.add(n));
  }
  Object.keys(edges).forEach((id) => {
    if (!index.has(id)) visit(id);
  });
  return cycles;
}

const taskNumber = /^T[1-9][0-9]*$/;
const numericOrder = (a, b) => a.length - b.length || a.localeCompare(b);
const htmlBlock =
  /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?=[ \t/>]|$)/i;
const standaloneTag =
  /^ {0,3}<\/?[a-z][a-z0-9-]*(?:[ \t]+[a-z_:][a-z0-9_:.-]*(?:[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|[^ \t"'=<>`]+))?)*[ \t]*\/?>[ \t]*$/i;
const referenceId = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
function inlineText(text, references) {
  const code = [];
  return text
    .replace(/(`+)([^`]*?)\1/g, (_, marker, value) => {
      code.push(value);
      return `\u0000${code.length - 1}\u0000`;
    })
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (match, label, ref) =>
      references.has(referenceId(ref || label)) ? label : match,
    )
    .replace(/\[([^\]]+)\]/g, (match, label) =>
      references.has(referenceId(label)) ? label : match,
    )
    .replace(/(\*\*|__|~~|\*|_)(.*?)\1/g, "$2")
    .replace(/\\([\\`*{}\[\]()#+\-.!_|>])/g, "$1")
    .replace(/\u0000(\d+)\u0000/g, (_, index) => code[index])
    .trim();
}

function cells(line) {
  const source = line.trim(),
    result = [];
  let value = "";
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\\" && i + 1 < source.length)
      value += source[i] + source[++i];
    else if (source[i] === "|") {
      result.push(value.trim());
      value = "";
    } else value += source[i];
  }
  result.push(value.trim());
  if (source.startsWith("|")) result.shift();
  if (result.at(-1) === "" && source.endsWith("|")) result.pop();
  return result;
}

function indentation(line) {
  let width = 0;
  for (const character of line) {
    if (character === " ") width++;
    else if (character === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

// Read only document-level headings and pipe tables; examples in code, quotes,
// lists and HTML blocks do not declare scheduling constraints.
function declarations(body) {
  const lines = body.split(/\r?\n/),
    visible = [];
  let fence,
    comment = false,
    html,
    list,
    paragraph = false;
  for (const line of lines) {
    let text = line;
    if (fence) {
      if (
        new RegExp(`^ {0,3}${fence.marker}{${fence.length},}[ \\t]*$`).test(
          line,
        )
      )
        fence = undefined;
      text = "";
    } else if (comment) {
      if (line.includes("-->")) comment = false;
      text = "";
    } else if (html) {
      if (html === "block" ? !line.trim() : html.test(line)) html = undefined;
      text = "";
    } else if (/^ {0,3}>|^(?: {4}|\t)/.test(line)) text = "";
    else if (/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/.test(line)) {
      const marker = /^ {0,3}(?:[-+*]|\d+[.)])/.exec(line)[0];
      const padding = indentation(line.slice(marker.length));
      list = marker.length + (padding > 4 ? 1 : padding);
      text = "";
    } else if (list && line.trim() && indentation(line) >= list) text = "";
    else {
      if (line.trim()) list = undefined;
      const opened = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (opened && (opened[1][0] !== "`" || !opened[2].includes("`"))) {
        fence = { marker: opened[1][0], length: opened[1].length };
        text = "";
      } else if (/^ {0,3}<!--/.test(line)) {
        comment = !line.includes("-->");
        text = "";
      } else if (/^ {0,3}(?:<\?|<!\[CDATA\[|<![A-Z])/.test(line)) {
        const end = line.trimStart().startsWith("<?")
          ? /\?>/
          : line.trimStart().startsWith("<![CDATA[")
            ? /\]\]>/
            : />/;
        if (!end.test(line)) html = end;
        text = "";
      } else {
        const raw = /^ {0,3}<(script|pre|style|textarea)(?=[ \t>]|$)/i
          .exec(line)?.[1]
          ?.toLowerCase();
        if (raw) {
          const end = new RegExp(`</${raw}\\s*>`, "i");
          if (!end.test(line)) html = end;
          text = "";
        } else if (
          htmlBlock.test(line) ||
          (!paragraph && standaloneTag.test(line))
        ) {
          html = "block";
          text = "";
        }
      }
    }
    visible.push(text);
    paragraph =
      Boolean(text.trim()) &&
      !/^ {0,3}(?:#{1,6}(?:[ \t]|$)|(?:=+|-+)[ \t]*$)/.test(text);
  }
  const references = new Set();
  for (const line of visible) {
    const definition = /^ {0,3}\[([^\]]+)\]:[ \t]*\S/.exec(line);
    if (definition) references.add(referenceId(definition[1]));
  }
  const plain = (text) => inlineText(text, references);
  const sections = [],
    tables = [];
  let section;
  for (let i = 0; i < visible.length; i++) {
    const line = visible[i];
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/.exec(line);
    const setext =
      !line.includes("|") &&
      line.trim() &&
      /^ {0,3}(=+|-+)[ \t]*$/.exec(visible[i + 1] ?? "");
    if (atx || setext) {
      const depth = atx ? atx[1].length : setext[1][0] === "=" ? 1 : 2;
      const title = plain(
        atx ? (atx[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "") : line,
      );
      if (section && depth <= section.depth) section = undefined;
      if (title === "执行顺序") {
        section = { depth, line: i + 1 };
        sections.push(section);
      }
      if (setext) i++;
      continue;
    }
    if (!line.includes("|")) continue;
    const headers = cells(line).map(plain);
    const delimiter = cells(visible[i + 1] ?? "");
    const isTable =
      delimiter.length > 0 && delimiter.every((cell) => /^:?-+:?$/.test(cell));
    const isOrder = headers.includes("任务") && headers.includes("前置任务");
    const attempted =
      isOrder ||
      (section &&
        (isTable || headers.includes("任务") || headers.includes("前置任务")));
    if (!attempted) continue;
    const table = {
      headers,
      rows: [],
      line: i + 1,
      section,
      wellFormed: isTable && headers.length === delimiter.length,
    };
    if (isTable) {
      i++;
      while (
        visible[i + 1]?.includes("|") &&
        visible[i + 1].trim() &&
        !/^ {0,3}#{1,6}(?:[ \t]|$)/.test(visible[i + 1])
      ) {
        i++;
        table.rows.push({
          values: cells(visible[i]).map(plain),
          line: i + 1,
        });
      }
    }
    tables.push(table);
  }
  return { sections, tables };
}

/**
 * @param {{size: string, tasks: Record<string, {status: string}>}} state
 * @param {string | undefined} body
 * @param {string | undefined} [documentId]
 * @returns {{status: "valid" | "missing" | "invalid" | "not-applicable", source?: "default" | "plan", edges: Record<string, string[]>, diagnostics: Array<{code: string, message: string, line?: number, severity: "warning"}>, documentId?: string, line?: number}}
 */
export function parseTaskOrder(state, body, documentId) {
  const graph = { status: "valid", edges: {}, diagnostics: [], documentId };
  if (state.size === "xlarge") {
    graph.status = "not-applicable";
    return graph;
  }
  if (["medium", "large"].includes(state.size) && body === undefined) {
    graph.status = "missing";
    return graph;
  }
  const { sections, tables } = declarations(body ?? "");
  const taskIds = Object.keys(state.tasks).sort(numericOrder);
  if (!tables.length) {
    graph.source = "default";
    taskIds.forEach((id, i) => {
      graph.edges[id] = i ? [taskIds[i - 1]] : [];
    });
    return graph;
  }
  graph.source = "plan";
  const problem = (message, line) =>
    graph.diagnostics.push({
      code: "PLAN_DEPENDENCIES",
      message,
      ...(line ? { line } : {}),
      severity: "warning",
    });
  if (
    sections.length !== 1 ||
    tables.length !== 1 ||
    tables[0].section !== sections[0]
  )
    problem("显式执行顺序需要唯一的“执行顺序”章节和任务表。", tables[0].line);
  else {
    const table = tables[0];
    graph.line = table.line;
    const heads = table.headers,
      taskAt = heads.indexOf("任务"),
      prevAt = heads.indexOf("前置任务");
    if (
      !table.wellFormed ||
      heads.filter((head) => head === "任务").length !== 1 ||
      heads.filter((head) => head === "前置任务").length !== 1
    )
      problem(
        "执行顺序须为包含唯一“任务 / 前置任务”列的有效表格。",
        table.line,
      );
    for (const row of table.rows) {
      const id = row.values[taskAt],
        prev = row.values[prevAt];
      if (!taskNumber.test(id ?? "") || !Object.hasOwn(state.tasks, id)) {
        problem(`任务 ${id || "（空）"} 不在 change.json 中。`, row.line);
        continue;
      }
      if (Object.hasOwn(graph.edges, id)) {
        problem(`${id} 出现多行。`, row.line);
        continue;
      }
      const deps =
        prev === "无" ? [] : (prev ?? "").split(/[、,，\s]+/).filter(Boolean);
      if (
        !prev ||
        (prev !== "无" && !deps.length) ||
        deps.some(
          (id) => !taskNumber.test(id) || !Object.hasOwn(state.tasks, id),
        )
      )
        problem(`${id} 的前置任务为空或引用了非法编号。`, row.line);
      if (new Set(deps).size !== deps.length || deps.includes(id))
        problem(`${id} 存在重复或自身依赖。`, row.line);
      graph.edges[id] = deps;
    }
    for (const id of taskIds)
      if (!Object.hasOwn(graph.edges, id))
        problem(`${id} 没有执行顺序记录。`, table.line);
    if (cyclicNodes(graph.edges).size)
      problem("任务前置关系存在循环。", table.line);
  }
  if (graph.diagnostics.length) graph.status = "invalid";
  return graph;
}

/**
 * @param {Record<string, {status: string}>} tasks
 * @param {Record<string, string[]>} edges
 * @param {string} id
 */
export function unfinishedPredecessors(tasks, edges, id) {
  const ancestors = new Set(),
    pending = [...(edges[id] ?? [])];
  while (pending.length) {
    const parent = pending.pop();
    if (ancestors.has(parent)) continue;
    ancestors.add(parent);
    pending.push(...(edges[parent] ?? []));
  }
  return [...ancestors]
    .filter((parent) => tasks[parent]?.status !== "done")
    .sort(numericOrder);
}
