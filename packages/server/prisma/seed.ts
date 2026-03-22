// Database Seed Script
// Creates initial users, templates, and 1 machine for production use

import { PrismaClient, UserRole } from '@prisma/client';
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
      role: UserRole.HQ_ENGINEER,
      isActive: true,
      isApproved: true,
    },
  });
  console.log(`✅ HQ_ENGINEER user: ${asUser.username}`);

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
  const templateData = {
      templateId: 'FANUC_0i-TF Plus_SB-20R2_V1',
      version: '1.0.0',
      name: 'Star SB-20R2 (FANUC 0i-TF Plus)',
      description: 'Star SB-20R2 2계통 자동선반, FANUC 0i-TF Plus 컨트롤러',
      cncType: 'FANUC',
      seriesName: '0i-TF Plus',
      createdBy: 'as_manager',

      systemInfo: {
        cncType: 'FANUC',
        seriesName: '0i-TF Plus',
        modelName: 'SB-20R2',
        maxPaths: 2,
        maxAxes: 5,
        supportedOptions: [],
        coordinateDecimalPlaces: 4,
      },

      axisConfig: {
        path1: { axes: ['X', 'Z', 'C', 'Y', 'A', 'CRG'], spindleName: 'S1', toolPrefix: 'T0100 ~ T3523' },
        path2: { axes: ['X', 'Z', 'C', 'A'], spindleName: 'S2', toolPrefix: 'T2000 ~ T2900' },
        path3: { axes: null, spindleName: null, toolPrefix: null },
      },

      pmcMap: {
        interlock: {
          doorClosed:     { type: 'R', address: 6001, bit: 3, dataType: 'bit' },
          chuckClamped:   { type: 'R', address: 6000, bit: 2, dataType: 'bit' },
          spindleStopped: null,
          coolantLevel:   { type: 'R', address: 6001, bit: 6, dataType: 'bit' },
        },
        status: {
          operationMode:    null,
          cycleRunning:     { type: 'R', address: 6003, bit: 0, dataType: 'bit' },
          subCycleRunning:  { type: 'R', address: 6003, bit: 1, dataType: 'bit' },
          alarmActive:      null,
          emergencyStop:    { type: 'R', address: 6001, bit: 2, dataType: 'bit' },
          programEnd:       { type: 'R', address: 6002, bit: 4, dataType: 'bit' },
          subProgramEnd:    { type: 'R', address: 6002, bit: 5, dataType: 'bit' },
          machineReady:     { type: 'R', address: 6001, bit: 1, dataType: 'bit' },
        },
        control: {
          cycleStart:  { type: 'R', address: 6105, bit: 4, dataType: 'bit' },
          feedHold:    { type: 'R', address: 6105, bit: 3, dataType: 'bit' },
          singleBlock: { type: 'R', address: 6106, bit: 1, dataType: 'bit' },
          reset:       { type: 'R', address: 6103, bit: 0, dataType: 'bit' },
        },
        counters: { partCount: null, targetCount: null, cycleTime: null },
        scheduler: {
          loadable:    null,
          dataReady:   null,
          m20Complete: { type: 'R', address: 6002, bit: 4, dataType: 'bit' },
        },
      },

      interlockConfig: {
        enabled: true,
        controlAllowed: {
          conditions: [{ id: 'doorClosed', name: '안전 도어 닫힘', pmcKey: 'interlock.doorClosed', expected: true, required: true, description: '안전 도어가 닫혀 있어야 원격 제어 가능' }],
        },
        scheduleAllowed: {
          conditions: [{ id: 'doorClosed', name: '안전 도어 닫힘', pmcKey: 'interlock.doorClosed', expected: true, required: true, description: '안전 도어가 닫혀 있어야 스케줄러 실행 가능' }],
        },
      },

      interlockModules: {
        remotePanel: { enabled: true, conditions: [
          { id: 'rp-door',  name: '안전 도어 닫힘', pmcAddr: 'R6001.3', expected: true,  description: '안전 도어가 닫혀 있어야 원격 조작 가능' },
          { id: 'rp-estop', name: '비상정지 해제',  pmcAddr: 'R6001.2', expected: false, description: '비상정지 해제 상태여야 함' },
        ]},
        scheduler: { enabled: true, conditions: [
          { id: 'sc-door', name: '안전 도어 닫힘', pmcAddr: 'R6001.3', expected: true, description: '안전 도어가 닫혀 있어야 스케줄 실행 가능' },
        ]},
        fileTransferIn:  { enabled: false, conditions: [] },
        fileTransferOut: { enabled: false, conditions: [] },
      },

      remoteControlInterlock: {
        remoteEnabled:     null,
        localOperationOff: null,
        emergencyStopOff:  { type: 'R', address: 6001, bit: 2, dataType: 'bit' },
      },

      virtualPanel: {
        modeKeys: {
          edit:   { keyId: 'edit',   displayName: 'EDIT',        keyType: 'selector', pmcOutput: { type: 'R', address: 6104, bit: 4, dataType: 'bit' }, pmcFeedback: { type: 'R', address: 6004, bit: 4, dataType: 'bit' }, requiresInterlock: true, safetyLevel: 'normal' },
          memory: { keyId: 'memory', displayName: 'MEMORY',      keyType: 'selector', pmcOutput: { type: 'R', address: 6104, bit: 5, dataType: 'bit' }, pmcFeedback: { type: 'R', address: 6004, bit: 5, dataType: 'bit' }, requiresInterlock: true, safetyLevel: 'normal' },
          mdi:    { keyId: 'mdi',    displayName: 'MDI',         keyType: 'selector', pmcOutput: { type: 'R', address: 6104, bit: 6, dataType: 'bit' }, pmcFeedback: { type: 'R', address: 6004, bit: 6, dataType: 'bit' }, requiresInterlock: true, safetyLevel: 'normal' },
          jog:    null,
          ref:    { keyId: 'ref',    displayName: 'ZERO RETURN', keyType: 'selector', pmcOutput: { type: 'R', address: 6105, bit: 2, dataType: 'bit' }, pmcFeedback: { type: 'R', address: 6005, bit: 2, dataType: 'bit' }, requiresInterlock: true, safetyLevel: 'normal' },
          handle: { keyId: 'handle', displayName: 'HANDLE',      keyType: 'selector', pmcOutput: { type: 'R', address: 6105, bit: 0, dataType: 'bit' }, pmcFeedback: { type: 'R', address: 6005, bit: 0, dataType: 'bit' }, requiresInterlock: true, safetyLevel: 'normal' },
          dnc:    { keyId: 'dnc',    displayName: 'DNC',         keyType: 'selector', pmcOutput: { type: 'R', address: 6105, bit: 1, dataType: 'bit' }, pmcFeedback: { type: 'R', address: 6005, bit: 1, dataType: 'bit' }, requiresInterlock: true, safetyLevel: 'normal' },
        },
        controlKeys: {
          cycleStart: { keyId: 'cycleStart', displayName: 'CYCLE START', keyType: 'momentary', pmcOutput: { type: 'R', address: 6105, bit: 4, dataType: 'bit' }, pmcFeedback: { type: 'R', address: 6005, bit: 4, dataType: 'bit' }, requiresInterlock: true, safetyLevel: 'critical' },
          feedHold:   { keyId: 'feedHold',   displayName: 'FEED HOLD',   keyType: 'momentary', pmcOutput: { type: 'R', address: 6105, bit: 3, dataType: 'bit' }, pmcFeedback: { type: 'R', address: 6005, bit: 3, dataType: 'bit' }, requiresInterlock: true, safetyLevel: 'caution' },
          reset:      { keyId: 'reset',      displayName: 'RESET',       keyType: 'momentary', pmcOutput: { type: 'R', address: 6103, bit: 0, dataType: 'bit' }, pmcFeedback: null, requiresInterlock: true, safetyLevel: 'caution' },
          alarmClear: null,
        },
        toggleKeys: {
          singleBlock:  { keyId: 'singleBlock',  displayName: 'SINGLE BLOCK',   keyType: 'toggle', pmcOutput: { type: 'R', address: 6106, bit: 1, dataType: 'bit' }, pmcFeedback: { type: 'R', address: 6006, bit: 1, dataType: 'bit' }, requiresInterlock: true, safetyLevel: 'caution' },
          dryRun:       null,
          optionalStop: { keyId: 'optionalStop', displayName: 'OPTIONAL STOP',  keyType: 'toggle', pmcOutput: { type: 'R', address: 6105, bit: 7, dataType: 'bit' }, pmcFeedback: { type: 'R', address: 6005, bit: 7, dataType: 'bit' }, requiresInterlock: true, safetyLevel: 'normal' },
          blockSkip:    null,
        },
        overrides: { feedRate: null, spindleRate: null },
      },

      schedulerConfig: {
        maxQueueSize: 15,
        countSignal: 'scheduler.m20Complete',
        countMode: 'M20_EDGE',
        oneCycleStopSupported: true,
        oneCycleStopPmcAddress: { type: 'R', address: 6106, bit: 0, dataType: 'bit' },
        countDisplay: { macroNo: 500 },
        subM20Signal: { type: 'R', address: 6002, bit: 5, dataType: 'bit' },
      },

      capabilities: {
        monitoring: true, scheduler: true, fileTransfer: true, alarmHistory: true,
        remoteControl: true, hasSubSpindle: true, hasCAxis: true, hasYAxis: true,
      },

      panelLayout: [
        { id: 'grp-head', name: 'HEAD', keys: [
          { id: 'HEAD1',       label: 'HEAD 1',      hasLamp: true,  color: 'gray', size: 'normal', reqAddr: 'R6104.0', lampAddr: 'R6004.0', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
          { id: 'HEAD2',       label: 'HEAD 2',      hasLamp: true,  color: 'gray', size: 'normal', reqAddr: 'R6104.1', lampAddr: 'R6004.1', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
          { id: 'HEAD_CHANGE', label: 'HEAD CHANGE', hasLamp: false, color: 'gray', size: 'normal', reqAddr: 'R6103.7', lampAddr: '',        timing: { longPressMs: 1500, holdMs: 300, timeoutMs: 2000 } },
        ]},
        { id: 'grp-chuck', name: 'CHUCKING', sameRowAsPrev: true, keys: [
          { id: 'MAIN_CHUCK', label: 'MAIN CHUCKING', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6100.1', lampAddr: 'R6000.1', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
          { id: 'SUB_CHUCK',  label: 'SUB CHUCKING',  hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6100.3', lampAddr: 'R6000.3', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
        ]},
        { id: 'grp-mode', name: 'MODE', keys: [
          { id: 'EDIT',   label: 'EDIT',   hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6104.4', lampAddr: 'R6004.4', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
          { id: 'MEMORY', label: 'MEMORY', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6104.5', lampAddr: 'R6004.5', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
          { id: 'MDI',    label: 'MDI',    hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6104.6', lampAddr: 'R6004.6', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
          { id: 'HANDLE', label: 'HANDLE', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6105.0', lampAddr: 'R6005.0', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
          { id: 'DNC',    label: 'DNC',    hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6105.1', lampAddr: 'R6005.1', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
        ]},
        { id: 'grp-op', name: 'OPERATION', keys: [
          { id: 'SINGLE_BLOCK', label: 'SINGLE BLOCK',   hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6106.1', lampAddr: 'R6006.1', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
          { id: 'OPT_STOP',     label: 'OPTIONAL STOP',  hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6105.7', lampAddr: 'R6005.7', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
          { id: 'ONE_CYCLE',    label: 'ONE CYCLE',      hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6106.0', lampAddr: 'R6006.0', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
          { id: 'AIR_CUT',      label: 'AIR CUT',        hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6105.6', lampAddr: 'R6005.6', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
          { id: 'AUTO_PWR_OFF', label: 'AUTO POWER OFF', hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6105.5', lampAddr: 'R6005.5', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
          { id: 'WORK_LIGHT',   label: 'WORK LIGHT',     hasLamp: true, color: 'gray', size: 'normal', reqAddr: 'R6106.2', lampAddr: 'R6006.2', timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 } },
        ]},
        { id: 'grp-cycle', name: 'CYCLE', keys: [
          { id: 'CYCLE_START', label: 'CYCLE START',    hasLamp: true,  color: 'green',  size: 'large', reqAddr: 'R6105.4', lampAddr: 'R6005.4', timing: { longPressMs: 2000, holdMs: 500,  timeoutMs: 3000 } },
          { id: 'FEED_HOLD',   label: 'FEED HOLD',      hasLamp: true,  color: 'yellow', size: 'large', reqAddr: 'R6105.3', lampAddr: 'R6005.3', timing: { longPressMs: 1000, holdMs: 300,  timeoutMs: 2000 } },
          { id: 'E_STOP',      label: 'EMERGENCY STOP', hasLamp: false, color: 'red',    size: 'large', reqAddr: '',        lampAddr: '',        timing: { longPressMs: 3000, holdMs: 1000, timeoutMs: 5000 } },
          { id: 'RESET',       label: 'RESET',          hasLamp: false, color: 'gray',   size: 'large', reqAddr: 'R6103.0', lampAddr: '',        timing: { longPressMs: 1500, holdMs: 500,  timeoutMs: 3000 } },
        ]},
      ],

      topBarInterlock: {
        remote: {
          interlockEnabled: true,
          fields: [
            { id: 'rc-door',  label: '도어 닫힘',   pmcAddr: 'R6001.3', contact: 'A', enabled: true },
            { id: 'rc-estop', label: '비상정지 해제', pmcAddr: 'R6001.2', contact: 'B', enabled: true },
          ],
        },
        scheduler: {
          interlockEnabled: true,
          fields: [
            { id: 'sc-door',  label: '도어 닫힘',   pmcAddr: 'R6001.3', contact: 'A', enabled: true },
            { id: 'sc-estop', label: '비상정지 해제', pmcAddr: 'R6001.2', contact: 'B', enabled: true },
          ],
        },
        transfer: { interlockEnabled: false, fields: [] },
        backup:   { interlockEnabled: false, fields: [] },
      },

      offsetConfig: { toolCount: 64, pageSize: 16 },

      counterConfig: {
        fields: [
          { key: 'preset',    label: 'PRESET',    varType: 'macro', varNo: 500, readonly: false },
          { key: 'count',     label: 'COUNT',     varType: 'macro', varNo: 501, readonly: false },
          { key: 'total',     label: 'TOTAL',     varType: 'macro', varNo: 502, readonly: true  },
          { key: 'remaining', label: 'REMAINING', varType: 'macro', varNo: 503, readonly: true  },
        ],
      },

      pmcMessages: [
        { id: 'pmc-msg-1', pmcAddr: 'A209.5', message: 'Are you sure of AIR-CUT mode?' },
        { id: 'pmc-msg-2', pmcAddr: 'A209.6', message: 'Are you sure of ONLY SUB mode?' },
      ],

      toolLifeConfig: {
        paths: [
          {
            pathNo: 1,
            columns: [
              { key: 'preset', label: 'PRESET', varType: 'macro', readonly: false },
              { key: 'count',  label: 'COUNT',  varType: 'macro', readonly: true  },
            ],
            entries: [
              { id: 'p1-t1', toolNo: 'T0101', isSeparator: false, varNos: { preset: 3001, count: 3002 } },
              { id: 'p1-t2', toolNo: 'T0202', isSeparator: false, varNos: { preset: 3003, count: 3004 } },
              { id: 'p1-t3', toolNo: 'T0303', isSeparator: false, varNos: { preset: 3005, count: 3006 } },
              { id: 'p1-t4', toolNo: 'T0404', isSeparator: false, varNos: { preset: 3007, count: 3008 } },
              { id: 'p1-t5', toolNo: 'T0505', isSeparator: false, varNos: { preset: 3009, count: 3010 } },
              { id: 'p1-t6', toolNo: 'T0606', isSeparator: false, varNos: { preset: 3011, count: 3012 } },
              { id: 'p1-t7', toolNo: 'T0707', isSeparator: false, varNos: { preset: 3013, count: 3014 } },
              { id: 'p1-t8', toolNo: 'T0808', isSeparator: false, varNos: { preset: 3015, count: 3016 } },
              { id: 'p1-t9', toolNo: 'T0909', isSeparator: false, varNos: { preset: 3017, count: 3018 } },
            ],
          },
          {
            pathNo: 2,
            columns: [
              { key: 'preset', label: 'PRESET', varType: 'macro', readonly: false },
              { key: 'count',  label: 'COUNT',  varType: 'macro', readonly: true  },
            ],
            entries: [
              { id: 'p2-t1', toolNo: 'T3101', isSeparator: false, varNos: { preset: 3101, count: 3102 } },
              { id: 'p2-t2', toolNo: 'T3202', isSeparator: false, varNos: { preset: 3103, count: 3104 } },
            ],
          },
        ],
      },
  };

  const template = await prisma.template.upsert({
    where: { templateId: 'FANUC_0i-TF Plus_SB-20R2_V1' },
    update: {},          // 이미 존재하면 건드리지 않음 — UI 편집 내용 보존
    create: templateData,
  });
  console.log(`✅ Template: ${template.templateId}`);

  // ============================================
  // Machine (1대 - 실장비 연동용)
  // ============================================
  const machine = await prisma.machine.upsert({
    where: { machineId: 'MC-001' },
    update: {},
    create: {
      machineId: 'MC-001',
      name: '1호기 자동선반',
      templateId: template.id,
      ipAddress: '192.168.1.101',   // ← 실장비 IP로 변경 필요
      port: 8193,
      timeout: 3000,
      retryCount: 3,
      isActive: true,
      schedulerMode: 'MANUAL',
      maxQueueSize: 15,
      inputFolder: '',
      outputFolder: '',
      backupFolder: '',
    },
  });
  console.log(`✅ Machine: ${machine.machineId} (${machine.name})`);

  // ============================================
  // Global Settings
  // ============================================
  const settings = [
    { key: 'system.version', value: '"1.0.0"' },
    { key: 'scheduler.defaultQueueSize', value: '15' },
    { key: 'control.lockTimeout', value: '300' },
    { key: 'control.heartbeatInterval', value: '30' },
    { key: 'registration.adminCode', value: 'ADMIN-0000' },
    { key: 'registration.operatorCode', value: 'OP-0000' },
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
  console.log('\n📋 Credentials:');
  console.log('   Admin:    admin / admin123!');
  console.log('   HQ_ENG:   as_manager / as123!');
  console.log('   Operator: operator / user123!');
  console.log('\n📊 Created Data:');
  console.log(`   - Users: 3`);
  console.log(`   - Templates: 1 (SB-20R2)`);
  console.log(`   - Machines: 1 (MC-001 — 실장비 IP 변경 필요)`);
  console.log('\n⚠️  실장비 IP: packages/server/prisma/seed.ts 에서 192.168.1.101 을 실제 IP로 변경 후 re-seed 하세요');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
