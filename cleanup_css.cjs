const fs = require("fs");
const filePath = "./src/styles.css";
let css = fs.readFileSync(filePath, "utf-8");

css = css.replace(/background:\s*#071226;/g, "background: var(--bg-base);");
css = css.replace(/color:\s*#071226;/g, "color: var(--text-inverse);");
css = css.replace(/border:\s*2px solid #071226;/g, "border: 2px solid var(--bg-panel);");

css = css.replace(/rgba\(52,\s*211,\s*153,\s*0\.[0-9]+\)/g, "var(--status-success-glow)");
css = css.replace(/rgba\(248,\s*113,\s*113,\s*0\.[0-9]+\)/g, "var(--status-recording-glow)");
css = css.replace(/rgba\(215,\s*241,\s*255,\s*0\.[0-9]+\)/g, "var(--text-muted)");
css = css.replace(/rgba\(248,\s*251,\s*255,\s*0\.[0-9]+\)/g, "var(--text-primary)");

// fix the markdown-stage gradient that was partially replaced
css = css.replace(/linear-gradient\(180deg,\s*rgba\(6,\s*20,\s*39,\s*0\.94\),\s*var\(--bg-panel\)\),/g, "var(--bg-panel);");
css = css.replace(/linear-gradient\(180deg,\s*rgba\(5,\s*18,\s*34,\s*0\.92\),\s*rgba\(8,\s*20,\s*38,\s*0\.76\)\),/g, "var(--bg-panel);");

fs.writeFileSync(filePath, css);
console.log("Cleanup complete");
