// Database Seed Script
// Creates initial users, templates, machines, and sample data for UI testing

import { PrismaClient, UserRole, SchedulerJobStatus, WorkOrderStatus, AlarmType } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // ============================================
  // Users
  // ============================================
  const adminPassword = await bcrypt.hash('admin123!', 12);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@star-webcnc.local',
      passwordHash: adminPassword,
      role: UserRole.ADMIN,
      isActive: true,
      isApproved: true,
    },
  });
  console.log(`✅ Admin user: ${admin.username}`);

  const asPassword = await bcrypt.hash('as123!', 12);
  const asUser = await prisma.user.upsert({
    where: { username: 'as_manager' },
    update: {},
    create: {
      username: 'as_manager',
      email: 'as@star-webcnc.local',
      passwordHash: asPassword,
      role: UserRole.AS,
      isActive: true,
      isApproved: true,
    },
  });
  console.log(`✅ AS user: ${asUser.username}`);

  const userPassword = await bcrypt.hash('user123!', 12);
  const normalUser = await prisma.user.upsert({
    where: { username: 'operator' },
    update: {},
    create: {
      username: 'operator',
      email: 'operator@star-webcnc.local',
      passwordHash: userPassword,
      role: UserRole.USER,
      isActive: true,
      isApproved: true,
    },
  });
  console.log(`✅ Normal user: ${normalUser.username}`);

  // ============================================
  // Template
  // ============================================
  const template = await prisma.template.upsert({
    where: { templateId: 'FANUC_0iTF_v1' },
    update: {},
    create: {
      templateId: 'FANUC_0iTF_v1',
      version: '1.0.0',
      name: 'FANUC 0i-TF 자동선반 기본 템플릿',
      description: 'Star 자동선반 FANUC 0i-TF 컨트롤러용 기본 템플릿',
      cncType: 'FANUC',
      seriesName: '0i-TF',
      pmcMap: {
        operation: {
          running: { type: 'G', address: 7, bit: 3, desc: '운전 중' },
          alarm: { type: 'G', address: 8, bit: 0, desc: '알람 발생' },
          emergency: { type: 'X', address: 8, bit: 4, desc: '비상정지' },
        },
        mode: {
          auto: { type: 'G', address: 43, bit: 1, desc: '자동 모드' },
          mdi: { type: 'G', address: 43, bit: 2, desc: 'MDI 모드' },
          edit: { type: 'G', address: 43, bit: 3, desc: '편집 모드' },
        },
        scheduler: {
          loadable: { type: 'R', address: 500, bit: 0, desc: '프로그램 로드 가능' },
          dataReady: { type: 'R', address: 500, bit: 1, desc: '데이터 준비 완료' },
        },
        signals: {
          m20Complete: { type: 'F', address: 64, bit: 4, desc: 'M20 완료 신호' },
          cycleStart: { type: 'G', address: 7, bit: 2, desc: '사이클 스타트' },
        },
      },
      interlockConfig: {
        controlAllowed: {
          conditions: [
            { signal: 'operation.running', expected: false, desc: '운전 중 아님' },
            { signal: 'operation.alarm', expected: false, desc: '알람 없음' },
            { signal: 'operation.emergency', expected: false, desc: '비상정지 아님' },
          ],
        },
        scheduleAllowed: {
          conditions: [
            { signal: 'scheduler.loadable', expected: true, desc: '프로그램 로드 가능' },
            { signal: 'mode.auto', expected: true, desc: '자동 모드' },
          ],
        },
      },
      schedulerConfig: {
        maxQueueSize: 15,
        countSignal: 'signals.m20Complete',
        countMode: 'M20_RISING_EDGE',
        autoStartNext: true,
      },
      capabilities: {
        monitoring: true,
        scheduler: true,
        fileTransfer: true,
        alarmHistory: true,
        parameterBackup: true,
      },
    },
  });
  console.log(`✅ Template: ${template.templateId}`);

  // ============================================
  // Machines (4대)
  // ============================================
  const machines = [
    { machineId: 'MC-001', name: '1호기 자동선반', ip: '192.168.1.101' },
    { machineId: 'MC-002', name: '2호기 자동선반', ip: '192.168.1.102' },
    { machineId: 'MC-003', name: '3호기 자동선반', ip: '192.168.1.103' },
    { machineId: 'MC-004', name: '4호기 자동선반', ip: '192.168.1.104' },
  ];

  const createdMachines = [];
  for (const m of machines) {
    const machine = await prisma.machine.upsert({
      where: { machineId: m.machineId },
      update: {},
      create: {
        machineId: m.machineId,
        name: m.name,
        templateId: template.id,
        ipAddress: m.ip,
        port: 8193,
        timeout: 3000,
        retryCount: 3,
        isActive: true,
        schedulerMode: 'MANUAL',
        maxQueueSize: 15,
        inputFolder: `//${m.ip}/cnc/input`,
        outputFolder: `//${m.ip}/cnc/output`,
        backupFolder: `//${m.ip}/cnc/backup`,
      },
    });
    createdMachines.push(machine);
    console.log(`✅ Machine: ${machine.machineId} (${machine.name})`);
  }

  // ============================================
  // Sample Alarms
  // ============================================
  const now = new Date();
  const alarmsData = [
    { machineIdx: 0, alarmNo: 1001, msg: 'SERVO ALARM: OVERLOAD', type: AlarmType.ALARM, hoursAgo: 2 },
    { machineIdx: 0, alarmNo: 2010, msg: 'SPINDLE ALARM: OVERHEAT', type: AlarmType.WARNING, hoursAgo: 5, cleared: true },
    { machineIdx: 1, alarmNo: 3001, msg: 'PMC ALARM: CHUCK ERROR', type: AlarmType.ALARM, hoursAgo: 1 },
    { machineIdx: 2, alarmNo: 1005, msg: 'SERVO ALARM: POSITION ERROR', type: AlarmType.CRITICAL, hoursAgo: 0.5 },
    { machineIdx: 3, alarmNo: 2001, msg: 'SPINDLE ALARM: SPEED DEVIATION', type: AlarmType.WARNING, hoursAgo: 8, cleared: true },
  ];

  for (const a of alarmsData) {
    const occurredAt = new Date(now.getTime() - a.hoursAgo * 60 * 60 * 1000);
    await prisma.alarm.create({
      data: {
        machineDbId: createdMachines[a.machineIdx].id,
        alarmNo: a.alarmNo,
        alarmMsg: a.msg,
        alarmType: a.type,
        category: a.msg.split(':')[0].toLowerCase().replace(' alarm', ''),
        occurredAt,
        clearedAt: a.cleared ? new Date(occurredAt.getTime() + 30 * 60 * 1000) : null,
        duration: a.cleared ? 30 * 60 : null,
      },
    });
  }
  console.log(`✅ Sample alarms created: ${alarmsData.length}`);

  // ============================================
  // Work Orders
  // ============================================
  const workOrdersData = [
    { orderNo: 'WO-2026-001', product: 'SHAFT-A100', name: '샤프트 A100', qty: 500, status: WorkOrderStatus.COMPLETED, machine: 0, produced: 500 },
    { orderNo: 'WO-2026-002', product: 'GEAR-B200', name: '기어 B200', qty: 300, status: WorkOrderStatus.IN_PROGRESS, machine: 1, produced: 187 },
    { orderNo: 'WO-2026-003', product: 'BOLT-C300', name: '볼트 C300', qty: 1000, status: WorkOrderStatus.IN_PROGRESS, machine: 2, produced: 423 },
    { orderNo: 'WO-2026-004', product: 'NUT-D400', name: '너트 D400', qty: 800, status: WorkOrderStatus.PENDING, machine: 3, produced: 0 },
    { orderNo: 'WO-2026-005', product: 'PIN-E500', name: '핀 E500', qty: 200, status: WorkOrderStatus.PENDING, machine: null, produced: 0 },
  ];

  for (const wo of workOrdersData) {
    await prisma.workOrder.upsert({
      where: { orderNumber: wo.orderNo },
      update: {},
      create: {
        orderNumber: wo.orderNo,
        productCode: wo.product,
        productName: wo.name,
        targetQuantity: wo.qty,
        producedQty: wo.produced,
        status: wo.status,
        assignedMachine: wo.machine !== null ? createdMachines[wo.machine].machineId : null,
        programNumber: wo.machine !== null ? `O${1000 + wo.machine}` : null,
        priority: workOrdersData.indexOf(wo),
        scheduledStart: wo.status !== WorkOrderStatus.PENDING ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : null,
        actualStart: wo.status === WorkOrderStatus.IN_PROGRESS || wo.status === WorkOrderStatus.COMPLETED
          ? new Date(now.getTime() - 20 * 60 * 60 * 1000) : null,
        actualEnd: wo.status === WorkOrderStatus.COMPLETED ? new Date(now.getTime() - 4 * 60 * 60 * 1000) : null,
      },
    });
  }
  console.log(`✅ Work orders created: ${workOrdersData.length}`);

  // ============================================
  // Scheduler Jobs
  // ============================================
  const schedulerJobsData = [
    { machineIdx: 0, programNo: 'O1001', target: 100, completed: 100, status: SchedulerJobStatus.COMPLETED },
    { machineIdx: 1, programNo: 'O1002', target: 150, completed: 87, status: SchedulerJobStatus.RUNNING },
    { machineIdx: 2, programNo: 'O1003', target: 200, completed: 45, status: SchedulerJobStatus.PAUSED },
    { machineIdx: 3, programNo: 'O1004', target: 80, completed: 0, status: SchedulerJobStatus.PENDING },
  ];

  for (const job of schedulerJobsData) {
    await prisma.schedulerJob.create({
      data: {
        machineDbId: createdMachines[job.machineIdx].id,
        programNo: job.programNo,
        targetCount: job.target,
        completedCount: job.completed,
        status: job.status,
        oneCycleStop: false,
        createdById: admin.id,
        startedAt: job.status !== SchedulerJobStatus.PENDING ? new Date(now.getTime() - 5 * 60 * 60 * 1000) : null,
        completedAt: job.status === SchedulerJobStatus.COMPLETED ? new Date(now.getTime() - 1 * 60 * 60 * 1000) : null,
      },
    });
  }
  console.log(`✅ Scheduler jobs created: ${schedulerJobsData.length}`);

  // ============================================
  // Production Logs
  // ============================================
  for (let i = 0; i < 50; i++) {
    const machineIdx = i % 4;
    const hoursAgo = Math.floor(i / 4) + 1;
    const startTime = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
    const cycleTime = 30 + Math.floor(Math.random() * 30); // 30-60 seconds

    await prisma.productionLog.create({
      data: {
        machineId: createdMachines[machineIdx].id,
        programNo: `O${1000 + machineIdx}`,
        startTime,
        endTime: new Date(startTime.getTime() + cycleTime * 1000),
        cycleTime,
        partsCount: 1,
        status: Math.random() > 0.05 ? 'completed' : 'error',
        errorCode: Math.random() > 0.95 ? '1001' : null,
      },
    });
  }
  console.log(`✅ Production logs created: 50`);

  // ============================================
  // Audit Logs
  // ============================================
  const auditActions = [
    { action: 'auth.login', target: 'user' },
    { action: 'scheduler.start', target: 'machine' },
    { action: 'scheduler.pause', target: 'machine' },
    { action: 'control.acquire', target: 'machine' },
    { action: 'control.release', target: 'machine' },
    { action: 'workOrder.create', target: 'workOrder' },
    { action: 'transfer.upload', target: 'machine' },
  ];

  for (let i = 0; i < 30; i++) {
    const auditData = auditActions[i % auditActions.length];
    const hoursAgo = i * 2;

    await prisma.auditLog.create({
      data: {
        userId: i % 3 === 0 ? admin.id : (i % 3 === 1 ? asUser.id : normalUser.id),
        userRole: i % 3 === 0 ? 'ADMIN' : (i % 3 === 1 ? 'AS' : 'USER'),
        action: auditData.action,
        targetType: auditData.target,
        targetId: auditData.target === 'machine' ? createdMachines[i % 4].machineId : null,
        params: {},
        result: Math.random() > 0.1 ? 'success' : 'failure',
        ipAddress: '192.168.1.' + (10 + (i % 10)),
        createdAt: new Date(now.getTime() - hoursAgo * 60 * 60 * 1000),
      },
    });
  }
  console.log(`✅ Audit logs created: 30`);

  // ============================================
  // Global Settings
  // ============================================
  const settings = [
    { key: 'system.version', value: '"1.0.0"' },
    { key: 'scheduler.defaultQueueSize', value: '15' },
    { key: 'control.lockTimeout', value: '300' },
    { key: 'control.heartbeatInterval', value: '30' },
  ];

  for (const s of settings) {
    await prisma.globalSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: { key: s.key, value: s.value },
    });
  }
  console.log(`✅ Global settings created`);

  // ============================================
  // Summary
  // ============================================
  console.log('\n' + '='.repeat(50));
  console.log('🎉 Seeding completed!');
  console.log('='.repeat(50));
  console.log('\n📋 Test Credentials:');
  console.log('   Admin:    admin / admin123!');
  console.log('   AS:       as_manager / as123!');
  console.log('   Operator: operator / user123!');
  console.log('\n📊 Created Data:');
  console.log(`   - Users: 3`);
  console.log(`   - Templates: 1`);
  console.log(`   - Machines: 4`);
  console.log(`   - Alarms: ${alarmsData.length}`);
  console.log(`   - Work Orders: ${workOrdersData.length}`);
  console.log(`   - Scheduler Jobs: ${schedulerJobsData.length}`);
  console.log(`   - Production Logs: 50`);
  console.log(`   - Audit Logs: 30`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
