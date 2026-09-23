import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../config/prisma.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';
import { sendInternalError, sendValidationError } from '../utils/httpResponses.js';
import {
  toChinaDay,
  getChinaDateKey,
  dayToKey,
  getLastNDays,
  calculateStreak
} from '../utils/date.js';

const router = Router();

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1),
  topic: z.string().min(1),
  maxMembers: z.number().min(3).max(5).default(5),
  meetingTime: z.string().optional(),
  meetingFrequency: z.string().optional()
});

const createMessageSchema = z.object({
  content: z.string().min(1)
});

const createCheckInSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  reminderTime: z.string().min(1)
});

const submitCheckInSchema = z.object({
  response: z.string().trim().min(1, '请写一句今天的感受').max(500),
  moodRating: z.number({ invalid_type_error: '请选择 1-10 的心情评分' }).int().min(1).max(10)
});

const serializeCheckIn = (checkIn: {
  id: string;
  response: string | null;
  moodRating: number | null;
  checkInDate: Date;
  createdAt: Date;
}) => ({
  id: checkIn.id,
  response: checkIn.response,
  moodRating: checkIn.moodRating,
  // DATE 列以 UTC 午夜读回，其 UTC 年月日即存储的日历日
  checkInDate: dayToKey(checkIn.checkInDate),
  createdAt: checkIn.createdAt
});

router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const groups = await prisma.supportGroup.findMany({
      where: { status: 'ACTIVE' },
      include: {
        members: {
          select: {
            user: {
              select: {
                id: true,
                username: true,
                nickname: true,
                avatar: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });

    const total = await prisma.supportGroup.count({ where: { status: 'ACTIVE' } });

    res.json({
      groups,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    sendInternalError(res, error, '获取小组列表错误', '获取小组列表失败');
  }
});

router.get('/my', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      include: {
        group: {
          include: {
            members: {
              select: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    nickname: true,
                    avatar: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { joinedAt: 'desc' }
    });

    const groups = memberships.map(m => m.group);

    res.json(groups);
  } catch (error) {
    sendInternalError(res, error, '获取我的小组错误', '获取我的小组失败');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const group = await prisma.supportGroup.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                nickname: true,
                avatar: true
              }
            }
          }
        },
        messages: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                nickname: true,
                avatar: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 50
        },
        checkInTemplates: true
      }
    });

    if (!group) {
      return res.status(404).json({ error: '小组不存在' });
    }

    res.json(group);
  } catch (error) {
    sendInternalError(res, error, '获取小组详情错误', '获取小组详情失败');
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const validated = createGroupSchema.parse(req.body);
    const userId = req.user!.id;

    const group = await prisma.$transaction(async (tx) => {
      const newGroup = await tx.supportGroup.create({
        data: {
          name: validated.name,
          description: validated.description,
          topic: validated.topic,
          maxMembers: validated.maxMembers,
          meetingTime: validated.meetingTime,
          meetingFrequency: validated.meetingFrequency,
          createdBy: userId,
          status: 'ACTIVE'
        }
      });

      await tx.groupMember.create({
        data: {
          groupId: newGroup.id,
          userId,
          role: 'leader'
        }
      });

      return newGroup;
    });

    res.json({
      message: '小组创建成功',
      group
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(res, error);
    }
    sendInternalError(res, error, '创建小组错误', '创建小组失败');
  }
});

router.post('/:id/join', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const group = await prisma.supportGroup.findUnique({
      where: { id }
    });

    if (!group) {
      return res.status(404).json({ error: '小组不存在' });
    }

    const existingMember = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: id,
          userId
        }
      }
    });

    if (existingMember) {
      return res.status(400).json({ error: '您已经是小组成员' });
    }

    const memberCount = await prisma.groupMember.count({
      where: { groupId: id }
    });

    if (memberCount >= group.maxMembers) {
      return res.status(400).json({ error: '小组已满' });
    }

    await prisma.groupMember.create({
      data: {
        groupId: id,
        userId,
        role: 'member'
      }
    });

    if (memberCount + 1 >= group.maxMembers) {
      await prisma.supportGroup.update({
        where: { id },
        data: { status: 'FULL' }
      });
    }

    res.json({ message: '加入小组成功' });
  } catch (error) {
    sendInternalError(res, error, '加入小组错误', '加入小组失败');
  }
});

router.get('/:id/messages', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const isMember = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: id,
          userId
        }
      }
    });

    if (!isMember) {
      return res.status(403).json({ error: '您不是小组成员' });
    }

    const messages = await prisma.groupMessage.findMany({
      where: { groupId: id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    res.json(messages);
  } catch (error) {
    sendInternalError(res, error, '获取小组消息错误', '获取消息失败');
  }
});

router.post('/:id/messages', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const validated = createMessageSchema.parse(req.body);
    const userId = req.user!.id;

    const isMember = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: id,
          userId
        }
      }
    });

    if (!isMember) {
      return res.status(403).json({ error: '您不是小组成员' });
    }

    const message = await prisma.groupMessage.create({
      data: {
        groupId: id,
        userId,
        content: validated.content
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true
          }
        }
      }
    });

    res.json({
      message: '消息发送成功',
      data: message
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(res, error);
    }
    sendInternalError(res, error, '发送消息错误', '发送消息失败');
  }
});

router.post('/:id/checkin-templates', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const validated = createCheckInSchema.parse(req.body);
    const userId = req.user!.id;

    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: id,
          userId
        }
      }
    });

    if (!membership || membership.role !== 'leader') {
      return res.status(403).json({ error: '只有组长可以发布打卡' });
    }

    const template = await prisma.checkInTemplate.create({
      data: {
        groupId: id,
        title: validated.title,
        description: validated.description,
        reminderTime: validated.reminderTime
      }
    });

    res.json({
      message: '今日打卡发布成功',
      template
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(res, error);
    }
    sendInternalError(res, error, '创建打卡模板错误', '创建打卡模板失败');
  }
});

