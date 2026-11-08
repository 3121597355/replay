const resolveForm = document.querySelector('#resolveForm');
const urlInput = document.querySelector('#urlInput');
const resolveButton = document.querySelector('#resolveButton');
const statusRegion = document.querySelector('#statusRegion');
const statusTitle = document.querySelector('#statusTitle');
const statusDetail = document.querySelector('#statusDetail');
const browserVerifyButton = document.querySelector('#browserVerifyButton');
const resultsSection = document.querySelector('#resultsSection');
const resultsTitle = document.querySelector('#resultsTitle');
const resultsCount = document.querySelector('#resultsCount');
const mediaList = document.querySelector('#mediaList');
const mediaTemplate = document.querySelector('#mediaTemplate');
const openFolderButton = document.querySelector('#openFolderButton');
const historyList = document.querySelector('#historyList');
const historyCount = document.querySelector('#historyCount');
const historyEmpty = document.querySelector('#historyEmpty');
const historyTemplate = document.querySelector('#historyTemplate');
const clearHistoryButton = document.querySelector('#clearHistoryButton');
const historySearch = document.querySelector('#historySearch');
const historyFilters = document.querySelector('#historyFilters');
const historyEmptyTitle = document.querySelector('#historyEmptyTitle');
const historyEmptyDetail = document.querySelector('#historyEmptyDetail');
const emptyAction = document.querySelector('#emptyAction');
const historyMatchCount = document.querySelector('#historyMatchCount');
const serviceStatus = document.querySelector('#serviceStatus');
const pasteButton = document.querySelector('#pasteButton');
const clearUrlButton = document.querySelector('#clearUrlButton');

let resolveController = null;
let currentResult = null;
let historyTimer = null;
let historyItems = [];
let historyFilter = 'all';
let historyLoaded = false;
let historyLoading = false;
let historyError = false;
let historySignature = '';

function syncUrlControls() {
  clearUrlButton.hidden = !urlInput.value;
  urlInput.removeAttribute('aria-invalid');
}

function setResolving(loading) {
  resolveButton.disabled = loading;
  resolveButton.classList.toggle('is-loading', loading);
  resolveButton.querySelector('span').textContent = loading ? '正在解析' : '解析视频';
  resolveForm.setAttribute('aria-busy', String(loading));
  urlInput.readOnly = loading;
  pasteButton.disabled = loading;
  clearUrlButton.disabled = loading;
}

function setServiceStatus(state, label) {
  serviceStatus.dataset.state = state;
  serviceStatus.querySelector('span').textContent = label;
  serviceStatus.title = label;
  serviceStatus.setAttribute('aria-label', label);
  serviceStatus.hidden = state === 'ready';
}

function showStatus(tone, title, detail = '') {
  statusRegion.hidden = false;
  statusRegion.dataset.tone = tone;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
  statusDetail.hidden = !detail;
  browserVerifyButton.hidden = true;
}

