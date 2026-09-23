import React, { useCallback, useEffect, useState } from 'react';
import { groupAPI } from '../services/api';
import { CheckInDay, CheckInOverview } from '../types';

interface GroupCheckInProps {
  groupId: string;
  isLeader: boolean;
}

interface CheckInFormState {
  response: string;
  moodRating: number | null;
}

const MoodChart: React.FC<{ week: CheckInDay[] }> = ({ week }) => {
  const width = 560;
  const height = 180;
  const padX = 32;
  const padTop = 16;
  const padBottom = 28;

  const x = (i: number) => padX + (i * (width - 2 * padX)) / 6;
  const y = (rating: number) =>
    padTop + ((10 - rating) * (height - padTop - padBottom)) / 9;

  const hasAnyRecord = week.some(d => d.moodRating !== null);

  if (!hasAnyRecord) {
    return (
      <div className="text-center text-gray-400 py-8 text-sm">
        最近七天还没有打卡记录
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      {[10, 5, 1].map(r => (
        <g key={r}>
          <line
            x1={padX}
            x2={width - padX}
            y1={y(r)}
            y2={y(r)}
            stroke="#f0e6e2"
            strokeWidth="1"
          />
          <text x={padX - 8} y={y(r) + 4} textAnchor="end" fontSize="11" fill="#b8a9a3">
            {r}
          </text>
        </g>
      ))}

      {week.map((day, i) => {
        const next = week[i + 1];
        if (day.moodRating === null || !next || next.moodRating === null) {
          return null;
        }
        return (
          <line
            key={`seg-${day.date}`}
            x1={x(i)}
            y1={y(day.moodRating)}
            x2={x(i + 1)}
            y2={y(next.moodRating)}
            stroke="#0ea5e9"
            strokeWidth="2"
            strokeLinecap="round"
          />
        );
      })}

      {week.map((day, i) => (
        <g key={day.date}>
          {day.moodRating !== null && (
            <circle cx={x(i)} cy={y(day.moodRating)} r="4.5" fill="#0ea5e9">
              <title>{`${day.date} 心情 ${day.moodRating}/10${day.response ? `：${day.response}` : ''}`}</title>
            </circle>
          )}
          <text
            x={x(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize="11"
            fill={i === week.length - 1 ? '#0ea5e9' : '#b8a9a3'}
          >
            {i === week.length - 1 ? '今天' : day.date.slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
};

const GroupCheckIn: React.FC<GroupCheckInProps> = ({ groupId, isLeader }) => {
  const [overview, setOverview] = useState<CheckInOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<Record<string, CheckInFormState>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ title: '', description: '', reminderTime: '09:00' });
  const [creating, setCreating] = useState(false);

  const fetchOverview = useCallback(async () => {
    try {
      const response = await groupAPI.getCheckIns(groupId);
      setOverview(response.data);
    } catch (error) {
      console.error('获取打卡记录失败:', error);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const getForm = (templateId: string): CheckInFormState =>
    forms[templateId] || { response: '', moodRating: null };

  const updateForm = (templateId: string, patch: Partial<CheckInFormState>) => {
    setForms(prev => ({
      ...prev,
      [templateId]: { ...getForm(templateId), ...prev[templateId], ...patch }
    }));
  };

  const handleSubmit = async (templateId: string) => {
    const form = getForm(templateId);
    if (!form.response.trim()) {
      alert('请写一句今天的感受');
      return;
    }
    if (!form.moodRating) {
      alert('请选择今日心情评分（1-10分）');
      return;
    }

    setSubmittingId(templateId);
    try {
      await groupAPI.submitCheckIn(templateId, {
        response: form.response.trim(),
        moodRating: form.moodRating
      });
      await fetchOverview();
    } catch (error: any) {
      alert(error.response?.data?.error || '打卡失败');
      await fetchOverview();
    } finally {
      setSubmittingId(null);
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplate.title.trim()) {
      alert('请填写打卡标题');
      return;
    }

    setCreating(true);
    try {
      await groupAPI.createCheckInTemplate(groupId, {
        title: newTemplate.title.trim(),
        description: newTemplate.description.trim() || undefined,
        reminderTime: newTemplate.reminderTime
      });
      setNewTemplate({ title: '', description: '', reminderTime: '09:00' });
      setShowCreateForm(false);
      await fetchOverview();
    } catch (error: any) {
      alert(error.response?.data?.error || '创建打卡失败');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 mb-6 text-center text-gray-400">
        打卡加载中...
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">每日心情打卡</h2>
        <div className="flex items-center gap-3">
          {overview && overview.streak > 0 && (
            <span className="px-3 py-1 bg-orange-100 text-orange-600 rounded-full text-sm font-medium">
              🔥 已连续打卡 {overview.streak} 天
            </span>
          )}
          {isLeader && (
            <button
              onClick={() => setShowCreateForm(v => !v)}
              className="text-sm text-primary-600 hover:underline"
            >
              {showCreateForm ? '取消' : '+ 发布每日打卡'}
            </button>
          )}
        </div>
      </div>

      {isLeader && showCreateForm && (
        <form onSubmit={handleCreateTemplate} className="mb-6 p-4 bg-gray-50 rounded-lg space-y-3">
          <input
            type="text"
            value={newTemplate.title}
            onChange={e => setNewTemplate(prev => ({ ...prev, title: e.target.value }))}
            className="input-field"
            placeholder="打卡标题，如：今日心情打卡"
          />
          <input
            type="text"
            value={newTemplate.description}
            onChange={e => setNewTemplate(prev => ({ ...prev, description: e.target.value }))}
            className="input-field"
            placeholder="打卡说明（可选）"
          />
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 whitespace-nowrap">提醒时间</label>
            <input
              type="time"
              value={newTemplate.reminderTime}
              onChange={e => setNewTemplate(prev => ({ ...prev, reminderTime: e.target.value }))}
              className="input-field"
            />
            <button type="submit" disabled={creating} className="btn-primary whitespace-nowrap">
              {creating ? '发布中...' : '发布'}
            </button>
          </div>
        </form>
      )}

      {overview && overview.templates.length === 0 ? (
        <div className="text-center text-gray-400 py-6 text-sm">
          {isLeader ? '还没有打卡，点击右上角「发布每日打卡」开始吧' : '组长还没有发布打卡'}
        </div>
      ) : (
        <div className="space-y-4 mb-6">
          {overview?.templates.map(template => (
            <div key={template.id} className="border border-gray-100 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-800">{template.title}</h3>
                <span className="text-xs text-gray-400">每日 {template.reminderTime} 提醒</span>
              </div>
              {template.description && (
                <p className="text-sm text-gray-500 mb-3">{template.description}</p>
              )}

              {template.todayCheckIn ? (
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-green-600 text-sm font-medium">✓ 今日已打卡</span>
                    {template.todayCheckIn.moodRating !== null && (
                      <span className="text-sm text-gray-600">
                        心情 {template.todayCheckIn.moodRating}/10
                      </span>
                    )}
                  </div>
                  {template.todayCheckIn.response && (
                    <p className="text-sm text-gray-600">「{template.todayCheckIn.response}」</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea
                    value={getForm(template.id).response}
                    onChange={e => updateForm(template.id, { response: e.target.value })}
                    className="input-field resize-none"
                    rows={2}
                    maxLength={500}
                    placeholder="写一句今天的感受..."
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-gray-500 mr-1">今日心情：</span>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(score => (
                      <button
                        key={score}
                        type="button"
                        onClick={() => updateForm(template.id, { moodRating: score })}
                        className={`w-8 h-8 rounded-full text-sm font-medium transition-colors ${
                          getForm(template.id).moodRating === score
                            ? 'bg-primary-500 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {score}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={submittingId === template.id}
                      onClick={() => handleSubmit(template.id)}
                      className="btn-primary ml-auto"
                    >
                      {submittingId === template.id ? '提交中...' : '打卡'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {overview && (
        <div>
          <h3 className="text-sm font-semibold text-gray-600 mb-2">最近七天心情变化</h3>
          <MoodChart week={overview.week} />
        </div>
      )}
    </div>
  );
};

export default GroupCheckIn;
