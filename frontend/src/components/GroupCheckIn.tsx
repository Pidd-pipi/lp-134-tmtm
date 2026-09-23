import React, { useEffect, useMemo, useState } from 'react';
import { groupAPI } from '../services/api';
import {
  CheckInHistory,
  CheckInTemplate,
  TodayCheckIn
} from '../types';

interface GroupCheckInProps {
  groupId: string;
  templates: CheckInTemplate[];
  isLeader: boolean;
  templatesVersion: number;
  onTemplatesChange: () => Promise<void> | void;
}

const MOOD_COLOR = '#f97316';

const moodLabel = (rating: number | null): string => {
  if (rating === null) return '';
  if (rating <= 2) return '很难受';
  if (rating <= 4) return '不太好';
  if (rating <= 6) return '一般';
  if (rating <= 8) return '还不错';
  return '很好';
};

// 最近七天心情曲线：没有记录的日期留空，连线在缺口处断开
const MoodTrendChart: React.FC<{ week: CheckInHistory['week'] }> = ({ week }) => {
  const width = 340;
  const height = 180;
  const padding = { top: 24, right: 16, bottom: 36, left: 28 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const xOf = (index: number) =>
    padding.left + (innerW * index) / Math.max(week.length - 1, 1);
  const yOf = (rating: number) =>
    padding.top + innerH * (1 - (rating - 1) / 9);

  const segments: string[] = [];
  let current: string[] = [];
  week.forEach((day, i) => {
    if (day.moodRating !== null) {
      current.push(`${xOf(i)},${yOf(day.moodRating)}`);
    } else if (current.length) {
      segments.push(current.join(' '));
      current = [];
    }
  });
  if (current.length) segments.push(current.join(' '));

  const todayIndex = week.length - 1;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {[1, 5, 10].map(score => (
        <g key={score}>
          <line
            x1={padding.left}
            y1={yOf(score)}
            x2={width - padding.right}
            y2={yOf(score)}
            stroke="#f3f4f6"
            strokeWidth={1}
          />
          <text x={4} y={yOf(score) + 4} fontSize={10} fill="#9ca3af">
            {score}
          </text>
        </g>
      ))}

      {segments.map((points, i) => (
        <polyline
          key={i}
          points={points}
          fill="none"
          stroke={MOOD_COLOR}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}

      {week.map((day, i) => (
        <g key={day.date}>
          {day.moodRating !== null && (
            <>
              <circle
                cx={xOf(i)}
                cy={yOf(day.moodRating)}
                r={4}
                fill="white"
                stroke={MOOD_COLOR}
                strokeWidth={2}
              />
              <text
                x={xOf(i)}
                y={yOf(day.moodRating) - 9}
                fontSize={10}
                fill="#9a3412"
                textAnchor="middle"
              >
                {day.moodRating}
              </text>
            </>
          )}
          <text
            x={xOf(i)}
            y={height - 18}
            fontSize={10}
            fill={i === todayIndex ? '#ea580c' : '#9ca3af'}
            textAnchor="middle"
          >
            {i === todayIndex ? '今天' : day.weekday.replace('周', '')}
          </text>
          <text
            x={xOf(i)}
            y={height - 6}
            fontSize={8}
            fill="#d1d5db"
            textAnchor="middle"
          >
            {day.moodRating === null ? '未打卡' : ''}
          </text>
        </g>
      ))}
    </svg>
  );
};

const GroupCheckIn: React.FC<GroupCheckInProps> = ({
  groupId,
  templates,
  isLeader,
  templatesVersion,
  onTemplatesChange
}) => {
  const [selectedId, setSelectedId] = useState<string>('');
  const [todayData, setTodayData] = useState<TodayCheckIn | null>(null);
  const [history, setHistory] = useState<CheckInHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  // 发布表单
  const [showPublish, setShowPublish] = useState(false);
  const [title, setTitle] = useState('今日心情打卡');
  const [description, setDescription] = useState('');
  const [reminderTime, setReminderTime] = useState('20:00');
  const [publishing, setPublishing] = useState(false);

  // 提交打卡表单
  const [response, setResponse] = useState('');
  const [moodRating, setMoodRating] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [duplicateNotice, setDuplicateNotice] = useState('');

  const activeTemplate = useMemo(
    () => templates.find(t => t.id === selectedId) || templates[templates.length - 1] || null,
    [templates, selectedId]
  );

  useEffect(() => {
    if (!activeTemplate) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const [todayRes, historyRes] = await Promise.all([
          groupAPI.getTodayCheckIn(activeTemplate.id),
          groupAPI.getCheckInHistory(activeTemplate.id)
        ]);
        if (cancelled) return;
        setTodayData(todayRes.data);
        setHistory(historyRes.data);
      } catch (error: any) {
        if (!cancelled) {
          setLoadError(error.response?.data?.error || '加载打卡内容失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [activeTemplate?.id, templatesVersion]);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setPublishing(true);
    try {
      await groupAPI.createCheckInTemplate(groupId, {
        title: title.trim(),
        description: description.trim() || undefined,
        reminderTime
      });
      setShowPublish(false);
      setDescription('');
      await onTemplatesChange();
    } catch (error: any) {
      alert(error.response?.data?.error || '发布打卡失败');
    } finally {
      setPublishing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTemplate || moodRating === null) {
      setSubmitError('请选择 1-10 的心情评分');
      return;
    }
    if (!response.trim()) {
      setSubmitError('请写一句今天的感受');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    setDuplicateNotice('');
    try {
      await groupAPI.submitCheckIn(activeTemplate.id, {
        response: response.trim(),
        moodRating
      });
      setResponse('');
      setMoodRating(null);
      const [todayRes, historyRes] = await Promise.all([
        groupAPI.getTodayCheckIn(activeTemplate.id),
        groupAPI.getCheckInHistory(activeTemplate.id)
      ]);
      setTodayData(todayRes.data);
      setHistory(historyRes.data);
    } catch (error: any) {
      const status = error.response?.status;
      const message = error.response?.data?.error || '打卡失败';
      if (status === 409) {
        // 同一天重复提交：提示并展示原有记录
        setDuplicateNotice(message);
        if (error.response?.data?.checkIn) {
          setTodayData(prev => ({
            date: prev?.date || '',
            completed: true,
            checkIn: error.response.data.checkIn,
            streak: prev?.streak ?? 0
          }));
        }
      } else {
        setSubmitError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const completed = Boolean(todayData?.completed);
  const streak = history?.streak ?? todayData?.streak ?? 0;

  return (
    <div className="bg-white rounded-lg shadow-md">
      <div className="p-6 border-b flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800">每日心情打卡</h2>
          <p className="text-sm text-gray-500 mt-1">
            写一句今天的感受，记录心情变化
          </p>
        </div>
        {isLeader && (
          <button
            onClick={() => setShowPublish(v => !v)}
            className="btn-secondary text-sm"
          >
            {showPublish ? '取消' : '发布打卡'}
          </button>
        )}
      </div>

      <div className="p-6 space-y-6">
        {isLeader && showPublish && (
          <form onSubmit={handlePublish} className="space-y-3 bg-orange-50 rounded-lg p-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                打卡标题
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="input-field"
                placeholder="例如：今日心情打卡"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                说明（可选）
              </label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="input-field"
                placeholder="给成员的一句话"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                每日提醒时间
              </label>
              <input
                type="time"
                value={reminderTime}
                onChange={e => setReminderTime(e.target.value)}
                className="input-field"
              />
            </div>
            <button type="submit" disabled={publishing} className="btn-primary text-sm">
              {publishing ? '发布中...' : '发布'}
            </button>
          </form>
        )}

        {templates.length === 0 ? (
          <div className="text-center text-gray-500 py-6">
            {isLeader
              ? '还没有打卡，点击右上角「发布打卡」发起今日心情打卡吧'
              : '组长还没有发布打卡，耐心等一下吧'}
          </div>
        ) : (
          <>
            {templates.length > 1 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  打卡
                </label>
                <select
                  value={activeTemplate?.id || ''}
                  onChange={e => setSelectedId(e.target.value)}
                  className="input-field"
                >
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {activeTemplate && templates.length === 1 && (
              <div>
                <h3 className="font-semibold text-gray-800">
                  {activeTemplate.title}
                </h3>
                {activeTemplate.description && (
                  <p className="text-sm text-gray-500 mt-1">
                    {activeTemplate.description}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  每日提醒：{activeTemplate.reminderTime}
                </p>
              </div>
            )}

            {loading ? (
              <div className="text-center text-gray-500 py-6">加载中...</div>
            ) : loadError ? (
              <div className="text-center text-red-500 py-6">{loadError}</div>
            ) : (
              <>
                {/* 今日状态 */}
                <div className="flex items-center justify-between bg-orange-50 rounded-lg p-4">
                  <div>
                    <p className="text-sm text-gray-500">今日状态</p>
                    {completed && todayData?.checkIn ? (
                      <p className="font-semibold text-gray-800 mt-1">
                        已打卡 · {todayData.checkIn.moodRating} 分
                        <span className="ml-2 text-orange-600 font-normal">
                          {moodLabel(todayData.checkIn.moodRating)}
                        </span>
                      </p>
                    ) : (
                      <p className="font-semibold text-gray-400 mt-1">
                        今天还没有打卡
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">连续完成</p>
                    <p className="text-2xl font-bold text-orange-500">
                      {streak}
                      <span className="text-sm font-normal text-gray-500 ml-1">天</span>
                    </p>
                  </div>
                </div>

                {/* 最近七天变化 */}
                {history && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">
                      最近七天心情变化
                    </h4>
                    <MoodTrendChart week={history.week} />
                    <div className="space-y-2 mt-2">
                      {[...history.week]
                        .filter(d => d.response)
                        .reverse()
                        .slice(0, 3)
                        .map(d => (
                          <div key={d.date} className="text-sm text-gray-600 bg-gray-50 rounded p-2">
                            <span className="text-xs text-gray-400 mr-2">
                              {d.date}
                            </span>
                            {d.moodRating !== null && (
                              <span className="text-xs text-orange-600 mr-2">
                                {d.moodRating}分
                              </span>
                            )}
                            {d.response}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* 打卡表单 / 重复提交提示 */}
                {completed ? (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                    <p className="text-sm text-orange-700">
                      ✓ {duplicateNotice || '今天已经打过卡了，原记录已保留'}
                    </p>
                    {todayData?.checkIn?.response && (
                      <p className="text-sm text-gray-600 mt-2">
                        “{todayData.checkIn.response}”
                      </p>
                    )}
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-3">
                    {duplicateNotice && (
                      <p className="text-sm text-orange-600">{duplicateNotice}</p>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        今天的心情评分（1 很糟糕 - 10 很好）
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {Array.from({ length: 10 }, (_, i) => i + 1).map(score => (
                          <button
                            key={score}
                            type="button"
                            onClick={() => setMoodRating(score)}
                            className={`w-9 h-9 rounded-full text-sm font-medium transition-colors ${
                              moodRating === score
                                ? 'bg-orange-500 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-orange-100'
                            }`}
                          >
                            {score}
                          </button>
                        ))}
                      </div>
                      {moodRating !== null && (
                        <p className="text-xs text-orange-600 mt-1">
                          {moodLabel(moodRating)}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        写一句今天的感受
                      </label>
                      <textarea
                        value={response}
                        onChange={e => setResponse(e.target.value)}
                        className="input-field"
                        rows={3}
                        maxLength={500}
                        placeholder="今天发生了什么？此刻心情如何？"
                      />
                    </div>
                    {submitError && (
                      <p className="text-sm text-red-500">{submitError}</p>
                    )}
                    <button
                      type="submit"
                      disabled={submitting}
                      className="btn-primary"
                    >
                      {submitting ? '提交中...' : '完成今日打卡'}
                    </button>
                  </form>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default GroupCheckIn;