function hideStatus() {
  statusRegion.hidden = true;
  statusRegion.removeAttribute('data-tone');
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）`);
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

function jsonOptions(body, signal) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  };
}

function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return null;
  const total = Math.round(Number(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatElapsed(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function taskLabel(status) {
  return {
    queued: '等待下载',
    downloading: '正在下载',
    processing: '正在分离字幕',
    paused: '已暂停',
    completed: '下载完成',
    failed: '下载失败',
  }[status] || '准备下载';
}

function updateProgress(track, value, metric, task) {
  const progress = Math.min(100, Math.max(0, Number(task.progress) || 0));
  const active = ['queued', 'downloading', 'processing'].includes(task.status);
  const indeterminate = active && (progress === 0 || task.status === 'processing');
  track.classList.toggle('is-indeterminate', indeterminate);
  value.style.width = indeterminate ? '' : `${progress}%`;
  track.setAttribute('aria-valuenow', String(Math.round(progress)));
  const metrics = [];
  if (progress > 0) metrics.push(`${Number.isInteger(progress) ? progress : progress.toFixed(1)}%`);
  if (progress === 0 && Number(task.elapsed) > 0) metrics.push(`已处理 ${formatElapsed(task.elapsed)}`);
  if (task.speed) metrics.push(task.speed);
  if (task.eta) metrics.push(`剩余 ${task.eta}`);
  metric.textContent = metrics.join(' · ');
}

function renderSubtitles(container, note, task) {
  container.replaceChildren();
  const files = (task.subtitles || []).filter(file => file.fileAvailable && file.fileUrl);
  for (const file of files) {
    const link = document.createElement('a');
    link.className = 'button button-secondary subtitle-download';
    link.href = file.fileUrl;
    link.setAttribute('download', file.filename);
    link.textContent = `保存 ${file.language || ''} SRT`;
    container.append(link);
  }
  note.hidden = !['completed', 'processing'].includes(task.status);
  note.textContent = task.status === 'processing' ? '视频已下载，正在导出字幕…'
    : task.subtitleWarning || (files.length ? `已分离 ${files.length} 个 SRT，与 MP4 分别保存。`
      : task.subtitleStatus === 'unchecked' ? '旧记录尚未提取字幕，可重新下载。'
      : '未发现可导出的文本字幕；画面中的字幕无法直接分离。');
}

async function openDownloads(button = openFolderButton) {
  button.disabled = true;
  const label = button.querySelector('span');
  const originalLabel = label?.textContent;
  try {
    await api('/api/open-downloads', { method: 'POST' });
    if (label) label.textContent = '已打开';
    showStatus('success', '已打开下载文件夹');
    window.setTimeout(() => {
      if (label) label.textContent = originalLabel;
    }, 1600);
  } catch (error) {
    showStatus('error', '无法打开下载文件夹', error.message);
  } finally {
    button.disabled = false;
  }
}

function updateTask(nodes, task) {
  nodes.task = task;
  nodes.taskPanel.dataset.status = task.status;
  nodes.taskStatus.textContent = taskLabel(task.status);
  nodes.taskError.hidden = !task.error;
  nodes.taskError.textContent = task.error || '';
  nodes.actions.hidden = task.status !== 'completed' || !task.fileUrl;
  renderSubtitles(nodes.subtitleLinks, nodes.subtitleNote, task);
  updateProgress(nodes.progressTrack, nodes.progressValue, nodes.taskMetric, task);
  const pausable = ['queued', 'downloading', 'paused'].includes(task.status);
  nodes.taskToggle.hidden = !pausable;
  nodes.taskToggle.querySelector('span').textContent = task.status === 'paused' ? '继续下载' : '暂停下载';

  if (task.status === 'completed') {
    nodes.taskMetric.textContent = `${Math.round(Number(task.progress) || 100)}% · ${task.filename || 'MP4'}`;
    if (task.fileUrl) nodes.fileDownload.href = task.fileUrl;
    nodes.fileDownload.setAttribute('download', task.filename || 'video.mp4');
    nodes.downloadButton.querySelector('span').textContent = '已完成';
    nodes.downloadButton.disabled = true;
  } else if (task.status === 'failed') {
    nodes.taskError.hidden = false;
    nodes.taskError.textContent = task.error || '下载未完成，请重试。';
    nodes.downloadButton.disabled = false;
    nodes.downloadButton.querySelector('span').textContent = '重试';
  } else {
    nodes.downloadButton.disabled = true;
    nodes.downloadButton.querySelector('span').textContent = task.status === 'paused' ? '已暂停' : task.status === 'processing' ? '分离字幕中' : '下载中';
  }
}

async function toggleTask(nodes) {
  const task = nodes.task;
  if (!task || !['queued', 'downloading', 'paused'].includes(task.status)) return;
  const action = task.status === 'paused' ? 'resume' : 'pause';
  nodes.taskToggle.disabled = true;
  try {
    const updated = await api(`/api/downloads/${encodeURIComponent(task.id)}/${action}`, { method: 'POST' });
    updateTask(nodes, updated);
    void loadHistory().catch(() => {});
    if (action === 'resume') await pollTask(updated.id, nodes);
  } catch (error) {
    nodes.taskError.hidden = false;
    nodes.taskError.textContent = error.message;
  } finally {
    nodes.taskToggle.disabled = false;
  }
}

async function pollTask(taskId, nodes) {
  try {
    const task = await api(`/api/downloads/${encodeURIComponent(taskId)}`);
    updateTask(nodes, task);
    if (['queued', 'downloading', 'processing'].includes(task.status)) {
      window.setTimeout(() => pollTask(taskId, nodes), 750);
    }
  } catch (error) {
    nodes.taskError.hidden = false;
    nodes.taskError.textContent = error.message;
    nodes.downloadButton.disabled = false;
  }
}

async function startDownload(item, nodes) {
  nodes.downloadButton.disabled = true;
  nodes.downloadButton.querySelector('span').textContent = '准备中';
  nodes.taskPanel.hidden = false;
  nodes.taskError.hidden = true;
  nodes.actions.hidden = true;
  nodes.taskStatus.textContent = '准备下载';
  nodes.taskMetric.textContent = '';
  nodes.progressTrack.classList.remove('is-indeterminate');
  nodes.progressValue.style.width = '0%';

  try {
    const task = await api('/api/downloads', jsonOptions({
      sourceUrl: currentResult.sourceUrl,
      itemId: item.id,
      title: item.title,
    }));
    nodes.downloadButton.querySelector('span').textContent = '下载中';
    updateTask(nodes, task);
    void loadHistory().catch(() => {});
    await pollTask(task.id, nodes);
  } catch (error) {
    nodes.taskStatus.textContent = '下载失败';
    nodes.taskError.hidden = false;
    nodes.taskError.textContent = error.message;
    nodes.downloadButton.disabled = false;
    nodes.downloadButton.querySelector('span').textContent = '重试';
  }
}

function renderHistory(items) {
  const activeElement = document.activeElement;
  const focusedRowId = activeElement?.closest('.history-row')?.dataset.taskId;
  const focusedAction = ['history-toggle', 'history-delete', 'history-download', 'history-open-folder']
    .find((name) => activeElement?.classList.contains(name));
  const query = historySearch.value.trim().toLocaleLowerCase();
  const counts = {
    all: items.length,
    active: items.filter((item) => ['queued', 'downloading', 'processing', 'paused'].includes(item.status)).length,
    completed: items.filter((item) => item.status === 'completed').length,
    failed: items.filter((item) => item.status === 'failed').length,
  };
  const visibleItems = items.filter((item) => {
    const matchesStatus = historyFilter === 'all'
      || (historyFilter === 'active' ? ['queued', 'downloading', 'processing', 'paused'].includes(item.status) : item.status === historyFilter);
    return matchesStatus && `${item.title || ''} ${item.filename || ''}`.toLocaleLowerCase().includes(query);
  });
  for (const button of historyFilters.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === historyFilter));
    button.querySelector('[data-count]').textContent = counts[button.dataset.filter];
  }
  historyList.replaceChildren();
  historyEmpty.hidden = visibleItems.length > 0;
  historyCount.textContent = `${items.length} 条记录`;
  historyMatchCount.textContent = `显示 ${visibleItems.length} 条下载记录`;
  const filtered = query || historyFilter !== 'all';
  historyEmptyTitle.textContent = filtered ? '没有匹配的下载记录' : '暂无下载记录';
  historyEmptyDetail.hidden = true;
  emptyAction.hidden = !filtered;
  emptyAction.querySelector('span').textContent = '查看全部记录';
  clearHistoryButton.disabled = !items.some((item) => ['completed', 'failed'].includes(item.status));

  for (const task of visibleItems) {
    const fragment = historyTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.history-row');
    row.dataset.taskId = task.id;
    row.dataset.status = task.status;
    fragment.querySelector('.history-title').textContent = task.title || '视频';
    const created = new Date(task.createdAt);
    fragment.querySelector('.history-meta').textContent = Number.isNaN(created.getTime()) ? '视频下载任务' : created.toLocaleString('zh-CN');
    fragment.querySelector('.history-status').textContent = taskLabel(task.status);
    fragment.querySelector('.history-state').textContent = task.filename || 'MP4';
    updateProgress(
      fragment.querySelector('.progress-track'),
      fragment.querySelector('.progress-value'),
      fragment.querySelector('.history-metric'),
      task,
    );

    const error = fragment.querySelector('.history-error');
    error.hidden = !task.error;
    error.textContent = task.error || '';
    const actions = fragment.querySelector('.history-actions');
    renderSubtitles(fragment.querySelector('.subtitle-links'), fragment.querySelector('.subtitle-note'), task);
    const toggle = fragment.querySelector('.history-toggle');
    const deleteButton = fragment.querySelector('.history-delete');
    const pausable = ['queued', 'downloading', 'paused'].includes(task.status);
    const removable = ['completed', 'failed'].includes(task.status);
    const hasFileActions = Boolean(task.fileAvailable && task.fileUrl);
    toggle.hidden = !pausable;
    deleteButton.hidden = !removable;
    actions.hidden = !hasFileActions && !removable;
    toggle.querySelector('span').textContent = task.status === 'paused' ? '继续下载' : '暂停下载';
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        const action = task.status === 'paused' ? 'resume' : 'pause';
        await api(`/api/downloads/${encodeURIComponent(task.id)}/${action}`, { method: 'POST' });
        await loadHistory();
      } catch (error) {
        showStatus('error', '无法更新下载任务', error.message);
      } finally {
        toggle.disabled = false;
      }
    });
    deleteButton.addEventListener('click', async () => {
      if (!removable || !window.confirm('删除这条下载记录？已下载的文件将保留。')) return;
      deleteButton.disabled = true;
      try {
        await api(`/api/downloads/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
        await loadHistory();
        showStatus('success', '已删除下载记录');
      } catch (error) {
        showStatus('error', '无法删除下载记录', error.message);
        deleteButton.disabled = false;
      }
    });
    const download = fragment.querySelector('.history-download');
    const folderButton = fragment.querySelector('.history-open-folder');
    download.hidden = !hasFileActions;
    folderButton.hidden = !hasFileActions;
    if (hasFileActions) {
      download.href = task.fileUrl;
      download.setAttribute('download', task.filename || 'video.mp4');
      folderButton.addEventListener('click', () => openDownloads(folderButton));
    } else if (task.status === 'completed') {
      error.hidden = false;
      error.textContent = '文件不存在';
    }
    historyList.append(fragment);
    if (task.id === focusedRowId && focusedAction) {
      const control = row.querySelector(`.${focusedAction}`);
      if (!control.hidden && !control.closest('[hidden]')) control.focus({ preventScroll: true });
    }
  }
}

