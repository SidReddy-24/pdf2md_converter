'use client';

// Prevent static pre-rendering — this page is fully client-side
export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Upload,
  FileText,
  Folder,
  CheckCircle,
  AlertCircle,
  Loader2,
  Download,
  Copy,
  Trash2,
  Search,
  Filter,
  RefreshCw,
  BarChart2,
  Sparkles,
  ClipboardCheck
} from 'lucide-react';
import { convertPdfToMarkdown } from '@/utils/pdfParser';
import JSZip from 'jszip';

interface QueueFile {
  id: string;
  name: string;
  relativePath?: string;
  size: number; // in bytes
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  markdown: string;
  errorMsg?: string;
  pageCount?: number;
}

export default function Home() {
  const [files, setFiles] = useState<QueueFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'preview' | 'editor'>('preview');
  const [isDragOver, setIsDragOver] = useState(false);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const originalFilesRef = useRef<Map<string, File>>(new Map());
  const filesRef = useRef<QueueFile[]>([]);
  const isProcessingRef = useRef(false);
  const isMountedRef = useRef(true);

  // Track mount status to avoid state updates after unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sync files state to a ref to avoid infinite re-triggering of useEffect
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Memoize search/filter file queue
  const filteredFiles = useMemo(() => {
    return files.filter(f => {
      const matchesSearch = f.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = statusFilter === 'all' || f.status === statusFilter;
      return matchesSearch && matchesFilter;
    });
  }, [files, searchQuery, statusFilter]);

  // Compute metrics
  const metrics = useMemo(() => {
    const total = files.length;
    const completed = files.filter(f => f.status === 'completed').length;
    const processing = files.filter(f => f.status === 'processing').length;
    const pending = files.filter(f => f.status === 'pending').length;
    const failed = files.filter(f => f.status === 'error').length;
    
    const totalPages = files.reduce((acc, f) => acc + (f.pageCount || 0), 0);
    const totalSizeBytes = files.reduce((acc, f) => acc + f.size, 0);
    const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(1);

    return { total, completed, processing, pending, failed, totalPages, totalSizeMB };
  }, [files]);

  // Handle files selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
  };

  // Add files to the queue helper
  const addFiles = (newFileList: File[]) => {
    const pdfFiles = newFileList.filter(file => file.name.toLowerCase().endsWith('.pdf'));
    if (pdfFiles.length === 0) return;

    const newQueueFiles: QueueFile[] = pdfFiles.map(file => {
      const id = Math.random().toString(36).substr(2, 9);
      originalFilesRef.current.set(id, file); // Save original File object
      const relativePath = (file as any).relativePath || file.webkitRelativePath || file.name;
      return {
        id,
        name: file.name,
        relativePath,
        size: file.size,
        status: 'pending',
        progress: 0,
        markdown: '',
      };
    });

    setFiles(prev => {
      // Avoid duplicate filenames in the current list
      const existingNames = new Set(prev.map(f => f.name));
      const filteredNew = newQueueFiles.filter(f => !existingNames.has(f.name));
      
      // Select the first new file if none is selected yet
      if (prev.length === 0 && filteredNew.length > 0) {
        setSelectedFileId(filteredNew[0].id);
      }
      return [...prev, ...filteredNew];
    });

    // Reset input elements
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  // Helper to traverse dropped items recursively
  const traverseDirectory = async (entry: any, fileList: File[]) => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        entry.file(resolve, reject);
      });
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const path = entry.fullPath.startsWith('/') ? entry.fullPath.substring(1) : entry.fullPath;
        Object.defineProperty(file, 'relativePath', {
          value: path,
          writable: true,
          enumerable: true,
          configurable: true
        });
        fileList.push(file);
      }
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readAllEntries = async () => {
        const allEntries: any[] = [];
        let read = async (): Promise<any[]> => {
          return new Promise((resolve, reject) => {
            dirReader.readEntries(resolve, reject);
          });
        };
        
        let results = await read();
        while (results.length > 0) {
          allEntries.push(...results);
          results = await read();
        }
        return allEntries;
      };

      const entries = await readAllEntries();
      for (const childEntry of entries) {
        await traverseDirectory(childEntry, fileList);
      }
    }
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const items = e.dataTransfer.items;
    if (items) {
      const fileList: File[] = [];
      const promises: Promise<void>[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            promises.push(traverseDirectory(entry, fileList));
          }
        }
      }

      await Promise.all(promises);
      addFiles(fileList);
    }
  };



  // Robust queue worker to process files sequentially without canceling on progress updates
  const processNextFile = useCallback(async () => {
    if (isProcessingRef.current || !isMountedRef.current) return;

    const pendingFile = filesRef.current.find(f => f.status === 'pending');
    if (!pendingFile) return;

    isProcessingRef.current = true;

    // Mark as processing
    setFiles(prev =>
      prev.map(f => (f.id === pendingFile.id ? { ...f, status: 'processing', progress: 5 } : f))
    );

    const fileObj = originalFilesRef.current.get(pendingFile.id);
    if (!fileObj) {
      if (isMountedRef.current) {
        setFiles(prev =>
          prev.map(f =>
            f.id === pendingFile.id
              ? { ...f, status: 'error', errorMsg: 'File object not found' }
              : f
          )
        );
      }
      isProcessingRef.current = false;
      setTimeout(processNextFile, 0);
      return;
    }

    try {
      const buffer = await fileObj.arrayBuffer();
      
      // Convert PDF to Markdown
      const markdown = await convertPdfToMarkdown(buffer, (current, total) => {
        if (!isMountedRef.current) return;
        const percentage = Math.min(Math.round((current / total) * 100), 98);
        setFiles(prev =>
          prev.map(f => (f.id === pendingFile.id ? { ...f, progress: percentage } : f))
        );
      });

      const pageMatches = markdown.match(/<!-- Page \d+ -->/g);
      const pageCount = pageMatches ? pageMatches.length : 1;

      if (isMountedRef.current) {
        setFiles(prev =>
          prev.map(f =>
            f.id === pendingFile.id
              ? { ...f, status: 'completed', progress: 100, markdown, pageCount }
              : f
          )
        );
      }
    } catch (err) {
      console.error('Conversion error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Error parsing PDF document';
      if (isMountedRef.current) {
        setFiles(prev =>
          prev.map(f =>
            f.id === pendingFile.id
              ? {
                  ...f,
                  status: 'error',
                  progress: 0,
                  errorMsg,
                }
              : f
          )
        );
      }
    } finally {
      isProcessingRef.current = false;
      if (isMountedRef.current) {
        setTimeout(processNextFile, 0);
      }
    }
  }, []);

  // Trigger the processing loop whenever a new pending file is present
  useEffect(() => {
    const hasPending = files.some(f => f.status === 'pending');
    if (hasPending) {
      processNextFile();
    }
  }, [files, processNextFile]);

  // Selected file details
  const selectedFile = useMemo(() => {
    return files.find(f => f.id === selectedFileId) || null;
  }, [files, selectedFileId]);

  // Edit markdown content locally
  const handleMarkdownChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (selectedFileId) {
      setFiles(prev =>
        prev.map(f => (f.id === selectedFileId ? { ...f, markdown: e.target.value } : f))
      );
    }
  };

  // Copy markdown to clipboard
  const handleCopyClipboard = () => {
    if (selectedFile && selectedFile.markdown) {
      navigator.clipboard.writeText(selectedFile.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Download single file
  const handleDownloadSingle = () => {
    if (selectedFile && selectedFile.markdown) {
      const blob = new Blob([selectedFile.markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = selectedFile.name.replace(/\.pdf$/i, '') + '.md';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // Download all files as a ZIP preserving the relative folder structure
  const handleDownloadZip = async () => {
    const completedFiles = files.filter(f => f.status === 'completed' && f.markdown);
    if (completedFiles.length === 0) return;

    const zip = new JSZip();
    completedFiles.forEach(file => {
      const zipPath = (file.relativePath || file.name).replace(/\.pdf$/i, '') + '.md';
      zip.file(zipPath, file.markdown);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'markdown_conversions.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Clear queue
  const handleClearQueue = () => {
    setFiles([]);
    setSelectedFileId(null);
    originalFilesRef.current.clear();
  };

  // Delete a specific file from queue
  const handleDeleteFile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFiles(prev => prev.filter(f => f.id !== id));
    originalFilesRef.current.delete(id);
    if (selectedFileId === id) {
      const remaining = files.filter(f => f.id !== id);
      setSelectedFileId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  // Basic HTML parser for rendering Markdown
  const renderMarkdown = (md: string) => {
    if (!md) return '<p style="color: hsl(var(--text-dim)); font-style: italic;">No content available</p>';

    // Escape HTML to prevent XSS
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Handle Page break comments
    html = html.replace(/&lt;!-- Page (\d+) --&gt;/g, (_, num) => {
      return `<div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin: 2rem 0; color: hsl(var(--secondary)); font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; border-top: 1px dashed hsla(var(--secondary), 0.3); border-bottom: 1px dashed hsla(var(--secondary), 0.3); padding: 0.5rem 0;">Page ${num}</div>`;
    });

    // Heading 1
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
    // Heading 2
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    // Heading 3
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');

    // Bold (**text**)
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italic (*text*)
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Code blocks (`code`)
    html = html.replace(/`(.*?)`/g, '<code>$1</code>');

    // Blockquotes
    html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

    // Bullet lists (simple matcher)
    html = html.replace(/^\-\s+(.+)$/gm, '<li>$1</li>');
    // Group adjacent <li> elements inside <ul>
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');

    // Process double linebreaks as paragraph tags
    const paragraphs = html.split('\n\n');
    const formattedParagraphs = paragraphs.map(p => {
      if (p.trim().startsWith('<h') || p.trim().startsWith('<blockquote') || p.trim().startsWith('<ul') || p.trim().startsWith('<div')) {
        return p;
      }
      // Replace single line breaks with <br />
      const withLineBreaks = p.trim().replace(/\n/g, '<br />');
      return `<p>${withLineBreaks}</p>`;
    });

    return formattedParagraphs.join('');
  };

  // Helper format file size
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <main className="app-container">
      {/* Header section */}
      <header className="header-banner">
        <div className="logo-section">
          <div className="logo-icon">
            <FileText size={20} />
          </div>
          <div>
            <h1 className="logo-text">
              pdf2<span className="logo-accent">md</span>.io
            </h1>
          </div>
        </div>
        
        <div className="actions-group">
          <button
            onClick={handleDownloadZip}
            disabled={metrics.completed === 0}
            className="btn btn-primary"
          >
            <Download size={16} />
            Export completed ZIP ({metrics.completed})
          </button>
          <button
            onClick={handleClearQueue}
            disabled={files.length === 0}
            className="btn btn-danger"
          >
            <Trash2 size={16} />
            Clear Queue
          </button>
        </div>
      </header>

      {/* Metrics Dashboard */}
      <section className="dashboard-grid">
        <div className="metric-card">
          <div className="metric-label">
            <BarChart2 size={14} className="glow-text" />
            Conversion Queue
          </div>
          <div className="metric-value">
            {metrics.completed} <span style={{ fontSize: '1rem', color: 'hsl(var(--text-muted))', fontWeight: '400' }}>/ {metrics.total}</span>
          </div>
          <div className="metric-desc">
            {metrics.processing > 0 ? 'Currently converting PDFs...' : 'Queue is idle'}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">
            <FileText size={14} />
            Pages Processed
          </div>
          <div className="metric-value">{metrics.totalPages}</div>
          <div className="metric-desc">Total output markdown pages</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">
            <Sparkles size={14} />
            Total Storage Size
          </div>
          <div className="metric-value">{metrics.totalSizeMB} MB</div>
          <div className="metric-desc">Size of loaded PDF files</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">
            <RefreshCw size={14} className={metrics.processing > 0 ? 'spinner' : ''} />
            System Status
          </div>
          <div className="metric-value" style={{ fontSize: '1.25rem', padding: '0.3rem 0' }}>
            {metrics.processing > 0 ? (
              <span style={{ color: 'hsl(var(--secondary))', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Loader2 size={18} className="spinner" />
                Converting...
              </span>
            ) : metrics.total > 0 && metrics.pending === 0 ? (
              <span style={{ color: 'hsl(var(--success))' }}>All Converted</span>
            ) : (
              <span style={{ color: 'hsl(var(--text-muted))' }}>Standby</span>
            )}
          </div>
          <div className="metric-desc">100% Client-Side Processing</div>
        </div>
      </section>

      {/* Drag & Drop Input Zone */}
      <section
        className={`dropzone-container ${isDragOver ? 'is-dragover' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="dropzone-glow" />
        <div className="dropzone-icon-wrapper">
          <Upload size={32} />
        </div>
        <div>
          <p className="dropzone-title">Drag & drop your PDF files or whole directory here</p>
          <p className="dropzone-subtitle">
            PDFs will be parsed locally, preserving headers, paragraphs, lists and fonts. No data ever leaves your computer.
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }} onClick={e => e.stopPropagation()}>
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <FileText size={16} />
            Select Files
          </button>
          
          <button className="btn btn-secondary" onClick={() => folderInputRef.current?.click()}>
            <Folder size={16} />
            Select Folder
          </button>
        </div>

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          multiple
          accept=".pdf"
          className="dropzone-input"
        />

        <input
          type="file"
          ref={folderInputRef}
          onChange={handleFileChange}
          multiple
          webkitdirectory="true"
          directory="true"
          className="dropzone-input"
        />
        
        <div className="folder-badge">
          <Folder size={12} />
          Directory uploads supported
        </div>
      </section>

      {/* Main Workspace Layout */}
      <section className="workspace-layout">
        {/* Left Side: File Queue */}
        <div className="queue-panel">
          <div className="panel-header">
            <h2 className="panel-title">
              Queue List
              <span className="badge-count">{filteredFiles.length}</span>
            </h2>
          </div>

          {/* Search and Filter */}
          <div style={{ padding: '0.75rem', display: 'flex', gap: '0.5rem', borderBottom: '1px solid hsl(var(--border))' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--text-dim))' }} />
              <input
                type="text"
                placeholder="Search queue..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  background: 'hsla(var(--bg-deep), 0.5)',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.4rem 0.5rem 0.4rem 2rem',
                  fontSize: '0.8rem',
                  color: 'hsl(var(--text-main))',
                  outline: 'none'
                }}
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{
                background: 'hsla(var(--bg-deep), 0.5)',
                border: '1px solid hsl(var(--border))',
                borderRadius: 'var(--radius-sm)',
                padding: '0.4rem 0.5rem',
                fontSize: '0.8rem',
                color: 'hsl(var(--text-main))',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="all" style={{ background: 'hsl(var(--bg-card))', color: 'hsl(var(--text-main))' }}>All</option>
              <option value="completed" style={{ background: 'hsl(var(--bg-card))', color: 'hsl(var(--text-main))' }}>Completed</option>
              <option value="processing" style={{ background: 'hsl(var(--bg-card))', color: 'hsl(var(--text-main))' }}>Processing</option>
              <option value="pending" style={{ background: 'hsl(var(--bg-card))', color: 'hsl(var(--text-main))' }}>Pending</option>
              <option value="error" style={{ background: 'hsl(var(--bg-card))', color: 'hsl(var(--text-main))' }}>Error</option>
            </select>
          </div>

          {/* Files List */}
          <div className="queue-list">
            {filteredFiles.length === 0 ? (
              <div className="queue-empty-state">
                <FileText size={24} style={{ opacity: 0.4 }} />
                <p style={{ fontSize: '0.85rem' }}>No PDFs in queue</p>
              </div>
            ) : (
              filteredFiles.map(file => (
                <div
                  key={file.id}
                  onClick={() => setSelectedFileId(file.id)}
                  className={`queue-item ${selectedFileId === file.id ? 'is-selected' : ''}`}
                >
                  <div className="queue-item-meta">
                    <span className="queue-item-name" title={file.name}>
                      {file.name}
                    </span>
                    <div className="queue-item-details">
                      <span>{formatSize(file.size)}</span>
                      <span>•</span>
                      {file.status === 'pending' && (
                        <span className="status-indicator pending">Pending</span>
                      )}
                      {file.status === 'processing' && (
                        <span className="status-indicator processing">
                          <Loader2 size={12} className="spinner" />
                          {file.progress}%
                        </span>
                      )}
                      {file.status === 'completed' && (
                        <span className="status-indicator completed">
                          <CheckCircle size={12} />
                          Ready
                        </span>
                      )}
                      {file.status === 'error' && (
                        <span className="status-indicator error" title={file.errorMsg}>
                          <AlertCircle size={12} />
                          Failed
                        </span>
                      )}
                    </div>
                    {file.status === 'processing' && (
                      <div className="progress-container">
                        <div className="progress-bar" style={{ width: `${file.progress}%` }} />
                      </div>
                    )}
                  </div>

                  <button
                    onClick={e => handleDeleteFile(file.id, e)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'hsl(var(--text-dim))',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0.25rem'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'hsl(var(--error))')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'hsl(var(--text-dim))')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Side: Preview Panel */}
        <div className="preview-panel">
          {selectedFile ? (
            <>
              {/* Toolbar */}
              <div
                style={{
                  padding: '0.75rem 1.25rem',
                  borderBottom: '1px solid hsl(var(--border))',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}
              >
                <div>
                  <h3
                    style={{
                      fontSize: '0.95rem',
                      fontWeight: '700',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '300px'
                    }}
                    title={selectedFile.name}
                  >
                    {selectedFile.name}
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                    {formatSize(selectedFile.size)}{' '}
                    {selectedFile.pageCount && `• ${selectedFile.pageCount} pages parsed`}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={handleCopyClipboard}
                    disabled={!selectedFile.markdown}
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                  >
                    {copied ? <ClipboardCheck size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>

                  <button
                    onClick={handleDownloadSingle}
                    disabled={!selectedFile.markdown}
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                  >
                    <Download size={14} />
                    Download
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="preview-tabs">
                <button
                  className={`tab-btn ${activeTab === 'preview' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('preview')}
                >
                  Formatted Preview
                </button>
                <button
                  className={`tab-btn ${activeTab === 'editor' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('editor')}
                >
                  Raw Markdown
                </button>
              </div>

              {/* Content Panel */}
              <div className="preview-content">
                {selectedFile.status === 'processing' && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'hsla(var(--bg-deep), 0.85)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '1rem',
                      zIndex: 10
                    }}
                  >
                    <Loader2 size={32} className="spinner" style={{ color: 'hsl(var(--secondary))' }} />
                    <p style={{ fontSize: '0.9rem', color: 'hsl(var(--text-muted))' }}>
                      Parsing PDF content... {selectedFile.progress}%
                    </p>
                  </div>
                )}

                {selectedFile.status === 'error' && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'hsla(var(--bg-deep), 0.85)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '1rem',
                      zIndex: 10,
                      padding: '2rem',
                      textAlign: 'center'
                    }}
                  >
                    <AlertCircle size={36} style={{ color: 'hsl(var(--error))' }} />
                    <h4 style={{ fontWeight: '600' }}>Extraction Failed</h4>
                    <p style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))', maxWidth: '400px' }}>
                      {selectedFile.errorMsg || 'An unknown error occurred while reading this PDF file.'}
                    </p>
                  </div>
                )}

                {selectedFile.status === 'pending' && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'hsla(var(--bg-deep), 0.85)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '1rem',
                      zIndex: 10
                    }}
                  >
                    <RefreshCw size={28} className="animate-pulse-slow" style={{ color: 'hsl(var(--text-dim))' }} />
                    <p style={{ fontSize: '0.9rem', color: 'hsl(var(--text-dim))' }}>
                      Waiting in conversion queue...
                    </p>
                  </div>
                )}

                {activeTab === 'preview' ? (
                  <div
                    className="rendered-markdown"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(selectedFile.markdown) }}
                  />
                ) : (
                  <textarea
                    className="editor-textarea"
                    value={selectedFile.markdown}
                    onChange={handleMarkdownChange}
                    placeholder="Markdown content will appear here once parsed..."
                  />
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'hsl(var(--text-dim))',
                gap: '1rem',
                textAlign: 'center',
                padding: '2rem'
              }}
            >
              <FileText size={48} style={{ opacity: 0.3 }} />
              <div>
                <h4 style={{ color: 'hsl(var(--text-muted))', fontWeight: '600' }}>No Document Selected</h4>
                <p style={{ fontSize: '0.85rem', maxWidth: '300px', marginTop: '0.25rem' }}>
                  Select a PDF from the queue sidebar or upload new documents to start previewing.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
