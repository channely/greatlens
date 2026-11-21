// 并行测试端口分配：用原子 mkdir 作为跨进程锁，避免多个测试文件抢同一端口导致偶发 EADDRINUSE。
// 每个调用方必须 release()；锁超过 5 分钟视为崩溃残留可回收。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LOCK_ROOT = path.join(os.tmpdir(), 'greatlens-test-portlocks');
const STALE_MS = 5 * 60 * 1000;

export function acquireTestPort(base = 20000, span = 40000) {
  fs.mkdirSync(LOCK_ROOT, { recursive: true });
  const now = Date.now();
  for (let i = 0; i < 2000; i++) {
    const port = base + Math.floor(Math.random() * span);
    const lock = path.join(LOCK_ROOT, String(port));
    try {
      // 回收崩溃残留的陈旧锁
      try {
        const stat = fs.statSync(lock);
        if (now - stat.mtimeMs > STALE_MS) fs.rmSync(lock, { recursive: true, force: true });
      } catch {}
      fs.mkdirSync(lock); // 原子占位
      let released = false;
      return {
        port,
        release() {
          if (released) return;
          released = true;
          try { fs.rmSync(lock, { recursive: true, force: true }); } catch {}
        },
      };
    } catch { /* 已被占用，换一个 */ }
  }
  throw new Error('无法分配测试端口');
}
