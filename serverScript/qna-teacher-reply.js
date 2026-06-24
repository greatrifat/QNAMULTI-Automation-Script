// Options:
//   url              Teacher portal base URL                      (default: 'https://ums-teacher-portal-6.osl.team')
//   tpin             Teacher TPIN                                 (default: '8732')
//   password         Teacher login password
//   replyText        Answer text to submit                        (default: 'reply from teacher 8732')
//   submitDelayMin   Min wait before submitting each answer (sec) (default: 30)
//   submitDelayMax   Max wait before submitting each answer (sec) (default: 100)
//   logFile          Path to asked-questions log (written by ask script) (default: './qna.asked.json')

async (page) => {
  const fs   = require('fs');
  const path = require('path');

  const {
    url            = 'https://ums-teacher-portal-6.osl.team',
    tpin           = '8732',
    password,
    replyText      = 'reply from teacher 8732',
    submitDelayMin = 30,
    submitDelayMax = 100,
    logFile        = './qna.asked.json',
  } = __PARAMS__;

  const logPath = path.resolve(logFile);

  if (!fs.existsSync(logPath)) {
    throw new Error(`Log file not found: ${logPath} — run the ask-question script first.`);
  }

  const askedLog = JSON.parse(fs.readFileSync(logPath, 'utf-8'));

  if (askedLog.length === 0) {
    throw new Error(`${logFile} is empty — run the ask-question script first.`);
  }

  // Unique card names in log order
  const cardNames = [...new Set(askedLog.map(r => r.cardName))];
  console.log(`\nCards to process (${cardNames.length}): ${cardNames.join(', ')}`);

  // ── 1. Login ─────────────────────────────────────────────────────────────────
  await page.goto(`${url}/Teacher/Account/Login`);
  await page.getByPlaceholder('Enter Your TPIN').fill(String(tpin));
  await page.getByRole('textbox', { name: 'Enter Your Password' }).fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL('**/Teacher/Routine', { timeout: 15000 });
  console.log('Logged in');

  for (const cardName of cardNames) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Card: "${cardName}"`);

    const cardRuns = askedLog.filter(r => r.cardName === cardName);

    // Total questions to answer
    const replyCount = cardRuns.reduce((sum, r) => sum + r.totalSubmitted, 0);

    // Unique subject+chapter pairs
    const allPairs = cardRuns.flatMap(r =>
      r.questions.map(q => ({ subject: q.subject, chapter: q.chapter }))
    );
    const uniquePairs = Array.from(
      new Map(allPairs.map(p => [`${p.subject}||${p.chapter}`, p])).values()
    );

    console.log(`  totalSubmitted: ${replyCount} | ${uniquePairs.length} subject/chapter pair(s):`);
    uniquePairs.forEach(p => console.log(`  - ${p.subject} -> ${p.chapter}`));

    // ── 2. Navigate to Pending Questions ────────────────────────────────────────
    await page.goto(`${url}/Teacher/QnA2/Index`);
    await page.waitForLoadState('networkidle');

    // ── 3. Collect Answer links matching card + subject + chapter ────────────────
    const answerLinks = await page.evaluate(
      ({ card, pairs }) => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        const links = [];
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 6) continue;
          const course  = cells[1]?.textContent?.trim() ?? '';
          const subject = cells[2]?.textContent?.trim() ?? '';
          const chapter = cells[3]?.textContent?.trim() ?? '';
          if (course !== card) continue;
          const matched = pairs.some(p => p.subject === subject && p.chapter === chapter);
          if (!matched) continue;
          const href = cells[5]?.querySelector('a')?.href;
          if (href) links.push(href);
        }
        return links;
      },
      { card: cardName, pairs: uniquePairs }
    );

    console.log(`Found ${answerLinks.length} subject/chapter row(s) for "${cardName}"`);

    if (answerLinks.length === 0) {
      console.log(`No pending rows found for "${cardName}" — skipping.`);
    } else {
      // ── 4. Answer up to replyCount questions ───────────────────────────────────
      let answered = 0;

      outer: for (const link of answerLinks) {
        console.log(`\n  Opening: ${link}`);
        await page.goto(link);
        await page.waitForLoadState('networkidle');

        while (answered < replyCount) {
          if (!page.url().includes('/NewQuestionDisplay')) {
            console.log('  -> No more questions in this batch');
            break;
          }

          // Random delay simulating human reading time
          const delayMs = (submitDelayMin + Math.random() * (submitDelayMax - submitDelayMin)) * 1000;
          const delaySec = (delayMs / 1000).toFixed(1);

          const answerBox = page.getByRole('textbox', { name: 'Enter Answer' });
          await answerBox.waitFor({ state: 'visible', timeout: 10000 });
          await answerBox.fill(`${replyText} [${delaySec}s]`);
          await answerBox.dispatchEvent('input');

          console.log(`  Waiting ${delaySec}s before submitting...`);
          await page.waitForTimeout(delayMs);

          await page.getByRole('button', { name: 'Submit & Next' }).click();
          await page.locator('.blockUI.blockOverlay')
            .waitFor({ state: 'hidden', timeout: 15000 })
            .catch(() => {});
          await page.waitForLoadState('networkidle');

          answered++;
          console.log(`  Replied #${answered} / ${replyCount} (waited ${delaySec}s)`);

          if (answered >= replyCount) break outer;

          await page.waitForTimeout(200);
        }
      }

      console.log(`\n"${cardName}" done — ${answered} reply(ies) submitted`);
    }

    // ── 5. Remove this card's runs from log file ─────────────────────────────────
    const currentLog = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    const remaining = currentLog.filter(r => r.cardName !== cardName);
    fs.writeFileSync(logPath, JSON.stringify(remaining, null, 2), 'utf-8');
    console.log(`Removed "${cardName}" from ${logFile} (${remaining.length} run(s) remaining)`);
  }

  console.log(`\nAll ${cardNames.length} card(s) processed.`);
}
