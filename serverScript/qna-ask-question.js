// Options:
//   url                Student portal base URL                      (default: 'https://ums-portal-6.osl.team/')
//   registrationNumber Student registration number                  (default: '4012324')
//   password           Student login password
//   cardNames          Q&A card names to process                    (default: ["Qna Service One","Qna Service Two","Qna Service Three"])
//   subjects           Filter subjects (empty = all)                (default: [])
//   chapters           Filter chapters (empty = all)                (default: [])
//   questions          Questions to submit                          (default: ["What is the acceleration due to gravity on Earth?","Does light travel faster than sound? (Yes/No)","What is the chemical symbol for water?","What is the largest planet in our solar system?","What is the process by which plants make their own food called?","What is the capital city of France?","What is the freezing point of water in degrees Celsius?","What is the main function of the respiratory system?"])
//   teacherType        Teacher type 'human'|'ai'                    (default: 'human')
//   logFile            Path to write asked-questions log            (default: './qna.asked.json')

async (page) => {
  const fs   = require('fs');
  const path = require('path');

  const {
    url                = 'https://ums-portal-6.osl.team/',
    registrationNumber = '4012324',
    password,
    cardNames          = ['Qna Service One', 'Qna Service Two', 'Qna Service Three'],
    subjects           = [],
    chapters           = [],
    questions          = [
      'What is the acceleration due to gravity on Earth?',
      'Does light travel faster than sound? (Yes/No)',
      'What is the chemical symbol for water?',
      'What is the largest planet in our solar system?',
      'What is the process by which plants make their own food called?',
      'What is the capital city of France?',
      'What is the freezing point of water in degrees Celsius?',
      'What is the main function of the respiratory system?',
    ],
    teacherType = 'human',
    logFile     = './qna.asked.json',
  } = __PARAMS__;

  const logPath = path.resolve(logFile);

  function timestamp() {
    return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Dhaka' }).slice(0, 19);
  }

  // Cards already logged in a previous run — skip on resume
  const existingLog = fs.existsSync(logPath)
    ? JSON.parse(fs.readFileSync(logPath, 'utf-8'))
    : [];
  const alreadyLogged = new Set(existingLog.map(r => r.cardName));

  // ── 1. Login ────────────────────────────────────────────────────────────────
  await page.goto(url);
  await page.waitForURL('**/Account/Login');
  await page.getByPlaceholder('Enter Your Registration Number').fill(String(registrationNumber));
  await page.getByRole('button', { name: 'Next' }).click();

  await page.waitForURL('**/Account/Password');
  await page.getByRole('textbox', { name: 'Enter Your Password' }).fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL('**/');

  // ── 2. Dismiss popup ────────────────────────────────────────────────────────
  const closeBtn = page.getByRole('button', { name: 'Close' });
  if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await closeBtn.click();
  }

  console.log(`\nCards to process (${cardNames.length}): ${cardNames.join(', ')}`);

  for (const cardName of cardNames) {
    console.log(`\n${'='.repeat(60)}`);

    if (alreadyLogged.has(cardName)) {
      console.log(`Skipping "${cardName}" — already logged in ${logFile}`);
      continue;
    }

    console.log(`Card: "${cardName}"`);

    const runLog = {
      cardName,
      runAt: timestamp(),
      totalSubmitted: 0,
      questions: [],
    };

    // ── 3. Navigate to Q&A course list ──────────────────────────────────────
    await page.goto(`${url}QnA/Course`);

    // ── 4. Find the card — Load More until visible ───────────────────────────
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

    // ── 6. Collect subjects ──────────────────────────────────────────────────
    const allSubjects = (await page.locator('#Subject option').allTextContents())
      .filter(s => !s.startsWith('All'));

    const subjectsToTest = subjects.length
      ? allSubjects.filter(s => subjects.includes(s))
      : allSubjects;

    console.log(`Subjects (${subjectsToTest.length}): ${subjectsToTest.join(', ')}`);

    let totalSubmitted = 0;

    for (const subject of subjectsToTest) {
      console.log(`\n  Subject: "${subject}"`);
      await page.locator('#Subject').selectOption(subject);

      await page.waitForFunction(
        () => document.querySelector('#Chapter')?.options.length > 1,
        { timeout: 5000 }
      ).catch(() => {});

      // ── 7. Collect chapters ────────────────────────────────────────────────
      const allChapters = (await page.locator('#Chapter option').allTextContents())
        .filter(c => !c.startsWith('All') && c !== 'Select Chapter');

      const chaptersToTest = chapters.length
        ? allChapters.filter(c => chapters.includes(c))
        : allChapters;

      console.log(`  Chapters (${chaptersToTest.length}): ${chaptersToTest.join(', ')}`);

      for (const chapter of chaptersToTest) {
        console.log(`\n    Chapter: "${chapter}"`);
        await page.locator('#Chapter').selectOption(chapter);

        for (const questionText of questions) {
          // ── 8. Type question with timestamp ──────────────────────────────
          const askedAt = timestamp();
          const questionWithTs = `${questionText} [${askedAt}]`;
          const textarea = page.getByRole('textbox', { name: 'Submit your question' });
          await textarea.fill(questionWithTs);
          await textarea.dispatchEvent('input');

          // ── 9. Wait for Submit button to be enabled ───────────────────────
          await page.waitForFunction(
            () => !document.querySelector('.beforeQnaQuestionSubmitBtn')?.disabled,
            { timeout: 5000 }
          );
          await page.locator('.beforeQnaQuestionSubmitBtn').click();

          // ── 10. Handle teacher-type modal ─────────────────────────────────
          const teacherBtn = teacherType === 'ai' ? 'Ask to AI Teacher' : 'Ask to Human Teacher';
          await page.locator(`.btn:has-text("${teacherBtn}")`).waitFor({ state: 'visible', timeout: 5000 });
          await page.locator(`.btn:has-text("${teacherBtn}")`).click();

          // ── 11. Confirm acceptance ────────────────────────────────────────
          await page.getByText('Question Accepted').first()
            .waitFor({ state: 'visible', timeout: 8000 });

          await page.locator('.blockUI.blockOverlay')
            .waitFor({ state: 'hidden', timeout: 10000 })
            .catch(() => {});

          totalSubmitted++;
          runLog.questions.push({ subject, chapter, question: questionWithTs, askedAt, teacherType });

          console.log(`    #${totalSubmitted}: ${questionWithTs.slice(0, 70)}...`);
          await page.waitForTimeout(400);
        }
      }
    }

    runLog.totalSubmitted = totalSubmitted;

    // ── 12. Append to log file ───────────────────────────────────────────────
    const current = fs.existsSync(logPath)
      ? JSON.parse(fs.readFileSync(logPath, 'utf-8'))
      : [];
    current.push(runLog);
    fs.writeFileSync(logPath, JSON.stringify(current, null, 2), 'utf-8');

    console.log(`\n"${cardName}" done — ${totalSubmitted} question(s) submitted.`);
  }

  console.log(`\nAll ${cardNames.length} card(s) processed.`);
  console.log(`Log saved -> ${logPath}`);
}
