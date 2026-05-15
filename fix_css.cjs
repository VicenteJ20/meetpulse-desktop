const fs = require("fs");
const filePath = "./src/styles.css";
let css = fs.readFileSync(filePath, "utf-8");

css = css.replace(/var\(--text-inverse\)ef0/g, "var(--text-primary)");

fs.writeFileSync(filePath, css);
console.log("Fix complete");
