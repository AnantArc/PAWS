import { chromium } from "playwright";

const base = "http://localhost:3000";
const browser = await chromium.launch();

async function capture(theme) {
  // user-scale: 1440x900 CSS px at 1.25 device pixel ratio
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.25,
  });
  const page = await ctx.newPage();

  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.locator('input[placeholder="e.g. Jash"]').fill("Jash");
  await page.locator('input[type="email"]').fill("operator@paws.local");
  await page.locator('input[type="password"]').fill("paws-demo-operator");
  await page.getByRole("button", { name: /Launch Console/i }).click();
  await page.waitForURL("**/console", { timeout: 30000 });
  await page.waitForTimeout(4000);

  await page.evaluate((th) => localStorage.setItem("paws-theme-v2", th), theme);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(4500);

  await page.screenshot({ path: `/home/user/qa-screens/${theme}-1440-top.png` });
  await page.evaluate(() => window.scrollBy(0, 560));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `/home/user/qa-screens/${theme}-1440-mid.png` });
  await ctx.close();
}

await capture("dark");
await capture("light");
await browser.close();
console.log("done");
