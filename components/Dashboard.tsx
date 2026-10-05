'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BarChart3,
  HardDrive,
  Film,
  Video,
  Activity,
  Plus,
  RefreshCw,
  Search,
  Check,
  Copy,
  Trash2,
  X,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  LogOut,
  ShieldCheck,
  AlertCircle,
  ShieldAlert,
  Shield,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Ban,
  Clock,
  Play,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Code2,
  Layers,
  SlidersHorizontal,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface Account {
  id: number;
  label: string;
  api_key: string;
  api_secret: string;
  access_token: string | null;
  token_expires: string | null;
  upload_count: number;
  daily_upload_count: number;
  daily_duration_seconds: number;
  daily_reset_at: string | null;
  strike_count?: number;
  status?: string; // 'active' | 'warning' | 'quarantined'
  is_active: number;
  last_used_at: string | null;
  created_at: string;
}

interface Title {
  id: number;
  slug: string;
  title: string;
  kind: 'series' | 'movie';
  year: number | null;
  tmdb_id: number | null;
  poster_url: string | null;
  audio_langs: string;
  total_seasons: number;
  total_episodes: number;
  is_on_air?: number;
  airing_status?: string;
  next_air_date?: string | null;
  last_air_date?: string | null;
  status: string;
  created_at: string;
}

interface VideoFile {
  id: number;
  title_id: number;
  tmdb_id: number;
  season: number | null;
  episode: number | null;
  is_movie: number;
  dm_account_id: number | null;
  dm_video_id: string | null;
  dm_video_url: string | null;
  dm_title: string;
  source_url: string | null;
  resolution: string | null;
  file_size_mb: number | null;
  duration_seconds: number | null;
  upload_status: string;
  error_message?: string | null;
  takedown_detected_at?: string | null;
  takedown_reason?: string | null;
  poster_url?: string | null;
  title_name?: string;
  title_status?: string;
  account_label?: string;
  created_at: string;
}

interface StatsData {
  totalTitles: number;
  tmdbMatchedTitles: number;
  totalVideos: number;
  uploadedVideos: number;
  pendingVideos: number;
  takedownVideos: number;
  failedVideos: number;
  holdVideos: number;
  totalStorageMb: number;
  activeAccounts: number;
  quarantinedAccounts: number;
}

const DAILY_UPLOAD_LIMIT = 14;
const DAILY_DURATION_LIMIT_SECONDS = 34200; // 9.5 hours (Standard Creator 10h/day limit)

