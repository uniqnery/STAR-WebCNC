// Database Seed Script
// Creates initial admin user and sample data

import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...\n');

  // Create admin user
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
  console.log(`✅ Admin user created: ${admin.username} (${admin.email})`);

  // Create AS user
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
  console.log(`✅ AS user created: ${asUser.username} (${asUser.email})`);

  // Create sample template
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
        // PMC 어드레스 매핑
        operation: {
          running: { type: 'R', address: 0, bit: 0 },
          alarm: { type: 'R', address: 0, bit: 1 },
          emergency: { type: 'R', address: 0, bit: 2 },
        },
        scheduler: {
          loadable: { type: 'R', address: 100, bit: 0 },
          dataReady: { type: 'R', address: 100, bit: 1 },
        },
        signals: {
          m20Complete: { type: 'R', address: 200, bit: 0 },
        },
      },
      interlockConfig: {
        // 인터락 조건
        controlAllowed: {
          conditions: [
            { signal: 'operation.running', expected: false },
            { signal: 'operation.alarm', expected: false },
            { signal: 'operation.emergency', expected: false },
          ],
        },
        scheduleAllowed: {
          conditions: [
            { signal: 'scheduler.loadable', expected: true },
          ],
        },
      },
      schedulerConfig: {
        // 스케줄러 설정
        maxQueueSize: 15,
        countSignal: 'signals.m20Complete',
        countMode: 'M20_EDGE',
      },
      capabilities: {
        // 지원 기능
        monitoring: true,
        scheduler: true,
        fileTransfer: true,
        alarmHistory: true,
      },
    },
  });
  console.log(`✅ Template created: ${template.templateId} (${template.name})`);

  // Create sample machine
  const machine = await prisma.machine.upsert({
    where: { machineId: 'MC-001' },
    update: {},
    create: {
      machineId: 'MC-001',
      name: '1호기 자동선반',
      templateId: template.id,
      ipAddress: '192.168.1.101',
      port: 8193,
      timeout: 3000,
      retryCount: 3,
      isActive: true,
      schedulerMode: 'MANUAL',
      maxQueueSize: 15,
      inputFolder: '//192.168.1.101/cnc/input',
      outputFolder: '//192.168.1.101/cnc/output',
      backupFolder: '//192.168.1.101/cnc/backup',
    },
  });
  console.log(`✅ Machine created: ${machine.machineId} (${machine.name})`);

  // Create global settings
  await prisma.globalSetting.upsert({
    where: { key: 'system.version' },
    update: { value: '"0.1.0"' },
    create: {
      key: 'system.version',
      value: '"0.1.0"',
    },
  });

  await prisma.globalSetting.upsert({
    where: { key: 'scheduler.defaultQueueSize' },
    update: { value: '15' },
    create: {
      key: 'scheduler.defaultQueueSize',
      value: '15',
    },
  });

  console.log(`✅ Global settings created`);

  console.log('\n🎉 Seeding completed!');
  console.log('\n📋 Default Credentials:');
  console.log('   Admin: admin / admin123!');
  console.log('   AS:    as_manager / as123!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
