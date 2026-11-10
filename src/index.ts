async function ensureServer(): Promise<{ status: string; pid?: number; message: string }> {
  const serverScript = path.join(repoRoot, 'dist', 'index.js');
  
  // 1. Check if already running
  try {
    const { stdout } = await execAsync(
      `pgrep -f "node ${serverScript.replace(/ /g, '\\ ')}\"`,
      { timeout: 5000 },
    );
    const pids = stdout.trim().split('\n').filter(Boolean).map(Number);
    if (pids.length > 0) {
      console.log('✅ ZeroCreds MCP server is already running.');
      return { status: 'already_running', pid: pids[0], message: 'ZeroCreds MCP server is already running.' };
    }
  } catch {
    // pgrep returns non-zero when no match — that's expected, continue.
  }
  
  // 2. Read admin token (for logging only — never expose the value)
  const tokenPath = path.join(os.homedir(), '.config', 'zerocreds', 'local', 'admin-token');
  let hasToken = false;
  try {
    fs.accessSync(tokenPath, fs.constants.R_OK);
    hasToken = true;
  } catch {
    // token file missing — server may still start but will fail later
  }
  
  // 3. Start the server
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (hasToken) {
    env.ZEROCREDS_TOKEN = fs.readFileSync(tokenPath, 'utf8').trim();
  }
  
  // Spawn detached so it survives the parent process
  const { spawn } = await import('child_process');
  const child = spawn(nodeBin, [serverScript], {
    env,
    detached: true,
    stdio: 'inherit',
  });
  child.unref();
  
  const pid = child.pid;
  if (!pid) {
    return { status: 'error', message: 'Failed to spawn server process.' };
  }
  
  console.log(`🚀 Server process started with PID: ${pid}`);
  
  // 4. Wait for readiness (poll for process existence)
  const maxWaitMs = 5000;
  const pollInterval = 500;
  let waited = 0;
  while (waited < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollInterval));
    waited += pollInterval;
    try {
      const { stdout } = await execAsync(
        `pgrep -f "node ${serverScript.replace(/ /g, '\\ ')}\"`,
        { timeout: 3000 },
      );
      if (stdout.trim()) {
        return {
          status: 'started',
          pid,
          message: `ZeroCreds MCP server started (PID ${pid}).`,
        };
      }
    } catch {
      // process not yet visible — keep waiting
    }
  }
  
  return {
    status: 'timeout',
    pid,
    message: `Server process spawned (PID ${pid}) but did not become ready within ${maxWaitMs}ms.`,
  };
}