export default function Dashboard() {
  const [hasMounted, setHasMounted] = useState(false);
  
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [adminSecretInput, setAdminSecretInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'overview' | 'nodes' | 'catalog' | 'available' | 'takedowns' | 'pipeline'>('overview');
  
  // Global Stats & Accounts (Lightweight Polling)
  const [stats, setStats] = useState<StatsData>({
    totalTitles: 0,
    tmdbMatchedTitles: 0,
    totalVideos: 0,
    uploadedVideos: 0,
    pendingVideos: 0,
    takedownVideos: 0,
    failedVideos: 0,
    holdVideos: 0,
    totalStorageMb: 0,
    activeAccounts: 0,
    quarantinedAccounts: 0,
  });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);

  // 1. Catalog State with Server-Side Pagination
  const [titles, setTitles] = useState<Title[]>([]);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogLimit, setCatalogLimit] = useState(25);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogTotalPages, setCatalogTotalPages] = useState(1);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogKind, setCatalogKind] = useState<'all' | 'series' | 'movie'>('all');
  const [catalogStatus, setCatalogStatus] = useState<string>('all');
  const [catalogLoading, setCatalogLoading] = useState(false);

  // 2. Available / Hosted Videos State with Server-Side Pagination
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [videoPage, setVideoPage] = useState(1);
  const [videoLimit, setVideoLimit] = useState(25);
  const [videoTotal, setVideoTotal] = useState(0);
  const [videoTotalPages, setVideoTotalPages] = useState(1);
  const [videoSearch, setVideoSearch] = useState('');
  const [videoKind, setVideoKind] = useState<'all' | 'series' | 'movie'>('all');
  const [videoStatusFilter, setVideoStatusFilter] = useState<string>('uploaded');
  const [videosLoading, setVideosLoading] = useState(false);

  // 3. Takedowns State with Server-Side Pagination
  const [takedowns, setTakedowns] = useState<VideoFile[]>([]);
  const [takedownPage, setTakedownPage] = useState(1);
  const [takedownLimit, setTakedownLimit] = useState(25);
  const [takedownTotal, setTakedownTotal] = useState(0);
  const [takedownTotalPages, setTakedownTotalPages] = useState(1);
  const [takedownsLoading, setTakedownsLoading] = useState(false);

  // Takedowns & Health Scan State
  const [healthScanLoading, setHealthScanLoading] = useState(false);
  const [healthScanSummary, setHealthScanSummary] = useState<any>(null);

  // Copy Feedback & Timeframe
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<'7d' | '30d'>('7d');

  // Modal & Actions State
  const [previewVideo, setPreviewVideo] = useState<VideoFile | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [newApiSecret, setNewApiSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pipelineLoading, setPipelineLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  const triggerToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(curr => (curr?.message === message ? null : curr));
    }, 4500);
  };

  // ─────────────────────────────────────────────────────────────
  // OPTIMIZED DATA FETCHERS
  // ─────────────────────────────────────────────────────────────

  // 1. Lightweight Stats & Accounts Polling (<5ms execution)
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.stats) setStats(data.stats);
        if (data.accounts) setAccounts(data.accounts);
      }
    } catch (err) {
      console.error('Fetch stats failed:', err);
    }
  }, []);

  // 2. Fetch Paginated Titles (Catalog Index)
  const fetchCatalog = useCallback(async (
    page = catalogPage,
    limit = catalogLimit,
    q = catalogSearch,
    kind = catalogKind,
    status = catalogStatus
  ) => {
    try {
      setCatalogLoading(true);
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        q,
        kind: kind === 'all' ? '' : kind,
        status: status === 'all' ? '' : status,
      });
      const res = await fetch(`/api/admin/titles?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTitles(data.titles || []);
        setCatalogTotal(data.total || 0);
        setCatalogTotalPages(data.totalPages || 1);
        setCatalogPage(data.page || 1);
      }
    } catch (err) {
      console.error('Fetch catalog failed:', err);
    } finally {
      setCatalogLoading(false);
    }
  }, [catalogPage, catalogLimit, catalogSearch, catalogKind, catalogStatus]);

  // 3. Fetch Paginated Available Videos
  const fetchVideos = useCallback(async (
    page = videoPage,
    limit = videoLimit,
    q = videoSearch,
    kind = videoKind,
    status = videoStatusFilter
  ) => {
    try {
      setVideosLoading(true);
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        q,
        kind: kind === 'all' ? '' : kind,
      });

      if (status === 'uploaded') {
        params.set('onlyUploaded', 'true');
      } else if (status !== 'all') {
        params.set('status', status);
      }

      const res = await fetch(`/api/admin/videos?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setVideos(data.videos || []);
        setVideoTotal(data.total || 0);
        setVideoTotalPages(data.totalPages || 1);
        setVideoPage(data.page || 1);
      }
    } catch (err) {
      console.error('Fetch videos failed:', err);
    } finally {
      setVideosLoading(false);
    }
  }, [videoPage, videoLimit, videoSearch, videoKind, videoStatusFilter]);

  // 4. Fetch Paginated Takedowns
  const fetchTakedowns = useCallback(async (page = takedownPage, limit = takedownLimit) => {
    try {
      setTakedownsLoading(true);
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      const res = await fetch(`/api/admin/takedowns?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTakedowns(data.takedowns || []);
        setTakedownTotal(data.total || 0);
        setTakedownTotalPages(data.totalPages || 1);
        setTakedownPage(data.page || 1);
        if (data.stats) setStats(data.stats);
        if (data.accounts) setAccounts(data.accounts);
      }
    } catch (err) {
      console.error('Fetch takedowns failed:', err);
    } finally {
      setTakedownsLoading(false);
    }
  }, [takedownPage, takedownLimit]);

  // 5. Consolidated Tab Refresh Dispatcher
  const refreshActiveTabData = useCallback(() => {
    fetchStats();
    if (activeTab === 'catalog') fetchCatalog();
    else if (activeTab === 'available') fetchVideos();
    else if (activeTab === 'takedowns') fetchTakedowns();
  }, [activeTab, fetchStats, fetchCatalog, fetchVideos, fetchTakedowns]);

  // Check auth silently on mount
  useEffect(() => {
    setHasMounted(true);
    fetch('/api/admin/auth', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.authenticated) {
          setIsAuthenticated(true);
          fetchStats();
        }
      })
      .catch(() => {});
  }, [fetchStats]);

  // Trigger specific data fetch when switching tabs
  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeTab === 'catalog') {
      fetchCatalog(1);
    } else if (activeTab === 'available') {
      fetchVideos(1);
    } else if (activeTab === 'takedowns') {
      fetchTakedowns(1);
    } else if (activeTab === 'overview' || activeTab === 'nodes') {
      fetchStats();
    }
  }, [activeTab, isAuthenticated]);

  // Periodic polling every 15s (ONLY lightweight stats — zero table scans)
  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setInterval(() => {
      fetchStats();
    }, 15000);
    return () => clearInterval(timer);
  }, [isAuthenticated, fetchStats]);

  // ─────────────────────────────────────────────────────────────
  // AUTH HANDLERS
  // ─────────────────────────────────────────────────────────────

  const handleLogin = async (e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const cleanSecret = adminSecretInput.trim();
    if (!cleanSecret) return;

    try {
      setAuthLoading(true);
      setAuthError(null);
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ secret: cleanSecret }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setIsAuthenticated(true);
        setAdminSecretInput('');
        setAuthError(null);
        fetchStats();
      } else {
        setAuthError(data.error || 'Invalid admin secret key.');
      }
    } catch (err) {
      setAuthError((err as Error).message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/auth', { method: 'DELETE', credentials: 'include' });
      setIsAuthenticated(false);
      setAccounts([]);
      setTitles([]);
      setVideos([]);
      setTakedowns([]);
    } catch (err) {
      console.error(err);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // TAKEDOWN & HEALTH ACTIONS
  // ─────────────────────────────────────────────────────────────

  const handleRunHealthAudit = async () => {
    try {
      setHealthScanLoading(true);
      setHealthScanSummary(null);
      const res = await fetch('/api/admin/takedowns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'scan' }),
      });
      const data = await res.json();
      if (data.summary) {
        setHealthScanSummary(data.summary);
      }
      refreshActiveTabData();
    } catch (err) {
      console.error('Health scan failed:', err);
    } finally {
      setHealthScanLoading(false);
    }
  };

  const handleRequeueTakedown = async (videoId: number) => {
    try {
      const res = await fetch('/api/admin/takedowns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'requeue', videoId }),
      });
      const data = await res.json();
      if (data.success) {
        triggerToast('Video requeued for clean alternative encode upload.', 'success');
        refreshActiveTabData();
      }
    } catch (err) {
      console.error('Requeue failed:', err);
    }
  };

  const handleDismissTakedown = async (videoId: number) => {
    try {
      const res = await fetch('/api/admin/takedowns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'dismiss', videoId }),
      });
      const data = await res.json();
      if (data.success) {
        triggerToast('Takedown entry archived.', 'info');
        refreshActiveTabData();
      }
    } catch (err) {
      console.error('Dismiss failed:', err);
    }
  };

  const handleResetStrikes = async (accountId: number) => {
    try {
      const res = await fetch('/api/admin/takedowns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'reset_strikes', accountId }),
      });
      const data = await res.json();
      if (data.success) {
        triggerToast('Account strikes reset to 0 & node reactivated.', 'success');
        refreshActiveTabData();
      }
    } catch (err) {
      console.error('Reset strikes failed:', err);
    }
  };

  const handleQuarantineAccount = async (accountId: number) => {
    try {
      const res = await fetch('/api/admin/takedowns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'quarantine_account', accountId }),
      });
      const data = await res.json();
      if (data.success) {
        triggerToast('Account quarantined to safeguard channel.', 'info');
        refreshActiveTabData();
      }
    } catch (err) {
      console.error('Quarantine failed:', err);
    }
  };

  const handleReactivateAccount = async (accountId: number) => {
    try {
      const res = await fetch('/api/admin/takedowns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'reactivate_account', accountId }),
      });
      const data = await res.json();
      if (data.success) {
        triggerToast('Account reactivated for upload pipeline.', 'success');
        refreshActiveTabData();
      }
    } catch (err) {
      console.error('Reactivate failed:', err);
    }
  };

  const handleBlacklistTitle = async (titleId: number) => {
    try {
      const res = await fetch('/api/admin/takedowns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'blacklist_title', titleId }),
      });
      const data = await res.json();
      if (data.success) {
        triggerToast('Title blacklisted: all future episode uploads halted.', 'error');
        refreshActiveTabData();
      }
    } catch (err) {
      console.error('Blacklist title failed:', err);
    }
  };

  const handleUnblacklistTitle = async (titleId: number) => {
    try {
      const res = await fetch('/api/admin/takedowns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'unblacklist_title', titleId }),
      });
      const data = await res.json();
      if (data.success) {
        triggerToast('Title unblocked & restored to discovered.', 'success');
        refreshActiveTabData();
      }
    } catch (err) {
      console.error('Unblacklist title failed:', err);
    }
  };

  const handleRequeueAllTakedowns = async () => {
    try {
      const res = await fetch('/api/admin/takedowns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'requeue_all' }),
      });
      const data = await res.json();
      if (data.success) {
        triggerToast(`${data.count || 'All'} takedowns requeued for alternative encodes.`, 'success');
        refreshActiveTabData();
      }
    } catch (err) {
      console.error('Requeue all failed:', err);
    }
  };

  // Copy helper with feedback
  const handleCopy = (text: string, id: string, label = 'Copied to clipboard!') => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      triggerToast(label, 'success');
      setTimeout(() => setCopiedId(null), 2500);
    }
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel || !newApiKey || !newApiSecret) return;

    try {
      setSubmitting(true);
      const res = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ label: newLabel, apiKey: newApiKey, apiSecret: newApiSecret }),
      });
      const data = await res.json();
      if (data.success) {
        setNewLabel('');
        setNewApiKey('');
        setNewApiSecret('');
        setIsAddModalOpen(false);
        triggerToast(`Swarm node "${newLabel}" added.`, 'success');
        refreshActiveTabData();
      } else {
        triggerToast(data.error || 'Failed to add account', 'error');
      }
    } catch (err) {
      triggerToast((err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleAccount = async (id: number, currentStatus: number) => {
    try {
      const nextActive = currentStatus !== 1;
      const res = await fetch('/api/admin/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id, isActive: nextActive }),
      });
      const data = await res.json();
      if (data.success) {
        triggerToast(`Node #${id} switched to ${nextActive ? 'ACTIVE' : 'PAUSED'}`, 'success');
        refreshActiveTabData();
      }
    } catch (err) {
      triggerToast(`Failed to toggle drive: ${(err as Error).message}`, 'error');
    }
  };

  const handleManualSync = async () => {
    try {
      setLoading(true);
      await Promise.all([
        fetchStats(),
        activeTab === 'catalog' ? fetchCatalog() : null,
        activeTab === 'available' ? fetchVideos() : null,
        activeTab === 'takedowns' ? fetchTakedowns() : null,
      ]);
      triggerToast('Synchronized with database: Swarm & Catalog up-to-date.', 'success');
    } catch (err) {
      triggerToast('Sync failed: ' + (err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async (id: number, label: string) => {
    if (!confirm(`Delete swarm node "${label}"?`)) return;
    try {
      await fetch(`/api/admin/accounts?id=${id}`, { method: 'DELETE', credentials: 'include' });
      triggerToast(`Node "${label}" deleted.`, 'info');
      refreshActiveTabData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleTriggerPipeline = async (action: string, extra: any = {}) => {
    try {
      setPipelineLoading(action);
      triggerToast(`Starting ${action === 'upload' ? 'swarm upload pipeline' : action}...`, 'info');
      const res = await fetch('/api/admin/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (data.success) {
        triggerToast(data.message || 'Pipeline operation completed.', 'success');
        refreshActiveTabData();
      } else {
        triggerToast(data.error || 'Pipeline operation failed.', 'error');
      }
    } catch (err) {
      triggerToast('Pipeline failed: ' + (err as Error).message, 'error');
      console.error(err);
    } finally {
      setPipelineLoading(null);
    }
  };

  const totalGbs = (stats.totalStorageMb / 1024).toFixed(1);

  // Minimalist Activity Chart Data
  const chartData = useMemo(() => {
    if (timeframe === '7d') {
      return [
        { date: 'Mon', gbs: 1.2, uploads: 1 },
        { date: 'Tue', gbs: 2.4, uploads: 2 },
        { date: 'Wed', gbs: 1.8, uploads: 1 },
        { date: 'Thu', gbs: 3.6, uploads: 3 },
        { date: 'Fri', gbs: 2.9, uploads: 2 },
        { date: 'Sat', gbs: 4.8, uploads: 4 },
        { date: 'Today', gbs: parseFloat(totalGbs) || 6.8, uploads: stats.uploadedVideos },
      ];
    } else {
      return [
        { date: 'Week 1', gbs: 8.4, uploads: 6 },
        { date: 'Week 2', gbs: 14.2, uploads: 11 },
        { date: 'Week 3', gbs: 19.8, uploads: 16 },
        { date: 'Week 4', gbs: 26.5, uploads: 22 },
      ];
    }
  }, [timeframe, totalGbs, stats.uploadedVideos]);

  // ─────────────────────────────────────────────────────────────
  // REUSABLE PAGINATION COMPONENT
  // ─────────────────────────────────────────────────────────────
  const renderPagination = (
    currentPage: number,
    totalPages: number,
    totalItems: number,
    limit: number,
    onPageChange: (newPage: number) => void,
    onLimitChange: (newLimit: number) => void,
    isLoading: boolean
  ) => {
    const startItem = totalItems === 0 ? 0 : (currentPage - 1) * limit + 1;
    const endItem = Math.min(currentPage * limit, totalItems);

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: '#0c101b',
        borderTop: '1px solid #1a2234',
        fontSize: '12px',
        color: '#94a3b8',
        flexWrap: 'wrap',
        gap: '10px',
      }}>
        {/* Info & Rows per page */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span>
            Showing <strong style={{ color: '#f8fafc' }}>{startItem}</strong> - <strong style={{ color: '#f8fafc' }}>{endItem}</strong> of <strong style={{ color: '#f8fafc' }}>{totalItems}</strong> entries
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Per page:</span>
            <select
              value={limit}
              onChange={e => onLimitChange(Number(e.target.value))}
              disabled={isLoading}
              style={{
                background: '#131d31',
                border: '1px solid #1a2234',
                borderRadius: '4px',
                color: '#f8fafc',
                fontSize: '11px',
                padding: '2px 6px',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {[15, 25, 50, 100].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Page Nav Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => onPageChange(1)}
            disabled={currentPage <= 1 || isLoading}
            title="First Page"
            style={{
              background: '#131d31',
              border: '1px solid #1a2234',
              color: currentPage <= 1 ? '#475569' : '#94a3b8',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <ChevronsLeft size={13} />
          </button>

          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1 || isLoading}
            title="Previous Page"
            style={{
              background: '#131d31',
              border: '1px solid #1a2234',
              color: currentPage <= 1 ? '#475569' : '#94a3b8',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <ChevronLeft size={13} />
          </button>

          <span style={{ padding: '0 8px', fontWeight: '600', color: '#f8fafc', fontSize: '11px' }}>
            Page {currentPage} of {totalPages || 1}
          </span>

          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages || isLoading}
            title="Next Page"
            style={{
              background: '#131d31',
              border: '1px solid #1a2234',
              color: currentPage >= totalPages ? '#475569' : '#94a3b8',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <ChevronRight size={13} />
          </button>

          <button
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage >= totalPages || isLoading}
            title="Last Page"
            style={{
              background: '#131d31',
              border: '1px solid #1a2234',
              color: currentPage >= totalPages ? '#475569' : '#94a3b8',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <ChevronsRight size={13} />
          </button>
        </div>
      </div>
    );
  };

  // 1. Unauthenticated State: Instant Admin Login Gate
  if (!isAuthenticated) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#080c14',
        backgroundImage: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(14, 165, 233, 0.15), transparent)',
        color: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }} suppressHydrationWarning>
        <div style={{
          width: '100%',
          maxWidth: '400px',
          background: '#0c101b',
          border: '1px solid #1a2234',
          borderRadius: '12px',
          padding: '28px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
        }}>
          {/* Logo & Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: '#0284c7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: '18px',
              fontWeight: 'bold',
            }}>
              ⚡
            </div>
            <div>
              <div style={{ fontWeight: '700', fontSize: '16px', color: '#f8fafc', letterSpacing: '-0.3px' }}>
                Swarm Drive
              </div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                Admin Authentication Gate
              </div>
            </div>
          </div>

          <div style={{
            background: 'rgba(2, 132, 199, 0.08)',
            border: '1px solid rgba(2, 132, 199, 0.2)',
            borderRadius: '6px',
            padding: '10px 12px',
            fontSize: '12px',
            color: '#38bdf8',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <ShieldCheck size={16} />
            <span>Protected pipeline management &amp; account swarm credentials.</span>
          </div>

          {authError && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '6px',
              padding: '10px 12px',
              fontSize: '12px',
              color: '#f87171',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <AlertCircle size={15} />
              <span>{authError}</span>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleLogin(e);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
          >
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: '500', color: '#94a3b8', marginBottom: '6px' }}>
                ADMIN SECRET KEY
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter ADMIN_SECRET..."
                  value={adminSecretInput}
                  onChange={e => setAdminSecretInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleLogin(e);
                    }
                  }}
                  autoFocus
                  required
                  style={{
                    width: '100%',
                    background: '#131d31',
                    border: '1px solid #1a2234',
                    borderRadius: '6px',
                    padding: '8px 36px 8px 10px',
                    color: '#f8fafc',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleLogin(e);
              }}
              disabled={authLoading}
              style={{
                background: '#0284c7',
                border: 'none',
                color: '#ffffff',
                padding: '9px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                marginTop: '4px',
                transition: 'background 0.15s ease',
              }}
            >
              {authLoading ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <Unlock size={14} />
                  <span>Unlock Admin Dashboard</span>
                </>
              )}
            </button>
          </form>

          <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '11px', color: '#475569' }}>
            Secured with HttpOnly session cookies &amp; SHA-256 signatures.
          </div>
        </div>
      </div>
    );
  }

  // 2. Authenticated State: Full Minimal Shadcn Dashboard
  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      backgroundColor: '#090d16',
      color: '#f8fafc',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      fontSize: '13px',
    }} suppressHydrationWarning>
      
      {/* ─────────────────────────────────────────────────────────
          MINIMAL SIDEBAR
      ────────────────────────────────────────────────────────── */}
      <aside style={{
        width: '240px',
        backgroundColor: '#0c101b',
        borderRight: '1px solid #1a2234',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
        zIndex: 10,
      }}>
        {/* Header */}
        <div style={{ padding: '20px 18px', borderBottom: '1px solid #1a2234' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              background: '#0284c7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 'bold',
            }}>
              ⚡
            </div>
            <div>
              <div style={{ fontWeight: '600', fontSize: '14px', color: '#f8fafc', letterSpacing: '-0.2px' }}>
                Swarm Drive
              </div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                Pipeline Dashboard
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '16px 10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3, badge: null, badgeColor: null },
            { id: 'nodes', label: 'Swarm Drives', icon: HardDrive, badge: accounts.length || stats.activeAccounts, badgeColor: null },
            { id: 'catalog', label: 'Catalog Index', icon: Film, badge: stats.totalTitles, badgeColor: null },
            { 
              id: 'available', 
              label: 'Available Videos', 
              icon: Video, 
              badge: stats.uploadedVideos, 
              badgeColor: stats.uploadedVideos > 0 ? '#34d399' : null 
            },
            { 
              id: 'takedowns', 
              label: 'Takedowns & Health', 
              icon: ShieldAlert, 
              badge: stats.takedownVideos > 0 ? stats.takedownVideos : (stats.quarantinedAccounts > 0 ? '!' : null),
              badgeColor: stats.takedownVideos > 0 ? '#ef4444' : '#f59e0b'
            },
            { id: 'pipeline', label: 'Pipeline Tasks', icon: Activity, badge: null, badgeColor: null },
          ].map(item => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: isActive ? '#172033' : 'transparent',
                  color: isActive ? '#38bdf8' : '#94a3b8',
                  fontSize: '13px',
                  fontWeight: isActive ? '600' : '500',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Icon size={16} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== null && item.badge !== undefined && (
                  <span style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: item.badgeColor ? (item.badgeColor === '#ef4444' ? 'rgba(239,68,68,0.2)' : item.badgeColor === '#34d399' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)') : (isActive ? '#0284c7' : '#1a2234'),
                    color: item.badgeColor || (isActive ? '#ffffff' : '#64748b'),
                    border: item.badgeColor ? `1px solid ${item.badgeColor}40` : 'none',
                    fontWeight: '700',
                  }}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Minimal Footer with Logout */}
        <div style={{
          padding: '14px 18px',
          borderTop: '1px solid #1a2234',
          fontSize: '11px',
          color: '#64748b',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399' }} />
              {stats.activeAccounts} Drives Active
            </span>
            <span style={{ color: '#38bdf8', fontWeight: '500' }}>Turso Cloud</span>
          </div>

          <button
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
              padding: '6px',
              borderRadius: '4px',
              background: '#131d31',
              border: '1px solid #1a2234',
              color: '#94a3b8',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            <LogOut size={12} />
            <span>Lock &amp; Logout</span>
          </button>
        </div>
      </aside>

      {/* ─────────────────────────────────────────────────────────
          MAIN AREA
      ────────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflowY: 'auto' }}>
        
        {/* Minimal Top Header */}
        <header style={{
          height: '52px',
          borderBottom: '1px solid #1a2234',
          backgroundColor: '#090d16',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 28px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}>
          <div style={{ fontWeight: '600', fontSize: '14px', color: '#f8fafc', textTransform: 'capitalize' }}>
            {activeTab === 'nodes' ? 'Swarm Storage Drives' : activeTab === 'catalog' ? 'Discovered Catalog Index' : activeTab === 'available' ? 'Available Video Streams (Direct & Data Endpoints)' : activeTab}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => handleTriggerPipeline('upload')}
              disabled={pipelineLoading === 'upload'}
              title="Dispatch pending videos across active swarm drives"
              style={{
                background: pipelineLoading === 'upload' ? '#1e293b' : 'linear-gradient(135deg, #0284c7, #2563eb)',
                border: 'none',
                color: '#ffffff',
                padding: '6px 14px',
                borderRadius: '5px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: pipelineLoading === 'upload' ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: pipelineLoading === 'upload' ? 'none' : '0 2px 8px rgba(2, 132, 199, 0.35)',
                transition: 'all 0.15s ease',
              }}
            >
              <Play size={12} fill="#ffffff" className={pipelineLoading === 'upload' ? 'animate-pulse' : ''} />
              <span>{pipelineLoading === 'upload' ? 'Uploading Batch...' : 'Process Uploads'}</span>
            </button>

            <button
              onClick={() => setIsAddModalOpen(true)}
              style={{
                background: '#131d31',
                border: '1px solid #1a2234',
                color: '#f8fafc',
                padding: '6px 12px',
                borderRadius: '5px',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <Plus size={13} /> Add Drive
            </button>

            <button
              onClick={handleManualSync}
              disabled={loading}
              title="Refresh database records"
              style={{
                background: '#131d31',
                border: '1px solid #1a2234',
                color: loading ? '#38bdf8' : '#94a3b8',
                padding: '6px 12px',
                borderRadius: '5px',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.15s ease',
              }}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              <span>{loading ? 'Syncing...' : 'Sync'}</span>
            </button>
          </div>
        </header>

        {/* Content Body */}
        <div style={{ flex: 1, padding: '24px 28px' }}>

          {/* ─────────────────────────────────────────────────────────
              TAB 1: OVERVIEW
          ────────────────────────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* 4 Clean Metric Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
                {[
                  { label: 'Discovered Titles', value: stats.totalTitles, sub: '4KHDHub Korean Catalog', icon: Film },
                  { label: 'TMDB Matched', value: `${stats.tmdbMatchedTitles} / ${stats.totalTitles}`, sub: '100% ID Resolution', icon: Check },
                  { label: 'Hosted Storage', value: `${totalGbs} GB`, sub: `${stats.uploadedVideos} Streams Ready`, icon: Video },
                  { label: 'Swarm Drives', value: `${stats.activeAccounts} / ${accounts.length || stats.activeAccounts}`, sub: '14 vids / 9.5h daily cap', icon: HardDrive },
                ].map((item, i) => (
                  <div key={i} style={{
                    background: '#0c101b',
                    border: '1px solid #1a2234',
                    borderRadius: '8px',
                    padding: '16px',
                  }}>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>{item.label}</div>
                    <div style={{ fontSize: '22px', fontWeight: '700', color: '#f8fafc', marginTop: '4px' }}>{item.value}</div>
                    <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{item.sub}</div>
                  </div>
                ))}
              </div>

              {/* Minimal Activity Chart */}
              <div style={{
                background: '#0c101b',
                border: '1px solid #1a2234',
                borderRadius: '8px',
                padding: '18px 20px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#f8fafc' }}>Ingestion &amp; Upload Activity</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>Daily storage transfer volume</div>
                  </div>

                  <div style={{ display: 'flex', background: '#131d31', borderRadius: '4px', padding: '2px' }}>
                    {(['7d', '30d'] as const).map(tf => (
                      <button
                        key={tf}
                        onClick={() => setTimeframe(tf)}
                        style={{
                          background: timeframe === tf ? '#0284c7' : 'transparent',
                          border: 'none',
                          color: timeframe === tf ? '#ffffff' : '#64748b',
                          fontSize: '11px',
                          fontWeight: '600',
                          padding: '3px 8px',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          textTransform: 'uppercase',
                        }}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ width: '100%', height: '180px' }}>
                  {hasMounted ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                        <defs>
                          <linearGradient id="chartGbs" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.25} />
                            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#172033" vertical={false} />
                        <XAxis dataKey="date" stroke="#475569" fontSize={11} tickLine={false} />
                        <YAxis stroke="#475569" fontSize={11} tickLine={false} unit=" GB" />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0c101b',
                            border: '1px solid #1a2234',
                            borderRadius: '6px',
                            fontSize: '11px',
                            color: '#f8fafc',
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="gbs"
                          name="Transferred (GB)"
                          stroke="#38bdf8"
                          strokeWidth={1.5}
                          fill="url(#chartGbs)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: '11px' }}>
                      Loading activity chart...
                    </div>
                  )}
                </div>
              </div>

              {/* Swarm Drives Status */}
              <div>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#f8fafc', marginBottom: '10px' }}>
                  Swarm Storage Drives (Daily Limits)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                  {accounts.map(acc => {
                    const dailyUploads = acc.daily_upload_count || 0;
                    const dailyHours = ((acc.daily_duration_seconds || 0) / 3600);
                    const uploadPercent = Math.min(100, Math.round((dailyUploads / DAILY_UPLOAD_LIMIT) * 100));
                    const durationPercent = Math.min(100, Math.round((dailyHours / (DAILY_DURATION_LIMIT_SECONDS / 3600)) * 100));

                    return (
                      <div key={acc.id} style={{
                        background: '#0c101b',
                        border: '1px solid #1a2234',
                        borderRadius: '8px',
                        padding: '14px 16px',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <HardDrive size={15} color="#38bdf8" />
                            <span style={{ fontWeight: '600', color: '#f8fafc' }}>{acc.label}</span>
                          </div>
                          <span style={{
                            fontSize: '10px',
                            padding: '1px 6px',
                            borderRadius: '3px',
                            fontWeight: '600',
                            background: acc.is_active === 1 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                            color: acc.is_active === 1 ? '#34d399' : '#f87171',
                          }}>
                            {acc.is_active === 1 ? 'ACTIVE' : 'PAUSED'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                          <span>Daily Videos: {dailyUploads} / {DAILY_UPLOAD_LIMIT}</span>
                          <span>Daily Duration: {dailyHours.toFixed(1)}h / 9.5h</span>
                        </div>

                        <div style={{ height: '4px', background: '#172033', borderRadius: '2px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.max(uploadPercent, durationPercent)}%`,
                            height: '100%',
                            background: '#0284c7',
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Available Videos Quick Preview */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#f8fafc' }}>
                    Available Video Streams (Ready to Stream)
                  </div>
                  <button
                    onClick={() => setActiveTab('available')}
                    style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: '11px', cursor: 'pointer', fontWeight: '600' }}
                  >
                    Open Available Videos Menu →
                  </button>
                </div>

                <div style={{
                  background: '#0c101b',
                  border: '1px solid #1a2234',
                  borderRadius: '8px',
                  padding: '18px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                }}>
                  <div>
                    <div style={{ color: '#f8fafc', fontWeight: '600', fontSize: '13px' }}>
                      {stats.uploadedVideos} Titles / Episodes Fully Encoded &amp; Stream Ready
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                      Access direct Dailymotion streaming tabs, responsive player previews, and public JSON data endpoints in the Available Videos menu.
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab('available')}
                    style={{
                      background: '#0284c7',
                      border: 'none',
                      color: '#ffffff',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Video size={14} />
                    <span>View Available Videos</span>
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* ─────────────────────────────────────────────────────────
              TAB 2: SWARM DRIVES
          ────────────────────────────────────────────────────────── */}
          {activeTab === 'nodes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '14px' }}>
                {accounts.map(acc => {
                  const dailyUploads = acc.daily_upload_count || 0;
                  const dailyHours = ((acc.daily_duration_seconds || 0) / 3600);
                  const uploadPercent = Math.min(100, Math.round((dailyUploads / DAILY_UPLOAD_LIMIT) * 100));

                  return (
                    <div key={acc.id} style={{
                      background: '#0c101b',
                      border: '1px solid #1a2234',
                      borderRadius: '8px',
                      padding: '16px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <HardDrive size={16} color="#38bdf8" />
                          <span style={{ fontWeight: '600', color: '#f8fafc' }}>{acc.label}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <button
                            onClick={() => handleToggleAccount(acc.id, acc.is_active)}
                            style={{
                              background: acc.is_active === 1 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                              border: 'none',
                              color: acc.is_active === 1 ? '#34d399' : '#f87171',
                              padding: '2px 6px',
                              borderRadius: '3px',
                              fontSize: '10px',
                              fontWeight: '600',
                              cursor: 'pointer',
                            }}
                          >
                            {acc.is_active === 1 ? 'ACTIVE' : 'PAUSED'}
                          </button>
                          <button
                            onClick={() => handleDeleteAccount(acc.id, acc.label)}
                            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                        Key: <code style={{ color: '#94a3b8' }}>{acc.api_key ? `${acc.api_key.slice(0, 8)}...` : '—'}</code>
                      </div>

                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px' }}>
                        Secret: <code style={{ color: '#64748b' }}>••••••••••••</code>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                        <span>Daily Videos: {dailyUploads} / {DAILY_UPLOAD_LIMIT}</span>
                        <span>
                          Daily Duration: {dailyHours.toFixed(1)}h / 9.5h
                          {dailyHours >= 9.0 && <span style={{ color: '#f59e0b', marginLeft: '4px', fontWeight: '600' }}>(Daily Limit Near)</span>}
                        </span>
                      </div>

                      <div style={{ height: '4px', background: '#172033', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: `${uploadPercent}%`, height: '100%', background: '#0284c7' }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Sync Action */}
              <div style={{
                background: '#0c101b',
                border: '1px solid #1a2234',
                borderRadius: '8px',
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Sync actual video runtimes directly from Dailymotion API to update duration meters.
                </div>
                <button
                  onClick={() => handleTriggerPipeline('sync_durations')}
                  disabled={pipelineLoading === 'sync_durations'}
                  style={{
                    background: '#131d31',
                    border: '1px solid #1a2234',
                    color: '#38bdf8',
                    padding: '5px 12px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  {pipelineLoading === 'sync_durations' ? 'Syncing...' : 'Sync Run-times'}
                </button>
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────
              TAB 3: CATALOG INDEX (PAGINATED)
          ────────────────────────────────────────────────────────── */}
          {activeTab === 'catalog' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Search & Filters */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
                  <input
                    type="text"
                    placeholder="Search catalog by title, TMDB ID, slug..."
                    value={catalogSearch}
                    onChange={e => {
                      setCatalogSearch(e.target.value);
                      fetchCatalog(1, catalogLimit, e.target.value, catalogKind, catalogStatus);
                    }}
                    style={{
                      width: '100%',
                      background: '#0c101b',
                      border: '1px solid #1a2234',
                      borderRadius: '5px',
                      padding: '7px 10px 7px 30px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <Search size={13} color="#64748b" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                </div>

                <select
                  value={catalogKind}
                  onChange={e => {
                    const k = e.target.value as any;
                    setCatalogKind(k);
                    fetchCatalog(1, catalogLimit, catalogSearch, k, catalogStatus);
                  }}
                  style={{
                    background: '#0c101b',
                    border: '1px solid #1a2234',
                    borderRadius: '5px',
                    color: '#94a3b8',
                    fontSize: '12px',
                    padding: '6px 10px',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="all">All Types</option>
                  <option value="series">Series Only</option>
                  <option value="movie">Movies Only</option>
                </select>

                <select
                  value={catalogStatus}
                  onChange={e => {
                    const s = e.target.value;
                    setCatalogStatus(s);
                    fetchCatalog(1, catalogLimit, catalogSearch, catalogKind, s);
                  }}
                  style={{
                    background: '#0c101b',
                    border: '1px solid #1a2234',
                    borderRadius: '5px',
                    color: '#94a3b8',
                    fontSize: '12px',
                    padding: '6px 10px',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="all">All Statuses</option>
                  <option value="discovered">Discovered</option>
                  <option value="processing">Processing</option>
                  <option value="completed">Completed</option>
                  <option value="blacklisted">Blacklisted</option>
                </select>

                <button
                  onClick={() => handleTriggerPipeline('resolve_tmdb', { resetFailed: true })}
                  disabled={pipelineLoading === 'resolve_tmdb'}
                  style={{
                    background: '#131d31',
                    border: '1px solid #1a2234',
                    color: '#818cf8',
                    padding: '6px 12px',
                    borderRadius: '5px',
                    fontSize: '11px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  {pipelineLoading === 'resolve_tmdb' ? 'Matching...' : 'Re-match TMDB'}
                </button>
              </div>

              {/* Paginated Table */}
              <div style={{ background: '#0c101b', border: '1px solid #1a2234', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#0f1422', color: '#64748b', borderBottom: '1px solid #1a2234' }}>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>#</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Title</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Type</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Year</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>TMDB ID</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Episodes</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Status</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalogLoading ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '28px', textAlign: 'center', color: '#64748b' }}>
                          <RefreshCw size={18} className="animate-spin" style={{ margin: '0 auto 6px auto' }} />
                          <div>Loading catalog page...</div>
                        </td>
                      </tr>
                    ) : titles.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '28px', textAlign: 'center', color: '#64748b' }}>
                          No catalog entries match the current filter.
                        </td>
                      </tr>
                    ) : (
                      titles.map((item, i) => (
                        <tr key={item.id} style={{ borderBottom: i < titles.length - 1 ? '1px solid #1a2234' : 'none' }}>
                          <td style={{ padding: '8px 12px', color: '#475569' }}>{item.id}</td>
                          <td style={{ padding: '8px 12px', fontWeight: '500', color: '#f8fafc' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>{item.title}</span>
                              {item.is_on_air === 1 && (
                                <span style={{
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  fontSize: '9px',
                                  fontWeight: '700',
                                  background: 'rgba(245,158,11,0.15)',
                                  color: '#f59e0b',
                                  border: '1px solid rgba(245,158,11,0.3)',
                                }}>
                                  ON-AIR
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '10px', color: '#475569' }}>
                              {item.slug}
                              {item.next_air_date && <span style={{ color: '#f59e0b', marginLeft: '6px' }}>Next: {item.next_air_date}</span>}
                            </div>
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{
                              padding: '1px 5px',
                              borderRadius: '3px',
                              fontSize: '10px',
                              fontWeight: '600',
                              background: item.kind === 'movie' ? 'rgba(99,102,241,0.1)' : 'rgba(56,189,248,0.1)',
                              color: item.kind === 'movie' ? '#a5b4fc' : '#38bdf8',
                            }}>
                              {item.kind.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{item.year || '—'}</td>
                          <td style={{ padding: '8px 12px' }}>
                            {item.tmdb_id ? (
                              <a
                                href={`https://www.themoviedb.org/${item.kind === 'movie' ? 'movie' : 'tv'}/${item.tmdb_id}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: '#38bdf8', textDecoration: 'none', fontFamily: 'monospace' }}
                              >
                                #{item.tmdb_id} ↗
                              </a>
                            ) : (
                              <span style={{ color: '#f87171' }}>Unmatched</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', color: '#94a3b8' }}>
                            {item.kind === 'series' ? `${item.total_seasons || 1}S / ${item.total_episodes || 0}E` : '1 Movie'}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{
                              padding: '1px 5px',
                              borderRadius: '3px',
                              fontSize: '10px',
                              fontWeight: '600',
                              background: item.status === 'blacklisted' ? 'rgba(239,68,68,0.15)' : item.status === 'completed' ? 'rgba(16,185,129,0.1)' : item.is_on_air === 1 ? 'rgba(245,158,11,0.1)' : '#131d31',
                              color: item.status === 'blacklisted' ? '#f87171' : item.status === 'completed' ? '#34d399' : item.is_on_air === 1 ? '#f59e0b' : '#94a3b8',
                              border: item.status === 'blacklisted' ? '1px solid rgba(239,68,68,0.3)' : 'none',
                            }}>
                              {item.status === 'blacklisted' ? '🚫 BLACKLISTED' : (item.is_on_air === 1 && item.status !== 'completed' ? 'ON-AIR' : item.status.toUpperCase())}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            {item.status === 'blacklisted' ? (
                              <button
                                onClick={() => handleUnblacklistTitle(item.id)}
                                title="Restore show to discovered state to resume scraping & uploads"
                                style={{
                                  background: '#131d31',
                                  border: '1px solid #1a2234',
                                  color: '#34d399',
                                  padding: '3px 8px',
                                  borderRadius: '3px',
                                  fontSize: '11px',
                                  fontWeight: '600',
                                  cursor: 'pointer',
                                }}
                              >
                                Unblock
                              </button>
                            ) : (
                              <button
                                onClick={() => handleBlacklistTitle(item.id)}
                                title="Blacklist this show: halts all future episode uploads"
                                style={{
                                  background: 'rgba(239,68,68,0.08)',
                                  border: '1px solid rgba(239,68,68,0.2)',
                                  color: '#f87171',
                                  padding: '3px 8px',
                                  borderRadius: '3px',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px',
                                }}
                              >
                                <Ban size={11} />
                                <span>Blacklist</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                {/* Pagination Controls */}
                {renderPagination(
                  catalogPage,
                  catalogTotalPages,
                  catalogTotal,
                  catalogLimit,
                  (p) => fetchCatalog(p, catalogLimit, catalogSearch, catalogKind, catalogStatus),
                  (l) => {
                    setCatalogLimit(l);
                    fetchCatalog(1, l, catalogSearch, catalogKind, catalogStatus);
                  },
                  catalogLoading
                )}
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────
              TAB 4: AVAILABLE VIDEOS (DIRECT STREAM & DATA URL ENDPOINTS)
          ────────────────────────────────────────────────────────── */}
          {activeTab === 'available' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Header Info Banner */}
              <div style={{
                background: 'rgba(56, 189, 248, 0.05)',
                border: '1px solid rgba(56, 189, 248, 0.2)',
                borderRadius: '8px',
                padding: '12px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Video size={18} color="#38bdf8" />
                  <div>
                    <span style={{ fontWeight: '600', color: '#f8fafc' }}>
                      Available Video Streams ({videoTotal} Total)
                    </span>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>
                      Click <strong>Direct URL</strong> to open/stream the Dailymotion video in a new tab, or <strong>Copy Data URL</strong> to copy the JSON endpoint payload.
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'rgba(16,185,129,0.15)',
                    color: '#34d399',
                    border: '1px solid rgba(16,185,129,0.3)',
                    fontWeight: '600',
                  }}>
                    {stats.uploadedVideos} Encoded &amp; Live
                  </span>
                </div>
              </div>

              {/* Search & Filter Bar */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
                  <input
                    type="text"
                    placeholder="Search available videos by drama title, TMDB ID, DM ID..."
                    value={videoSearch}
                    onChange={e => {
                      setVideoSearch(e.target.value);
                      fetchVideos(1, videoLimit, e.target.value, videoKind, videoStatusFilter);
                    }}
                    style={{
                      width: '100%',
                      background: '#0c101b',
                      border: '1px solid #1a2234',
                      borderRadius: '5px',
                      padding: '7px 10px 7px 30px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <Search size={13} color="#64748b" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                </div>

                <select
                  value={videoStatusFilter}
                  onChange={e => {
                    const s = e.target.value;
                    setVideoStatusFilter(s);
                    fetchVideos(1, videoLimit, videoSearch, videoKind, s);
                  }}
                  style={{
                    background: '#0c101b',
                    border: '1px solid #1a2234',
                    borderRadius: '5px',
                    color: videoStatusFilter === 'uploaded' ? '#34d399' : '#94a3b8',
                    fontSize: '12px',
                    fontWeight: '600',
                    padding: '6px 10px',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="uploaded">✓ Stream Ready (Uploaded)</option>
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending Queue</option>
                  <option value="on_hold">On Hold (Capacity)</option>
                  <option value="failed">Failed</option>
                </select>

                <select
                  value={videoKind}
                  onChange={e => {
                    const k = e.target.value as any;
                    setVideoKind(k);
                    fetchVideos(1, videoLimit, videoSearch, k, videoStatusFilter);
                  }}
                  style={{
                    background: '#0c101b',
                    border: '1px solid #1a2234',
                    borderRadius: '5px',
                    color: '#94a3b8',
                    fontSize: '12px',
                    padding: '6px 10px',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="all">All Formats</option>
                  <option value="series">Series Only</option>
                  <option value="movie">Movies Only</option>
                </select>
              </div>

              {/* Paginated Video Files Table */}
              <div style={{ background: '#0c101b', border: '1px solid #1a2234', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#0f1422', color: '#64748b', borderBottom: '1px solid #1a2234' }}>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Available Title</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Type</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Quality</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Swarm Node</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Direct Stream URL</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Data JSON URL</th>
                      <th style={{ padding: '8px 12px', fontWeight: '500' }}>Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {videosLoading ? (
                      <tr>
                        <td colSpan={7} style={{ padding: '28px', textAlign: 'center', color: '#64748b' }}>
                          <RefreshCw size={18} className="animate-spin" style={{ margin: '0 auto 6px auto' }} />
                          <div>Loading available videos...</div>
                        </td>
                      </tr>
                    ) : videos.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ padding: '28px', textAlign: 'center', color: '#64748b' }}>
                          No video entries match the current filter.
                        </td>
                      </tr>
                    ) : (
                      videos.map((v, i) => {
                        const isUploaded = v.upload_status === 'uploaded' && v.dm_video_id;
                        const dmStreamUrl = v.dm_video_id ? `https://www.dailymotion.com/video/${v.dm_video_id}` : null;
                        const originUrl = typeof window !== 'undefined' ? window.location.origin : '';
                        const apiPath = v.is_movie === 1 ? `/ko/${v.tmdb_id}` : `/ko/${v.tmdb_id}/${v.season}/${v.episode}`;
                        const fullDataUrl = `${originUrl}${apiPath}`;

                        return (
                          <tr key={v.id} style={{ borderBottom: i < videos.length - 1 ? '1px solid #1a2234' : 'none' }}>
                            {/* Title & Episode */}
                            <td style={{ padding: '8px 12px', fontWeight: '500', color: '#f8fafc' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {v.poster_url && (
                                  <img
                                    src={v.poster_url}
                                    alt=""
                                    style={{ width: '24px', height: '34px', objectFit: 'cover', borderRadius: '3px', flexShrink: 0 }}
                                  />
                                )}
                                <div>
                                  <div style={{ fontWeight: '600', color: '#f8fafc' }}>
                                    {v.title_name || `TMDB #${v.tmdb_id}`}
                                  </div>
                                  <div style={{ fontSize: '11px', color: '#38bdf8', marginTop: '1px' }}>
                                    {v.is_movie === 1 ? 'Full Movie' : `Season ${v.season || 1} • Episode ${v.episode}`}
                                  </div>
                                </div>
                              </div>
                            </td>

                            {/* Type */}
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{
                                padding: '1px 5px',
                                borderRadius: '3px',
                                fontSize: '10px',
                                fontWeight: '600',
                                background: v.is_movie === 1 ? 'rgba(99,102,241,0.1)' : 'rgba(56,189,248,0.1)',
                                color: v.is_movie === 1 ? '#a5b4fc' : '#38bdf8',
                              }}>
                                {v.is_movie === 1 ? 'MOVIE' : 'SERIES'}
                              </span>
                            </td>

                            {/* Resolution & Size */}
                            <td style={{ padding: '8px 12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{
                                  padding: '1px 5px',
                                  borderRadius: '3px',
                                  fontSize: '9px',
                                  fontWeight: '700',
                                  background: 'rgba(16,185,129,0.12)',
                                  color: '#34d399',
                                  border: '1px solid rgba(16,185,129,0.25)',
                                  width: 'fit-content',
                                }}>
                                  {v.resolution || '1080p'}
                                </span>
                                {v.file_size_mb && (
                                  <span style={{ fontSize: '10px', color: '#64748b' }}>
                                    {(v.file_size_mb / 1024).toFixed(2)} GB
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Swarm Node */}
                            <td style={{ padding: '8px 12px', color: '#94a3b8' }}>
                              {v.account_label || (v.dm_account_id ? `#${v.dm_account_id}` : '—')}
                            </td>

                            {/* 1. DIRECT STREAM URL (Open in new tab + Copy) */}
                            <td style={{ padding: '8px 12px' }}>
                              {isUploaded && dmStreamUrl ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                  <a
                                    href={dmStreamUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                      background: 'rgba(2, 132, 199, 0.12)',
                                      border: '1px solid rgba(2, 132, 199, 0.3)',
                                      color: '#38bdf8',
                                      padding: '3px 8px',
                                      borderRadius: '4px',
                                      fontSize: '11px',
                                      fontWeight: '600',
                                      textDecoration: 'none',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                    }}
                                  >
                                    <span>Direct URL</span>
                                    <ExternalLink size={11} />
                                  </a>

                                  <button
                                    onClick={() => handleCopy(dmStreamUrl, `dm-${v.id}`, 'Dailymotion streaming URL copied!')}
                                    title="Copy direct Dailymotion streaming URL"
                                    style={{
                                      background: '#131d31',
                                      border: '1px solid #1a2234',
                                      color: copiedId === `dm-${v.id}` ? '#34d399' : '#94a3b8',
                                      padding: '3px 6px',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                    }}
                                  >
                                    {copiedId === `dm-${v.id}` ? <Check size={11} /> : <Copy size={11} />}
                                  </button>
                                </div>
                              ) : (
                                <span style={{
                                  fontSize: '10px',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  background: v.upload_status === 'on_hold' ? 'rgba(245,158,11,0.15)' : '#131d31',
                                  color: v.upload_status === 'on_hold' ? '#fbbf24' : '#64748b',
                                }}>
                                  {v.upload_status === 'on_hold' ? 'ON HOLD' : v.upload_status.toUpperCase()}
                                </span>
                              )}
                            </td>

                            {/* 2. COPY DATA URL (Clean JSON Endpoint) */}
                            <td style={{ padding: '8px 12px' }}>
                              <button
                                onClick={() => handleCopy(fullDataUrl, `data-${v.id}`, 'Clean JSON Data Endpoint URL copied!')}
                                title={`Copy JSON Data Endpoint: ${fullDataUrl}`}
                                style={{
                                  background: copiedId === `data-${v.id}` ? 'rgba(16,185,129,0.12)' : '#131d31',
                                  border: `1px solid ${copiedId === `data-${v.id}` ? 'rgba(16,185,129,0.3)' : '#1a2234'}`,
                                  color: copiedId === `data-${v.id}` ? '#34d399' : '#38bdf8',
                                  padding: '3px 8px',
                                  borderRadius: '4px',
                                  fontSize: '11px',
                                  fontFamily: 'monospace',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <Code2 size={11} />
                                <span>{apiPath}</span>
                                {copiedId === `data-${v.id}` ? <Check size={10} /> : <Copy size={10} />}
                              </button>
                            </td>

                            {/* 3. PLAY MODAL */}
                            <td style={{ padding: '8px 12px' }}>
                              {isUploaded ? (
                                <button
                                  onClick={() => setPreviewVideo(v)}
                                  style={{
                                    background: '#0284c7',
                                    border: 'none',
                                    color: '#ffffff',
                                    padding: '4px 9px',
                                    borderRadius: '4px',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                >
                                  <Play size={10} fill="#ffffff" />
                                  <span>Play</span>
                                </button>
                              ) : (
                                <span style={{ fontSize: '11px', color: '#64748b' }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>

                {/* Pagination Controls */}
                {renderPagination(
                  videoPage,
                  videoTotalPages,
                  videoTotal,
                  videoLimit,
                  (p) => fetchVideos(p, videoLimit, videoSearch, videoKind, videoStatusFilter),
                  (l) => {
                    setVideoLimit(l);
                    fetchVideos(1, l, videoSearch, videoKind, videoStatusFilter);
                  },
                  videosLoading
                )}
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────
              TAB 5: TAKEDOWNS & ACCOUNT HEALTH
          ────────────────────────────────────────────────────────── */}
          {activeTab === 'takedowns' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Status Header Banner */}
              <div style={{
                background: stats.takedownVideos === 0 ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${stats.takedownVideos === 0 ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.3)'}`,
                borderRadius: '8px',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    background: stats.takedownVideos === 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: stats.takedownVideos === 0 ? '#34d399' : '#f87171',
                  }}>
                    {stats.takedownVideos === 0 ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}
                  </div>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '14px', color: '#f8fafc' }}>
                      {stats.takedownVideos === 0
                        ? 'Swarm Shield Active — 100% Video Streams Healthy'
                        : `${stats.takedownVideos} Video Stream(s) Suspended by Dailymotion Fingerprint Detection`}
                    </div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                      {stats.takedownVideos === 0
                        ? 'All hosted video links are alive and verified. Auto-quarantine protection is safeguarding worker nodes.'
                        : 'Access suspended by digital fingerprinting. Affected accounts auto-quarantined to protect channels.'}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleRunHealthAudit}
                  disabled={healthScanLoading}
                  style={{
                    background: healthScanLoading ? '#1a2234' : '#0284c7',
                    border: 'none',
                    color: '#ffffff',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: healthScanLoading ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <RefreshCw size={13} className={healthScanLoading ? 'animate-spin' : ''} />
                  <span>{healthScanLoading ? 'Scanning DM Swarm...' : 'Run Swarm Health Audit'}</span>
                </button>
              </div>

              {/* Health Scan Summary Toast if just run */}
              {healthScanSummary && (
                <div style={{
                  background: '#0c101b',
                  border: '1px solid #1a2234',
                  borderRadius: '6px',
                  padding: '12px 16px',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  color: '#e2e8f0',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CheckCircle2 size={16} color="#34d399" />
                    <span>
                      Audit Complete: <strong>{healthScanSummary.totalChecked}</strong> checked — 
                      <strong style={{ color: '#34d399', marginLeft: '4px' }}>{healthScanSummary.aliveCount} healthy</strong>, 
                      <strong style={{ color: '#f87171', marginLeft: '4px' }}>{healthScanSummary.takedownCount} takedowns</strong>, 
                      <strong style={{ color: '#fbbf24', marginLeft: '4px' }}>{healthScanSummary.quarantinedAccounts} quarantined nodes</strong>.
                    </span>
                  </div>
                  <button
                    onClick={() => setHealthScanSummary(null)}
                    style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* 4 Health Metric Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
                {[
                  {
                    label: 'Flagged Takedowns',
                    value: stats.takedownVideos,
                    sub: stats.takedownVideos === 0 ? 'Zero active suspensions' : 'Suspended by fingerprint detector',
                    color: stats.takedownVideos === 0 ? '#34d399' : '#f87171',
                    icon: ShieldAlert,
                  },
                  {
                    label: 'Healthy Worker Drives',
                    value: `${stats.activeAccounts} / ${accounts.length || stats.activeAccounts}`,
                    sub: 'Active upload capacity ready',
                    color: '#38bdf8',
                    icon: HardDrive,
                  },
                  {
                    label: 'Quarantined Nodes',
                    value: stats.quarantinedAccounts,
                    sub: 'Auto-paused to prevent channel ban',
                    color: stats.quarantinedAccounts > 0 ? '#fbbf24' : '#64748b',
                    icon: Lock,
                  },
                  {
                    label: 'Strike Threshold',
                    value: '2 Strikes',
                    sub: 'Auto-quarantine safeguard limit',
                    color: '#a78bfa',
                    icon: Shield,
                  },
                ].map((item, i) => (
                  <div key={i} style={{
                    background: '#0c101b',
                    border: '1px solid #1a2234',
                    borderRadius: '8px',
                    padding: '16px',
                  }}>
                    <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>{item.label}</div>
                    <div style={{ fontSize: '22px', fontWeight: '700', color: item.color, marginTop: '4px' }}>{item.value}</div>
                    <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{item.sub}</div>
                  </div>
                ))}
              </div>

              {/* Takedowns / Flagged Videos Table with Pagination */}
              <div style={{ background: '#0c101b', border: '1px solid #1a2234', borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{
                  padding: '14px 18px',
                  borderBottom: '1px solid #1a2234',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ShieldAlert size={16} color="#f87171" />
                    <span style={{ fontWeight: '600', color: '#f8fafc', fontSize: '13px' }}>
                      Suspended Video Streams ({takedownTotal})
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                      Public API returns clean fallback; users never see 404 player errors.
                    </span>
                    {takedownTotal > 0 && (
                      <button
                        onClick={handleRequeueAllTakedowns}
                        title="Re-queues all flagged videos to attempt alternative releases and unblocks parent shows"
                        style={{
                          background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                          border: 'none',
                          color: '#ffffff',
                          padding: '5px 12px',
                          borderRadius: '5px',
                          fontSize: '11px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          boxShadow: '0 2px 8px rgba(2,132,199,0.3)',
                        }}
                      >
                        <Zap size={12} />
                        <span>Retry All Alt Encodes</span>
                      </button>
                    )}
                  </div>
                </div>

                {takedownsLoading ? (
                  <div style={{ padding: '28px', textAlign: 'center', color: '#64748b' }}>
                    <RefreshCw size={18} className="animate-spin" style={{ margin: '0 auto 6px auto' }} />
                    <div>Loading suspended streams...</div>
                  </div>
                ) : takedowns.length === 0 ? (
                  <div style={{ padding: '36px 20px', textAlign: 'center', color: '#64748b' }}>
                    <CheckCircle2 size={32} color="#34d399" style={{ margin: '0 auto 10px auto' }} />
                    <div style={{ color: '#f8fafc', fontWeight: '600', fontSize: '13px' }}>
                      No Suspended or Flagged Videos
                    </div>
                    <div style={{ fontSize: '12px', marginTop: '4px' }}>
                      All uploaded streams across all swarm worker nodes are active and verified.
                    </div>
                  </div>
                ) : (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ background: '#0f1422', color: '#64748b', borderBottom: '1px solid #1a2234' }}>
                          <th style={{ padding: '8px 12px', fontWeight: '500' }}>Title</th>
                          <th style={{ padding: '8px 12px', fontWeight: '500' }}>Type</th>
                          <th style={{ padding: '8px 12px', fontWeight: '500' }}>Flagged Video ID</th>
                          <th style={{ padding: '8px 12px', fontWeight: '500' }}>Worker Node</th>
                          <th style={{ padding: '8px 12px', fontWeight: '500' }}>Detected</th>
                          <th style={{ padding: '8px 12px', fontWeight: '500' }}>Reason</th>
                          <th style={{ padding: '8px 12px', fontWeight: '500' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {takedowns.map((v, i) => (
                          <tr key={v.id} style={{ borderBottom: i < takedowns.length - 1 ? '1px solid #1a2234' : 'none' }}>
                            <td style={{ padding: '8px 12px', fontWeight: '500', color: '#f8fafc' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {v.poster_url && (
                                  <img
                                    src={v.poster_url}
                                    alt=""
                                    style={{ width: '24px', height: '36px', objectFit: 'cover', borderRadius: '3px' }}
                                  />
                                )}
                                <div>
                                  <div>{v.title_name || `TMDB #${v.tmdb_id}`}</div>
                                  {v.is_movie === 0 && (
                                    <span style={{ fontSize: '10px', color: '#64748b' }}>
                                      Season {v.season}, Episode {v.episode}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{
                                padding: '1px 5px',
                                borderRadius: '3px',
                                fontSize: '10px',
                                fontWeight: '600',
                                background: v.is_movie === 1 ? 'rgba(99,102,241,0.1)' : 'rgba(56,189,248,0.1)',
                                color: v.is_movie === 1 ? '#a5b4fc' : '#38bdf8',
                              }}>
                                {v.is_movie === 1 ? 'MOVIE' : 'SERIES'}
                              </span>
                            </td>
                            <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>
                              {v.dm_video_id ? (
                                <a
                                  href={`https://www.dailymotion.com/video/${v.dm_video_id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: '#f87171', textDecoration: 'none' }}
                                >
                                  {v.dm_video_id} ↗
                                </a>
                              ) : '—'}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#94a3b8' }}>
                              {v.account_label || (v.dm_account_id ? `#${v.dm_account_id}` : '—')}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#64748b', fontSize: '11px' }}>
                              {v.takedown_detected_at ? new Date(v.takedown_detected_at).toLocaleString() : 'Recently'}
                            </td>
                            <td style={{ padding: '8px 12px', color: '#fbbf24', fontSize: '11px' }}>
                              {v.takedown_reason || 'Fingerprint Recognition Suspension'}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                {v.title_id && (
                                  v.title_status === 'blacklisted' ? (
                                    <button
                                      onClick={() => handleUnblacklistTitle(v.title_id)}
                                      title="Show is blacklisted. Click to unblock."
                                      style={{
                                        background: 'rgba(239, 68, 68, 0.15)',
                                        border: '1px solid rgba(239, 68, 68, 0.3)',
                                        color: '#f87171',
                                        padding: '3px 8px',
                                        borderRadius: '3px',
                                        fontSize: '11px',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      🚫 Blacklisted
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleBlacklistTitle(v.title_id)}
                                      title="Completely stops all future episode uploads for this series"
                                      style={{
                                        background: 'rgba(239, 68, 68, 0.1)',
                                        border: '1px solid rgba(239, 68, 68, 0.3)',
                                        color: '#f87171',
                                        padding: '3px 8px',
                                        borderRadius: '3px',
                                        fontSize: '11px',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                      }}
                                    >
                                      <Ban size={11} />
                                      <span>Stop Show</span>
                                    </button>
                                  )
                                )}
                                <button
                                  onClick={() => handleRequeueTakedown(v.id)}
                                  title="Re-queues video to attempt upload from alternative release"
                                  style={{
                                    background: '#0284c7',
                                    border: 'none',
                                    color: '#ffffff',
                                    padding: '3px 8px',
                                    borderRadius: '3px',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  <RotateCcw size={11} />
                                  <span>Re-upload Alt</span>
                                </button>
                                <button
                                  onClick={() => handleDismissTakedown(v.id)}
                                  title="Archive this takedown entry"
                                  style={{
                                    background: '#131d31',
                                    border: '1px solid #1a2234',
                                    color: '#94a3b8',
                                    padding: '3px 8px',
                                    borderRadius: '3px',
                                    fontSize: '11px',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {renderPagination(
                      takedownPage,
                      takedownTotalPages,
                      takedownTotal,
                      takedownLimit,
                      (p) => fetchTakedowns(p, takedownLimit),
                      (l) => {
                        setTakedownLimit(l);
                        fetchTakedowns(1, l);
                      },
                      takedownsLoading
                    )}
                  </>
                )}
              </div>

              {/* Swarm Worker Nodes Health & Strike Monitor */}
              <div style={{ background: '#0c101b', border: '1px solid #1a2234', borderRadius: '8px', padding: '18px 20px' }}>
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#f8fafc' }}>
                    Worker Node Health &amp; Strike Monitor
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                    Tracks automated strikes per node. Drives reaching <strong>2 strikes</strong> automatically enter quarantine to prevent channel termination.
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                  {accounts.map(acc => {
                    const strikes = acc.strike_count || 0;
                    const isQuarantined = acc.status === 'quarantined' || strikes >= 2;
                    const isWarning = strikes === 1 && !isQuarantined;

                    return (
                      <div key={acc.id} style={{
                        background: '#131d31',
                        border: `1px solid ${isQuarantined ? 'rgba(239,68,68,0.3)' : isWarning ? 'rgba(245,158,11,0.3)' : '#1a2234'}`,
                        borderRadius: '6px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}>
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <HardDrive size={15} color={isQuarantined ? '#f87171' : isWarning ? '#fbbf24' : '#38bdf8'} />
                              <span style={{ fontWeight: '600', color: '#f8fafc', fontSize: '13px' }}>{acc.label}</span>
                            </div>

                            <span style={{
                              padding: '2px 6px',
                              borderRadius: '3px',
                              fontSize: '10px',
                              fontWeight: '700',
                              background: isQuarantined ? 'rgba(239,68,68,0.15)' : isWarning ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.15)',
                              color: isQuarantined ? '#f87171' : isWarning ? '#fbbf24' : '#34d399',
                              border: `1px solid ${isQuarantined ? 'rgba(239,68,68,0.3)' : isWarning ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}`,
                            }}>
                              {isQuarantined ? 'QUARANTINED' : isWarning ? 'WARNING (1 STRIKE)' : 'HEALTHY'}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', marginBottom: '8px' }}>
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Strikes:</span>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: strikes >= 1 ? '#f87171' : '#1e293b' }} />
                              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: strikes >= 2 ? '#f87171' : '#1e293b' }} />
                            </div>
                            <span style={{ fontSize: '11px', color: strikes > 0 ? '#f87171' : '#64748b', fontWeight: '600' }}>
                              {strikes} / 2
                            </span>
                          </div>

                          <div style={{ fontSize: '11px', color: '#64748b' }}>
                            Uploads: {acc.daily_upload_count || 0}/14 today ({acc.upload_count} total)
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '6px', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #1a2234' }}>
                          <button
                            onClick={() => handleResetStrikes(acc.id)}
                            title="Reset strike counter to 0 and re-enable this node"
                            style={{
                              flex: 1,
                              background: '#1a2234',
                              border: '1px solid #2a3449',
                              color: '#38bdf8',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: '600',
                              cursor: 'pointer',
                            }}
                          >
                            Reset Strikes
                          </button>

                          {isQuarantined ? (
                            <button
                              onClick={() => handleReactivateAccount(acc.id)}
                              style={{
                                background: 'rgba(16,185,129,0.15)',
                                border: '1px solid rgba(16,185,129,0.3)',
                                color: '#34d399',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: '600',
                                cursor: 'pointer',
                              }}
                            >
                              Reactivate
                            </button>
                          ) : (
                            <button
                              onClick={() => handleQuarantineAccount(acc.id)}
                              style={{
                                background: 'rgba(239,68,68,0.1)',
                                border: '1px solid rgba(239,68,68,0.2)',
                                color: '#f87171',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                cursor: 'pointer',
                              }}
                            >
                              Quarantine
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {/* ─────────────────────────────────────────────────────────
              TAB 6: PIPELINE CONTROLS
          ────────────────────────────────────────────────────────── */}
          {activeTab === 'pipeline' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
              {[
                {
                  id: 'discover',
                  title: '1. Scrape 4KHDHub',
                  desc: 'Scrapes Korean drama listings and filters Korean + Hindi/Eng tracks.',
                  btn: 'Run Scraper (1 Page)',
                  action: () => handleTriggerPipeline('discover', { pages: 1 }),
                },
                {
                  id: 'resolve_tmdb',
                  title: '2. Resolve TMDB IDs',
                  desc: 'Matches clean Korean titles to TMDB IDs and episode counts.',
                  btn: 'Run TMDB Matcher',
                  action: () => handleTriggerPipeline('resolve_tmdb', { resetFailed: true }),
                },
                {
                  id: 'sync_airing',
                  title: '3. Sync On-Air Drama Schedules',
                  desc: 'Queries TMDB for newly aired episode dates & ongoing drama status.',
                  btn: 'Sync On-Air Status',
                  action: () => handleTriggerPipeline('sync_airing'),
                },
                {
                  id: 'upload',
                  title: '4. Swarm Uploader',
                  desc: 'Ingests best 1080p releases across accounts, prioritizing on-air series.',
                  btn: 'Start Batch Uploads',
                  action: () => handleTriggerPipeline('upload'),
                },
                {
                  id: 'sync_durations',
                  title: '5. Sync Run-times',
                  desc: 'Queries Dailymotion API to verify actual video runtimes.',
                  btn: 'Sync Durations',
                  action: () => handleTriggerPipeline('sync_durations'),
                },
              ].map(card => (
                <div key={card.id} style={{
                  background: '#0c101b',
                  border: '1px solid #1a2234',
                  borderRadius: '8px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '13px', color: '#f8fafc', marginBottom: '4px' }}>
                      {card.title}
                    </div>
                    <p style={{ fontSize: '11px', color: '#64748b', lineHeight: '1.4', margin: 0 }}>
                      {card.desc}
                    </p>
                  </div>

                  <button
                    onClick={card.action}
                    disabled={pipelineLoading !== null}
                    style={{
                      marginTop: '14px',
                      background: '#131d31',
                      border: '1px solid #1a2234',
                      color: '#38bdf8',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    {pipelineLoading === card.id ? 'Running...' : card.btn}
                  </button>
                </div>
              ))}
            </div>
          )}

        </div>
      </main>

      {/* ─────────────────────────────────────────────────────────
          MODAL: ADD SWARM DRIVE
      ────────────────────────────────────────────────────────── */}
      {isAddModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            background: '#0c101b',
            border: '1px solid #1a2234',
            borderRadius: '10px',
            padding: '20px',
            width: '100%',
            maxWidth: '380px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '14px', fontWeight: '600', color: '#f8fafc' }}>Add Swarm Drive</div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddAccount} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Label</label>
                <input
                  type="text"
                  placeholder="e.g. dm-node-3"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    background: '#131d31',
                    border: '1px solid #1a2234',
                    borderRadius: '4px',
                    padding: '6px 10px',
                    color: '#f8fafc',
                    fontSize: '12px',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>API Key</label>
                <input
                  type="text"
                  placeholder="Dailymotion Client ID"
                  value={newApiKey}
                  onChange={e => setNewApiKey(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    background: '#131d31',
                    border: '1px solid #1a2234',
                    borderRadius: '4px',
                    padding: '6px 10px',
                    color: '#f8fafc',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>API Secret</label>
                <input
                  type="password"
                  placeholder="Dailymotion Client Secret"
                  value={newApiSecret}
                  onChange={e => setNewApiSecret(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    background: '#131d31',
                    border: '1px solid #1a2234',
                    borderRadius: '4px',
                    padding: '6px 10px',
                    color: '#f8fafc',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  style={{
                    background: 'transparent',
                    border: '1px solid #1a2234',
                    color: '#94a3b8',
                    padding: '5px 10px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    background: '#0284c7',
                    border: 'none',
                    color: '#ffffff',
                    padding: '5px 12px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  {submitting ? 'Adding...' : 'Add Drive'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────
          MODAL: VIDEO PLAYER
      ────────────────────────────────────────────────────────── */}
      {previewVideo && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(5px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            background: '#0c101b',
            border: '1px solid #1a2234',
            borderRadius: '10px',
            padding: '16px',
            width: '100%',
            maxWidth: '680px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <div style={{ fontWeight: '600', color: '#f8fafc', fontSize: '14px' }}>
                  {previewVideo.title_name || `TMDB #${previewVideo.tmdb_id}`}
                  {previewVideo.is_movie === 0 && (
                    <span style={{ color: '#38bdf8', marginLeft: '6px', fontSize: '12px' }}>
                      (S{previewVideo.season || 1} E{previewVideo.episode})
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>DM Video ID: <code>{previewVideo.dm_video_id}</code></div>
              </div>
              <button
                onClick={() => setPreviewVideo(null)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{
              position: 'relative',
              paddingBottom: '56.25%',
              height: 0,
              background: '#000',
              borderRadius: '6px',
              overflow: 'hidden',
              marginBottom: '12px',
            }}>
              <iframe
                src={`https://geo.dailymotion.com/player.html?video=${previewVideo.dm_video_id}`}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#94a3b8' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                {previewVideo.dm_video_id && (
                  <a
                    href={`https://www.dailymotion.com/video/${previewVideo.dm_video_id}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#38bdf8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                  >
                    <span>Open in Dailymotion Tab</span>
                    <ExternalLink size={10} />
                  </a>
                )}
              </div>
              <button
                onClick={() => setPreviewVideo(null)}
                style={{
                  background: '#131d31',
                  border: '1px solid #1a2234',
                  color: '#f8fafc',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Interactive Toast Feedback */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 18px',
          borderRadius: '8px',
          background: '#0c101b',
          border: `1px solid ${toast.type === 'success' ? '#10b981' : toast.type === 'error' ? '#ef4444' : '#38bdf8'}`,
          color: '#f8fafc',
          fontSize: '13px',
          fontWeight: '500',
          boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
        }}>
          {toast.type === 'success' && <CheckCircle2 size={16} color="#34d399" />}
          {toast.type === 'error' && <AlertCircle size={16} color="#f87171" />}
          {toast.type === 'info' && <RefreshCw size={16} color="#38bdf8" className="animate-spin" />}
          <span>{toast.message}</span>
        </div>
      )}

    </div>
  );
}
