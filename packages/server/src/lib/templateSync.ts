// Template File ↔ DB Sync
// templates/{templateId}.json 파일을 DB와 양방향 동기화
//
// 서버 시작 시: 파일 → DB upsert (파일이 원본)
// 웹 저장 시:   DB → 파일 덮어쓰기 (양방향 유지)

import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from './prisma';
import { Prisma } from '@prisma/client';

const TEMPLATES_DIR = path.resolve(process.cwd(), '../../templates');

// 파일명으로 사용할 수 없는 문자 제거
function safeFilename(templateId: string): string {
  return templateId.replace(/[/\\:*?"<>|]/g, '_') + '.json';
}

// DB에 저장되는 필드만 포함 (id, createdAt, updatedAt 제외)
type TemplateFileData = {
  templateId: string;
  version: string;
  name: string;
  description: string;
  cncType: string;
  seriesName: string;
  systemInfo: unknown;
  axisConfig: unknown;
  pmcMap: unknown;
  interlockConfig: unknown;
  interlockModules: unknown;
  remoteControlInterlock: unknown;
  virtualPanel: unknown;
  panelLayout: unknown;
  topBarInterlock: unknown;
  offsetConfig: unknown;
  counterConfig: unknown;
  toolLifeConfig: unknown;
  schedulerConfig: unknown;
  capabilities: unknown;
};

/**
 * 서버 시작 시 호출
 * templates/ 폴더의 모든 JSON 파일을 읽어 DB에 upsert
 * 파일이 DB보다 우선 (파일이 원본)
 */
export async function syncTemplatesFromFiles(): Promise<void> {
  try {
    await fs.mkdir(TEMPLATES_DIR, { recursive: true });
    const files = await fs.readdir(TEMPLATES_DIR);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
      console.log('[TemplateSync] No template files found. Exporting from DB...');
      await exportAllTemplatesToFiles();
      return;
    }

    let synced = 0;
    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(TEMPLATES_DIR, file), 'utf-8');
        const data = JSON.parse(content) as TemplateFileData;

        if (!data.templateId) {
          console.warn(`[TemplateSync] Skipping ${file}: missing templateId`);
          continue;
        }

        await prisma.template.upsert({
          where: { templateId: data.templateId },
          update: {
            version:               data.version,
            name:                  data.name,
            description:           data.description ?? '',
            cncType:               data.cncType,
            seriesName:            data.seriesName,
            systemInfo:            (data.systemInfo ?? {}) as Prisma.InputJsonValue,
            axisConfig:            (data.axisConfig ?? {}) as Prisma.InputJsonValue,
            pmcMap:                (data.pmcMap ?? {}) as Prisma.InputJsonValue,
            interlockConfig:       (data.interlockConfig ?? {}) as Prisma.InputJsonValue,
            interlockModules:      (data.interlockModules ?? {}) as Prisma.InputJsonValue,
            remoteControlInterlock:(data.remoteControlInterlock ?? {}) as Prisma.InputJsonValue,
            virtualPanel:          (data.virtualPanel ?? {}) as Prisma.InputJsonValue,
            panelLayout:           (data.panelLayout ?? []) as Prisma.InputJsonValue,
            topBarInterlock:       (data.topBarInterlock ?? {}) as Prisma.InputJsonValue,
            offsetConfig:          (data.offsetConfig ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            counterConfig:         (data.counterConfig ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            toolLifeConfig:        (data.toolLifeConfig ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            schedulerConfig:       (data.schedulerConfig ?? {}) as Prisma.InputJsonValue,
            capabilities:          (data.capabilities ?? {}) as Prisma.InputJsonValue,
            isActive:              true,
          },
          create: {
            templateId:            data.templateId,
            version:               data.version || '1.0.0',
            name:                  data.name,
            description:           data.description ?? '',
            cncType:               data.cncType,
            seriesName:            data.seriesName,
            systemInfo:            (data.systemInfo ?? {}) as Prisma.InputJsonValue,
            axisConfig:            (data.axisConfig ?? {}) as Prisma.InputJsonValue,
            pmcMap:                (data.pmcMap ?? {}) as Prisma.InputJsonValue,
            interlockConfig:       (data.interlockConfig ?? {}) as Prisma.InputJsonValue,
            interlockModules:      (data.interlockModules ?? {}) as Prisma.InputJsonValue,
            remoteControlInterlock:(data.remoteControlInterlock ?? {}) as Prisma.InputJsonValue,
            virtualPanel:          (data.virtualPanel ?? {}) as Prisma.InputJsonValue,
            panelLayout:           (data.panelLayout ?? []) as Prisma.InputJsonValue,
            topBarInterlock:       (data.topBarInterlock ?? {}) as Prisma.InputJsonValue,
            offsetConfig:          (data.offsetConfig ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            counterConfig:         (data.counterConfig ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            toolLifeConfig:        (data.toolLifeConfig ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            schedulerConfig:       (data.schedulerConfig ?? {}) as Prisma.InputJsonValue,
            capabilities:          (data.capabilities ?? {}) as Prisma.InputJsonValue,
            isActive:              true,
            createdBy:             'file-sync',
          },
        });
        synced++;
        console.log(`[TemplateSync] Synced: ${data.templateId}`);
      } catch (err) {
        console.error(`[TemplateSync] Failed to sync ${file}:`, err);
      }
    }

    console.log(`[TemplateSync] ${synced}/${jsonFiles.length} templates synced from files`);
  } catch (err) {
    console.error('[TemplateSync] Sync failed:', err);
  }
}

/**
 * 템플릿 하나를 파일로 저장
 * DB 저장 후 호출하여 파일과 DB를 동기화
 */
export async function exportTemplateToFile(template: Record<string, unknown>): Promise<void> {
  try {
    const templateId = template.templateId as string;
    if (!templateId) return;

    await fs.mkdir(TEMPLATES_DIR, { recursive: true });

    const fileData: TemplateFileData = {
      templateId:             templateId,
      version:                template.version as string,
      name:                   template.name as string,
      description:            template.description as string,
      cncType:                template.cncType as string,
      seriesName:             template.seriesName as string,
      systemInfo:             template.systemInfo,
      axisConfig:             template.axisConfig,
      pmcMap:                 template.pmcMap,
      interlockConfig:        template.interlockConfig,
      interlockModules:       template.interlockModules,
      remoteControlInterlock: template.remoteControlInterlock,
      virtualPanel:           template.virtualPanel,
      panelLayout:            template.panelLayout,
      topBarInterlock:        template.topBarInterlock,
      offsetConfig:           template.offsetConfig,
      counterConfig:          template.counterConfig,
      toolLifeConfig:         template.toolLifeConfig,
      schedulerConfig:        template.schedulerConfig,
      capabilities:           template.capabilities,
    };

    const filePath = path.join(TEMPLATES_DIR, safeFilename(templateId));
    await fs.writeFile(filePath, JSON.stringify(fileData, null, 2), 'utf-8');
    console.log(`[TemplateSync] Exported to file: ${filePath}`);
  } catch (err) {
    console.error('[TemplateSync] Failed to export template to file:', err);
  }
}

/**
 * DB의 모든 활성 템플릿을 파일로 내보내기
 * templates/ 폴더가 비어있을 때 초기 파일 생성에 사용
 */
async function exportAllTemplatesToFiles(): Promise<void> {
  const templates = await prisma.template.findMany({ where: { isActive: true } });
  for (const t of templates) {
    await exportTemplateToFile(t as unknown as Record<string, unknown>);
  }
  console.log(`[TemplateSync] Exported ${templates.length} templates to files`);
}
