// Request Validators using Zod

import { z } from 'zod';

// Auth validators
export const loginSchema = z.object({
  username: z.string()
    .min(3, '사용자명은 최소 3자 이상이어야 합니다.')
    .max(50, '사용자명은 최대 50자까지 가능합니다.'),
  password: z.string()
    .min(6, '비밀번호는 최소 6자 이상이어야 합니다.')
    .max(100, '비밀번호는 최대 100자까지 가능합니다.'),
});

export const registerSchema = z.object({
  username: z.string()
    .min(3, '사용자명은 최소 3자 이상이어야 합니다.')
    .max(50, '사용자명은 최대 50자까지 가능합니다.')
    .regex(/^[a-zA-Z0-9_]+$/, '사용자명은 영문, 숫자, 밑줄만 사용할 수 있습니다.'),
  email: z.string()
    .email('올바른 이메일 형식이 아닙니다.'),
  password: z.string()
    .min(8, '비밀번호는 최소 8자 이상이어야 합니다.')
    .max(100, '비밀번호는 최대 100자까지 가능합니다.')
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
      '비밀번호는 대소문자, 숫자, 특수문자를 포함해야 합니다.'
    ),
});

// Machine validators
export const machineIdSchema = z.string().uuid('유효하지 않은 장비 ID입니다.');

export const machineCreateSchema = z.object({
  machineId: z.string()
    .min(1, '장비 식별자는 필수입니다.')
    .max(20, '장비 식별자는 최대 20자까지 가능합니다.'),
  name: z.string()
    .min(1, '장비명은 필수입니다.')
    .max(100, '장비명은 최대 100자까지 가능합니다.'),
  templateId: z.string().uuid('유효하지 않은 템플릿 ID입니다.'),
  ipAddress: z.string()
    .ip({ version: 'v4', message: '유효하지 않은 IP 주소입니다.' }),
  port: z.number()
    .int()
    .min(1, '포트 번호는 1 이상이어야 합니다.')
    .max(65535, '포트 번호는 65535 이하여야 합니다.')
    .default(8193),
});

// Scheduler validators
export const schedulerItemSchema = z.object({
  mainProgram: z.string()
    .min(1, '메인 프로그램 번호는 필수입니다.')
    .max(20, '프로그램 번호는 최대 20자까지 가능합니다.'),
  subProgram: z.string()
    .max(20, '서브 프로그램 번호는 최대 20자까지 가능합니다.')
    .optional(),
  preset: z.number()
    .int()
    .min(1, '목표 수량은 1 이상이어야 합니다.')
    .max(999999, '목표 수량은 999999 이하여야 합니다.'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type MachineCreateInput = z.infer<typeof machineCreateSchema>;
export type SchedulerItemInput = z.infer<typeof schedulerItemSchema>;
