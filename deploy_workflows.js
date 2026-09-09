const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKFLOWS_FILE = path.join(__dirname, 'workflows.json');

function runCmd(command) {
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, command, error: error.message });
      } else {
        resolve({ success: true, command, stdout });
      }
    });
  });
}

async function deploy() {
  console.log("=== Starting n8n Full Workflows Deployment ===");

  // 1. Copy host workflows.json to container
  const copyRes = await runCmd("docker cp /root/leadwise_n8n/workflows.json n8n:/home/node/workflows_import.json");
  if (!copyRes.success) {
    console.error("Failed to copy workflows.json to container. Aborting.");
    return;
  }
  console.log("Successfully copied workflows.json to container.");

  // 2. Import workflows into container's database
  console.log("Importing workflows into n8n database...");
  const importRes = await runCmd("docker compose exec -u node n8n n8n import:workflow --input=/home/node/workflows_import.json");
  if (!importRes.success) {
    console.error("Failed to import workflows in n8n. Aborting.");
    console.error(importRes.error);
    return;
  }
  console.log("Workflows imported successfully.");

  // 3. Define the exact scope of workflows to publish/unpublish (ALL 48 workflows!)
  console.log("Starting SEQUENTIAL active-state synchronization for ALL workflows...");

  const fileContent = fs.readFileSync(WORKFLOWS_FILE, 'utf8');
  const workflows = JSON.parse(fileContent);

  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();

  for (const w of workflows) {
    const action = w.active ? "publish" : "unpublish";
    const actionLabel = w.active ? "Activating" : "Deactivating";
    const cmd = `docker compose exec -u node n8n n8n ${action}:workflow --id=${w.id}`;
    
    console.log(`[Execute] ${actionLabel} "${w.name}" (ID: ${w.id})...`);
    const res = await runCmd(cmd);
    if (res.success) {
      successCount++;
    } else {
      failCount++;
      console.error(`Failed to change state of "${w.name}" (${w.id}): ${res.error}`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\nActive state sync complete in ${duration} seconds!`);
  console.log(`Success: ${successCount}, Failed/Skipped: ${failCount}`);

  // 4. Cleanup temporary file in container
  await runCmd("docker compose exec -u node n8n rm -f /home/node/workflows_import.json");

  console.log("=== Deployment Finished Successfully ===");
}

deploy();
