import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const teacherData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'qna.teacher.testdata.json'), 'utf-8')
);

interface AskedRun {
  cardName: string;
  totalSubmitted: number;
  questions: { subject: string; chapter: string }[];
}

const askedLog: AskedRun[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'qna.asked.json'), 'utf-8')
);

test('Q&A Teacher: reply to pending questions for configured card', async ({ page }) => {
  test.setTimeout(0);

  const { url, credentials, qna } = teacherData;
  const { replyText, submitDelayMin = 10, submitDelayMax = 50 } = qna;

  if (askedLog.length === 0) {
    throw new Error('qna.asked.json is empty — run the student ask script first.');
  }

  // All unique card names in the log (preserve order of appearance)
  const cardNames = [...new Set(askedLog.map(r => r.cardName))];
  console.log(`📋 Cards to process (${cardNames.length}): ${cardNames.join(', ')}`);

  // ── 1. Login ──────────────────────────────────────────────────────────────────
  await page.goto(`${url}/Teacher/Account/Login`);
  await page.getByPlaceholder('Enter Your TPIN').fill(credentials.tpin);
  await page.getByRole('textbox', { name: 'Enter Your Password' }).fill(credentials.password);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL('**/Teacher/Routine', { timeout: 15000 });
  console.log('✅ Logged in');

  const logPath = path.join(__dirname, 'qna.asked.json');

  for (const cardName of cardNames) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🗂  Card: "${cardName}"`);

    const cardRuns = askedLog.filter(r => r.cardName === cardName);

    // Total questions to answer = sum of totalSubmitted across all runs for this card
    const replyCount = cardRuns.reduce((sum, r) => sum + r.totalSubmitted, 0);

    // Unique subject+chapter pairs across all runs
    const allPairs = cardRuns.flatMap(r => r.questions.map(q => ({ subject: q.subject, chapter: q.chapter })));
    const uniquePairs = Array.from(
      new Map(allPairs.map(p => [`${p.subject}||${p.chapter}`, p])).values()
    );

    console.log(`   totalSubmitted: ${replyCount} | ${uniquePairs.length} subject/chapter pair(s):`);
    uniquePairs.forEach(p => console.log(`   • ${p.subject} → ${p.chapter}`));

    // ── 2. Navigate to Pending Questions index ──────────────────────────────────
    await page.goto(`${url}/Teacher/QnA2/Index`);
    await page.waitForLoadState('networkidle');

    // ── 3. Collect Answer links matching card + subject + chapter ───────────────
    const answerLinks = await page.evaluate(
      ({ card, pairs }: { card: string; pairs: { subject: string; chapter: string }[] }) => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        const links: string[] = [];
        for (const row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 6) continue;
          const course  = cells[1]?.textContent?.trim() ?? '';
          const subject = cells[2]?.textContent?.trim() ?? '';
          const chapter = cells[3]?.textContent?.trim() ?? '';
          if (course !== card) continue;
          const matched = pairs.some(p => p.subject === subject && p.chapter === chapter);
          if (!matched) continue;
          const href = (cells[5]?.querySelector('a') as HTMLAnchorElement)?.href;
          if (href) links.push(href);
        }
        return links;
      },
      { card: cardName, pairs: uniquePairs }
    );

    console.log(`🔍 Found ${answerLinks.length} subject/chapter row(s) for "${cardName}"`);

    if (answerLinks.length === 0) {
      console.warn(`⚠️  No pending rows found for "${cardName}" — skipping.`);
    } else {
      // ── 4. Answer up to replyCount questions across all subject/chapter rows ──
      let answered = 0;

      outer: for (const link of answerLinks) {
        console.log(`\n▶ Opening: ${link}`);
        await page.goto(link);
        await page.waitForLoadState('networkidle');

        while (answered < replyCount) {
          if (!page.url().includes('/NewQuestionDisplay')) {
            console.log('   → No more questions in this batch');
            break;
          }

          // Random delay before submitting (simulates human reading time)
          const delayMs = (submitDelayMin + Math.random() * (submitDelayMax - submitDelayMin)) * 1000;
          const delaySec = (delayMs / 1000).toFixed(1);

          // Fill reply text with delay time appended
          const answerBox = page.getByRole('textbox', { name: 'Enter Answer' });
          await answerBox.waitFor({ state: 'visible', timeout: 10000 });
          await answerBox.fill(`${replyText} [${delaySec}s]`);
          await answerBox.dispatchEvent('input');

          console.log(`   ⏳ Waiting ${delaySec}s before submitting…`);
          await page.waitForTimeout(delayMs);

          // Submit and wait for overlay to clear
          await page.getByRole('button', { name: 'Submit & Next' }).click();
          await page.locator('.blockUI.blockOverlay')
            .waitFor({ state: 'hidden', timeout: 15000 })
            .catch(() => {});
          await page.waitForLoadState('networkidle');

          answered++;
          console.log(`   ✅ Replied #${answered} / ${replyCount} (waited ${delaySec}s)`);

          if (answered >= replyCount) break outer;

          await page.waitForTimeout(200);
        }
      }

      console.log(`\n✅ "${cardName}" done — ${answered} reply(ies) submitted`);
    }

    // ── 5. Remove this card's runs from qna.asked.json ─────────────────────────
    const currentLog: AskedRun[] = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    const remaining = currentLog.filter(r => r.cardName !== cardName);
    fs.writeFileSync(logPath, JSON.stringify(remaining, null, 2), 'utf-8');
    console.log(`🗑  Removed "${cardName}" from qna.asked.json (${remaining.length} run(s) remaining)`);
  }

  console.log(`\n🎉 All ${cardNames.length} card(s) processed.`);
});
