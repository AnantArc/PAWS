import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

// 1. Landing Page
console.log("Capturing landing page...");
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.screenshot({ path: "/home/user/paws_landing_page.png" });

// 2. Mission Control Console
console.log("Capturing mission control console...");
await page.goto("http://localhost:3000/console", { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
await page.screenshot({ path: "/home/user/paws_mission_control.png" });

await browser.close();
console.log("Captured screenshots successfully!");