// 我在某个模板下的今日打卡与连续天数
router.get('/checkin/:templateId/today', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.user!.id;

    const template = await prisma.checkInTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, groupId: true }
    });

    if (!template) {
      return res.status(404).json({ error: '打卡不存在' });
    }

    const member = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: template.groupId,
          userId
        }
      }
    });

    if (!member) {
      return res.status(403).json({ error: '您不是小组成员' });
    }

    const today = toChinaDay();
    const todayKey = getChinaDateKey();

    const [todayCheckIn, completedDays] = await Promise.all([
      prisma.checkIn.findUnique({
        where: {
          templateId_memberId_checkInDate: {
            templateId,
            memberId: member.id,
            checkInDate: today
          }
        }
      }),
      prisma.checkIn.findMany({
        where: {
          memberId: member.id,
          templateId,
          status: 'COMPLETED'
        },
        select: { checkInDate: true }
      })
    ]);

    const dateKeys = new Set(completedDays.map(c => dayToKey(c.checkInDate)));

    res.json({
      date: todayKey,
      completed: Boolean(todayCheckIn),
      checkIn: todayCheckIn ? serializeCheckIn(todayCheckIn) : null,
      streak: calculateStreak(dateKeys)
    });
  } catch (error) {
    sendInternalError(res, error, '获取今日打卡错误', '获取今日打卡失败');
  }
});

// 我在某个模板下最近 7 天的心情记录
router.get('/checkin/:templateId/history', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.user!.id;

    const template = await prisma.checkInTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, groupId: true, title: true }
    });

    if (!template) {
      return res.status(404).json({ error: '打卡不存在' });
    }

    const member = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: template.groupId,
          userId
        }
      }
    });

    if (!member) {
      return res.status(403).json({ error: '您不是小组成员' });
    }

    const days = getLastNDays(7);
    const rangeStart = days[0];

    const records = await prisma.checkIn.findMany({
      where: {
        memberId: member.id,
        templateId,
        checkInDate: { gte: rangeStart }
      },
      orderBy: { checkInDate: 'asc' }
    });

    const byDay = new Map(records.map(r => [dayToKey(r.checkInDate), r]));
    const allCompleted = await prisma.checkIn.findMany({
      where: { memberId: member.id, templateId, status: 'COMPLETED' },
      select: { checkInDate: true }
    });
    const dateKeys = new Set(allCompleted.map(c => dayToKey(c.checkInDate)));

    // 没有记录的日期留空（null），不按 0 分处理
    const week = days.map(day => {
      const key = dayToKey(day);
      const record = byDay.get(key);
      return {
        date: key,
        weekday: WEEKDAYS[day.getUTCDay()],
        moodRating: record?.moodRating ?? null,
        response: record?.response ?? null
      };
    });

    res.json({
      template: { id: template.id, title: template.title },
      today: getChinaDateKey(),
      week,
      streak: calculateStreak(dateKeys)
    });
  } catch (error) {
    sendInternalError(res, error, '获取打卡历史错误', '获取打卡历史失败');
  }
});

router.post('/checkin/:templateId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { templateId } = req.params;
    const validated = submitCheckInSchema.parse(req.body);
    const userId = req.user!.id;

    const template = await prisma.checkInTemplate.findUnique({
      where: { id: templateId },
      include: { group: true }
    });

    if (!template) {
      return res.status(404).json({ error: '打卡不存在' });
    }

    const member = await prisma.groupMember.findUnique({
      where: {
        groupId_userId: {
          groupId: template.groupId,
          userId
        }
      }
    });

    if (!member) {
      return res.status(403).json({ error: '您不是小组成员' });
    }

    const today = toChinaDay();

    // 同一模板当天重复提交：保留原记录，返回 409 提示已经打过卡
    const existingCheckIn = await prisma.checkIn.findUnique({
      where: {
        templateId_memberId_checkInDate: {
          templateId,
          memberId: member.id,
          checkInDate: today
        }
      }
    });

    if (existingCheckIn) {
      return res.status(409).json({
        error: '今天已经打过卡了，原记录已保留',
        checkIn: serializeCheckIn(existingCheckIn)
      });
    }

    let checkIn;
    try {
      checkIn = await prisma.checkIn.create({
        data: {
          templateId,
          memberId: member.id,
          userId,
          status: 'COMPLETED',
          response: validated.response,
          moodRating: validated.moodRating,
          checkInDate: today
        }
      });
    } catch (dbError) {
      // 并发提交时唯一索引兜底
      if (
        dbError instanceof Prisma.PrismaClientKnownRequestError &&
        dbError.code === 'P2002'
      ) {
        const raceRecord = await prisma.checkIn.findUniqueOrThrow({
          where: {
            templateId_memberId_checkInDate: {
              templateId,
              memberId: member.id,
              checkInDate: today
            }
          }
        });
        return res.status(409).json({
          error: '今天已经打过卡了，原记录已保留',
          checkIn: serializeCheckIn(raceRecord)
        });
      }
      throw dbError;
    }

    const allCompleted = await prisma.checkIn.findMany({
      where: { memberId: member.id, templateId, status: 'COMPLETED' },
      select: { checkInDate: true }
    });
    const dateKeys = new Set(allCompleted.map(c => dayToKey(c.checkInDate)));

    res.json({
      message: '打卡成功',
      checkIn: serializeCheckIn(checkIn),
      streak: calculateStreak(dateKeys)
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(res, error);
    }
    sendInternalError(res, error, '打卡错误', '打卡失败');
  }
});

export default router;