async function loadHistory() {
  if (historyLoading) return;
  historyLoading = true;
  window.clearTimeout(historyTimer);
  try {
    const { items } = await api('/api/downloads');
    const signature = JSON.stringify(items);
    historyItems = items;
    if (!historyLoaded || historyError || signature !== historySignature) renderHistory(items);
    historyLoaded = true;
    historyError = false;
    historySignature = signature;
  } catch (error) {
    historyError = true;
    if (!historyLoaded) {
      historyEmpty.hidden = false;
      historyEmptyTitle.textContent = '暂时无法读取下载记录';
      historyEmptyDetail.textContent = error.message;
      historyEmptyDetail.hidden = false;
      emptyAction.hidden = false;
      emptyAction.querySelector('span').textContent = '重新加载';
      historyCount.textContent = '连接异常';
    }
    throw error;
  } finally {
    historyLoading = false;
    const active = historyItems.some((item) => ['queued', 'downloading', 'processing'].includes(item.status));
    historyTimer = window.setTimeout(() => { void loadHistory().catch(() => {}); }, active ? 750 : 5000);
  }
}

function renderResults(result) {
  currentResult = result;
  mediaList.replaceChildren();
  resultsTitle.textContent = result.title || '解析结果';
  resultsCount.textContent = `${result.items.length} 个视频`;

  result.items.forEach((item, index) => {
    const fragment = mediaTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.media-row');
    const nodes = {
      downloadButton: fragment.querySelector('.media-download'),
      taskPanel: fragment.querySelector('.task-panel'),
      taskStatus: fragment.querySelector('.task-status'),
      taskMetric: fragment.querySelector('.task-metric'),
      progressTrack: fragment.querySelector('.progress-track'),
      progressValue: fragment.querySelector('.progress-value'),
      taskError: fragment.querySelector('.task-error'),
      actions: fragment.querySelector('.task-actions'),
      fileDownload: fragment.querySelector('.file-download'),
      taskToggle: fragment.querySelector('.task-toggle'),
      subtitleLinks: fragment.querySelector('.subtitle-links'),
      subtitleNote: fragment.querySelector('.subtitle-note'),
    };
    row.dataset.mediaId = item.id;
    fragment.querySelector('.media-index').textContent = String(index + 1).padStart(2, '0');
    fragment.querySelector('.media-title').textContent = item.title || `视频 ${index + 1}`;
    const meta = [item.format, item.resolution, formatDuration(item.duration)].filter(Boolean);
    fragment.querySelector('.media-meta').textContent = meta.join(' · ');
    nodes.downloadButton.addEventListener('click', () => startDownload(item, nodes));
    nodes.taskToggle.addEventListener('click', () => toggleTask(nodes));
    const folderButton = fragment.querySelector('.row-open-folder');
    folderButton.addEventListener('click', () => openDownloads(folderButton));
    mediaList.append(fragment);
  });

  resultsSection.hidden = false;
  hideStatus();
}

resolveForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = urlInput.value.trim();
  let parsed;
  try {
    parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    urlInput.setAttribute('aria-invalid', 'true');
    showStatus('error', '链接格式不正确', '请输入以 http:// 或 https:// 开头的完整链接。');
    urlInput.focus();
    return;
  }

  resolveController?.abort();
  resolveController = new AbortController();
  setResolving(true);
  resultsSection.hidden = true;
  showStatus('loading', '正在解析视频', '正在读取页面中的媒体信息。');

  try {
    const result = await api('/api/resolve', jsonOptions({ url: parsed.href }, resolveController.signal));
    renderResults(result);
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (error.code === 'BROWSER_VERIFICATION_REQUIRED') {
      showStatus('warning', '需要浏览器验证', '使用下载器专用浏览器完成页面验证后，将自动继续解析。');
      browserVerifyButton.hidden = false;
    } else {
      showStatus('error', '没有解析到可下载视频', error.message);
    }
  } finally {
    setResolving(false);
  }
});

browserVerifyButton.addEventListener('click', async () => {
  const value = urlInput.value.trim();
  browserVerifyButton.disabled = true;
  setResolving(true);
  resultsSection.hidden = true;
  showStatus('loading', '等待浏览器验证', '请在专用 Chrome 中完成验证后开始播放视频，并保持窗口打开。');
  try {
    const result = await api('/api/browser-resolve', jsonOptions({ url: value }));
    renderResults(result);
  } catch (error) {
    showStatus('error', '浏览器验证未完成', error.message);
    browserVerifyButton.hidden = false;
  } finally {
    browserVerifyButton.disabled = false;
    setResolving(false);
  }
});

