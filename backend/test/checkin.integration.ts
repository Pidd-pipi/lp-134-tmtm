// 每日心情打卡端到端集成测试：启动内嵌 PostgreSQL，跑真实路由。
// 用法：DATABASE_URL=... npx tsx test/checkin.integration.ts
import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PG_PORT = 55432;
const DB_USER = 'test';
const DB_PASS = 'test';
const DB_NAME = 'testdb';
const DATABASE_URL = `postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:${PG_PORT}/${DB_NAME}?schema=public`;

const failures: string[] = [];
const assert = (name: string, cond: boolean, detail = '') => {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    console.log(`  ❌ ${name} ${detail}`);
    failures.push(name);
  }
};

const main = async () => {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.JWT_SECRET = 'test-secret';

  console.log('启动内嵌 PostgreSQL...');
  const pg = new EmbeddedPostgres({
    databaseDir: path.resolve('/workspace/.pgdata'),
    user: DB_USER,
    password: DB_PASS,
    port: PG_PORT,
    persistent: true
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB_NAME);

  console.log('执行 Prisma 迁移...');
  execSync('npx prisma migrate deploy', {
    cwd: '/workspace/backend',
    env: { ...process.env, DATABASE_URL },
    stdio: 'inherit'
  });

  const { createApp } = await import('../src/app.js');
  const server = createApp().listen(33234);
  await new Promise(r => server.once('listening', r));

  const api = (method: string, url: string, token?: string, body?: unknown) =>
    fetch(`http://127.0.0.1:33234${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

  const register = async (name: string) => {
    const res = await api('POST', '/api/auth/register', undefined, {
      username: name,
      email: `${name}@test.com`,
      password: 'password123'
    });
    const data = await res.json();
    return { token: data.token as string, id: data.user.id as string };
  };

  console.log('\n=== 1. 用户与小组准备 ===');
  const leader = await register('leader1');
  const member = await register('member1');
  const outsider = await register('outsider1');

  const groupRes = await api('POST', '/api/groups', leader.token, {
    name: '打卡测试小组',
    description: '测试每日心情打卡',
    topic: '情绪管理',
    maxMembers: 5
  });
  const groupData = await groupRes.json();
  const groupId = groupData.group.id;
  assert('组长创建小组', !!groupId);

  await api('POST', `/api/groups/${groupId}/join`, member.token);

  console.log('\n=== 2. 仅组长可发布打卡 ===');
  const memberPublish = await api('POST', `/api/groups/${groupId}/checkin-templates`, member.token, {
    title: '成员打卡',
    reminderTime: '20:00'
  });
  assert('普通成员发布打卡被拒绝 (403)', memberPublish.status === 403);

  const outsiderPublish = await api('POST', `/api/groups/${groupId}/checkin-templates`, outsider.token, {
    title: '外人打卡',
    reminderTime: '20:00'
  });
  assert('非成员发布打卡被拒绝 (403)', outsiderPublish.status === 403);

  const publishRes = await api('POST', `/api/groups/${groupId}/checkin-templates`, leader.token, {
    title: '今日心情打卡',
    description: '记录今天的心情',
    reminderTime: '20:00'
  });
  const publishData = await publishRes.json();
  const templateId = publishData.template?.id;
  assert('组长发布每日打卡成功', publishRes.status === 200 && !!templateId, JSON.stringify(publishData));

  console.log('\n=== 3. 非成员不能读取打卡内容或提交 ===');
  const outsiderToday = await api('GET', `/api/groups/checkin/${templateId}/today`, outsider.token);
  assert('非成员读取今日打卡被拒绝 (403)', outsiderToday.status === 403);

  const outsiderHistory = await api('GET', `/api/groups/checkin/${templateId}/history`, outsider.token);
  assert('非成员读取七天历史被拒绝 (403)', outsiderHistory.status === 403);

  const outsiderSubmit = await api('POST', `/api/groups/checkin/${templateId}`, outsider.token, {
    response: '我不是成员',
    moodRating: 5
  });
  assert('非成员提交打卡被拒绝 (403)', outsiderSubmit.status === 403);

  const anonToday = await fetch(`http://127.0.0.1:33234/api/groups/checkin/${templateId}/today`);
  assert('未登录读取打卡被拒绝 (401)', anonToday.status === 401);

  console.log('\n=== 4. 参数校验 ===');
  const badRating = await api('POST', `/api/groups/checkin/${templateId}`, member.token, {
    response: '评分越界',
    moodRating: 11
  });
  assert('评分超出 1-10 被拒绝 (400)', badRating.status === 400);

  const emptyResponse = await api('POST', `/api/groups/checkin/${templateId}`, member.token, {
    response: '   ',
    moodRating: 7
  });
  assert('空感受被拒绝 (400)', emptyResponse.status === 400);

  console.log('\n=== 5. 当天首次提交 ===');
  const submitRes = await api('POST', `/api/groups/checkin/${templateId}`, member.token, {
    response: '今天心情还不错，工作顺利',
    moodRating: 8
  });
  const submitData = await submitRes.json();
  assert('首次打卡成功 (200)', submitRes.status === 200, JSON.stringify(submitData));
  assert('返回连续天数 1', submitData.streak === 1, `got ${submitData.streak}`);
  assert('记录含日期', submitData.checkIn?.checkInDate === new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10));

  console.log('\n=== 6. 同模板当天重复提交：提示已打卡并保留原记录 ===');
  const dupRes = await api('POST', `/api/groups/checkin/${templateId}`, member.token, {
    response: '想覆盖原记录',
    moodRating: 2
  });
  const dupData = await dupRes.json();
  assert('重复打卡返回 409', dupRes.status === 409);
  assert('提示已经打过卡', /已经打过卡/.test(dupData.error || ''), dupData.error);
  assert('返回原记录', dupData.checkIn?.response === '今天心情还不错，工作顺利' && dupData.checkIn.moodRating === 8);

  console.log('\n=== 7. 今日状态与连续天数 ===');
  const todayRes = await api('GET', `/api/groups/checkin/${templateId}/today`, member.token);
  const todayData = await todayRes.json();
  assert('今日状态 completed=true', todayData.completed === true);
  assert('今日记录保留原内容', todayData.checkIn?.moodRating === 8);
  assert('连续完成天数 = 1', todayData.streak === 1, `got ${todayData.streak}`);

  console.log('\n=== 8. 最近七天：无记录日留空，不按 0 分 ===');
  const histRes = await api('GET', `/api/groups/checkin/${templateId}/history`, member.token);
  const histData = await histRes.json();
  assert('返回 7 天', histData.week?.length === 7);
  const todayItem = histData.week[6];
  assert('今天有评分 8', todayItem.moodRating === 8 && todayItem.response === '今天心情还不错，工作顺利');
  const emptyDays = histData.week.slice(0, 6);
  assert('其余 6 天评分均为 null（留空，非 0）', emptyDays.every((d: any) => d.moodRating === null && d.response === null));
  assert('空天没有 0 分', histData.week.every((d: any) => d.moodRating === null || d.moodRating > 0));
  assert('历史接口连续天数 = 1', histData.streak === 1);

  console.log('\n=== 9. 多日数据下的曲线与连续天数 ===');
  // 直接写库补历史：前天 6 分，大前天 5 分；4 天前缺失
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  const membership = await prisma.groupMember.findFirstOrThrow({ where: { userId: member.id } });
  const day = (offset: number) => {
    const d = new Date(Date.now() + (8 - new Date().getTimezoneOffset() / 60) * 3600 * 1000);
    d.setUTCDate(d.getUTCDate() - offset);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  };
  await prisma.checkIn.createMany({
    data: [
      { templateId, memberId: membership.id, userId: member.id, status: 'COMPLETED', response: '前天一般', moodRating: 6, checkInDate: day(2) },
      { templateId, memberId: membership.id, userId: member.id, status: 'COMPLETED', response: '大前天还好', moodRating: 5, checkInDate: day(3) }
    ]
  });
  await prisma.$disconnect();

  const hist2Res = await api('GET', `/api/groups/checkin/${templateId}/history`, member.token);
  const hist2 = await hist2Res.json();
  const ratings = hist2.week.map((d: any) => d.moodRating);
  // 7 天：[null,null,null,5(d3),6(d2),null(d1),8(d0)]
  assert('7 天序列为 [null,null,null,5,6,null,8]', JSON.stringify(ratings) === JSON.stringify([null, null, null, 5, 6, null, 8]), JSON.stringify(ratings));
  // 今天打卡 + 昨天缺失 => 连续天数为 1（昨天断档）
  assert('昨天缺失时连续天数=1', hist2.streak === 1, `got ${hist2.streak}`);

  // 补上昨天 => 连续应为 3（今天/昨天/前天），大前天因 4 天前缺失不影响
  const prisma2 = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma2.checkIn.create({
    data: { templateId, memberId: membership.id, userId: member.id, status: 'COMPLETED', response: '昨天', moodRating: 7, checkInDate: day(1) }
  });
  await prisma2.$disconnect();
  const hist3 = await (await api('GET', `/api/groups/checkin/${templateId}/history`, member.token)).json();
  const ratings3 = hist3.week.map((d: any) => d.moodRating);
  assert('补昨天后序列为 [null,null,null,5,6,7,8]', JSON.stringify(ratings3) === JSON.stringify([null, null, null, 5, 6, 7, 8]), JSON.stringify(ratings3));
  assert('连续 4 天（含大前天）', hist3.streak === 4, `got ${hist3.streak}`);

  console.log('\n=== 10. 组长本人也是成员，可正常打卡与读取 ===');
  const leaderSubmit = await api('POST', `/api/groups/checkin/${templateId}`, leader.token, {
    response: '组长打卡',
    moodRating: 9
  });
  assert('组长打卡成功', leaderSubmit.status === 200);
  const leaderToday = await (await api('GET', `/api/groups/checkin/${templateId}/today`, leader.token)).json();
  assert('组长读到自己的打卡', leaderToday.completed === true && leaderToday.checkIn.moodRating === 9);
  // 成员不应看到组长的记录
  const memberHist = await (await api('GET', `/api/groups/checkin/${templateId}/history`, member.token)).json();
  assert('成员历史中不包含组长的记录', memberHist.week[6].moodRating === 8);

  console.log('\n=== 11. 今天未打卡时连续天数从昨天回看 ===');
  const member2 = await register('member2');
  await api('POST', `/api/groups/${groupId}/join`, member2.token);
  const prisma3 = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  const m2 = await prisma3.groupMember.findFirstOrThrow({ where: { userId: member2.id } });
  await prisma3.checkIn.createMany({
    data: [
      { templateId, memberId: m2.id, userId: member2.id, status: 'COMPLETED', response: '昨天', moodRating: 6, checkInDate: day(1) },
      { templateId, memberId: m2.id, userId: member2.id, status: 'COMPLETED', response: '前天', moodRating: 7, checkInDate: day(2) }
    ]
  });
  await prisma3.$disconnect();
  const m2Today = await (await api('GET', `/api/groups/checkin/${templateId}/today`, member2.token)).json();
  assert('今天未打卡，连续从昨天起算 = 2', m2Today.streak === 2, `got ${m2Today.streak}`);
  assert('今日 completed=false', m2Today.completed === false);

  server.close();
  await pg.stop();

  console.log(`\n${failures.length === 0 ? '🎉 全部断言通过' : `❌ ${failures.length} 个断言失败: ${failures.join('; ')}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
