const { chromium } = require('playwright');
const fs = require('fs');
(async() => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const outDir = '/home/user/work/project/live-analysis';
  fs.mkdirSync(outDir, { recursive: true });
  async function save(label){
    console.log('URL', label, page.url());
    console.log('TITLE', label, await page.title());
    await page.screenshot({ path: `${outDir}/${label}.png`, fullPage: true });
    fs.writeFileSync(`${outDir}/${label}.html`, await page.content());
    fs.writeFileSync(`${outDir}/${label}.txt`, await page.locator('body').innerText());
  }
  await page.goto('https://birloto.com/login.php', { waitUntil: 'networkidle', timeout: 120000 });
  await page.fill('input[name="login"]', 'Ravven');
  await page.fill('input[name="password"]', 'Baku2020_');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 120000 }).catch(()=>{}),
    page.locator('button[type="submit"], input[type="submit"]').first().click()
  ]);
  await page.waitForTimeout(2000);
  await save('10-home-logged');
  const card = page.locator('.card').first();
  console.log('cards', await page.locator('.card').count());
  await card.click();
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(()=>{});
  await page.waitForTimeout(4000);
  await save('11-after-first-card-click');
  // click first prominent button if available
  const btn = page.locator('button, a').filter({ hasText: /qoşul|qəbul et|oyuna qayıt|oyna/i }).first();
  if (await btn.count()) {
    await btn.click().catch(()=>{});
    await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(()=>{});
    await page.waitForTimeout(4000);
    await save('12-after-join-click');
  }
  await browser.close();
})();