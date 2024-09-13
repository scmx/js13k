import { fork } from "node:child_process";
import { watch } from "node:fs";

let child = fork("server.js", { stdio: "inherit" });

watch("server.js", (_eventType, filename) => {
  if (filename) {
    child.kill();
    child = fork("server.js", { stdio: "inherit" });
  }
});
