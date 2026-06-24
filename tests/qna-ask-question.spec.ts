import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const testData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'qna.testdata.json'), 'utf-8')
);

function timestamp(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Dhaka' }).slice(0, 19);
}

interface AskedQuestion {
  subject: string;
  chapter: string;
  question: string;
  askedAt: string;
  teacherType: string;
}

interface RunLog {
  cardName: string;
  runAt: string;
  totalSubmitted: number;
  questions: AskedQuestion[];
}

test('Q&A: ask questions across all subject/chapter combinations', async ({ page }) => {
  test.setTimeout(0);

  const { url, credentials, qna } = testData;
  const cardNames: string[] = qna.cardNames;

  // Cards already in the log from a previous run — skip them on resume
  const logPath = path.join(__dirname, 'qna.asked.json');
  const existingLog: RunLog[] = fs.existsSync(logPath)
    ? JSON.parse(fs.readFileSync(logPath, 'utf-8'))
    : [];
  const alreadyLogged = new Set(existingLog.map((r: RunLog) => r.cardName));

  // ── 1. Login ───────────────────────────────────────────────────────────────
  await page.goto(url);
  await page.waitForURL('**/Account/Login');
  await page.getByPlaceholder('Enter Your Registration Number').fill(credentials.registrationNumber);
  await page.getByRole('button', { name: 'Next' }).click();

  await page.waitForURL('**/Account/Password');
  await page.getByRole('textbox', { name: 'Enter Your Password' }).fill(credentials.password);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL('**/');

  // ── 2. Dismiss popup ───────────────────────────────────────────────────────
  const closeBtn = page.getByRole('button', { name: 'Close' });
  if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await closeBtn.click();
  }

  console.log(`\n📋 Cards to process (${cardNames.length}): ${cardNames.join(', ')}`);

  for (const cardName of cardNames) {
    console.log(`\n${'═'.repeat(60)}`);
    if (alreadyLogged.has(cardName)) {
      console.log(`⏭  Skipping "${cardName}" — already logged in qna.asked.json`);
      continue;
    }
    console.log(`🗂  Card: "${cardName}"`);

    const runLog: RunLog = {
      cardName,
      runAt: timestamp(),
      totalSubmitted: 0,
      questions: [],
    };

    // ── 3. Go to Q&A course list ─────────────────────────────────────────────
    await page.goto(`${url}QnA/Course`);

    // ── 4. Find the card — keep clicking Load More until found ───────────────
    const proceedLink = page.locator('.card', { hasText: cardName })
      .getByRole('link', { name: 'Proceed' });

    while (!(await proceedLink.isVisible().catch(() => false))) {
      const loadMore = page.getByText('Load More');
      if (!(await loadMore.isVisible().catch(() => false))) {
        throw new Error(`Card "${cardName}" not found on the Q&A course list.`);
      }
      await loadMore.click();
      await page.waitForTimeout(800);
    }

    await proceedLink.click();
    await page.waitForURL('**/QnA/Index**');

    // ── 5. Open Filter panel ─────────────────────────────────────────────────
    await page.getByText('Filter').click();
    await page.locator('#Subject').waitFor({ state: 'visible' });

    // ── 6. List all available subjects ──────────────────────────────────────
    const allSubjects = (await page.locator('#Subject option').allTextContents())
      .filter(s => !s.startsWith('All'));

    const subjectsToTest: string[] = qna.subjects?.length
      ? allSubjects.filter((s: string) => qna.subjects.includes(s))
      : allSubjects;

    console.log(`📚 Subjects found (${subjectsToTest.length}): ${subjectsToTest.join(', ')}`);

    let totalSubmitted = 0;

    for (const subject of subjectsToTest) {
      // ── 7. Select subject ──────────────────────────────────────────────────
      console.log(`\n▶ Subject: "${subject}"`);
      await page.locator('#Subject').selectOption(subject);

      await page.waitForFunction(
        () => (document.querySelector('#Chapter') as HTMLSelectElement)?.options.length > 1,
        { timeout: 5000 }
      ).catch(() => {});

      // ── 8. List all available chapters ────────────────────────────────────
      const allChapters = (await page.locator('#Chapter option').allTextContents())
        .filter(c => !c.startsWith('All') && c !== 'Select Chapter');

      const chaptersToTest: string[] = qna.chapters?.length
        ? allChapters.filter((c: string) => qna.chapters.includes(c))
        : allChapters;

      console.log(`   Chapters found (${chaptersToTest.length}): ${chaptersToTest.join(', ')}`);

      for (const chapter of chaptersToTest) {
        // ── 9. Select chapter ────────────────────────────────────────────────
        console.log(`\n   ▶ Chapter: "${chapter}"`);
        await page.locator('#Chapter').selectOption(chapter);

        for (const questionText of qna.questions) {
          // ── 10. Type question with timestamp ─────────────────────────────
          const askedAt = timestamp();
          const questionWithTs = `${questionText} [${askedAt}]`;
          const textarea = page.getByRole('textbox', { name: 'Submit your question' });
          await textarea.fill(questionWithTs);
          await textarea.dispatchEvent('input');

          // ── 11. Wait for Submit to be enabled, then click ─────────────────
          await page.waitForFunction(
            () => !(document.querySelector('.beforeQnaQuestionSubmitBtn') as HTMLInputElement)?.disabled,
            { timeout: 5000 }
          );
          await page.locator('.beforeQnaQuestionSubmitBtn').click();

          // ── 12. Handle teacher-type modal ─────────────────────────────────
          const teacherBtn = qna.teacherType === 'ai' ? 'Ask to AI Teacher' : 'Ask to Human Teacher';
          await page.locator(`.btn:has-text("${teacherBtn}")`).waitFor({ state: 'visible', timeout: 5000 });
          await page.locator(`.btn:has-text("${teacherBtn}")`).click();

          // ── 13. Verify accepted ───────────────────────────────────────────
          await page.getByText('Question Accepted').first()
            .waitFor({ state: 'visible', timeout: 8000 });

          // Wait for BlockUI overlay to fully clear before next iteration
          await page.locator('.blockUI.blockOverlay')
            .waitFor({ state: 'hidden', timeout: 10000 })
            .catch(() => {});

          totalSubmitted++;
          runLog.questions.push({ subject, chapter, question: questionWithTs, askedAt, teacherType: qna.teacherType });

          console.log(`   ✅ #${totalSubmitted}: ${questionWithTs.slice(0, 70)}…`);
          await page.waitForTimeout(400);
        }
      }
    }

    runLog.totalSubmitted = totalSubmitted;

    // ── 14. Append this card's run to qna.asked.json ─────────────────────────
    const existing: RunLog[] = fs.existsSync(logPath)
      ? JSON.parse(fs.readFileSync(logPath, 'utf-8'))
      : [];
    existing.push(runLog);
    fs.writeFileSync(logPath, JSON.stringify(existing, null, 2), 'utf-8');

    console.log(`\n✅ "${cardName}" done — ${totalSubmitted} question(s) submitted across ${subjectsToTest.length} subject(s).`);
  }

  console.log(`\n🎉 All ${cardNames.length} card(s) processed.`);
  console.log(`📄 Log saved → tests/qna.asked.json`);
});
