$config    = Get-Content -Raw "tests\qna.testdata.json" | ConvertFrom-Json
$loopCount = $config.workflow.loopCount

Write-Host ""
Write-Host "Q&A Workflow  --  $loopCount loop(s)"
Write-Host "------------------------------------------------------------"

for ($i = 1; $i -le $loopCount; $i++) {
    Write-Host ""
    Write-Host "------------------------------------------------------------"
    Write-Host "Loop $i / $loopCount"
    Write-Host "------------------------------------------------------------"

    Write-Host ""
    Write-Host "[Loop $i] Running Ask Question..."
    npx playwright test tests/qna-ask-question.spec.ts --headed
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[Loop $i] Ask Question FAILED -- workflow stopped."
        exit 1
    }
    Write-Host "[Loop $i] Ask Question complete."

    Write-Host ""
    Write-Host "[Loop $i] Running Teacher Reply..."
    npx playwright test tests/qna-teacher-reply.spec.ts --headed
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[Loop $i] Teacher Reply FAILED -- workflow stopped."
        exit 1
    }
    Write-Host "[Loop $i] Teacher Reply complete."
}

Write-Host ""
Write-Host "------------------------------------------------------------"
Write-Host "All $loopCount loop(s) finished successfully."
Write-Host "------------------------------------------------------------"
