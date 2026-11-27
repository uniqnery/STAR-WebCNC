// Local Windows startup coordinator. Logs contain component names, never connection strings.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');

const exec = promisify(execFile);
const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'agent-runtime', 'startup');
const enabledFile = path.join(runtime, 'enabled');
const reportFile = path.join(runtime, 'status.json');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const serverDir = path.join(root, 'packages', 'server');
const serverRequire = createRequire(path.join(serverDir, 'package.json'));
const pending = new Map();
let prisma;
let dockerLaunched = false;

function log(message) {
  fs.appendFileSync(path.join(runtime, 'startup.log'), `${new Date().toISOString()} ${message}\n`);
}

async function command(file, args, options = {}) {
  return (await exec(file, args, { cwd: root, windowsHide: true, timeout: 20000, ...options })).stdout.trim();
}

function listening(port) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('ENDPOINT_UNAVAILABLE');
  return response.json();
}

function launch(key, file, args, cwd, env = process.env) {
  // A process can still be starting when the next check runs. On Windows,
  // detached console children may open Windows Terminal despite windowsHide.
  if (Date.now() - (pending.get(key) ?? 0) < 30000) return;
  const logFile = path.join(runtime, `${key}.log`);
  const output = fs.openSync(logFile, 'a');
  const child = spawn(file, args, { cwd, env, windowsHide: true, detached: false, stdio: ['ignore', output, output] });
  child.on('error', () => log(`${key}: launch failed`));
  child.unref();
  fs.closeSync(output);
  pending.set(key, Date.now());
  log(`${key}: start requested`);
}

async function dockerReady() {
  try {
    await command('docker.exe', ['info', '--format', '{{.ServerVersion}}']);
    return true;
  } catch {
    if (!dockerLaunched) {
      const executable = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');
      if (!fs.existsSync(executable)) throw new Error('DOCKER_NOT_INSTALLED');
      launch('docker', executable, [], path.dirname(executable));
      dockerLaunched = true;
    }
    return false;
  }
}

async function ensureContainers() {
  for (const [service, name] of [['postgres', 'star-webcnc-db'], ['redis', 'star-webcnc-redis'], ['mqtt', 'star-webcnc-mqtt']]) {
    let running;
    try {
      running = await command('docker.exe', ['inspect', '--format', '{{.State.Running}}', name]);
    } catch {
      // Creation is explicit, using the application's existing Compose configuration.
      await command('docker.exe', ['compose', '--env-file', path.join(serverDir, '.env'), '-f', path.join(root, 'docker', 'docker-compose.yml'), 'up', '-d', service], { timeout: 120000 });
      continue;
    }
    if (running !== 'true') await command('docker.exe', ['start', name]);
  }
}

async function machines() {
  if (!prisma) {
    const envFile = path.join(serverDir, '.env');
    if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
    const { PrismaClient } = serverRequire('@prisma/client');
    prisma = new PrismaClient({ log: [] });
  }
  return prisma.machine.findMany({
    where: { isActive: true },
    select: { machineId: true, ipAddress: true, port: true, templateId: true },
  });
}

async function runningAgents() {
  // Read only this product's process arguments and return the machine IDs.
  const script = `@(Get-CimInstance Win32_Process -Filter "Name='dotnet.exe'" | Where-Object { $_.CommandLine -match 'StarWebCNC[.]Agent[.]dll' } | ForEach-Object { if ($_.CommandLine -match '--Agent:MachineId=(MC-[0-9]+)(?=["\\s]|$)') { $Matches[1] } }) | ConvertTo-Json -Compress`;
  const text = await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const parsed = text ? JSON.parse(text) : [];
  return new Set(Array.isArray(parsed) ? parsed : [parsed]);
}

