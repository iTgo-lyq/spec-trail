const pointer = (path, key) =>
  `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
const report = (errors, path, message) =>
  errors.push(`${path || "/"}: ${message}`);
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function stringRule(pattern, description) {
  return (value, path, errors) => {
    if (typeof value !== "string") report(errors, path, "must be a string");
    else if (!pattern.test(value)) report(errors, path, description);
  };
}

const text = stringRule(/\S/, "must contain non-whitespace text");
const id = stringRule(
  /^[a-z0-9]+(-[a-z0-9]+)*$/,
  "must be a lowercase kebab-case id",
);
const branch = stringRule(
  /^[^\s~^:?*\[\\]+$/,
  "must be a non-empty branch name without forbidden characters",
);
const commit = stringRule(
  /^[0-9a-f]{7,64}$/,
  "must contain 7–64 lowercase hexadecimal characters",
);

function oneOf(...choices) {
  return (value, path, errors) => {
    if (!choices.includes(value))
      report(
        errors,
        path,
        `must be one of ${choices.map((choice) => JSON.stringify(choice)).join(", ")}`,
      );
  };
}

function object(fields, required = Object.keys(fields)) {
  return (value, path, errors) => {
    if (!isObject(value)) return report(errors, path, "must be an object");
    for (const key of required) {
      if (!Object.hasOwn(value, key))
        report(errors, pointer(path, key), "is required");
    }
    for (const [key, item] of Object.entries(value)) {
      const at = pointer(path, key);
      if (!Object.hasOwn(fields, key)) report(errors, at, "unknown field");
      else fields[key](item, at, errors);
    }
  };
}

function list(itemRule, nonEmpty = false) {
  return (value, path, errors) => {
    if (!Array.isArray(value)) return report(errors, path, "must be an array");
    if (nonEmpty && !value.length)
      report(errors, path, "must contain at least one item");
    if (new Set(value).size !== value.length)
      report(errors, path, "must not contain duplicate items");
    value.forEach((item, index) =>
      itemRule(item, pointer(path, index), errors),
    );
  };
}

function timestamp(value, path, errors) {
  const parts =
    typeof value === "string" &&
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (parts) {
    const [year, month, day, hour, minute, second] = parts
      .slice(1, 7)
      .map(Number);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [
      31,
      leapYear ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ];
    const zoneHour = Number(parts[9] || 0);
    const zoneMinute = Number(parts[10] || 0);
    const offset = (zoneHour * 60 + zoneMinute) * (parts[8] === "-" ? -1 : 1);
    const utcMinute = (hour * 60 + minute - offset + 1440) % 1440;
    if (
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= days[month - 1] &&
      hour < 24 &&
      minute < 60 &&
      zoneHour < 24 &&
      zoneMinute < 60 &&
      (second < 60 || (second < 61 && utcMinute === 1439))
    )
      return;
  }
  report(errors, path, "must be a valid ISO 8601 timestamp with a timezone");
}

const confirmation = object({ at: timestamp, summary: text, source: text }, [
  "at",
  "summary",
]);
const step = (result, extra = {}, required = []) =>
  object({ result, at: timestamp, summary: text, ...extra }, [
    "result",
    "at",
    "summary",
    ...required,
  ]);
const taskFields = object(
  {
    title: text,
    status: oneOf("todo", "doing", "done", "blocked"),
    branch,
    reason: text,
    verification: text,
    commitTitle: text,
  },
  ["title", "status"],
);

function tasks(value, path, errors) {
  if (!isObject(value)) return report(errors, path, "must be an object");
  for (const [key, task] of Object.entries(value)) {
    const at = pointer(path, key);
    if (!/^T[1-9][0-9]*$/.test(key))
      report(
        errors,
        at,
        "task number must be T followed by a positive integer",
      );
    taskFields(task, at, errors);
    if (
      isObject(task) &&
      task.status === "blocked" &&
      !Object.hasOwn(task, "reason")
    ) {
      report(
        errors,
        pointer(at, "reason"),
        "is required when status is blocked",
      );
    }
  }
}

import * as prototypeContract from "../prototype/scripts/contract.mjs";
const prototypeRule = (value, path, errors) =>
  errors.push(...prototypeContract.validatePrototype(value, path));
const previewsRule = (value, path, errors) =>
  errors.push(...prototypeContract.validatePreviews(value, path));
const workflow = object(
  {
    schemaVersion: oneOf(1),
    prototype: prototypeRule,
    openfolioUrl: () => {}, // Validated together with the hosting choice below.
    protectedBranches: list(
      stringRule(
        /^[^\s*?\[]+$/,
        "must be a non-empty branch name without whitespace or wildcards",
      ),
      true,
    ),
  },
  ["schemaVersion", "protectedBranches"],
);

const changeFields = object(
  {
    schemaVersion: oneOf(1),
    id,
    title: text,
    size: oneOf("small", "medium", "large", "xlarge"),
    status: oneOf("active", "completed", "cancelled"),
    stage: oneOf("requirement", "technical", "plan", "execution", "close"),
    branch,
    parent: id,
    children: list(id),
    dependsOn: list(id),
    previews: previewsRule,
    confirmations: object(
      {
        requirement: confirmation,
        technical: confirmation,
        plan: confirmation,
        merge: object(
          {
            at: timestamp,
            summary: text,
            source: text,
            sourceCommit: commit,
            targetCommit: commit,
            baseCommit: commit,
          },
          ["at", "summary"],
        ),
      },
      [],
    ),
    tasks,
    waitingFor: object({
      kind: oneOf("confirmation", "dependency", "pause"),
      summary: text,
    }),
    rework: object({ at: timestamp, reason: text, approach: text }),
    closure: object(
      {
        verification: step(oneOf("passed", "failed")),
        acceptance: step(oneOf("accepted"), { source: text }),
        specs: step(oneOf("synced", "not_needed")),
        archive: step(
          oneOf("done"),
          {
            path: stringRule(
              /^docs\/project\/archive\/[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$/,
              "must be docs/project/archive/YYYY-MM-DD-<id>",
            ),
          },
          ["path"],
        ),
      },
      [],
    ),
    cancellation: object({ at: timestamp, reason: text }),
  },
  [
    "schemaVersion",
    "id",
    "title",
    "size",
    "status",
    "stage",
    "branch",
    "confirmations",
    "tasks",
    "closure",
  ],
);

function change(value, path, errors) {
  changeFields(value, path, errors);
  if (
    isObject(value) &&
    value.status === "cancelled" &&
    !Object.hasOwn(value, "cancellation")
  ) {
    report(
      errors,
      pointer(path, "cancellation"),
      "is required when status is cancelled",
    );
  }
}

export const validateChange = (value) => {
  const errors = [];
  change(value, "", errors);
  return errors;
};
export const validateWorkflow = (value) => {
  const errors = [];
  workflow(value, "", errors);
  errors.push(...prototypeContract.workflowHostingIssues(value));
  return errors;
};
