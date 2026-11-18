import { useSyncExternalStore } from 'react';

export const THEMES = { light: '浅色', dark: '深色' };

const STORAGE_KEY = 'gl:theme';
const DEFAULT_THEME = 'light';

// 模块级单一数据源：任意组件调用 useTheme 都读取同一份状态
let currentTheme = readStoredTheme();
const listeners = new Set();

function normalize(theme) {
  return theme === THEMES.dark || theme === 'dark' ? 'dark' : 'light';
}

function readStoredTheme() {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** 把主题写到 documentElement 上；入口可在渲染前调用以避免闪烁 */
export function applyTheme(theme) {
  const next = normalize(theme);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = next;
  }
  return next;
}

function emit() {
  listeners.forEach((listener) => listener());
}

function setTheme(theme) {
  const next = normalize(theme);
  currentTheme = next;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  } catch {
    // 隐私模式等场景下 localStorage 不可写，内存状态仍然生效
  }
  applyTheme(next);
  emit();
}

function toggleTheme() {
  setTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return currentTheme;
}

// 首次加载即应用已保存的主题
applyTheme(currentTheme);

// 多标签页之间保持同步（storage 事件只在其他标签页触发，不会造成回环）
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY && event.newValue !== currentTheme) {
      currentTheme = normalize(event.newValue);
      applyTheme(currentTheme);
      emit();
    }
  });
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { theme, setTheme, toggleTheme };
}