async function ensureAgents(configured) {
  const running = await runningAgents();
  for (const machine of configured) {
    if (!/^MC-\d+$/.test(machine.machineId)) throw new Error('INVALID_MACHINE_ID');
    if (running.has(machine.machineId)) continue;
    const local = path.join(root, 'agent-runtime', machine.machineId, 'publish');
    const publish = fs.existsSync(path.join(local, 'active')) ? local : path.join(serverDir, '..', 'agent', 'StarWebCNC.Agent', 'publish');
    const dll = path.join(publish, 'StarWebCNC.Agent.dll');
    if (!fs.existsSync(dll)) throw new Error('AGENT_BUILD_MISSING');
    const args = [dll,
      `--Agent:AgentId=AGENT-${machine.machineId.slice(3)}`,
      `--Agent:MachineId=${machine.machineId}`, `--Agent:TemplateId=${machine.templateId ?? ''}`,
      `--Agent:Cnc:IpAddress=${machine.ipAddress}`, `--Agent:Cnc:Port=${machine.port ?? 8193}`,
      '--Agent:Mqtt:Host=localhost', '--Agent:Mqtt:Port=1883', '--Agent:Server:BaseUrl=http://localhost:3000',
    ];
    launch(machine.machineId, 'dotnet.exe', args, publish, {
      ...process.env, DOTNET_ENVIRONMENT: 'Production',
      Logging__EventLog__LogLevel__Default: 'None', Logging__EventLog__LogLevel__StarWebCNC_Agent: 'None',
    });
  }
  return configured.every(m => running.has(m.machineId));
}

async function ensureCamera() {
  const compose = path.join(root, 'docker', 'docker-compose.camera-pilot.yml');
  if (!fs.existsSync(compose)) return;
  const row = await prisma.globalSetting.findUnique({ where: { key: 'camera.configs' } });
  const cameras = typeof row?.value === 'string' ? JSON.parse(row.value) : row?.value;
  const camera = cameras?.find(c => c.id === 'cam-1775703291746' && c.enabled);
  if (!camera) return;
  const name = 'star-webcnc-camera-pilot-media-1';
  let exists = true;
  let running;
  try { running = await command('docker.exe', ['inspect', '--format', '{{.State.Running}}', name]); }
  catch { exists = false; }
  if (!exists) {
    const credentials = camera.username ? `${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password)}@` : '';
    const source = `rtsp://${credentials}${camera.ipAddress}:${camera.rtspPort}${camera.streamPath}`;
    await command('docker.exe', ['compose', '-p', 'star-webcnc-camera-pilot', '-f', compose, 'up', '-d'], {
      timeout: 120000, env: { ...process.env, CAMERA_PILOT_RTSP_URL: source },
    });
  } else if (running !== 'true') await command('docker.exe', ['start', name]);
}

async function cycle() {
  if (!await dockerReady()) return { stage: 'waiting', message: 'Docker 기동 대기 중' };
  await ensureContainers();
  const configured = await machines();
  if (!await listening(3000)) {
    launch('api', process.execPath, [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'], serverDir, {
      ...process.env, NODE_ENV: 'development', DATA_DIR: 'C:\\StarWebCNC-Data',
      PROGRAM_REPOSITORY_ROOT: 'C:\\StarWebCNC-Data\\program-repository',
    });
    return { stage: 'waiting', message: 'API 서버 기동 대기 중' };
  }
  const health = await json('http://127.0.0.1:3000/health');
  if (health.status !== 'ok' || !health.services?.mqtt || !health.services?.redis) {
    return { stage: 'waiting', message: 'MQTT·Redis 연결 대기 중' };
  }
  if (!await listening(5173)) {
    launch('web', process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], path.join(root, 'packages', 'web'));
  }
  const agentsReady = await ensureAgents(configured);
  await ensureCamera();
  if (!agentsReady || !await listening(5173)) return { stage: 'waiting', message: '웹앱·Agent 기동 대기 중' };
  return { stage: 'ready', message: '웹앱·API·Agent 기동 확인', agentCount: configured.length };
}

async function main() {
  if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
  fs.mkdirSync(runtime, { recursive: true });
  // Windows releases the named pipe even if the coordinator crashes.
  const lock = net.createServer();
  const suffix = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 10);
  await new Promise((resolve, reject) => {
    lock.once('error', reject);
    lock.listen(`\\\\.\\pipe\\star-webcnc-startup-${suffix}`, resolve);
  });
  try {
    let previous = '';
    while (fs.existsSync(enabledFile)) {
      let report;
      try { report = await cycle(); }
      catch (error) {
        const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'STARTUP_DEPENDENCY_UNAVAILABLE';
        report = { stage: 'waiting', message: '구성 요소 준비 대기 중', code };
      }
      const text = JSON.stringify(report);
      if (previous !== text) { log(text); previous = text; }
      fs.writeFileSync(reportFile, JSON.stringify({ ...report, checkedAt: new Date().toISOString() }));
      await sleep(15000);
    }
  } finally {
    lock.close();
    await prisma?.$disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    if (error.code === 'EADDRINUSE') return;
    fs.mkdirSync(runtime, { recursive: true });
    log('Startup coordinator stopped unexpectedly');
    process.exitCode = 1;
  });
}
