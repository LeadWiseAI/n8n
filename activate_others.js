const fs = require('fs');
const path = require('path');

const WORKFLOWS_FILE = path.join(__dirname, 'workflows.json');

function activateOthers() {
  const fileContent = fs.readFileSync(WORKFLOWS_FILE, 'utf8');
  const workflows = JSON.parse(fileContent);

  // We exclude the old originals of Gemini gated workflows to prevent duplicate triggers
  const excludedIds = [
    "ANma7fFMpL2xMd7U", // Triagem e analises individuais - V3
    "maPSQwsf6D1b1P1Oz96S_", // Media describer webhook - V3
    "VdbZgJyLRXJf3pN0", // Leadwise - Trends, Alerts and Strategies
    "rC6tRellabl0swA6", // Follow up - Per lead - V3
    "s9M4TKvzxGauecZO", // Check waiting answer - Agent - V3
    "YFkvXD1YmD4bSc8C"  // Sentiment Analysis - Per lead - V3
  ];

  const activatedIds = [];

  for (const w of workflows) {
    if (w.active === false) {
      const nameUpper = w.name.toUpperCase();
      
      // Check if it's a cron or orchestrator
      const isCronOrOrchestrator = nameUpper.includes("CRON") || nameUpper.includes("ORCHESTRATOR");
      
      // Check if it is in our excluded list of old originals
      const isExcludedOriginal = excludedIds.includes(w.id);

      if (!isCronOrOrchestrator && !isExcludedOriginal) {
        w.active = true;
        activatedIds.push(w.id);
        console.log(`[Activate] Workflow "${w.name}" (ID: ${w.id})`);
      }
    }
  }

  if (activatedIds.length > 0) {
    fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(workflows, null, 2), 'utf8');
    console.log(`\nSuccessfully marked ${activatedIds.length} workflows as active in workflows.json.`);
    return activatedIds;
  } else {
    console.log("No other workflows needed activation.");
    return [];
  }
}

activateOthers();
