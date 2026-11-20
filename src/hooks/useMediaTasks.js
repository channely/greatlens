import { useEffect, useState } from 'react';
import { api } from '../api.js';

// 素材 / Cinema / Space 共用：加载近期任务并按固定间隔刷新，网络失败不把任务判死。
export function useMediaTasks(projectId, limit = 60, interval = 6000) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function reload() {
    try {
      const list = await api.media.tasks(limit);
      const rows = Array.isArray(list) ? list : [];
      setTasks(projectId ? rows.filter(t => !t.projectId || t.projectId === projectId) : rows);
      setError('');
    } catch (e) { setError(e.message || '任务刷新失败'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    reload();
    const timer = setInterval(reload, interval);
    return () => clearInterval(timer);
    /* eslint-disable-next-line */
  }, [projectId, limit, interval]);

  return { tasks, loading, error, reload };
}
