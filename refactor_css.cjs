const fs = require("fs");

const filePath = "./src/styles.css";
let css = fs.readFileSync(filePath, "utf-8");

// Borders
css = css.replace(/border-radius:\s*[0-9]+px;/g, (match) => {
  if (match.includes("999px") || match.includes("9999px")) return "border-radius: var(--radius-pill);";
  const px = parseInt(match.match(/[0-9]+/)[0], 10);
  if (px <= 6) return "border-radius: var(--radius-sm);";
  if (px <= 8) return "border-radius: var(--radius-md);";
  return "border-radius: var(--radius-lg);";
});

// Primary Accent
css = css.replace(/#7dd3fc/gi, "var(--accent-primary)");
css = css.replace(/rgba\(125,\s*211,\s*252,\s*0\.[0-9]+\)/gi, "var(--accent-subtle)");

// Dark backgrounds
css = css.replace(/rgba\([4-9],\s*1[0-9],\s*3[0-9],\s*0\.[0-9]+\)/g, "var(--bg-panel)");
css = css.replace(/rgba\(5,\s*18,\s*34,\s*0\.[0-9]+\)/g, "var(--bg-panel)");
css = css.replace(/rgba\(8,\s*20,\s*38,\s*0\.[0-9]+\)/g, "var(--bg-hover)");

// Light borders
css = css.replace(/rgba\(186,\s*230,\s*253,\s*0\.[0-9]+\)/g, "var(--border-light)");
css = css.replace(/rgba\(255,\s*255,\s*255,\s*0\.0[0-9]+\)/g, "var(--border-light)");

// Text Colors
css = css.replace(/#e0f2fe/gi, "var(--text-primary)");
css = css.replace(/#f8fbff/gi, "var(--text-primary)");
css = css.replace(/#fff(fff)?/gi, "var(--text-inverse)");
css = css.replace(/rgba\(215,\s*241,\s*255,\s*0\.[6-9][0-9]*\)/g, "var(--text-secondary)");
css = css.replace(/rgba\(224,\s*242,\s*254,\s*0\.[0-9]+\)/g, "var(--text-muted)");
css = css.replace(/rgba\(255,\s*255,\s*255,\s*0\.[5-9][0-9]*\)/g, "var(--text-secondary)");
css = css.replace(/rgba\(255,\s*255,\s*255,\s*0\.[1-4][0-9]*\)/g, "var(--text-muted)");

fs.writeFileSync(filePath, css);
console.log("Refactoring complete");
