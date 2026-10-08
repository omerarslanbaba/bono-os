const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const task = process.argv[2] || "check";
const root = path.resolve(__dirname, "..");
const logDir = path.join(root, ".ai", "logs");
fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, task.replace(/[^a-z0-9_-]/gi, "_") + ".log");

const checks = [
  "bridge/server.js","bridge/worker.js","bridge/repository.js","bridge/jobs.js",
  "bridge/uyap.js","bridge/v04.js","bridge/v05.js","bridge/v06.js","bridge/v09.js",
  "bridge/workflow_engine.js","bridge/event_bus.js","bridge/udf_adapter.js",
  "bridge/deadline_engine.js","extension/content.js","extension/page_probe.js"
];

function run(args) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
}

let output = "";
let code = 0;

if (task === "check") {
  for (const file of checks) {
    const r = run(["--check", file]);
    output += r.stdout || "";
    output += r.stderr || "";
    if (r.status !== 0) { code = r.status || 1; output += "\nFAILED FILE: " + file; break; }
  }
} else if (task === "test:uyap") {
  const r = run(["scripts/test_uyap_rate.js"]);
  output = (r.stdout || "") + (r.stderr || "");
  code = r.status || 0;
} else {
  console.error("Unsupported AI task:", task);
  process.exit(2);
}

fs.writeFileSync(logPath, output, "utf8");
if (code === 0) {
  console.log("PASS", task, "- full log:", path.relative(root, logPath));
} else {
  const tail = output.split(/\r?\n/).filter(Boolean).slice(-60).join("\n");
  console.error("FAIL", task, "- last output:\n" + tail);
  console.error("Full log:", path.relative(root, logPath));
  process.exitCode = code;
}