'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { estimateLevel, formatTime } from '@/lib/srt';
import { parseSubtitle, detectFormat, formatLabel } from '@/lib/subtitle';
import { isSoundCue } from '@/lib/lang';
import { getWork } from '@/lib/data';
import { exportAnkiCsv, exportSavedWords, exportSrtBlob } from '@/lib/anki';
import { buildSrt, buildVtt, deriveName } from '@/lib/subtitle-export';
import { episodeKey, guessLanguage, pairEpisodes, type Episode } from '@/lib/pairing';
import { discardDownloadImport, readDownloadImport } from '@/lib/download-import';
import { chooseDownloadSubtitle } from '@/lib/download-subtitles';
import { trackEvent } from '@/lib/analytics-events';
import {
  pickAndScan,
  readHandle,
  readTextHandle,
  supportsDirectoryPicker,
} from '@/lib/dirpicker';
import { clearProgress, fmtTime, loadProgress, saveProgress, type Progress } from '@/lib/progress';
import { extractFast, trackToSrt, describeTrack } from '@/lib/demux';
import { loadConfig, saveConfig, translateCues, testConfig, DEFAULT_CONFIG } from '@/lib/translate';
import { getJob, startJob, subscribeJob, isRunning as transRunning } from '@/lib/transjob';
import {
  applyCache,
  cacheStats,
  clearAllCaches,
  hashText,
  mergeCache,
  readCache,
} from '@/lib/transcache';
import {
  loadFFmpeg,
  probeSubtitleTracks,
  extractSubtitle,
  trackLabel,
  canRead,
  type SubtitleTrack,
  type ExtractStage,
} from '@/lib/ffmpeg';
import type { Cue, SavedLineClip, SavedWord } from '@/lib/types';
import { Suspense } from 'react';
import { createPortal } from 'react-dom';
import WordCard, { type LookupState } from '@/components/WordCard';
import { lookup, loadDict, tokenize } from '@/lib/dict';
import sample from '@/public/sample/manchester-repair-v2.json';
import { loadSavedWords, persistSavedWords } from '@/lib/saved-words';
import { fetchTextWithTimeout } from '@/lib/browser';
import { clearLearningSession, fileLearningSource, loadLearningSession, matchesLearningVideo,
  rememberLearningSession, saveLearningSession, type LearningSession, type LearningSource } from '@/lib/learning-session';
import type { AccountUser } from '@/lib/account-types';
import LearningActivity from './account/LearningActivity';
import SavedVocabularyCard from './SavedVocabularyCard';
import VocabularyMotionToggle from './VocabularyMotion';
import SpeakingPractice from './SpeakingPractice';
import { savedClipFor, validSavedClip } from '@/lib/saved-line';
import { savedMediaStore } from '@/lib/saved-media';
import { isAudioSource, MEDIA_ACCEPT } from '@/lib/media';
import { getStorageOwner } from '@/lib/account-storage';

const RATES = [0.5, 0.75, 1, 1.25, 1.5];