openFolderButton.addEventListener('click', () => openDownloads(openFolderButton));

clearHistoryButton.addEventListener('click', async () => {
  if (!window.confirm('清空已完成和失败的下载记录？进行中的任务和已下载文件将保留。')) return;
  clearHistoryButton.disabled = true;
  try {
    await api('/api/downloads', { method: 'DELETE' });
    await loadHistory();
  } catch (error) {
    showStatus('error', '无法清空下载记录', error.message);
  }
});

urlInput.addEventListener('input', syncUrlControls);
clearUrlButton.addEventListener('click', () => {
  urlInput.value = '';
  syncUrlControls();
  hideStatus();
  urlInput.focus();
});
pasteButton.addEventListener('click', async () => {
  pasteButton.disabled = true;
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      showStatus('warning', '剪贴板中没有链接', '先复制视频链接，再点击粘贴。');
      return;
    }
    urlInput.value = text.trim();
    syncUrlControls();
    hideStatus();
    urlInput.focus();
  } catch {
    showStatus('warning', '请手动粘贴链接', '点击输入框，按 Ctrl + V 粘贴复制的视频链接。');
    urlInput.focus();
  } finally {
    pasteButton.disabled = false;
  }
});
historyFilters.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-filter]');
  if (!button) return;
  historyFilter = button.dataset.filter;
  if (historyLoaded) renderHistory(historyItems);
});
historySearch.addEventListener('input', () => {
  if (historyLoaded) renderHistory(historyItems);
});
emptyAction.addEventListener('click', () => {
  if (historyError && !historyLoaded) {
    void loadHistory().catch(() => {});
  } else if (historySearch.value || historyFilter !== 'all') {
    historySearch.value = '';
    historyFilter = 'all';
    renderHistory(historyItems);
  } else {
    urlInput.focus();
    document.querySelector('#resolver').scrollIntoView({ block: 'center' });
  }
});
syncUrlControls();

loadHistory().catch((error) => showStatus('error', '无法读取下载记录', error.message));

async function checkHealth() {
  try {
    const { dependencies } = await api('/api/health');
    const missing = [];
    if (!dependencies.ytDlp) missing.push('yt-dlp');
    if (!dependencies.ffmpeg) missing.push('FFmpeg');
    if (dependencies.ffprobe === false) missing.push('FFprobe（字幕检测）');
    setServiceStatus(missing.length ? 'warning' : 'ready', missing.length ? '组件待检查' : '本地服务已就绪');
    if (missing.length && statusRegion.hidden) showStatus('warning', '下载组件未就绪', `缺少 ${missing.join('、')}，请检查 tools 目录和系统环境。`);
  } catch {
    setServiceStatus('offline', '本地服务未连接');
  }
}
void checkHealth();
window.setInterval(checkHealth, 30000);
