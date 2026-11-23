import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { categories } from "./catalog.ts";

const css = (await Promise.all(["styles.css","ui-tokens.css","ui-components.css","ui-modules.css","ui-home-colors.css","ui-buttons.css","ui-interactions.css","ui-shared-components.css"].map(file =>
  readFile(new URL("./" + file, import.meta.url), "utf8")))).join("\n").replace('@import "tailwindcss";', "");
const read = (file) => readFile(new URL(file, import.meta.url), "utf8");
const quantity = await read("./quantity.mjs");
const browser = quantity + "\n" + (await read("./browser.mjs")).replace(/^import[^\n]*\n/, "") + "\n" + await read("./date-picker-only.mjs");
const requireDemoAuth = true;
const iconNames = ["arrow-left","house","refrigerator","pill","shirt","laptop","credit-card","calendar-clock","package-open","menu","x","plus"];
const uiIcons = Object.fromEntries(await Promise.all(iconNames.map(async name => [name,(await read("./vendor/lucide/"+name+".svg")).replace('stroke-width="2"','stroke-width="1.7"').replace('<svg','<svg class="line-icon" aria-hidden="true" focusable="false"')])));
const generated = `const uiIcons = ${JSON.stringify(uiIcons)};\nconst catalog = ${JSON.stringify(categories)};\nconst styles = ${JSON.stringify(css + "button.button{border:0} a.button{text-decoration:none}")};\nconst browser = ${JSON.stringify(browser)};\n`;
const food = await read("./food.mjs");
const foodDates = await read("./food-dates.mjs");
const foodPortions = await read("./food-portions.mjs");
const intake = await read("./intake-provider.mjs") + "\n" + await read("./intake.mjs");
const drugs = await read("./drug.mjs") + "\n" + await read("./drug-plan.mjs") + "\n" + await read("./drug-intake.mjs") + "\n" + await read("./drug-safety.mjs");
const demoAuth = await read("./vendor/noble-argon2.js") + "\n" + await read("./demo-auth.mjs");
const localAuth = await read("./local-auth.mjs");
const journal = JSON.parse(await read("./drizzle/meta/_journal.json"));
// Demo workspaces start from the business schema only. Demo auth and local auth tables are
// created by their own databases and must not be duplicated into every demo workspace.
const demoMigrations = await Promise.all(journal.entries.filter(({tag}) => !/_demo_/.test(tag) && !/_local_/.test(tag)).map(async ({tag}) =>
  (await read("./drizzle/" + tag + ".sql")).split("--> statement-breakpoint").map((sql) => sql.trim()).filter(Boolean)));
const demoWorkspaces = "const demoMigrations = " + JSON.stringify(demoMigrations) + ";\n" + await read("./demo-workspace.mjs");
const wardrobe = await read("./wardrobe.mjs") + "\n" + await read("./wardrobe-intake.mjs");
const subscriptionIntake = await read("./subscription-intake.mjs");
const deviceIntake = await read("./device-intake.mjs");
const worker = (await read("./worker.mjs"))
  .replace('import { catalog, styles, browser } from "./generated.mjs";', () => generated + "const requireDemoAuth = " + requireDemoAuth + ";\n")
  .replace('import { parseQuantity } from "./quantity.mjs";', () => quantity)
  .replace('import { allFoodRows, ensureFoodData, foodActive, foodTasks, foodTitle, foodRoute } from "./food.mjs";', () => food + "\n" + foodDates + "\n" + intake + "\n" + foodPortions)
  .replace('import { demoAuthRoute } from "./demo-auth.mjs";', () => demoAuth + "\n" + demoWorkspaces)
  .replace('import { localAuthRoute } from "./local-auth.mjs";', () => localAuth)
  .replace('import { subscriptionExtract } from "./subscription-intake.mjs";', () => subscriptionIntake)
  .replace('import { deviceExtract } from "./device-intake.mjs";', () => deviceIntake)
  .replace('import { wardrobeRoute } from "./wardrobe.mjs";', () => wardrobe)
  .replace('import { drugHomeData, drugRoute } from "./drug.mjs";', () => drugs);
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await writeFile("dist/server/index.js", worker);
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
if (process.argv.includes("--test-legacy")) {
  await mkdir("test-results/legacy-worker", {recursive:true});
  await writeFile("test-results/legacy-worker/index.js", worker.replace("const requireDemoAuth = true;", "const requireDemoAuth = false;"));
}
