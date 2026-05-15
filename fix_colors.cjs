const fs = require("fs");
const filePath = "./src/styles.css";
let css = fs.readFileSync(filePath, "utf-8");

css = css.replace(/#2563eb/g, "var(--accent-primary)");
css = css.replace(/#1d4ed8/g, "var(--accent-hover)");
css = css.replace(/#f87171/g, "var(--status-recording)");
css = css.replace(/rgba\(255,\s*254,\s*240,\s*0\.7\)/g, "var(--text-secondary)");
css = css.replace(/rgba\(255,\s*254,\s*240,\s*0\.5\)/g, "var(--text-muted)");
css = css.replace(/rgba\(255,\s*254,\s*240,\s*0\.4\)/g, "var(--text-muted)");

fs.writeFileSync(filePath, css);
console.log("Fix buttons complete");