function LearnInner({ trial = false, user }: { trial?: boolean; user?: AccountUser | null }) {
  const sampleOnly = trial;
  const params = useSearchParams();
  const fromSlug = params.get('from');
  const fromWork = fromSlug ? getWork(fromSlug) : undefined;

  const videoRef = useRef<HTMLMediaElement | null>(null);
  const attachPlayer = useCallback((player: HTMLMediaElement | null) => { videoRef.current = player; }, []);
  const speakingEndRef = useRef<number>();
  const listRef = useRef<HTMLDivElement>(null);
  const cueRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [videoUrl, setVideoUrl] = useState<string>();
  const [videoFile, setVideoFile] = useState<File>();
  const [videoName, setVideoName] = useState<string>();
  const audioOnly = isAudioSource(videoFile || (videoName ? { name: videoName, type: '' } : undefined));
  const Player = audioOnly ? 'audio' : 'video';
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionNotice, setSessionNotice] = useState<string>();
  const [missingSession, setMissingSession] = useState<LearningSession | null>(null);
  const sessionIdRef = useRef<string>();
  const sessionSourceRef = useRef<LearningSource>();
  const sessionTimeRef = useRef(0);
  const restoreTimeRef = useRef<number | null>(null);
  const restoreGenerationRef = useRef(0);
  const sessionSnapshotRef = useRef<LearningSession | null>(null);
  const flushSessionRef = useRef<() => void>(() => {});
  const [downloadImportError, setDownloadImportError] = useState<string>();
  const importedDownloadRef = useRef<string>();
  const [loadingSample, setLoadingSample] = useState(false);
  const sampleRequestRef = useRef<AbortController | null>(null);
  const [sampleError, setSampleError] = useState<string>();
  const [videoStatus, setVideoStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [videoError, setVideoError] = useState<string>();
  const [cues, setCues] = useState<Cue[]>([]);
  const [sourceName, setSourceName] = useState<string>();
  const [current, setCurrent] = useState(-1);
  // 当前正在显示的字幕与精听选中的句子分开，空白处隐藏字幕仍可重播。
  const [selected, setSelected] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1);
  const [showTrans, setShowTrans] = useState(true);
  const [saved, setSaved] = useState<SavedWord[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [testResult, setTestResult] = useState<{
    pending: boolean;
    ok?: boolean;
    msg: string;
  } | null>(null);

  // 弹层要等挂到客户端才能 portal 到 body
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /**
   * 是否让字幕列表跟着播放走。
   * 用户手动滚动就关掉——不然他往上翻两句就被拽回当前句，
   * 根本没法回头找刚才漏听的那一句。
   */
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  // 点词查义
  const [lookupState, setLookupState] = useState<LookupState | null>(null);
  const lookupClipRef = useRef<{ sentence: string; sentenceTranslation?: string; clip?: SavedLineClip; file?: File }>();

  /**
   * 当前字幕的内容指纹，翻译缓存按它索引。
   * 同一份字幕重新导入，hash 一样，译文直接命中。
   */
  const subHashRef = useRef<string | null>(null);
  /** 同一份值再用 state 存一份，方便挂到 DOM 上做诊断 */
  const [subHash, setSubHash] = useState<string | null>(null);
  /** 这次加载有没有从缓存捡回译文，给界面用 */
  const [cachedHits, setCachedHits] = useState(0);
  /** 设置面板里显示的缓存占用 */
  const [cacheInfo, setCacheInfo] = useState({ count: 0, bytes: 0 });
  const refreshCacheInfo = useCallback(() => setCacheInfo(cacheStats()), []);

  /** 把缓存套到刚解析出来的字幕上。返回命中的句数。 */
  function hydrateFromCache(
    list: Cue[],
    hash: string
  ): { list: Cue[]; hits: number } {
    const entry = readCache(hash);
    if (!entry) return { list, hits: 0 };
    const { cues: merged, applied } = applyCache(list, entry);
    return { list: merged, hits: applied };
  }

  // 字幕选完就预热词典，等人点词时不用等下载
  useEffect(() => {
    if (cues.length === 0) return;
    loadDict().catch(() => {
      /* 词典拿不到就退化成「查不到」，不影响别的主流程 */
    });
  }, [cues.length]);

  const cueTokens = useMemo(() => cues.map((c) => tokenize(c.text)), [cues]);

  function clipForCue(cue?: Cue) {
    return cue && sessionIdRef.current && sessionSourceRef.current && videoName
      ? savedClipFor(cue, sessionIdRef.current, videoName, sessionSourceRef.current) : undefined;
  }
  function cacheCollectionClip(clip?: SavedLineClip, file?: File) {
    if (clip && file) void savedMediaStore().save(clip, file).then(saved => { if (!saved) flash('收藏和原句时间点已保存；回放原片未能缓存，下次可重新选择原片。'); });
  }
  async function openLookup(word: string, sentence: string, cue?: Cue) {
    lookupClipRef.current = { sentence, sentenceTranslation: cue?.translation || cue?.native, clip: clipForCue(cue), file: videoFile };
    trackEvent('word_lookup');
    setLookupState({ word, sentence, result: null, loading: true });
    try {
      const r = await lookup(word);
      setLookupState((prev) =>
        prev && prev.word === word ? { ...prev, result: r, loading: false } : prev
      );
    } catch {
      setLookupState((prev) => (prev && prev.word === word ? { ...prev, loading: false } : prev));
    }
  }

  function saveWord(word: string, sentence: string, def: string) {
    const origin = lookupClipRef.current?.sentence === sentence ? lookupClipRef.current : undefined;
    const exists = saved.some((s) => s.word.toLowerCase() === word.toLowerCase());
    if (exists) {
      const previous = saved.find(item => item.word.toLowerCase() === word.toLowerCase());
      if (previous?.sentence === sentence && origin) {
        const missingClip = !validSavedClip(previous.clip) && origin.clip;
        const sentenceTranslation = !previous.sentenceTranslation && origin.sentenceTranslation && (!validSavedClip(previous.clip) || previous.clip.videoId === origin.clip?.videoId) ? origin.sentenceTranslation : undefined;
        if (missingClip || sentenceTranslation) {
          setSaved(items => items.map(item => item === previous ? { ...item, ...(missingClip ? { clip: origin.clip } : {}), ...(sentenceTranslation ? { sentenceTranslation } : {}) } : item));
          cacheCollectionClip(origin.clip, origin.file); flash('已补全收藏的原句信息'); return;
        }
      }
      flash('这个词已经在生词本里了');
      return;
    }
    setSaved((prev) => [
      ...prev,
      { word, sentence, translation: def, sentenceTranslation: origin?.sentenceTranslation, addedAt: Date.now(), ...(origin?.clip ? { clip: origin.clip } : {}) },
    ]);
    flash(`已收藏 ${word}`);
    cacheCollectionClip(origin?.clip, origin?.file);
    trackEvent('word_save');
  }

  function isWordSaved(word: string) {
    return saved.some((s) => s.word.toLowerCase() === word.toLowerCase());
  }
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  /** 目录导入扫描出来的剧集 */
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [scanning, setScanning] = useState<number | null>(null);
  /** 目录导入要 Chrome / Edge，别的浏览器不显示这个入口 */
  const [canUseFolder, setCanUseFolder] = useState(false);
  useEffect(() => setCanUseFolder(supportsDirectoryPicker()), []);

  /**
   * 解码引擎不再预加载。
   *
   * 现在 mp4 / mkv 都走纯 JS 解析（几百 KB，毫秒级），
   * 只有 avi、ts 这类不认识的容器才需要 ffmpeg。
   * 为那 1% 的情况让所有人先下 31MB，不划算——
   * 真需要的时候会在「抽字幕」里自己加载。
   */
  /** 续播提示：这份字幕上次看到哪儿 */
  const [resume, setResume] = useState<Progress | null>(null);
  /** 上次写进度的时间，用来节流 */
  const lastSaveRef = useRef(0);
  const [cfg, setCfg] = useState(DEFAULT_CONFIG);
  const [toast, setToast] = useState<string>();
  // 字幕抽取
  const [extractState, setExtractState] = useState<ExtractStage | null>(null);
  const [tracks, setTracks] = useState<SubtitleTrack[] | null>(null);
  const [noTrack, setNoTrack] = useState(false);
  const ffRef = useRef<Awaited<ReturnType<typeof loadFFmpeg>> | null>(null);

  const loopRef = useRef(loop);
  const currentRef = useRef(current);
  const selectedRef = useRef(selected);
  const loopCueRef = useRef(-1);
  const cuesRef = useRef(cues);
  loopRef.current = loop;
  currentRef.current = current;
  selectedRef.current = selected;
  cuesRef.current = cues;

  // ---------- 初始化 ----------
  useEffect(() => {
    setCfg(loadConfig());
    setSaved(loadSavedWords());
    const owner = getStorageOwner();
    const update = (event: Event) => { if ((event as CustomEvent<string>).detail === owner) setSaved(loadSavedWords(owner)); };
    window.addEventListener('replay:saved-words-updated', update);
    return () => window.removeEventListener('replay:saved-words-updated', update);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    persistSavedWords(saved);
  }, [saved, mounted]);

  useEffect(() => () => sampleRequestRef.current?.abort(), []);

  useEffect(() => () => {
    if (videoUrl?.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => {
    if (!videoUrl || videoStatus !== 'loading') return;
    const timer = setTimeout(() => {
      if ((videoRef.current?.readyState ?? 0) < 3) {
        setVideoError('素材加载较慢，请检查文件或网络后重试。字幕已就绪，可以先阅读。');
        setVideoStatus('error');
      }
    }, 20000);
    return () => clearTimeout(timer);
  }, [videoUrl, videoStatus]);

  // 打开设置时才统计缓存占用，没必要每次渲染都扫 localStorage
  useEffect(() => {
    if (showSettings) refreshCacheInfo();
  }, [showSettings, refreshCacheInfo]);

  /**
   * 翻译任务的进度。
   * 任务本身活在模块作用域（lib/transjob），组件只是订阅者——
   * 所以切到别的页面翻译还在跑，回来能接着看进度。
   */
  const job = useSyncExternalStore(subscribeJob, getJob, () => null);
  /** 任务是否正在跑（可能是在别的页面启动的） */
  const jobRunning = job?.status === 'running';
  /** 这个任务是不是当前这份字幕的 */
  const jobIsMine = jobRunning && job?.hash === subHash;

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(undefined), 2600);
  }, []);

  // Rebuild blob URLs from the saved File; an old blob URL never survives a page reload.
  function restoreLearning(saved: LearningSession, file?: File) {
    restoreGenerationRef.current++;
    sessionIdRef.current = saved.id;
    sessionSourceRef.current = saved.source;
    sessionTimeRef.current = saved.time;
    restoreTimeRef.current = saved.time;
    let restoredCues = saved.cues;
    if (saved.hash) {
      const cache = readCache(saved.hash);
      if (cache) restoredCues = applyCache(restoredCues, cache).cues;
    }
    subHashRef.current = saved.hash;
    cuesRef.current = restoredCues;
    setSubHash(saved.hash); setCues(restoredCues); setSourceName(saved.sourceName);
    setRate(RATES.includes(saved.rate) ? saved.rate : 1);
    loopRef.current = saved.loop; setLoop(saved.loop); setShowTrans(saved.showTrans);
    const selectedCue = saved.selected >= 0 && saved.selected < restoredCues.length ? saved.selected : -1;
    selectedRef.current = selectedCue; loopCueRef.current = selectedCue;
    setSelected(selectedCue); setCurrent(-1); currentRef.current = -1;
    setVideoName(saved.videoName); setVideoFile(file); setResume(null); setPlaying(false);
    setVideoStatus('loading'); setVideoError(undefined); setFollow(true);
    const missing = saved.source.kind === 'file' && !file;
    setMissingSession(missing ? saved : null);
    setVideoUrl(saved.source.kind === 'sample' ? sample.video : file ? URL.createObjectURL(file) : undefined);
    setSessionNotice(missing ? '字幕和进度已恢复。请选择原素材继续，学习记录会保留。' : undefined);
    if (!missing) flash('已恢复上次的素材、字幕和进度');
  }

  useEffect(() => {
    const generation = restoreGenerationRef.current;
    let cancelled = false;
    if (trial) { setSessionLoading(false); void loadSample(); return () => sampleRequestRef.current?.abort(); }
    if (params.get('download')) { setSessionLoading(false); return; }
    void loadLearningSession().then(saved => {
      if (cancelled || generation !== restoreGenerationRef.current) return;
      if (saved) restoreLearning(saved.session, saved.video);
    }).catch(() => {
      if (!cancelled && generation === restoreGenerationRef.current)
        setSessionNotice('当前浏览器无法读取本地学习记录，仍可直接导入文件学习。');
    }).finally(() => { if (!cancelled) setSessionLoading(false); });
    return () => { cancelled = true; };
  }, []);

  sessionSnapshotRef.current = sessionIdRef.current && sessionSourceRef.current ? {
    id: sessionIdRef.current, source: sessionSourceRef.current, videoName: videoName ?? '',
    cues, sourceName, hash: subHash, time: restoreTimeRef.current ?? sessionTimeRef.current,
    selected, rate, loop, showTrans, updatedAt: Date.now(),
  } : null;
  flushSessionRef.current = () => {
    if (trial) return;
    const snapshot = sessionSnapshotRef.current;
    if (!snapshot) return;
    const latest = { ...snapshot, time: restoreTimeRef.current ?? sessionTimeRef.current,
      selected: selectedRef.current, updatedAt: Date.now() };
    void saveLearningSession(latest).then(result => {
      if (sessionIdRef.current === latest.id && result.message) setSessionNotice(result.message);
    });
  };
  useEffect(() => {
    const snapshot = sessionSnapshotRef.current;
    if (!snapshot || trial) return;
    // Update memory immediately, then debounce disk writes while switching subtitle lines.
    rememberLearningSession(snapshot);
    const timer = setTimeout(() => flushSessionRef.current(), 500);
    return () => clearTimeout(timer);
  }, [videoName, videoUrl, cues, sourceName, subHash, rate, loop, showTrans, selected]);
  useEffect(() => {
    const flush = () => flushSessionRef.current();
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      flush(); window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  /** 把浏览器原生错误翻译成人话，别把英文原文甩给用户 */
  function humanize(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    if (/could not be read|NotReadableError/i.test(msg)) {
      return '读不到这个文件（云盘占位 / 被占用 / 网络盘）。复制到本地硬盘再试。';
    }
    if (/allocation|out of memory|Array buffer/i.test(msg)) {
      return '文件太大，浏览器内存不够。先截一小段再试。';
    }
    if (/Failed to fetch|NetworkError|ffmpeg 加载失败/i.test(msg)) {
      return 'ffmpeg 没加载下来，检查下网络再点一次。';
    }
    return msg.length > 120 ? '抽字幕失败了，换个片源试试。' : msg || '出错了';
  }

  // ---------- 视频 ----------
  function setVideoSource(url: string, name: string, file?: File) {
    videoRef.current?.pause();
    restoreGenerationRef.current++;
    const id = crypto.randomUUID();
    sessionIdRef.current = id; sessionSourceRef.current = file ? fileLearningSource(file) : { kind: 'sample' };
    sessionTimeRef.current = 0; restoreTimeRef.current = 0;
    setSessionLoading(false); setMissingSession(null);
    setSessionNotice(file ? '正在将素材保存在此浏览器，保存后退出也可继续。' : undefined);
    const initial: LearningSession = { id, source: sessionSourceRef.current, videoName: name,
      cues: [], hash: null, time: 0, selected: -1, rate, loop, showTrans, updatedAt: Date.now() };
    sessionSnapshotRef.current = initial;
    if (!trial) void saveLearningSession(initial, file).then(result => {
      if (sessionIdRef.current === id) setSessionNotice(result.message);
    });
    setCues([]);
    setSourceName(undefined);
    subHashRef.current = null;
    setSubHash(null);
    setResume(null);
    setVideoUrl(url);
    setVideoFile(file);
    setVideoName(name);
    setVideoStatus('loading');
    setVideoError(undefined);
    setSampleError(undefined);
    if (videoUrl === url) videoRef.current?.load();
    setCurrent(-1);
    setSelected(-1);
    currentRef.current = -1;
    selectedRef.current = -1;
    loopCueRef.current = -1;
    setPlaying(false);
    setNoTrack(false);
    setTracks(null);
  }

  async function onVideoFile(file?: File) {
    if (!file) return;
    if (sampleOnly) { window.location.assign(user ? '/learn' : '/signup?returnTo=%2Flearn'); return; }
    sampleRequestRef.current?.abort();
    setLoadingSample(false);
    if (missingSession && matchesLearningVideo(missingSession.source, file)) {
      const restored = { ...missingSession, cues, sourceName, hash: subHash, rate, loop, showTrans };
      restoreLearning(restored, file);
      setSessionLoading(false);
      void saveLearningSession(restored, file).then(result => {
        if (sessionIdRef.current === restored.id) setSessionNotice(result.message);
      });
      return;
    }
    const url = URL.createObjectURL(file);
    setVideoSource(url, file.name, file);
    const selectedSession = sessionIdRef.current;
    trackEvent('video_import');
    flash(`已加载：${file.name}`);

    // 立刻探一下能不能读到内容，别等点抽字幕才发现
    const ok = await canRead(file);
    if (!ok && sessionIdRef.current === selectedSession) {
      setVideoFile(undefined);
      flash(
        '这个文件读不到内容（云盘占位 / 被占用 / 在网络盘上）。视频能播，但抽不了字幕——复制到本地硬盘再试。'
      );
    }
  }

  async function clearCurrentLearning() {
    if (!window.confirm('清除当前浏览器保存的素材、字幕和这次播放进度？生词本和电脑里的原文件会保留。')) return;
    restoreGenerationRef.current++;
    sampleRequestRef.current?.abort(); videoRef.current?.pause();
    if (subHashRef.current) clearProgress(subHashRef.current);
    sessionIdRef.current = undefined; sessionSourceRef.current = undefined;
    sessionSnapshotRef.current = null; sessionTimeRef.current = 0; restoreTimeRef.current = null;
    subHashRef.current = null; cuesRef.current = [];
    currentRef.current = selectedRef.current = loopCueRef.current = -1;
    setVideoUrl(undefined); setVideoFile(undefined); setVideoName(undefined);
    setCues([]); setSubHash(null); setSourceName(undefined); setResume(null);
    setCurrent(-1); setSelected(-1); setPlaying(false); setMissingSession(null);
    setLoadingSample(false); setSessionLoading(false); setSessionNotice(undefined);
    setRate(1); setLoop(false); setShowTrans(true); setTracks(null); setNoTrack(false);
    try { await clearLearningSession(); flash('已清除这次学习的本地记录'); }
    catch { setSessionNotice('本地记录清理失败，请检查浏览器存储设置。'); }
  }

  function applySrt(text: string, label: string) {
    const raw = parseSubtitle(text, label);
    if (raw.length === 0) {
      flash('没解析出字幕，检查一下是不是标准的 .srt / .vtt / .ass');
      return false;
    }

    // 内容指纹 → 命中缓存就不用再翻一遍
    const hash = hashText(text);
    subHashRef.current = hash;
    setSubHash(hash);
    const { list: parsed, hits } = hydrateFromCache(raw, hash);
    setCachedHits(hits);

    // 上次看到哪儿了
    const prog = loadProgress(hash);
    setResume(prog);

    setCues(parsed);
    setSourceName(label);
    setCurrent(-1);
    setSelected(-1);
    currentRef.current = -1;
    selectedRef.current = -1;
    loopCueRef.current = -1;

    const bilingual = parsed.filter((c) => c.native).length;
    const fmt = formatLabel[detectFormat(text, label)];
    const base =
      bilingual > 0
        ? `解析到 ${parsed.length} 条字幕（${fmt} · 双语 ${bilingual} 条）`
        : `解析到 ${parsed.length} 条字幕（${fmt}）`;
    flash(hits > 0 ? `${base} · 恢复 ${hits} 句旧译文` : base);
    return true;
  }

  function onSubFile(file?: File) {
    if (!file) return;
    if (sampleOnly) { window.location.assign(user ? '/learn' : '/signup?returnTo=%2Flearn'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (applySrt(String(reader.result ?? ''), file.name)) trackEvent('subtitle_import');
    };
    reader.readAsText(file, 'utf-8');
  }

  useEffect(() => {
    const id = params.get('download');
    if (!id || sampleOnly || importedDownloadRef.current === id) return;
    let cancelled = false;
    void (async () => {
      try {
        const bundle = await readDownloadImport(id);
        if (cancelled) return;
        if (!bundle) throw new Error('这次导入已过期或已完成，请从下载器重新导入。');
        const selection = await chooseDownloadSubtitle(bundle.video.name, bundle.subtitles);
        if (cancelled) return;
        importedDownloadRef.current = id;
        const media = (file: File, kind: 'video' | 'subtitle') => ({
          name: file.name, kind, size: file.size, handle: { getFile: async () => file },
        });
        const subtitles = selection.files.map(file => media(file, 'subtitle'));
        const best = selection.selected ? subtitles.find(file => file.name === selection.selected?.file.name) : undefined;
        await onVideoFile(bundle.video);
        if (cancelled) return;
        if (selection.selected) applySrt(selection.selected.text, selection.selected.file.name);
        setEpisodes([{
          key: episodeKey(bundle.video.name), label: bundle.video.name.replace(/\.mp4$/i, ''),
          video: media(bundle.video, 'video'), subtitles, best,
          bestLang: best ? guessLanguage(best.name) : undefined,
        }]);
        setDownloadImportError(undefined);
        trackEvent('download_import');
        flash(selection.note);
        await discardDownloadImport(id).catch(() => flash('文件已导入，浏览器暂未清理临时副本。'));
        const url = new URL(window.location.href);
        url.searchParams.delete('download');
        window.history.replaceState(window.history.state, '', url);
      } catch (error) {
        if (!cancelled) setDownloadImportError(error instanceof Error ? error.message : '下载文件导入失败，请重新导入。');
      }
    })();
    return () => { cancelled = true; };
  }, [params, flash]);

  // ---------- 自动抽字幕 ----------
  async function handleExtract(fileArg?: File) {
    const file = fileArg ?? videoFile;
    if (!file) {
      // Streamed demos use their paired SRT instead of downloading the whole MP4.
      if (videoUrl === sample.video) {
        await loadSample();
        return;
      }
      flash('先选一个视频，才能抽里面的字幕');
      return;
    }
    if (extractState) return;

    if (file.size > 20 * 1024 * 1024 * 1024) {
      flash('文件超过 20GB，这个体量浏览器处理不了，先用 ffmpeg 截一段');
      return;
    }

    setNoTrack(false);
    setTracks(null);
    setExtractState({ stage: 'scanning', pct: 0 });

    try {
      // ① 纯 JS：只读容器不解码，毫秒级
      const fast = await extractFast(file, (pct) =>
        setExtractState({ stage: 'scanning', pct })
      );

      if (fast.handled) {
        if (fast.tracks.length === 0) {
          setExtractState(null);
          setNoTrack(true);
          return;
        }

        // 多条轨时优先挑带中文的（中日韩），其次第一条
        const best =
          fast.tracks.find(
            (t) => t.lang && /^(chi|zho|zh|chs|cht|jpn|kor)/i.test(t.lang)
          ) ?? fast.tracks[0];

        const text = trackToSrt(best);
        if (!text.trim()) {
          setExtractState(null);
          setNoTrack(true);
          return;
        }

        setExtractState(null);
        const ok = applySrt(text, `${file.name.replace(/\.[^.]+$/, '')}.srt`);
        if (ok) {
          flash(
            `直接从容器里读出来了：${best.cues.length} 条（${describeTrack(best)}），用了 ${fast.ms}ms`
          );
        }
        return;
      }

      // ② 不认识的容器 → 走 ffmpeg
      if (file.size > 1024 * 1024 * 1024) {
        flash(
          `文件 ${(file.size / 1024 ** 3).toFixed(1)}GB，这个格式得用 ffmpeg 流式读，要几分钟，别关页面`
        );
      }
      setExtractState({ stage: 'loading', pct: 0 });

      const ff = await loadFFmpeg((s) => setExtractState(s));
      ffRef.current = ff;

      const found = await probeSubtitleTracks(file, ff, (s) => setExtractState(s));

      if (found.length === 0) {
        setExtractState(null);
        setNoTrack(true);
        return;
      }

      if (found.length === 1) {
        await pickTrack(found[0], file);
        return;
      }

      // 多条轨：让用户选
      setTracks(found);
      setExtractState(null);
    } catch (err) {
      setExtractState(null);
      flash(humanize(err));
    }
  }

  async function pickTrack(track: SubtitleTrack, fileArg?: File) {
    const file = fileArg ?? videoFile;
    if (!file) return;
    setTracks(null);
    try {
      setExtractState({ stage: 'extracting' });
      const ff = ffRef.current ?? (await loadFFmpeg((s) => setExtractState(s)));
      ffRef.current = ff;
      const text = await extractSubtitle(file, track.trackIndex, ff, (s) =>
        setExtractState(s)
      );
      setExtractState(null);
      applySrt(
        text,
        `${videoName ?? file.name} · 内嵌${trackLabel(track)}`
      );
    } catch (err) {
      setExtractState(null);
      flash(humanize(err));
    }
  }

  /**
   * 示例读取配套 SRT 后交给原生播放器流式播放，不预先下载整个 MP4。
   * 英文和时间轴来自同一源视频，不复用旧演示的字幕或缓存地址。
   */
  async function loadSample() {
    if (loadingSample && !sampleRequestRef.current?.signal.aborted) return;
    const request = new AbortController();
    sampleRequestRef.current = request;
    setLoadingSample(true);
    setSampleError(undefined);
    try {
      const text = await fetchTextWithTimeout(sample.subtitle, request.signal);
      if (request.signal.aborted) return;
      if (parseSubtitle(text, sample.subtitle).length !== sample.cues.length) {
        throw new Error('配套字幕不完整，请重新加载示例');
      }
      setVideoSource(sample.video, `${sample.title}.mp4`);
      if (!applySrt(text, `${sample.title}.srt`)) throw new Error('配套 SRT 解析失败');
      trackEvent('sample_ready');
      setFollow(true);
      flash('字幕已就绪，点击播放开始试学');
    } catch (err) {
      if (request.signal.aborted) return;
      trackEvent('sample_error');
      setSampleError(err instanceof Error && !/Failed to fetch|NetworkError/i.test(err.message)
        ? err.message : '示例字幕加载失败，请检查网络后重试');
    } finally {
      if (sampleRequestRef.current === request) {
        setLoadingSample(false);
        sampleRequestRef.current = null;
      }
    }
  }


  // ---------- 目录导入 ----------
  /** 选一个剧集文件夹，扫出视频和字幕并配对 */
  async function pickFolder() {
    if (sampleOnly) { window.location.assign(user ? '/learn' : '/signup?returnTo=%2Flearn'); return; }
    if (!supportsDirectoryPicker()) {
      flash('这个浏览器不支持选文件夹（Chrome / Edge 可以），先一个个选文件吧');
      return;
    }
    try {
      setScanning(0);
      const files = await pickAndScan((n) => setScanning(n));
      setScanning(null);
      if (!files) return; // 用户取消

      const eps = pairEpisodes(files);
      if (eps.length === 0) {
        flash('这个文件夹里没找到视频、音频或字幕文件');
        return;
      }
      setEpisodes(eps);
      setShowPicker(true);
      const ready = eps.filter((e) => e.video && e.best).length;
      flash(
        ready > 0
          ? `扫到 ${eps.length} 集，${ready} 集直接能学`
          : `扫到 ${eps.length} 集，但没有一集是视频和字幕都齐的`
      );
    } catch (err) {
      setScanning(null);
      const msg = err instanceof Error ? err.message : String(err);
      // 用户点取消会抛 AbortError，不是错
      if (/abort/i.test(msg)) return;
      flash(`扫描失败：${msg}`);
    }
  }

  /** 打开某一集：读视频 + 读字幕 */
  async function openEpisode(ep: Episode) {
    if (!ep.video) {
      flash('这一集只有字幕，没有视频或音频文件');
      return;
    }
    setShowPicker(false);
    flash(`正在打开 ${ep.label}…`);

    const vf = await readHandle(ep.video.handle);
    if (!vf) {
      flash('读不到这个素材文件（可能被移走或没给权限）');
      return;
    }
    onVideoFile(vf);

    if (ep.best) {
      const text = await readTextHandle(ep.best.handle);
      if (text) {
        applySrt(text, ep.best.name);
        return;
      }
      flash('素材打开了，但字幕读不出来');
      return;
    }
    flash('素材已打开，未找到配套字幕；音频请导入 SRT/VTT，视频可尝试抽字幕');
  }

  // ---------- 播放 ----------
  /**
   * 跳到第 idx 句。
   * autoplay 不传就跟随当前状态：暂停时点某句仍然暂停，方便停下来看。
   */
  const seekTo = useCallback((idx: number, autoplay?: boolean) => {
    speakingEndRef.current = undefined;
    const v = videoRef.current;
    const c = cuesRef.current[idx];
    if (!v || !c) return;
    const wasPlaying = !v.paused;
    v.currentTime = c.start + 0.005;
    currentRef.current = idx;
    selectedRef.current = idx;
    loopCueRef.current = idx;
    setCurrent(idx);
    setSelected(idx);
    // 主动跳到某句，就重新跟随播放
    setFollow(true);
    if (autoplay ?? wasPlaying) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, []);

  /**
   * 把某一屏滚到列表中间。
   *
   * 不能用 scrollIntoView：它会把「所有可滚动的祖先」都滚一遍，
   * 列表滚到头之后还会继续滚 main 和 body，结果整个页面往下跑。
   * 这里只动 list 自己的 scrollTop。
   */
  const scrollCueIntoView = useCallback((idx: number, smooth = true) => {
    const list = listRef.current;
    const el = cueRefs.current[idx];
    if (!list || !el) return;
    const listRect = list.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta = elRect.top - listRect.top;
    const target = list.scrollTop + delta - (list.clientHeight - elRect.height) / 2;
    const max = list.scrollHeight - list.clientHeight;
    list.scrollTo({
      top: Math.min(Math.max(0, target), Math.max(0, max)),
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  /** 滚回当前句，并恢复跟随。 */
  const resumeFollow = useCallback(() => {
    setFollow(true);
    scrollCueIntoView(currentRef.current);
  }, [scrollCueIntoView]);

  /**
   * 二分查找当前时间落在哪一句。
   * 字幕上千条，每帧全表扫一遍没必要。
   */
  const cueIndexAt = useCallback((list: Cue[], t: number): number => {
    if (list.length === 0) return -1;
    let lo = 0;
    let hi = list.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start <= t) {
        hit = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (hit < 0) return -1;
    // 落在句尾之后说明正处在两句话之间的空隙
    return t < list[hit].end ? hit : -1;
  }, []);

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || restoreTimeRef.current !== null || v.readyState < 1) return;
    const t = v.currentTime;
    sessionTimeRef.current = t;
    const list = cuesRef.current;
    if (speakingEndRef.current !== undefined && t >= speakingEndRef.current) {
      const end = speakingEndRef.current; speakingEndRef.current = undefined; v.pause(); v.currentTime = end; return;
    }

    // 循环目标独立于实时高亮，避免跨过句尾时被下一句抢走。
    if (loopRef.current && !v.paused && !v.seeking) {
      const c = list[loopCueRef.current];
      if (c && t >= c.end) {
        v.currentTime = c.start + 0.005;
        currentRef.current = loopCueRef.current;
        setCurrent(loopCueRef.current);
        return;
      }
    }

    const idx = cueIndexAt(list, t);
    if (idx >= 0 && loopRef.current && loopCueRef.current < 0) {
      loopCueRef.current = idx;
    }
    // -1 也必须同步：两句之间、片头、片尾都不该残留上一句。
    if (idx !== currentRef.current) {
      currentRef.current = idx;
      setCurrent(idx);
    }
    if (idx >= 0 && idx !== selectedRef.current) {
      selectedRef.current = idx;
      setSelected(idx);
    }

    // 每 5 秒记一次播放位置，下次打开同一份字幕能接着看
    const now = Date.now();
    if (now - lastSaveRef.current > 5000) {
      lastSaveRef.current = now;
      flushSessionRef.current();
      if (subHashRef.current) saveProgress(subHashRef.current, {
        time: t,
        cue: idx,
        duration: Number.isFinite(v.duration) ? v.duration : undefined,
      });
    }
  }, [cueIndexAt]);

  // 播放、循环和高亮共用同一个时钟；暂停拖动则由媒体事件同步。
  useEffect(() => {
    if (!playing) return;
    let rafId: number;
    const tick = () => {
      const v = videoRef.current;
      if (v && !v.paused && !v.ended) {
        onTimeUpdate();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, onTimeUpdate]);

  // 字幕加载完成时，按当前播放位置立即高亮，不等下一次播放。
  useEffect(() => {
    onTimeUpdate();
  }, [cues, videoUrl, onTimeUpdate]);

  const onSeeking = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    // 原生进度条跳转也更新循环目标，避免被拉回跳转前的句子。
    loopCueRef.current = cueIndexAt(cuesRef.current, v.currentTime);
    onTimeUpdate();
  }, [cueIndexAt, onTimeUpdate]);

  function toggleLoop() {
    speakingEndRef.current = undefined;
    loopCueRef.current = selectedRef.current;
    loopRef.current = !loopRef.current;
    setLoop(loopRef.current);
    if (loopRef.current) trackEvent('loop_enable');
  }

  // 自动滚动到当前句（用户手动翻看时暂停）
  useEffect(() => {
    if (current < 0 || !followRef.current) return;
    scrollCueIntoView(current);
  }, [current, scrollCueIntoView]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
  }, [rate]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function replay() {
    const v = videoRef.current;
    const c = cues[selectedRef.current];
    if (!v || !c) return;
    seekTo(selectedRef.current, true);
  }

  function listenSpeakingCue(cue: Cue) {
    const index = cues.findIndex(value => value.id === cue.id && value.start === cue.start);
    if (index < 0) return;
    setLoop(false); loopRef.current = false;
    seekTo(index, true); speakingEndRef.current = cue.end;
  }

  function go(delta: number) {
    if (cues.length === 0) return;
    const idx = selectedRef.current;
    const next = idx < 0 ? 0 : Math.min(cues.length - 1, Math.max(0, idx + delta));
    seekTo(next, true);
  }

  // ---------- 键盘 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.defaultPrevented || ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A', 'AUDIO'].includes(tag) || (e.target as HTMLElement)?.isContentEditable || (e.target as HTMLElement)?.closest('[role="button"], [data-speaking-practice]') || document.querySelector('[data-speaking-practice][data-capturing="true"]')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowDown' || e.code === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key.toLowerCase() === 'r') {
        replay();
      } else if (e.key.toLowerCase() === 'l') {
        toggleLoop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, cues.length]);

  // ---------- 翻译 ----------
  async function doTranslate() {
    if (!cfg.apiKey) {
      setShowSettings(true);
      flash('先填一个 API Key，或者用演示数据看效果');
      return;
    }
    if (cues.length === 0) return;
    if (transRunning()) {
      flash('上一轮还在跑，等它结束');
      return;
    }

    // 已经有中文的句子（字幕自带或翻过）不再请求，省 token
    // 音效行（[music]、[laughs]）也不翻——翻成中文没有意义
    const pending = cues.filter((c) => !c.translation && !c.native);
    const translatable = pending.filter((c) => !isSoundCue(c.text));
    if (translatable.length === 0) {
      flash(
        pending.length > 0
          ? `剩下的 ${pending.length} 句都是音效描述，不需要翻译`
          : '每句都有中文了——字幕自带的，或者已经翻过'
      );
      return;
    }

    const hash = subHash;
    const cacheName = sourceName ?? '未命名字幕';
    const snapshot = cues;

    // 任务交给模块级单例，组件切走也不影响它继续跑
    const out = await startJob(snapshot, cfg, hash ?? '', cacheName);
    if (!out) return;

    // 跑完之后从缓存回填——用快照而不是当前的 cues，
    // 万一这期间用户换了字幕，也不会把旧译文套到新字幕上
    if (hash && subHash === hash) {
      const entry = readCache(hash);
      if (entry) {
        setCues((prev) => {
          // 只对同一份字幕生效
          if (prev.length !== snapshot.length) return prev;
          return applyCache(prev, entry).cues;
        });
        setCachedHits(entry.items.length);
      }
    }

    if (out.ok === 0) {
      setShowSettings(true);
      flash(`翻译没成功：${out.error ?? '未知原因'}`);
      return;
    }

    const tail = out.skipped > 0 ? `，跳过 ${out.skipped} 句音效` : '';
    if (out.failed > 0) {
      flash(
        `翻译完成 ${out.ok} 句${tail}，${out.failed} 句失败（${out.error ?? '接口异常'}）· 已存缓存`
      );
    } else {
      flash(`翻译完成 ${out.ok} 句${tail} · 已存缓存，下次导入不用再翻`);
    }
  }

  // ---------- 生词 ----------
  function saveCue(c: Cue) {
    const clip = clipForCue(c);
    const sentenceTranslation = c.translation || c.native || '';
    if (saved.some((s) => s.sentence === c.text)) {
      const previous = saved.find(item => item.sentence === c.text);
      if (previous) {
        const missingClip = !validSavedClip(previous.clip) && clip;
        const missingTranslation = !previous.sentenceTranslation && sentenceTranslation && (!validSavedClip(previous.clip) || previous.clip.videoId === clip?.videoId);
        if (missingClip || missingTranslation) { setSaved(items => items.map(item => item === previous ? { ...item, ...(missingClip ? { clip } : {}), ...(missingTranslation ? { sentenceTranslation } : {}) } : item)); cacheCollectionClip(clip, videoFile); flash('已补全收藏的原句信息'); return; }
      }
      flash('这句已经收过了');
      return;
    }
    setSaved((prev) => [
      { word: c.text.slice(0, 60), sentence: c.text, translation: sentenceTranslation, sentenceTranslation, addedAt: Date.now(), ...(clip ? { clip } : {}) },
      ...prev,
    ]);
    flash('已加入生词本');
    cacheCollectionClip(clip, videoFile);
    trackEvent('cue_save');
  }

  function removeSaved(i: number) {
    const previous = saved[i], remaining = saved.filter((_, idx) => idx !== i);
    setSaved(remaining);
    if (previous?.clip && !remaining.some(item => item.clip?.videoId === previous.clip?.videoId)) void savedMediaStore().remove(previous.clip.videoId).catch(() => {});
  }

  const level = useMemo(() => (cues.length ? estimateLevel(cues) : '—'), [cues]);
  const bilingualCount = useMemo(
    () => cues.filter((c) => c.native).length,
    [cues]
  );
  const translatedCount = useMemo(
    () => cues.filter((c) => c.translation).length,
    [cues]
  );
  /** 还缺中文、且值得翻的句数——音效行不算 */
  const pendingTrans = useMemo(
    () => cues.filter((c) => !c.translation && !c.native && !isSoundCue(c.text)).length,
    [cues]
  );

  const title = sourceName ?? videoName ?? fromWork?.title ?? '学习台';

  return (
    <div
      data-page="learn"
      data-sub-hash={subHash ?? ''}
      className="learn-workspace flex min-w-0 flex-col bg-[var(--learn-bg)] text-[var(--text)]"
    >
      {/* ============ 顶部工具栏 ============ */}
      <div className="shrink-0 border-b border-[rgb(var(--fg-rgb)/0.06)] bg-[var(--learn-bar)] backdrop-blur-xl">
        <div className="learn-toolbar mx-auto flex w-full min-w-0 max-w-[1600px] flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4">
          <div className="mr-1 min-w-0 max-w-full flex-[1_1_160px]">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="title-serif min-w-0 truncate text-[15px] font-semibold text-[var(--text)]">
                {title}
              </h1>
              {cues.length > 0 && (
                <span className="chip !py-0 !text-[10px]">
                  {cues.length} 句 · {level}
                </span>
              )}
              <span
                className="shrink-0 rounded border border-[rgb(var(--fg-rgb)/0.08)] px-1.5 py-0.5 text-[9.5px] tnum text-[var(--text-faint)]"
                title="构建时间。刷新后还是旧的就说明浏览器缓存没更新"
              >
                {process.env.BUILD_STAMP}
              </span>
            </div>
          </div>

          <div className="learn-toolbar-actions flex min-w-0 max-w-full flex-[1_1_640px] flex-wrap items-center gap-1.5 sm:justify-end">
            <a href="/download" className="btn btn-ghost">下载视频</a>
            {episodes && episodes.length > 0 && (
              <button
                onClick={() => setShowPicker(true)}
                title="选另一集"
                className="btn btn-ghost gap-1.5"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <rect x="3.5" y="5" width="17" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="3.5" y="15" width="17" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M3.5 12h17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                选集
                <span className="tnum text-[var(--text-dim)]">{episodes.length}</span>
              </button>
            )}

            {sampleOnly ? <a className="btn btn-ghost" href={user ? '/learn' : '/signup?returnTo=%2Flearn'}>{user ? '回学习台导入' : '注册后导入素材'}</a> : <><FileBtn
              label={videoName ? '换素材' : '导入视频 / 音频'}
              accept={MEDIA_ACCEPT}
              onPick={onVideoFile}
              active={!!videoUrl}
            />
            <FileBtn
              label="载字幕"
              accept=".srt,.vtt,.ass,.ssa,text/plain"
              onPick={onSubFile}
              active={cues.length > 0 && !sourceName?.includes('演示')}
            /></>}
            {videoName && <button onClick={() => void clearCurrentLearning()}
              title="清除浏览器保存的本次素材、字幕和进度，保留生词本与原文件"
              className="btn btn-ghost">清除记录</button>}
            <button
              onClick={() => loadSample()}
              disabled={loadingSample}
              title="《海边的曼彻斯特》维修对话 · 约 39 秒 · 配套 SRT"
              className="btn btn-ghost disabled:opacity-35"
            >
              {loadingSample ? '加载示例…' : '示例片段'}
            </button>
            <button
              onClick={() => handleExtract()}
              disabled={audioOnly || (!videoFile && videoUrl !== sample.video) || !!extractState || loadingSample}
              title={
                audioOnly ? '音频请导入配套 SRT/VTT 字幕；抽字幕不提供语音识别' : videoUrl === sample.video ? '重新载入配套字幕' : videoFile
                  ? '从视频里直接抽字幕轨，不需要单独的字幕文件'
                  : '先选一个视频'
              }
              className={`btn disabled:opacity-35 ${
                videoFile && cues.length === 0 ? 'btn-gold' : 'btn-ghost'
              }`}
            >
              {extractState ? '抽取中…' : videoUrl === sample.video ? '重载字幕' : '抽字幕'}
            </button>

            <span className="mx-1 h-4 w-px bg-[rgb(var(--fg-rgb)/0.10)]" />

            <button
              onClick={doTranslate}
              disabled={jobRunning || cues.length === 0 || pendingTrans === 0}
              title={
                jobRunning
                  ? `翻译在后台继续，切到别的页面也不会停（${job?.done ?? 0}/${job?.total ?? 0}）`
                  : pendingTrans === 0 && cues.length > 0
                    ? '每句都有中文了——字幕自带的或已翻译并缓存'
                    : cachedHits > 0
                      ? `已有 ${cachedHits} 句缓存译文，只翻缺的 ${pendingTrans} 句`
                      : '用你配的接口批量翻译缺中文的句子'
              }
              className={`btn gap-1.5 disabled:opacity-40 ${
                jobRunning ? 'btn-gold' : 'btn-ghost'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M3 5.5h8M7 5.5v1.2c0 3.2-2 5.6-4.5 6.8M5 10c.9 2 2.6 3.3 4.6 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="m13 19 3.2-7.5L19.5 19M14.3 16.6h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {jobRunning ? (
                <span className="tnum">
                  {job?.done ?? 0}/{job?.total ?? 0}
                </span>
              ) : pendingTrans === 0 && cues.length > 0 ? (
                '已译完'
              ) : (
                '翻译'
              )}
              {!jobRunning && pendingTrans > 0 && cachedHits > 0 && (
                <span className="rounded bg-emerald-400/15 px-1 text-[10px] tnum text-emerald-400/80">
                  {cachedHits} 缓存
                </span>
              )}
            </button>

            <button
              onClick={() => setShowExport(true)}
              disabled={cues.length === 0}
              title="导出 Anki 卡片，或者带译文的时间轴"
              className="btn btn-ghost gap-1.5 disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M12 4v10m0 0 3.5-3.5M12 14 8.5 10.5M4 16.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              导出
            </button>

            <button
              onClick={() => setShowSaved((v) => !v)}
              className={`btn gap-1.5 ${
                showSaved ? 'btn-gold' : 'btn-ghost'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8L12 3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              生词本
              {saved.length > 0 && <span className="tnum opacity-70">{saved.length}</span>}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-[rgb(var(--fg-rgb)/0.10)] text-[var(--text-dim)] transition-colors hover:border-[rgb(var(--fg-rgb)/0.20)] hover:text-[var(--text-soft)]"
              title="翻译设置"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {downloadImportError && (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 text-[13px]">
          <span>{downloadImportError}</span><a href="/download" className="btn btn-ghost shrink-0">重新导入</a>
        </div>
      )}
      {(sessionLoading || sessionNotice || missingSession) && (
        <div role="status" className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-2 text-[12px] text-[var(--text-dim)]">
          <span>{sessionLoading ? '正在恢复上次的学习…' : sessionNotice}</span>
          {missingSession && <FileBtn label="选择原素材继续" accept={MEDIA_ACCEPT} onPick={onVideoFile} />}
        </div>
      )}
      {(loadingSample || sampleError) && (
        <div role={sampleError ? 'alert' : 'status'} className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 text-[13px]">
          <span>{sampleError ?? '正在加载配套字幕，视频将边加载边播放…'}</span>
          <button className="btn btn-ghost shrink-0 !text-[12px]" onClick={() => {
            if (loadingSample) {
              sampleRequestRef.current?.abort();
              setLoadingSample(false);
            } else void loadSample();
          }}>{loadingSample ? '取消' : '重试'}</button>
        </div>
      )}

      {/* ============ 抽取进度 ============ */}
      {extractState && (
        <div className="border-b border-[rgb(var(--fg-rgb)/0.06)] bg-[var(--learn-bar)] px-4 py-2 backdrop-blur">
          <div className="mx-auto flex min-w-0 max-w-[1600px] flex-wrap items-center gap-3">
            <span className="min-w-0 text-[11.5px] text-[var(--text-dim)]">
              {extractState.stage === 'scanning' && '读取容器…'}
              {extractState.stage === 'loading' &&
                (extractState.pct >= 100
                  ? '启动解码引擎…'
                  : '下载解码引擎（首次约 31MB，之后走浏览器缓存）')}
              {extractState.stage === 'probing' && '读取视频流信息…'}
              {extractState.stage === 'extracting' && '抽字幕并转 srt…'}
              {extractState.stage === 'done' && '完成'}
            </span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[rgb(var(--fg-rgb)/0.08)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-400 transition-all duration-300"
                style={{
                  width: `${
                    extractState.stage === 'scanning'
                      ? Math.max(4, extractState.pct)
                      : extractState.stage === 'loading'
                        // 下载占前 70%，剩下的留给启动和抽取，避免 100% 之后又往回掉
                        ? Math.max(4, Math.round(extractState.pct * 0.7))
                        : extractState.stage === 'probing'
                          ? 78
                          : extractState.stage === 'extracting'
                            ? 90
                            : 100
                  }%`,
                }}
              />
            </div>
            {extractState.stage === 'loading' && (
              <span className="tnum w-9 text-right text-[11px] text-[var(--text-dim)]">
                {extractState.pct}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* ============ 主体 ============ */}
      <div className="learn-columns mx-auto flex w-full min-w-0 max-w-[1600px] flex-1 flex-col lg:flex-row">
        {/* 左：播放器 */}
        <div className="learn-player flex min-w-0 flex-1 flex-col border-b border-[rgb(var(--fg-rgb)/0.06)] lg:border-b-0 lg:border-r">
          <div className={`learn-stage relative flex min-w-0 items-center justify-center bg-[var(--stage)] p-3 ${videoUrl ? 'learn-stage-video' : ''} ${audioOnly ? 'learn-stage-audio' : ''}`}>
            {videoUrl ? (
              <div className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-black shadow-card ${audioOnly ? 'learn-audio-player' : ''}`}>
                {audioOnly && <div className="learn-audio-cover"><span aria-hidden="true">♫</span><p>播客 · 新闻 · 音频精听</p><h2>{videoName}</h2><p>导入配套字幕，即可逐句循环、查词和录音跟读。</p></div>}
                <Player
                  key={videoUrl}
                  ref={attachPlayer}
                  src={videoUrl}
                  playsInline
                  preload="auto"
                  className={audioOnly ? 'learn-audio-controls' : 'mx-auto block h-full max-h-full w-full object-contain'}
                  onTimeUpdate={onTimeUpdate}
                  onSeeking={onSeeking}
                  onSeeked={onTimeUpdate}
                  onLoadedMetadata={() => {
                    if (videoRef.current) {
                      videoRef.current.playbackRate = rate;
                      if (restoreTimeRef.current !== null) {
                        const time = restoreTimeRef.current;
                        videoRef.current.currentTime = Number.isFinite(videoRef.current.duration)
                          ? Math.min(time, Math.max(0, videoRef.current.duration - 0.1)) : time;
                        sessionTimeRef.current = videoRef.current.currentTime;
                        restoreTimeRef.current = null;
                      }
                    }
                    onTimeUpdate();
                  }}
                  onEnded={onTimeUpdate}
                  onPlay={() => { document.querySelectorAll<HTMLMediaElement>('video,audio').forEach(other => { if (other !== videoRef.current) other.pause(); }); window.speechSynthesis?.cancel(); setPlaying(true); trackEvent('learning_start'); }}
                  onPause={() => { setPlaying(false); onTimeUpdate(); flushSessionRef.current(); }}
                  onCanPlay={() => { setVideoStatus('ready'); setVideoError(undefined); }}
                  onWaiting={() => setVideoStatus('loading')}
                  onError={(event) => {
                    trackEvent('video_error');
                    const code = event.currentTarget.error?.code;
                    setVideoError(code === 3 || code === 4
                      ? '浏览器无法播放这份素材，请换用 MP4 视频或 MP3/M4A/WAV 音频。'
                      : '素材加载失败，请检查文件或网络后重试。');
                    setVideoStatus('error');
                  }}
                  controls
                />

                {/* 续播提示：上次看到哪儿 */}
                {resume && (
                  <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-gold-500/30 bg-black/85 px-3 py-1.5 text-white shadow-lg backdrop-blur-sm">
                    <span className="text-[11.5px] text-[var(--text-soft)]">
                      上次看到 <span className="tnum text-[#e0a94a]">{fmtTime(resume.time)}</span>
                    </span>
                    <button
                      onClick={() => {
                        const v = videoRef.current;
                        if (!v) return;
                        v.currentTime = resume.time;
                        setResume(null);
                        v.play().catch(() => {});
                      }}
                      className="rounded-md bg-gold-500 px-2 py-0.5 text-[11px] font-medium text-black/85 transition-opacity hover:opacity-90"
                    >
                      接着看
                    </button>
                    <button
                      onClick={() => {
                        if (subHash) clearProgress(subHash);
                        setResume(null);
                      }}
                      className="rounded-md px-1.5 py-0.5 text-[11px] text-[var(--text-dim)] transition-colors hover:text-[var(--text-soft)]"
                      title="清掉这条记录，从头开始"
                    >
                      从头
                    </button>
                  </div>
                )}

                {/* 画面上的实时字幕，看片时视线不用来回跳 */}
                {!audioOnly && current >= 0 && cues[current] && (
                  <div
                    key={current}
                    className="pointer-events-none absolute inset-x-0 bottom-12 flex flex-col items-center gap-0.5 px-8 text-center"
                  >
                    <p className="cue-in max-w-[92%] text-[15px] font-medium leading-snug text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.95),0_0_18px_rgba(0,0,0,0.75)]">
                      {cues[current].text}
                    </p>
                    {showTrans && (cues[current].native || cues[current].translation) && (
                      <p className="cue-in-sub max-w-[92%] text-[12.5px] leading-snug text-[#f5cb7f] [text-shadow:0_1px_3px_rgba(0,0,0,0.95),0_0_14px_rgba(0,0,0,0.75)]">
                        {cues[current].translation ?? cues[current].native}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <EmptyVideo
                onVideo={onVideoFile}
                onSample={() => loadSample()}
                loadingSample={loadingSample}
                onFolder={pickFolder}
                scanning={scanning}
                canFolder={canUseFolder}
                hasCues={cues.length > 0}
                workTitle={fromWork?.title}
              />
            )}
          </div>

          {videoUrl && videoStatus !== 'ready' && (
            <div role={videoStatus === 'error' ? 'alert' : 'status'} className="flex items-center justify-between gap-2 px-4 py-2 text-[12px] text-[var(--text-dim)]">
              <span>{videoError ?? '素材正在缓冲，加载后点击播放。'}</span>
              {videoStatus === 'error' && <button className="btn btn-ghost shrink-0 !text-[12px]" onClick={() => {
                setVideoError(undefined);
                setVideoStatus('loading');
                videoRef.current?.load();
              }}>重试播放</button>}
            </div>
          )}

          {/* 控制条 */}
          <div className="learn-controls min-w-0 shrink-0 border-t border-[rgb(var(--fg-rgb)/0.06)] px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Ctrl onClick={() => go(-1)} disabled={!videoUrl || cues.length === 0} title="上一句 (↑)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6 8 12l10 6V6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                  <path d="M5 5v14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </Ctrl>
              <Ctrl onClick={togglePlay} disabled={!videoUrl} title="播放/暂停 (空格)" primary>
                {playing ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="5" width="4" height="14" rx="1" />
                    <rect x="14" y="5" width="4" height="14" rx="1" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 4.5v15L20 12 7 4.5Z" />
                  </svg>
                )}
              </Ctrl>
              <Ctrl onClick={() => go(1)} disabled={!videoUrl || cues.length === 0} title="下一句 (↓)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M6 6l10 6-10 6V6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                  <path d="M19 5v14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </Ctrl>
              <Ctrl onClick={replay} disabled={!videoUrl || selected < 0} title="重播本句 (R)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M4 12a8 8 0 1 1 2.3 5.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  <path d="M4 12V7m0 5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Ctrl>

              <button
                onClick={toggleLoop}
                className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] transition-all ${
                  loop
                    ? 'border-gold-500/35 bg-gold-500/10 text-[var(--gold-ink)]'
                    : 'border-[rgb(var(--fg-rgb)/0.10)] text-[var(--text-dim)] hover:text-[var(--text-soft)]'
                }`}
                title="单句循环 (L)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M17 2l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                单句循环
              </button>

              <div className="flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-[rgb(var(--fg-rgb)/0.10)] p-0.5">
                {RATES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRate(r)}
                    className={`rounded px-2 py-1 text-[11px] transition-colors tnum ${
                      rate === r
                        ? 'bg-[rgb(var(--fg-rgb)/0.12)] text-[var(--text)]'
                        : 'text-[var(--text-faint)] hover:text-[var(--text-soft)]'
                    }`}
                  >
                    {r}×
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowTrans((v) => !v)}
                className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] transition-all ${
                  showTrans
                    ? 'border-[rgb(var(--fg-rgb)/0.15)] bg-[rgb(var(--fg-rgb)/0.08)] text-[var(--text)]'
                    : 'border-[rgb(var(--fg-rgb)/0.10)] text-[var(--text-dim)]'
                }`}
              >
                译文
              </button>

              <div className="ml-auto flex min-w-0 flex-wrap items-center gap-3 text-[11px] text-[var(--text-faint)] tnum">
                {current >= 0 && cues[current] && (
                  <span className="hidden sm:inline">
                    {formatTime(cues[current].start)} – {formatTime(cues[current].end)}
                  </span>
                )}
                <span className="hidden xl:inline">
                  空格 播放 · ↑↓ 切换 · R 重播 · L 循环
                </span>
              </div>
            </div>
            <SpeakingPractice key={videoUrl || 'empty'} cue={cues[selected >= 0 ? selected : 0]} cueNumber={(selected >= 0 ? selected : 0) + 1} onListen={listenSpeakingCue} onPause={() => { speakingEndRef.current = undefined; videoRef.current?.pause(); }} />
          </div>
        </div>

        {/* 右：字幕列表 */}
        <aside className="learn-subtitles flex w-full min-w-0 shrink-0 flex-col lg:w-[40%] lg:max-w-[520px]">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[rgb(var(--fg-rgb)/0.06)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] tracking-[0.18em] text-[var(--text-faint)]">字幕</span>
              {translatedCount > 0 ? (
                <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-400/70 tnum">
                  已译 {translatedCount}/{cues.length}
                </span>
              ) : bilingualCount > 0 ? (
                <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-400/70">
                  双语 {bilingualCount}/{cues.length}
                </span>
              ) : null}
            </div>

            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
              {!follow && current >= 0 && (
                <button
                  onClick={resumeFollow}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-gold-500/30 bg-gold-500/10 px-2 py-0.5 text-[10.5px] text-[var(--gold-ink)] transition-colors hover:bg-gold-500/20"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                    <path d="M12 4v14m0 0 6-6m-6 6-6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  回到第 {current + 1} 句
                </button>
              )}
              {sourceName && (
                <span className="max-w-[180px] truncate text-[10.5px] text-[var(--text-faint)]">
                  {sourceName}
                </span>
              )}
            </div>
          </div>

          <WordCard
            state={lookupState}
            onClose={() => setLookupState(null)}
            onSave={saveWord}
            isSaved={isWordSaved}
          />

          <div
            ref={listRef}
            onWheel={() => {
              if (followRef.current) setFollow(false);
            }}
            onTouchMove={() => {
              if (followRef.current) setFollow(false);
            }}
            className="learn-cue-list min-h-0 max-h-[52dvh] flex-1 overflow-y-auto overscroll-contain"
          >
            {cues.length === 0 ? (
              <EmptyCues />
            ) : (
              <div className="divide-y divide-[rgb(var(--fg-rgb)/0.05)]">
                {cues.map((c, i) => (
                  <div
                    key={c.id}
                    ref={(el) => {
                      cueRefs.current[i] = el;
                    }}
                    onClick={() => seekTo(i)}
                    className={`cue-hover group relative cursor-pointer border-l-2 border-transparent px-4 py-3 transition-colors ${
                      i === current ? 'cue-active' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 shrink-0 text-[10px] tnum ${
                          i === current ? 'text-[var(--gold-ink)]' : 'text-[var(--text-faint)]'
                        }`}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`break-words text-[13.5px] leading-[1.65] ${
                            i === current ? 'text-[var(--text)]' : 'text-[var(--text-soft)]'
                          }`}
                        >
                          {(cueTokens[i] ?? []).map((t, ti) =>
                            t.word ? (
                              <span
                                key={ti}
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openLookup(t.word!, c.text, c);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openLookup(t.word!, c.text, c);
                                  }
                                }}
                                className={`cursor-pointer rounded-[3px] px-[1px] transition-colors hover:bg-gold-500/25 hover:text-gold-200 ${
                                  lookupState?.word === t.word.toLowerCase()
                                    ? 'bg-gold-500/20 text-[var(--gold-ink)]'
                                    : ''
                                }`}
                              >
                                {t.raw}
                              </span>
                            ) : (
                              <span key={ti}>{t.raw}</span>
                            )
                          )}
                        </p>
                        {showTrans && (c.native || c.translation) && (
                          <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-faint)]">
                            {c.translation ?? c.native}
                          </p>
                        )}
                        {showTrans && c.words && c.words.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {c.words.map((w) => (
                              <span
                                key={w.word}
                                className="rounded border border-gold-500/15 bg-gold-500/[0.06] px-1.5 py-[1px] text-[10px] text-[var(--gold-ink)]"
                                title={w.hint}
                              >
                                {w.word}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          saveCue(c);
                        }}
                        className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                        title="加入生词本"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[var(--text-faint)] hover:text-[var(--gold-ink)]">
                          <path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.2 6.4 20.1l1.2-6.2L3 9.6l6.3-.8L12 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ============ 生词本抽屉 ============ */}
      {/*
        弹层要挂在 body 上：<main> 有 relative z-10，
        会把里面的 fixed 元素关在自己的层叠上下文里，
        结果被 z-50 的导航栏压住，右上角的关闭按钮点不到。
      */}
      {mounted &&
        showSaved &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex justify-end">
            <div className="modal-overlay absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSaved(false)} />
            <div className="drawer-panel relative z-10 flex h-full w-full max-w-md flex-col border-l border-[rgb(var(--fg-rgb)/0.10)] bg-[var(--learn-panel)] shadow-2xl">
              <div className="flex items-center justify-between border-b border-[rgb(var(--fg-rgb)/0.08)] px-5 py-4">
                <div>
                  <h2 className="title-serif text-[17px] text-[var(--text)]">生词本</h2>
                  <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">
                    已收集 {saved.length} 条 · 导出后可直接导入 Anki
                  </p>
                </div>
                <button
                  onClick={() => setShowSaved(false)}
                  title="关闭 (Esc)"
                  className="grid h-8 w-8 place-items-center rounded-lg text-[var(--text-dim)] transition-colors hover:bg-[rgb(var(--fg-rgb)/0.08)] hover:text-[var(--text)]"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {saved.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
                    <div className="grid h-11 w-11 place-items-center rounded-full border border-[rgb(var(--fg-rgb)/0.10)] bg-[rgb(var(--fg-rgb)/0.03)]">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[var(--text-faint)]">
                        <path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.2 6.4 20.1l1.2-6.2L3 9.6l6.3-.8L12 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <p className="text-[13px] text-[var(--text-dim)]">还没收藏句子</p>
                    <p className="max-w-[240px] text-[11.5px] leading-relaxed text-[var(--text-faint)]">
                      把鼠标移到任意一句字幕上，点右侧的星标就能收进来
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <VocabularyMotionToggle />
                    {saved.map((w, i) => <SavedVocabularyCard key={`${w.word}:${w.addedAt}`} word={w} onRemove={() => removeSaved(i)} />)}
                  </div>
                )}
              </div>

              <div className="border-t border-[rgb(var(--fg-rgb)/0.08)] p-4">
                <button
                  onClick={() => {
                    const n = exportSavedWords(saved);
                    if (n === 0) flash('生词本是空的');
                    else flash(`已导出 ${n} 条`);
                  }}
                  disabled={saved.length === 0}
                  className="btn btn-gold w-full disabled:opacity-30"
                >
                  导出为 Anki 卡片
                </button>
                <p className="mt-2 text-center text-[10.5px] leading-relaxed text-[var(--text-faint)]">
                  Anki → 导入 → 选 CSV → 分隔符逗号 → 勾选「允许 HTML」
                </p>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ============ 选集面板 ============ */}
      {mounted &&
        showPicker &&
        episodes &&
        createPortal(
          <div className="fixed inset-0 z-[70] grid place-items-center p-4">
            <div
              className="modal-overlay absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setShowPicker(false)}
            />
            <div className="modal-panel relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-[rgb(var(--fg-rgb)/0.10)] bg-[var(--learn-panel)] shadow-2xl">
              <div className="flex shrink-0 items-baseline justify-between border-b border-[rgb(var(--fg-rgb)/0.08)] px-6 py-4">
                <div>
                  <h2 className="title-serif text-[19px] text-[var(--text)]">选一集</h2>
                  <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">
                    扫到 {episodes.length} 组 ·{' '}
                    {episodes.filter((e) => e.video && e.best).length} 组视频字幕都齐
                  </p>
                </div>
                <button
                  onClick={() => setShowPicker(false)}
                  className="text-[12px] text-[var(--text-dim)] hover:text-[var(--text-soft)]"
                >
                  关闭
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
                {episodes.map((ep) => {
                  const ok = !!(ep.video && ep.best);
                  const noSub = !!(ep.video && !ep.best);
                  return (
                    <button
                      key={ep.key}
                      onClick={() => openEpisode(ep)}
                      disabled={!ep.video}
                      className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        ep.video
                          ? 'hover:bg-[rgb(var(--fg-rgb)/0.05)]'
                          : 'cursor-not-allowed opacity-40'
                      }`}
                    >
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] ${
                          ok
                            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
                            : noSub
                              ? 'border-amber-400/30 bg-amber-400/10 text-amber-400'
                              : 'border-[rgb(var(--fg-rgb)/0.12)] text-[var(--text-faint)]'
                        }`}
                      >
                        {ok ? '✓' : noSub ? '!' : '·'}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-[var(--text)]">
                          {ep.label}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-[var(--text-faint)]">
                          {ep.video ? (
                            <>
                              {ep.best ? (
                                <>
                                  {ep.best.name}
                                  {ep.bestLang && ep.bestLang !== 'unknown' && (
                                    <span className="ml-1.5 rounded bg-[rgb(var(--fg-rgb)/0.08)] px-1 text-[9.5px] text-[var(--text-dim)]">
                                      {ep.bestLang === 'bilingual'
                                        ? '双语'
                                        : ep.bestLang === 'zh'
                                          ? '中文'
                                          : '英文'}
                                    </span>
                                  )}
                                  {ep.subtitles.length > 1 && (
                                    <span className="ml-1.5 text-[var(--text-faint)]">
                                      +{ep.subtitles.length - 1}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-amber-400/60">没有字幕文件</span>
                              )}
                            </>
                          ) : (
                            '只有字幕，没有视频'
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="shrink-0 border-t border-[rgb(var(--fg-rgb)/0.08)] px-6 py-3 text-[11px] text-[var(--text-faint)]">
                点某一集就加载它的视频和字幕。视频在本机读取，不上传。
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ============ 导出弹窗 ============ */}
      {mounted &&
        showExport &&
        createPortal(
          <div className="fixed inset-0 z-[70] grid place-items-center p-4">
            <div
              className="modal-overlay absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setShowExport(false)}
            />
            <div className="modal-panel relative z-10 w-full max-w-md rounded-2xl border border-[rgb(var(--fg-rgb)/0.10)] bg-[var(--learn-panel)] p-6 shadow-2xl">
              <h2 className="title-serif text-[19px] text-[var(--text)]">导出</h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--text-dim)]">
                当前 {cues.length} 条字幕
                {translatedCount > 0 && ` · ${translatedCount} 条有译文`}。
              </p>

              <div className="mt-5 space-y-2.5">
                {/* Anki */}
                <button
                  onClick={() => {
                    const n = exportAnkiCsv(cues);
                    trackEvent('export_anki');
                    setShowExport(false);
                    flash(`已导出 ${n} 张卡片，Anki 里选「逗号分隔」+ 允许 HTML 导入`);
                  }}
                  className="group w-full rounded-xl border border-[rgb(var(--fg-rgb)/0.10)] bg-[rgb(var(--fg-rgb)/0.02)] p-3.5 text-left transition-colors hover:border-gold-500/35 hover:bg-gold-500/[0.05]"
                >
                  <div className="text-[13px] font-medium text-[var(--text)]">Anki 卡片</div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-dim)]">
                    每句一张卡，正面英文、背面译文和重点词。CSV 格式。
                  </div>
                </button>

                {/* 双语字幕 */}
                <button
                  onClick={() => {
                    const text = buildSrt(cues);
                    exportSrtBlob(text, deriveName(sourceName, 'srt'));
                    trackEvent('export_srt');
                    setShowExport(false);
                    flash(
                      translatedCount > 0
                        ? '已导出双语字幕'
                        : '已导出字幕（还没有译文，只有原文）'
                    );
                  }}
                  className="group w-full rounded-xl border border-[rgb(var(--fg-rgb)/0.10)] bg-[rgb(var(--fg-rgb)/0.02)] p-3.5 text-left transition-colors hover:border-gold-500/35 hover:bg-gold-500/[0.05]"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--text)]">带译文的时间轴</span>
                    <span className="rounded bg-[rgb(var(--fg-rgb)/0.08)] px-1.5 py-0.5 text-[9.5px] text-[var(--text-dim)]">
                      SRT
                    </span>
                  </div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-dim)]">
                    原文在上、中文在下。播放器、剪辑软件、其它学习工具都能直接用。
                  </div>
                </button>

                {/* VTT */}
                <button
                  onClick={() => {
                    const text = buildVtt(cues);
                    exportSrtBlob(text, deriveName(sourceName, 'vtt'));
                    trackEvent('export_vtt');
                    setShowExport(false);
                    flash('已导出 WebVTT');
                  }}
                  className="group w-full rounded-xl border border-[rgb(var(--fg-rgb)/0.10)] bg-[rgb(var(--fg-rgb)/0.02)] p-3.5 text-left transition-colors hover:border-gold-500/35 hover:bg-gold-500/[0.05]"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--text)]">网页字幕</span>
                    <span className="rounded bg-[rgb(var(--fg-rgb)/0.08)] px-1.5 py-0.5 text-[9.5px] text-[var(--text-dim)]">
                      VTT
                    </span>
                  </div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-dim)]">
                    给 HTML5 `&lt;track&gt;` 用的格式，做网页播放器时用得上。
                  </div>
                </button>
              </div>

              <div className="mt-5 flex justify-end">
                <button onClick={() => setShowExport(false)} className="btn btn-ghost">
                  取消
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* ============ 设置弹窗 ============ */}
      {mounted &&
        showSettings &&
        createPortal(
          <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          <div className="modal-overlay absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
          <div className="modal-panel relative z-10 w-full max-w-lg rounded-2xl border border-[rgb(var(--fg-rgb)/0.10)] bg-[var(--learn-panel)] p-6 shadow-2xl">
            <h2 className="title-serif text-[19px] text-[var(--text)]">翻译设置</h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--text-dim)]">
              填一个 OpenAI 兼容接口的 Key，字幕会批量翻译。Key 只存在你浏览器的 localStorage，不会发送到任何第三方服务器（除了你自己填的接口）。
            </p>

            <div className="mt-5 space-y-3">
              <Field label="接口地址 Base URL">
                <input
                  value={cfg.baseUrl}
                  onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                  className="input"
                />
              </Field>
              <Field label="模型">
                <input
                  value={cfg.model}
                  onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
                  placeholder="deepseek-chat"
                  className="input"
                />
              </Field>
              <Field label="API Key">
                <input
                  type="password"
                  value={cfg.apiKey}
                  onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="input"
                />
              </Field>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={async () => {
                  setTestResult({ pending: true, msg: '正在请求…' });
                  const r = await testConfig(cfg);
                  setTestResult({
                    pending: false,
                    ok: r.ok,
                    msg: r.ok ? '连接正常，可以翻了' : r.error,
                  });
                }}
                className="rounded-lg border border-[rgb(var(--fg-rgb)/0.12)] px-2.5 py-1.5 text-[11.5px] text-[var(--text-dim)] transition-colors hover:border-[rgb(var(--fg-rgb)/0.25)] hover:text-[var(--text)]"
              >
                测试连接
              </button>
              <span className="text-[11px] text-[var(--text-faint)]">
                只发一条 8 token 的小请求，确认地址和 Key 能用
              </span>
            </div>

            {testResult && (
              <div
                className={`mt-2.5 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed ${
                  testResult.pending
                    ? 'border-[rgb(var(--fg-rgb)/0.10)] bg-[rgb(var(--fg-rgb)/0.03)] text-[var(--text-dim)]'
                    : testResult.ok
                      ? 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-300/85'
                      : 'border-red-400/25 bg-red-400/[0.06] text-red-300/85'
                }`}
              >
                <div className="mb-0.5 font-medium">
                  {testResult.pending
                    ? '测试中'
                    : testResult.ok
                      ? '✓ 连接正常'
                      : '✗ 连接失败'}
                </div>
                <div className="select-all break-all font-mono text-[11px] opacity-90">
                  {testResult.msg}
                </div>
                {!testResult.pending && !testResult.ok && (
                  <div className="mt-1.5 text-[11px] opacity-60">
                    可以选中复制这段错误去搜。401 多半是 Key 无效，404 是地址写错，
                    Failed to fetch 是本机网络问题。
                  </div>
                )}
              </div>
            )}

            {/* 翻译缓存 */}
            <div className="mt-5 rounded-xl border border-[rgb(var(--fg-rgb)/0.08)] bg-[rgb(var(--fg-rgb)/0.02)] px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] text-[var(--text-soft)]">翻译缓存</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
                    {cacheInfo.count > 0
                      ? `已存 ${cacheInfo.count} 部 · 约 ${(cacheInfo.bytes / 1024 / 1024).toFixed(1)} MB。同一份字幕再导入会直接套用，不再请求。`
                      : '还没有缓存。翻译完会自动存，下次导入同一份字幕不用再翻。'}
                  </div>
                </div>
                <button
                  onClick={() => {
                    const n = clearAllCaches();
                    refreshCacheInfo();
                    setCachedHits(0);
                    flash(n > 0 ? `已清空 ${n} 部译文缓存` : '本来就没有缓存');
                  }}
                  disabled={cacheInfo.count === 0}
                  className="btn btn-ghost shrink-0 !px-2.5 !py-1.5 !text-[11.5px] disabled:opacity-30"
                >
                  清空
                </button>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setShowSettings(false)} className="btn btn-ghost">
                取消
              </button>
              <button
                onClick={() => {
                  const persisted = saveConfig(cfg);
                  setShowSettings(false);
                  flash(persisted ? '设置已保存' : '设置本次有效；浏览器不允许保存，关闭页面后需要重新填写');
                }}
                className="btn btn-gold"
              >
                保存
              </button>
            </div>
          </div>
          </div>,
          document.body
        )}

      {/* ============ 字幕轨选择 ============ */}
      {mounted &&
        tracks &&
        tracks.length > 0 &&
        createPortal(
          <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          <div
            className="modal-overlay absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setTracks(null)}
          />
          <div className="modal-panel relative z-10 w-full max-w-md rounded-2xl border border-[rgb(var(--fg-rgb)/0.10)] bg-[var(--learn-panel)] p-6 shadow-2xl">
            <h2 className="title-serif text-[19px] text-[var(--text)]">
              发现 {tracks.length} 条字幕轨
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--text-dim)]">
              选一条抽出来。一般选你听得懂的语言对照着学，效果最好。
            </p>
            <div className="mt-4 space-y-2">
              {tracks.map((t) => (
                <button
                  key={t.trackIndex}
                  onClick={() => pickTrack(t)}
                  className="group flex w-full items-center justify-between rounded-xl border border-[rgb(var(--fg-rgb)/0.08)] bg-[rgb(var(--fg-rgb)/0.03)] px-4 py-3 text-left transition-colors hover:border-gold-500/35 hover:bg-gold-500/[0.06]"
                >
                  <span className="flex items-center gap-3">
                    <span className="grid h-7 w-7 place-items-center rounded-md border border-[rgb(var(--fg-rgb)/0.10)] text-[10px] tnum text-[var(--text-dim)]">
                      {String(t.trackIndex + 1).padStart(2, '0')}
                    </span>
                    <span>
                      <span className="block text-[13px] text-[var(--text)]">
                        {trackLabel(t)}
                      </span>
                      <span className="block text-[10.5px] text-[var(--text-faint)]">
                        流 #{t.streamIndex}
                      </span>
                    </span>
                  </span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="text-[var(--text-faint)] transition-all group-hover:translate-x-0.5 group-hover:text-[var(--gold-ink)]"
                  >
                    <path
                      d="M5 12h14M13 6l6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ))}
            </div>
            <button
              onClick={() => setTracks(null)}
              className="mt-4 w-full text-[12px] text-[var(--text-faint)] hover:text-[var(--text-soft)]"
            >
              取消
            </button>
          </div>
          </div>,
          document.body
        )}

      {/* ============ 没有字幕轨 ============ */}
      {mounted &&
        noTrack &&
        createPortal(
          <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          <div
            className="modal-overlay absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setNoTrack(false)}
          />
          <div className="modal-panel relative z-10 w-full max-w-lg rounded-2xl border border-[rgb(var(--fg-rgb)/0.10)] bg-[var(--learn-panel)] p-6 shadow-2xl">
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl border border-rose-400/20 bg-rose-400/8">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 8v5M12 16h.01"
                  stroke="rgba(251,113,133,0.9)"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="12" r="9" stroke="rgba(251,113,133,0.7)" strokeWidth="1.5" />
              </svg>
            </div>
            <h2 className="title-serif text-[19px] text-[var(--text)]">
              这个视频里没有字幕轨
            </h2>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--text-dim)]">
              能读的流：只有画面和声音。字幕要么被「烧」进了画面（硬字幕），
              要么片源本来就没带。
              <span className="text-[var(--text-dim)]">
                mp4 和 mkv 我都能抽——只要里面真有字幕轨；mp4 里九成是烧死的。
              </span>
            </p>

            <div className="mt-5 space-y-2.5">
              <Route n="1" title="找一个 srt 文件传进来" desc="字幕站基本都有，对一下片长和帧率就行——这条最快" />
              <Route n="2" title="其实不用换片源" desc="mp4 也能抽软字幕（mov_text）。换片源只在原片本来就没字幕时才有意义" />
            </div>

            <div className="mt-6 flex items-center gap-2">
              <label className="btn btn-gold cursor-pointer !text-[12.5px]">
                <input
                  type="file"
                  accept=".srt,.vtt,.ass,.ssa,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    onSubFile(e.target.files?.[0]);
                    setNoTrack(false);
                  }}
                />
                传一个 srt
              </label>
              <button
                onClick={() => setNoTrack(false)}
                className="ml-auto text-[12px] text-[var(--text-faint)] hover:text-[var(--text-soft)]"
              >
                关闭
              </button>
            </div>
          </div>
          </div>,
          document.body
        )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 animate-fade-up">
          <div className="rounded-full border border-[rgb(var(--fg-rgb)/0.12)] bg-[var(--learn-toast)] px-4 py-2 text-[12.5px] text-[var(--text)] shadow-2xl backdrop-blur">
            {toast}
          </div>
        </div>
      )}

      <style jsx global>{`
        .input {
          width: 100%;
          border-radius: 0.6rem;
          border: 1px solid rgb(var(--fg-rgb) / 0.12);
          background: rgb(var(--fg-rgb) / 0.03);
          padding: 0.6rem 0.75rem;
          font-size: 13px;
          color: var(--text);
          outline: none;
          transition: all 0.2s;
        }
        .input:focus {
          border-color: rgb(224 169 74 / 0.4);
          background: rgb(var(--fg-rgb) / 0.05);
        }
      `}</style>
    </div>
  );
}

/* ---------- 小组件 ---------- */

function FileBtn({
  label,
  accept,
  onPick,
  active,
}: {
  label: string;
  accept: string;
  onPick: (f?: File) => void;
  active?: boolean;
}) {
  return (
    <label
      className={`btn cursor-pointer !px-3 !py-1.5 !text-[12.5px] ${
        active ? 'btn-gold' : 'btn-ghost'
      }`}
    >
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      {label}
    </label>
  );
}

function Ctrl({
  children,
  onClick,
  disabled,
  title,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`grid h-8 w-8 place-items-center rounded-lg border transition-all disabled:opacity-30 ${
        primary
          ? 'border-gold-500/30 bg-gold-500/12 text-[var(--gold-ink)] hover:bg-gold-500/20'
          : 'border-[rgb(var(--fg-rgb)/0.10)] text-[var(--text-dim)] hover:border-[rgb(var(--fg-rgb)/0.20)] hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] tracking-wider text-[var(--text-faint)]">{label}</span>
      {children}
    </label>
  );
}

function Route({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-[rgb(var(--fg-rgb)/0.08)] bg-[rgb(var(--fg-rgb)/0.02)] px-3.5 py-3">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-gold-500/25 bg-gold-500/10 text-[10px] tnum text-[var(--gold-ink)]">
        {n}
      </span>
      <div>
        <div className="text-[12.5px] text-[var(--text-soft)]">{title}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-faint)]">{desc}</div>
      </div>
    </div>
  );
}

function EmptyVideo({
  onVideo,
  onSample,
  loadingSample,
  onFolder,
  scanning,
  canFolder,
  hasCues,
  workTitle,
}: {
  onVideo: (f?: File) => void;
  onSample: () => void;
  loadingSample: boolean;
  onFolder: () => void;
  scanning: number | null;
  canFolder: boolean;
  hasCues: boolean;
  workTitle?: string;
}) {
  return (
    <div className="learn-empty flex w-full min-w-0 flex-col items-center justify-center gap-4 rounded-2xl border border-[rgb(var(--fg-rgb)/0.06)] bg-gradient-to-b from-[rgb(var(--fg-rgb)/0.03)] via-transparent to-transparent p-4 text-center sm:gap-6 sm:p-6">
      <div className="learn-empty-icon relative">
        <div className="absolute inset-0 rounded-2xl bg-gold-500/10 blur-2xl" />
        <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-[rgb(var(--fg-rgb)/0.10)] bg-[rgb(var(--fg-rgb)/0.04)]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-11Z" stroke="rgba(224,169,74,0.7)" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M10 9.5l5 2.5-5 2.5v-5Z" fill="rgba(224,169,74,0.8)" />
          </svg>
        </div>
      </div>

      <div className="learn-empty-heading">
        <h3 className="title-serif text-[20px] text-[var(--text)]">
          {workTitle ? `打开《${workTitle}》的副本` : '选一段自己的视频或音频'}
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-[12.5px] leading-relaxed text-[var(--text-dim)]">
          文件在你的浏览器里播放，不会上传到任何服务器。
          {hasCues ? ' 字幕已就绪，请选配套的视频或音频。' : ' 电影、美剧、播客、新闻都可以；逐句学习需配套字幕。'}
        </p>
      </div>

      <div className="learn-empty-actions flex flex-wrap items-center justify-center gap-2">
        <label className="btn btn-gold cursor-pointer">
          <input
            type="file"
            accept={MEDIA_ACCEPT}
            className="hidden"
            onChange={(e) => onVideo(e.target.files?.[0])}
          />
          选择视频 / 音频
        </label>
        {canFolder && (
          <button
            onClick={onFolder}
            disabled={scanning !== null}
            title="选一个剧集文件夹，自动把视频和字幕配成对"
            className="btn btn-ghost disabled:opacity-50"
          >
            {scanning !== null ? (
              <span className="tnum">扫描中 {scanning} 个…</span>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="mr-1">
                  <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l1.8 2H19a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 19 18H4.5A1.5 1.5 0 0 1 3 16.5v-9Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                选整个文件夹
              </>
            )}
          </button>
        )}
      </div>

      {canFolder && (
        <p className="learn-empty-folder-note -mt-2 text-[11px] text-[var(--text-faint)]">
          整个文件夹选进来，会把 S01E01.mkv、S01E01.简体&amp;英文.srt 自动配成一对
        </p>
      )}

      {/* 三步走 */}
      <div className="learn-empty-steps mt-2 grid w-full max-w-lg grid-cols-3 gap-2">
        {[
          { n: '01', t: '选视频', d: '本地文件，不上传' },
          { n: '02', t: '抽字幕', d: '自动抽，或传 .srt' },
          { n: '03', t: '逐句精听', d: '循环 + 收藏' },
        ].map((s) => (
          <div key={s.n} className="rounded-lg border border-[rgb(var(--fg-rgb)/0.08)] bg-[rgb(var(--fg-rgb)/0.02)] px-3 py-2.5 text-left">
            <div className="tnum text-[10px] text-[var(--gold-ink)]">{s.n}</div>
            <div className="mt-0.5 text-[12px] text-[var(--text-soft)]">{s.t}</div>
            <div className="mt-0.5 text-[10.5px] text-[var(--text-faint)]">{s.d}</div>
          </div>
        ))}
      </div>

      <button
        onClick={onSample}
        disabled={loadingSample}
        className="text-[11px] text-[var(--text-faint)] underline decoration-white/15 underline-offset-4 transition-colors hover:text-[var(--gold-ink)]"
      >
        没有片源？试学《海边的曼彻斯特》维修片段
      </button>

      <div className="learn-empty-shortcuts flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1.5 text-[10.5px] text-[var(--text-faint)]">
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border border-[rgb(var(--fg-rgb)/0.15)] bg-[rgb(var(--fg-rgb)/0.08)] px-1.5 py-0.5 text-[9.5px] text-[var(--text-soft)]">空格</kbd>
          播放
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border border-[rgb(var(--fg-rgb)/0.15)] bg-[rgb(var(--fg-rgb)/0.08)] px-1.5 py-0.5 text-[9.5px] text-[var(--text-soft)]">↑↓</kbd>
          切换
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border border-[rgb(var(--fg-rgb)/0.15)] bg-[rgb(var(--fg-rgb)/0.08)] px-1.5 py-0.5 text-[9.5px] text-[var(--text-soft)]">R</kbd>
          重播
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="rounded border border-[rgb(var(--fg-rgb)/0.15)] bg-[rgb(var(--fg-rgb)/0.08)] px-1.5 py-0.5 text-[9.5px] text-[var(--text-soft)]">L</kbd>
          循环
        </span>
      </div>

      <div className="learn-empty-formats flex items-center gap-1.5 text-[10.5px] text-[var(--text-faint)]">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
          <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        mp4 / mkv / webm 都可以，越大加载越慢
      </div>
    </div>
  );
}

function EmptyCues() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-full border border-[rgb(var(--fg-rgb)/0.10)] bg-[rgb(var(--fg-rgb)/0.03)]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[var(--text-faint)]">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M7 10h10M7 14h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-[13px] text-[var(--text-dim)]">还没有字幕</p>
      <p className="max-w-[250px] text-[11.5px] leading-relaxed text-[var(--text-faint)]">
        如果视频自带字幕，点上方「抽字幕」直接抽出来；
        没有的话传一个 .srt / .vtt / .ass 文件
      </p>
    </div>
  );
}

export default function LearningStudio({ trial = false, user }: { trial?: boolean; user?: AccountUser | null }) {
  return (
    <>
      {trial && !user && <div className="trial-banner"><span><strong>免费试学</strong> · 循环一句、点词查义，先感受怎么学。</span><a href="/signup?returnTo=%2Flearn" className="btn btn-primary">免费注册，学自己的视频</a></div>}
      {trial && user && <div className="trial-banner"><span>正在体验示例，不覆盖你上次的视频与进度。</span><a href="/learn" className="btn btn-primary">回到我的学习台</a></div>}
      <LearningActivity enabled={!!user} />
      <Suspense fallback={<div className="p-10 text-sm text-[var(--text-faint)]">加载学习台…</div>}>
        <LearnInner trial={trial} user={user} />
      </Suspense>
    </>
  );
}
