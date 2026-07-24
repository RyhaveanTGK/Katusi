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

  await page.goto('https://birloto.com/home.php', { waitUntil: 'networkidle', timeout: 120000 });
  await save('01-home');

  await page.goto('https://birloto.com/login.php', { waitUntil: 'networkidle', timeout: 120000 });
  await save('02-login');

  await page.fill('input[name="login"]', 'Ravven');
  await page.fill('input[name="password"]', 'Baku2020_');
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 120000 }).catch(()=>{}),
    page.locator('button[type="submit"], input[type="submit"]').first().click()
  ]);
  await page.waitForTimeout(5000);
  await save('03-after-login');

  const roomLinks = await page.locator('a').evaluateAll(els => els.map(a => ({href:a.href, text:(a.textContent||'').trim()})).filter(x => x.href));
  fs.writeFileSync(`${outDir}/03-links.json`, JSON.stringify(roomLinks, null, 2));

  const possibleLinks = roomLinks.filter(x => /join|gamestart|room|oda|oyna|oyun/i.test(x.href + ' ' + x.text));
  console.log('POSSIBLE_LINKS', JSON.stringify(possibleLinks.slice(0,20), null, 2));
  let idx = 4;
  for (const link of possibleLinks.slice(0,3)) {
    try {
      await page.goto(link.href, { waitUntil: 'networkidle', timeout: 120000 });
      await page.waitForTimeout(4000);
      await save(`0${idx}-${link.text.replace(/[^a-z0-9]+/gi,'_').slice(0,30) || 'room'}`);
      idx++;
    } catch (e) {
      console.log('NAV_FAIL', link.href, e.message);
    }
  }

  await browser.close();
})();